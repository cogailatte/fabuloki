import fs from "node:fs";
import path from "node:path";
import { runAgent } from "../agent.js";
import {
  autoCutDirOf,
  briefOfAutoCut,
  patchAutoCut,
  readAutoCut,
  targetSizeOf,
  writeAutoCut,
  type AutoCutLayout,
  type AutoCutMeta,
  type AutoCutSegment,
} from "../autoCutMeta.js";
import { planAutoCutSegments } from "../autoCutPlan.js";
import { createChildProject, prepareEditSession, sceneAssetPath } from "../childProject.js";
import { repoRoot } from "../config.js";
import { geminiApiKey } from "../gemini.js";
import { generateImage, resolveProviders } from "../imageProviders/index.js";
import type { ImageAspect } from "../imageMeta.js";
import { projectAssetsDirOf, readMeta } from "../meta.js";
import type { JobCtx } from "../queue.js";
import {
  chooseEncoder,
  classifyFrame,
  detectSubjectOverRange,
  probeVideo,
  runCutReframe,
  sameAspect,
  type ReframeLayout,
} from "../reframe.js";
import { getStyle } from "../styles.js";
import { parseTranscriptJson, type TranscriptSegment } from "../transcript.js";
import { transcribeVideo } from "../transcribe.js";
import { ensureDir, toKebabAscii, toRepoRel } from "../util.js";

export async function runAutoCut(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const step = ctx.job.sceneId === "cut" ? "cut" : "plan";
  try {
    if (step === "cut") await stepCut(ctx, id);
    else await stepPlan(ctx, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {

      if (ctx.isCanceled()) {
        const cur = readAutoCut(id);
        patchAutoCut(id, {
          status: cur.segments.length > 0 ? "planned" : "draft",
          error: null,
          failedStep: null,
        });
      } else {

        patchAutoCut(id, { status: "failed", error: message, failedStep: step });
      }
    } catch {

    }
    throw err;
  }
}

async function stepPlan(ctx: JobCtx, id: string): Promise<void> {

  let meta = patchAutoCut(id, { status: "planning", error: null, failedStep: null });
  const dir = autoCutDirOf(id);
  ensureDir(dir);

  const videoAbs = sourceVideoAbs(meta);
  ctx.log(`[plan] Nguồn: ${meta.source.relPath} (${meta.source.width}x${meta.source.height})`);

  let transcriptAbs: string | null = null;
  if (meta.transcribe) {
    const outJson = path.join(dir, "transcript.json");
    if (fs.existsSync(outJson) && fs.statSync(outJson).size > 0) {

      ctx.log("[plan] Đã có transcript.json từ lần chạy trước - dùng lại.");
      transcriptAbs = outJson;
      ctx.progress(60, "Dùng lại transcript có sẵn");
    } else {
      ctx.progress(5, "Transcribe video nguồn");
      const res = await transcribeVideo({
        videoAbs,
        outJsonAbs: outJson,
        language: "vi",
        onLog: (line) => ctx.log(line),

        isCanceled: () => ctx.isCanceled(),
      });
      transcriptAbs = outJson;
      ctx.log(
        `[plan] Transcript: ${res.segments} đoạn, ${res.durationSec.toFixed(1)}s, ngôn ngữ ${res.language}`,
      );
      ctx.progress(60, "Đã có transcript");
    }
    meta = patchAutoCut(id, { transcriptRel: toRepoRel(outJson) });
  } else if (meta.transcriptRel) {

    const abs = path.join(repoRoot, meta.transcriptRel);
    if (fs.existsSync(abs)) transcriptAbs = abs;
    ctx.progress(60, "Dùng transcript có sẵn");
  } else {
    ctx.progress(60, "Bỏ qua transcribe");
  }

  ctx.progress(65, "Chọn đoạn cắt");
  const segments = await planAutoCutSegments({
    meta,
    transcriptAbs,
    onLog: (line) => ctx.log(line),
  });
  ctx.progress(95, "Ghi danh sách đoạn");

  const clean = segments.map((s, i) => ({ ...s, index: Number.isInteger(s.index) ? s.index : i }));
  if (clean.length === 0) {

    ctx.log(
      "[plan] Không chọn được đoạn nào (video quá ngắn, transcript rỗng hoặc yêu cầu quá hẹp). " +
        "Đổi chế độ/tham số rồi chạy lại bước chọn đoạn.",
    );
  } else {
    for (const s of clean) {
      ctx.log(`[plan] #${s.index} ${fmt(s.start)}-${fmt(s.end)} "${s.title}"`);
    }
  }

  patchAutoCut(id, { segments: clean, status: "planned", error: null, failedStep: null });
  ctx.progress(100, `Đã chọn ${clean.length} đoạn`);
}

async function stepCut(ctx: JobCtx, id: string): Promise<void> {

  let meta = patchAutoCut(id, { status: "cutting", error: null, failedStep: null });
  const dir = autoCutDirOf(id);
  const segDir = path.join(dir, "segments");
  ensureDir(segDir);

  const videoAbs = sourceVideoAbs(meta);
  const target = targetSizeOf(meta.output.aspect, meta.source);
  const outFps = pickFps(meta);

  const sessionBrief = briefOfAutoCut(meta);

  const todo = meta.segments.filter((s) => s.selected !== false && !s.projectId);
  const already = meta.segments.filter((s) => s.projectId).length;
  if (todo.length === 0) {
    ctx.log(
      already > 0
        ? `[cut] Mọi đoạn đã chọn đều có project con rồi (${already} đoạn) - không có gì để cắt.`
        : "[cut] Không có đoạn nào được chọn - hãy tích chọn đoạn rồi chạy lại.",
    );
    patchAutoCut(id, { status: "done", error: null, failedStep: null });
    return;
  }

  const probe = await probeVideo(videoAbs);
  const source = { width: probe.width, height: probe.height };
  ctx.log(
    `[cut] Nguồn ${source.width}x${source.height} @${probe.fps.toFixed(2)}fps` +
      `${probe.rotation ? ` (rotation ${probe.rotation}°, đã hoán đổi W/H)` : ""} -> ` +
      `${target.width}x${target.height} @${outFps.toFixed(2)}fps`,
  );

  const noReframe = sameAspect(source, target);
  if (noReframe) {
    ctx.log("[cut] Tỉ lệ nguồn trùng tỉ lệ đích - chỉ cắt, không đổi khung (bỏ qua vision).");
  }

  const apiKey = geminiApiKey();
  const encoder = await chooseEncoder();
  ctx.log(`[cut] Encoder: ${encoder === "nvenc" ? "h264_nvenc (GPU)" : "libx264 (CPU)"}`);

  const backgroundAbs = await prepareBackground(ctx, meta, target, noReframe);

  const createdIds: string[] = [];
  for (let i = 0; i < todo.length; i++) {
    if (ctx.isCanceled()) {
      ctx.log(`[cut] Job bị hủy - giữ nguyên ${createdIds.length} đoạn đã xong.`);
      patchAutoCut(id, { status: "planned", error: null, failedStep: null });
      return;
    }
    const seg = todo[i];
    const base = 10 + (85 * i) / todo.length;
    ctx.progress(base, `Đoạn ${i + 1}/${todo.length}: ${seg.title}`);

    const layout = await resolveLayout(ctx, {
      configured: meta.output.layout,
      noReframe,
      videoAbs,
      atSec: (seg.start + seg.end) / 2,
      apiKey,
    });

    let center: { x: number; y: number } | null = null;
    if (layout === "crop" && !noReframe) {
      const found = await detectSubjectOverRange({
        videoAbs,
        start: seg.start,
        end: seg.end,
        apiKey,
        onLog: (line) => ctx.log(line),
      });
      center = { x: found.centerX, y: found.centerY };
      ctx.log(
        `[cut] #${seg.index} tâm chủ thể ${found.found ? "" : "(mặc định) "}` +
          `x=${center.x.toFixed(3)} y=${center.y.toFixed(3)}`,
      );
    }

    const fileName = segmentFileName(seg);
    const cutAbs = path.join(segDir, fileName);
    ctx.progress(base + 20 / todo.length, `Cắt đoạn ${i + 1}/${todo.length}`);
    const usedEncoder = await runCutReframe(
      {
        srcAbs: videoAbs,
        outAbs: cutAbs,
        start: seg.start,
        end: seg.end,
        source,
        target,
        layout,
        center,
        backgroundKind: meta.output.background,
        backgroundAbs,
        backgroundColor: getStyle(meta.output.styleId).colors.background,
        encoder,
        fps: outFps,
      },
      {
        exec: (file, args) => ctx.exec(file, args, repoRoot),
        log: (line) => ctx.log(line),
      },
    );
    if (!fs.existsSync(cutAbs)) {
      throw new Error(`ffmpeg chạy xong nhưng không thấy file cắt "${fileName}"`);
    }
    ctx.log(
      `[cut] #${seg.index} ${fmt(seg.start)}-${fmt(seg.end)} layout=${layout} ` +
        `encoder=${usedEncoder} -> ${fileName}`,
    );

    ctx.progress(base + 50 / todo.length, `Tạo project cho đoạn ${i + 1}/${todo.length}`);
    const child = createChildProject({

      parentId: null,
      name: `${meta.name} - ${seg.title}`.slice(0, 120),
      width: target.width,
      height: target.height,
      fps: Math.max(1, Math.round(outFps)),
      copyFiles: [{ srcAbs: cutAbs, destRel: fileName }],

      scenes: [{ id: "src", srcVideo: sceneAssetPath(fileName) }],
      brief: {

        ...sessionBrief,

        styleId: meta.output.styleId,
        sourceDescription:
          `Đoạn ${fmt(seg.start)}-${fmt(seg.end)} giây cắt ra từ video nguồn ` +
          `"${meta.source.relPath}" (phiên Auto cut "${meta.name}"). ` +
          `File trong assets/ ĐÃ được cắt sẵn đúng khoảng này và đã đổi khung về ` +
          `${target.width}x${target.height} (${layout === "crop" ? "cúp bám chủ thể" : "thu nhỏ + nền"}).` +
          (seg.reason ? ` Lý do chọn: ${seg.reason}` : ""),

        mainKey: sessionBrief.mainKey.trim() || seg.title,

        notes: [childNotes(seg, fileName, target, layout, sessionBrief.autoCut), sessionBrief.notes.trim()]
          .filter(Boolean)
          .join("\n\n"),
      },
    });
    createdIds.push(child.id);

    writeChildTranscript(ctx, meta, child.id, seg);

    const fresh = readAutoCut(id);
    const row = fresh.segments.find((s) => s.index === seg.index);
    if (row) {
      row.projectId = child.id;
      row.appliedLayout = layout;
    }
    writeAutoCut(fresh);
    meta = fresh;

    try {
      fs.rmSync(cutAbs, { force: true });
    } catch {

    }
    ctx.log(`[cut] #${seg.index} -> project "${child.id}"`);
  }

  if (meta.autoEdit && createdIds.length > 0) {
    startAutoEdits(ctx, createdIds);
  }

  ctx.progress(100, `Đã tạo ${createdIds.length} project`);
  patchAutoCut(id, { status: "done", error: null, failedStep: null });
}

function sourceVideoAbs(meta: AutoCutMeta): string {
  const abs = path.join(repoRoot, meta.source.relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Không thấy video nguồn "${meta.source.relPath}" - file đã bị xóa hoặc di chuyển khỏi repo.`,
    );
  }
  return abs;
}

function pickFps(meta: AutoCutMeta): number {
  const wanted = meta.output.fps ?? meta.source.fps;
  return Number.isFinite(wanted) && wanted > 0 ? Math.min(120, wanted) : 30;
}

async function resolveLayout(
  ctx: JobCtx,
  input: {
    configured: AutoCutLayout;
    noReframe: boolean;
    videoAbs: string;
    atSec: number;
    apiKey: string | null;
  },
): Promise<ReframeLayout> {
  if (input.noReframe) return "crop";
  if (input.configured !== "auto") return input.configured;
  const kind = await classifyFrame({
    videoAbs: input.videoAbs,
    atSec: input.atSec,
    apiKey: input.apiKey,
  });
  const layout: ReframeLayout = kind === "person" ? "crop" : "fit";
  ctx.log(`[cut] Gemini phân loại khung: ${kind} -> layout ${layout}`);
  return layout;
}

async function prepareBackground(
  ctx: JobCtx,
  meta: AutoCutMeta,
  target: { width: number; height: number },
  noReframe: boolean,
): Promise<string | null> {
  if (noReframe) return null;
  if (meta.output.background !== "gemini") return null;

  if (meta.output.layout === "crop") {
    ctx.log("[cut] Layout crop nên không cần nền - bỏ qua tạo nền Gemini.");
    return null;
  }

  if (resolveProviders(null, null).chain.length === 0) {
    ctx.log("[warn] Chưa cấu hình nhà cung cấp tạo ảnh nào - dùng nền mờ từ chính video thay cho nền AI.");
    return null;
  }

  const outFile = path.join(autoCutDirOf(meta.id), "background.png");
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    ctx.log("[cut] Dùng lại background.png đã tạo ở lần chạy trước.");
    return outFile;
  }

  ctx.progress(5, "AI tạo ảnh nền");
  try {
    const { provider } = await generateImage({
      prompt:
        "A calm, non-distracting backdrop for a talking-head video clip that will be placed in the middle of the frame. " +
        "Keep the central band simple and low contrast so the video on top stays the focus.",
      kind: "background",
      aspect: imageAspectOf(target),

      width: target.width,
      height: target.height,
      design: getStyle(meta.output.styleId),
      outFile,
      usageProjectId: meta.id,
      allowText: false,
      onLog: (l) => ctx.log(l),
    });
    ctx.log(`[cut] Đã tạo nền AI (${provider}): ${toRepoRel(outFile)}`);
    return outFile;
  } catch (err) {
    ctx.log(
      `[warn] Tạo nền AI thất bại (${err instanceof Error ? err.message : String(err)}) - ` +
        "rơi về nền mờ từ chính video.",
    );
    return null;
  }
}

function imageAspectOf(target: { width: number; height: number }): ImageAspect {
  const ratio = target.width / target.height;
  const options: Array<[ImageAspect, number]> = [
    ["9:16", 9 / 16],
    ["4:5", 4 / 5],
    ["1:1", 1],
    ["16:9", 16 / 9],
  ];
  let best = options[0];
  for (const opt of options) {
    if (Math.abs(opt[1] - ratio) < Math.abs(best[1] - ratio)) best = opt;
  }
  return best[0];
}

function segmentFileName(seg: AutoCutSegment): string {
  const slug = toKebabAscii(seg.title).slice(0, 40).replace(/-+$/, "");
  return `${String(seg.index).padStart(2, "0")}-${slug || "doan"}.mp4`;
}

function childNotes(
  seg: AutoCutSegment,
  fileName: string,
  target: { width: number; height: number },
  layout: ReframeLayout,
  autoCut: boolean,
): string {
  const lines = [
    "## Đoạn cắt tự động (Auto cut videos)",
    `- File \`${sceneAssetPath(fileName)}\` ĐÃ được cắt đúng khoảng ${fmt(seg.start)}-${fmt(seg.end)} giây ` +
      "của video gốc và ĐÃ đổi về khung " +
      `${target.width}x${target.height}. Dùng TRỌN file này, TUYỆT ĐỐI không đặt thêm \`from\`/\`to\` ` +
      "để cắt lần nữa (sẽ mất phần đầu/cuối).",
    `- Khung đã xử lý theo kiểu \`${layout}\` (${
      layout === "crop" ? "cúp bám chủ thể, chủ thể đã ở giữa khung" : "thu nhỏ giữ trọn hình + nền lấp"
    }) - không cần crop/scale lại.`,
    "- `assets/transcript.json` là transcript RIÊNG của đoạn này, mốc giây đã quy về 0 " +
      "(0 = đầu video ngắn)" +

      (autoCut
        ? " - đây là bản GỐC trước bước tự động cắt; cắt xong thì phụ đề/karaoke phải theo " +
          "`assets/transcript.cut.json` như mục Tự động cắt hướng dẫn."
        : " - dùng thẳng cho phụ đề/karaoke, không phải trừ gì thêm."),
    `- Đây là video NGẮN (${target.width}x${target.height}): nhịp nhanh, chữ to, mọi thông tin nằm trong vùng an toàn.`,
  ];
  if (seg.hook) lines.push(`- Mở đầu video là hook: "${seg.hook}".`);
  if (seg.reason) lines.push(`- Lý do đoạn này được chọn: ${seg.reason}`);
  return lines.join("\n");
}

function writeChildTranscript(
  ctx: JobCtx,
  meta: AutoCutMeta,
  childId: string,
  seg: AutoCutSegment,
): void {
  const rel = meta.transcriptRel;
  if (!rel) return;
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return;

  let all: TranscriptSegment[] | null = null;
  try {
    all = parseTranscriptJson(JSON.parse(fs.readFileSync(abs, "utf8")));
  } catch {
    all = null;
  }
  if (!all || all.length === 0) {
    ctx.log(`[warn] Transcript phiên không đọc được - project "${childId}" chưa có phụ đề.`);
    return;
  }

  const span = seg.end - seg.start;
  const shifted: TranscriptSegment[] = all
    .filter((s) => s.end > seg.start && s.start < seg.end)
    .map((s) => ({
      start: round3(clampRange(s.start - seg.start, 0, span)),
      end: round3(clampRange(s.end - seg.start, 0, span)),
      text: s.text,
      words: (s.words ?? [])
        .filter((w) => w.end > seg.start && w.start < seg.end)
        .map((w) => ({
          word: w.word,
          start: round3(clampRange(w.start - seg.start, 0, span)),
          end: round3(clampRange(w.end - seg.start, 0, span)),
        })),
    }));

  const dest = path.join(projectAssetsDirOf(childId), "transcript.json");
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, JSON.stringify({ segments: shifted }, null, 2) + "\n", "utf8");
  ctx.log(`[cut] Transcript đoạn: ${shifted.length} câu -> ${toRepoRel(dest)}`);
}

const MAX_AUTO_EDIT = 3;

function startAutoEdits(ctx: JobCtx, childIds: string[]): void {
  const picked = childIds.slice(0, MAX_AUTO_EDIT);
  const tasks = picked.map((childId) =>
    prepareEditSession({ id: childId, meta: readMeta(childId) }),
  );
  const rest = childIds.length - picked.length;
  ctx.log(
    `[cut] Mở ${tasks.length} phiên edit AI (chạy nền, tuần tự).` +
      (rest > 0
        ? ` ${rest} project còn lại không tự edit (tối đa ${MAX_AUTO_EDIT} mỗi lần vì mỗi phiên rất nặng máy) - ` +
          'hãy bấm "Edit bằng AI" khi cần.'
        : ""),
  );
  void (async () => {
    for (const t of tasks) {
      try {
        await runAgent(t.sessionId, t.prompt);
      } catch {

      }
    }
  })();
}

function clampRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function fmt(sec: number): string {
  return (Math.round(sec * 100) / 100).toString();
}
