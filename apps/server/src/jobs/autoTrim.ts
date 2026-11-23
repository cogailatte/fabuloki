import fs from "node:fs";
import path from "node:path";
import {
  alignKeepRangesToFrames,
  analyzeSilence,
  applyTrim,
  remapWordTimestamps,
  toKeepRanges,
  verifyTrim,
  TRIM_PROFILES,
  type SilenceRange,
  type TrimAggressiveness,
  type TrimAnalysis,
  type TrimVerification,
  type WordSpan,
} from "../autoTrim.js";
import { repoRoot } from "../config.js";
import { updateJob } from "../db.js";
import { findDeadWeight, type DeadWeightReport } from "../deadWeight.js";
import { briefOf, projectAssetsDirOf, projectDirOf, readMeta } from "../meta.js";
import type { JobCtx } from "../queue.js";
import { HttpError, ensureDir, fileKind, ffprobeDurationMs, nowIso, toRepoRel } from "../util.js";

const SOURCE_TRANSCRIPT_RELS = ["assets/transcript.raw.json", "assets/transcript.json"];

const REPORT_REL = "assets/auto-trim-report.json";

const CUT_TRANSCRIPT_REL = "assets/transcript.cut.json";

export interface TrimRequest {

  jobId: string;

  sourceRel: string;
  level: TrimAggressiveness;

  cutCandidates: Array<{ start: number; end: number }>;
  createdAt: string;
}

function requestPathOf(projectId: string): string {
  return path.join(projectDirOf(projectId), "auto-trim-request.json");
}

export function writeTrimRequest(projectId: string, req: TrimRequest): void {
  fs.writeFileSync(requestPathOf(projectId), JSON.stringify(req, null, 2) + "\n", "utf8");
}

function takeTrimRequest(projectId: string, jobId: string): TrimRequest | null {
  const file = requestPathOf(projectId);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  fs.rmSync(file, { force: true });
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TrimRequest>;
  if (r.jobId !== jobId) return null;
  return {
    jobId,
    sourceRel: typeof r.sourceRel === "string" ? r.sourceRel : "",
    level: (r.level ?? "default") as TrimAggressiveness,
    cutCandidates: Array.isArray(r.cutCandidates) ? r.cutCandidates : [],
    createdAt: typeof r.createdAt === "string" ? r.createdAt : nowIso(),
  };
}

function resolveInProject(projectId: string, rel: string): string {
  const root = path.resolve(projectDirOf(projectId));
  const inside = (abs: string): boolean => abs === root || abs.startsWith(root + path.sep);

  const fromProject = path.resolve(root, rel);
  if (inside(fromProject) && fs.existsSync(fromProject)) return fromProject;

  const fromRepo = path.resolve(repoRoot, rel);
  if (inside(fromRepo) && fs.existsSync(fromRepo)) return fromRepo;

  if (!inside(fromProject) && !inside(fromRepo)) {
    throw new HttpError(
      400,
      "PATH_OUTSIDE_PROJECT",
      `Đường dẫn "${rel}" nằm ngoài thư mục project "${projectId}"`,
    );
  }
  throw new HttpError(404, "TRIM_SOURCE_NOT_FOUND", `Không thấy video nguồn "${rel}"`);
}

function pickDefaultSource(projectId: string): string | null {
  const assetsDir = projectAssetsDirOf(projectId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(assetsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const videos: Array<{ abs: string; name: string; size: number }> = [];
  for (const e of entries) {
    if (!e.isFile() || fileKind(e.name) !== "video") continue;
    if (/\.cut\./i.test(e.name)) continue;
    const abs = path.join(assetsDir, e.name);
    try {
      videos.push({ abs, name: e.name, size: fs.statSync(abs).size });
    } catch {

    }
  }
  if (videos.length === 0) return null;
  const face = videos.find((v) => /^face\./i.test(v.name));
  if (face) return face.abs;
  return videos.sort((a, b) => b.size - a.size)[0].abs;
}

export function resolveTrimSource(projectId: string, source?: string | null): string {
  const rel = typeof source === "string" ? source.trim() : "";
  if (rel) return resolveInProject(projectId, rel);
  const picked = pickDefaultSource(projectId);
  if (!picked) {
    throw new HttpError(
      404,
      "TRIM_SOURCE_NOT_FOUND",
      `Project "${projectId}" không có video nguồn trong assets/ (bỏ qua các bản *.cut.*). ` +
        "Truyền `source` để chỉ đúng file cần cắt.",
    );
  }
  return picked;
}

export interface SourceTranscript {

  relPath: string;
  absPath: string;

  json: unknown;

  words: WordSpan[];
}

function flattenWords(json: unknown): WordSpan[] {
  const out: WordSpan[] = [];
  const segments =
    Array.isArray(json)
      ? json
      : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).segments)
        ? ((json as Record<string, unknown>).segments as unknown[])
        : [];
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  for (const rawSeg of segments) {
    if (!rawSeg || typeof rawSeg !== "object") continue;
    const seg = rawSeg as Record<string, unknown>;
    const words = Array.isArray(seg.words) ? seg.words : [];
    let added = 0;
    for (const rawWord of words) {
      if (!rawWord || typeof rawWord !== "object") continue;
      const w = rawWord as Record<string, unknown>;
      const start = num(w.start);
      const end = num(w.end);
      if (start === null || end === null || end <= start) continue;
      out.push({ start, end });
      added++;
    }
    if (added > 0) continue;
    const ss = num(seg.start);
    const se = num(seg.end);
    if (ss !== null && se !== null && se > ss) out.push({ start: ss, end: se });
  }
  return out;
}

export function readSourceTranscript(projectId: string): SourceTranscript | null {
  const dir = projectDirOf(projectId);
  for (const rel of SOURCE_TRANSCRIPT_RELS) {
    const abs = path.join(dir, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch {
      continue;
    }
    const words = flattenWords(json);
    if (words.length === 0) continue;
    return { relPath: toRepoRel(abs), absPath: abs, json, words };
  }
  return null;
}

export interface TrimAnalyzeResult {

  source: string;

  transcript: string | null;

  guarded: boolean;
  silence: TrimAnalysis;
  deadWeight: DeadWeightReport;
  note: string;
}

export async function analyzeProjectTrim(input: {
  projectId: string;
  sourceAbs: string;
  level: TrimAggressiveness;
  isCanceled?: () => boolean;
}): Promise<TrimAnalyzeResult> {
  const t = readSourceTranscript(input.projectId);
  const silence = await analyzeSilence(input.sourceAbs, input.level, {
    isCanceled: input.isCanceled,

    ...(t ? { words: t.words } : {}),
  });
  const deadWeight = findDeadWeight(t?.json ?? null);
  return {
    source: toRepoRel(input.sourceAbs),
    transcript: t?.relPath ?? null,
    guarded: !!t,
    silence,
    deadWeight,
    note: t
      ? `Có hàng rào transcript (${t.relPath}, ${t.words.length} mốc chữ) - chỉ khoảng TRỐNG GIỮA CHỮ mới được cắt.`
      : "KHÔNG có transcript (đã tìm " +
        SOURCE_TRANSCRIPT_RELS.join(", ") +
        ") - đo bằng mức âm thanh một mình, con số này không đáng tin theo cả hai chiều và " +
        "danh sách mỡ thừa rỗng. Bóc băng trước rồi phân tích lại.",
  };
}

export function mergeCutRanges(ranges: Array<{ start: number; end: number }>): SilenceRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end, duration: 0 }))
    .sort((a, b) => a.start - b.start);
  const out: SilenceRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-6) {
      if (r.end > last.end) last.end = r.end;
      continue;
    }
    out.push({ ...r });
  }
  for (const r of out) r.duration = round3(r.end - r.start);
  return out;
}

const WORD_EDGE_TOLERANCE_SEC = 0.02;

export function guardWordMidpoints(
  cuts: SilenceRange[],
  words: WordSpan[],
): { kept: SilenceRange[]; dropped: SilenceRange[] } {
  if (words.length === 0) return { kept: cuts, dropped: [] };
  const spans = words.filter(
    (w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start,
  );
  const kept: SilenceRange[] = [];
  const dropped: SilenceRange[] = [];
  for (const c of cuts) {
    const splitsWord = spans.some((w) => {
      const m = (w.start + w.end) / 2;
      if (m < c.start || m > c.end) return false;
      return (
        w.start < c.start - WORD_EDGE_TOLERANCE_SEC || w.end > c.end + WORD_EDGE_TOLERANCE_SEC
      );
    });
    if (splitsWord) dropped.push(c);
    else kept.push(c);
  }
  return { kept, dropped };
}

export { toKeepRanges };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function totalSec(ranges: Array<{ start: number; end: number }>): number {
  return ranges.reduce((s, r) => s + (r.end - r.start), 0);
}

export interface AutoTrimReport {
  createdAt: string;
  jobId: string;
  level: TrimAggressiveness;
  profile: TrimAnalysis["profile"];

  source: string;

  output: string | null;
  transcript: { source: string | null; cut: string | null; guarded: boolean };
  duration: { beforeSec: number; afterSec: number | null; removedSec: number };

  removed: { silenceSec: number; approvedSec: number; ranges: number };
  threshold: { db: number; noiseFloorDb: number; note: string };
  candidates: {
    approved: number;

    rejected: Array<{ start: number; end: number }>;
  };
  verification: TrimVerification & { measuredOn: string; guarded: boolean };
  verdict: "pass" | "fail";
  note: string;
}

function reportPathOf(projectId: string): string {
  return path.join(projectDirOf(projectId), ...REPORT_REL.split("/"));
}

export async function runAutoTrim(ctx: JobCtx): Promise<void> {
  const projectId = ctx.job.projectId;
  const projectDir = projectDirOf(projectId);
  const req = takeTrimRequest(projectId, ctx.job.id);
  const brief = briefOf(readMeta(projectId));

  const level: TrimAggressiveness =
    req?.level ??

    (ctx.job.sceneId && Object.hasOwn(TRIM_PROFILES, ctx.job.sceneId)
      ? (ctx.job.sceneId as TrimAggressiveness)
      : brief.autoCutLevel);
  const sourceAbs = resolveTrimSource(projectId, req?.sourceRel ?? null);
  const approved = mergeCutRanges(req?.cutCandidates ?? []);

  ctx.log(`[trim] Nguồn: ${toRepoRel(sourceAbs)}`);
  ctx.log(
    `[trim] Mức "${level}" - khoảng lặng >= ${TRIM_PROFILES[level].minSilenceSec}s, ` +
      `chừa ${TRIM_PROFILES[level].padSec}s mỗi mép, trần còn lại ${TRIM_PROFILES[level].maxResidualSec}s.`,
  );
  ctx.log(
    approved.length > 0
      ? `[trim] Nhận ${approved.length} khoảng mỡ thừa ĐÃ DUYỆT (${totalSec(approved).toFixed(2)}s).`
      : "[trim] Không có ứng viên mỡ thừa nào được duyệt - chỉ cắt khoảng lặng đo được.",
  );

  ctx.progress(5, "Đo khoảng lặng");
  const analysis = await analyzeProjectTrim({
    projectId,
    sourceAbs,
    level,
    isCanceled: () => ctx.isCanceled(),
  });
  const words = readSourceTranscript(projectId)?.words ?? [];
  ctx.log(`[trim] ${analysis.note}`);
  ctx.log(
    `[trim] Ngưỡng ${analysis.silence.thresholdDb}dB, nền nhiễu ${analysis.silence.noiseFloorDb}dB. ` +
      `${analysis.silence.thresholdNote ?? ""}`,
  );
  ctx.log(
    `[trim] Máy đo được ${analysis.silence.silences.length} khoảng lặng đáng cắt ` +
      `(${analysis.silence.removedSec.toFixed(2)}s / ${analysis.silence.durationSec.toFixed(2)}s).`,
  );
  if (ctx.isCanceled()) return;

  ctx.progress(40, "Gộp khoảng cắt");
  const silenceCuts = mergeCutRanges(analysis.silence.silences);
  const guardedApproved = guardWordMidpoints(approved, words);
  if (guardedApproved.dropped.length > 0) {
    ctx.log(
      `[trim] LOẠI ${guardedApproved.dropped.length} ứng viên đã duyệt vì đè lên TRUNG ĐIỂM của chữ ` +
        `(cắt vào là nuốt lời nói): ` +
        guardedApproved.dropped
          .map((r) => `${r.start.toFixed(2)}-${r.end.toFixed(2)}s`)
          .join(", "),
    );
  }
  const allCuts = mergeCutRanges([...silenceCuts, ...guardedApproved.kept]);
  const silenceSec = round3(totalSec(silenceCuts));
  const approvedSec = round3(Math.max(0, totalSec(allCuts) - silenceSec));
  const beforeSec = analysis.silence.durationSec;
  const keepRanges = toKeepRanges(allCuts, beforeSec);
  ctx.log(
    `[trim] Tổng ${allCuts.length} khoảng sẽ cắt = ${totalSec(allCuts).toFixed(2)}s ` +
      `(khoảng lặng ${silenceSec.toFixed(2)}s + mỡ thừa đã duyệt ${approvedSec.toFixed(2)}s), ` +
      `giữ lại ${keepRanges.length} đoạn.`,
  );

  ctx.progress(50, "Cắt video");
  const stem = path.basename(sourceAbs, path.extname(sourceAbs));
  const outAbs = path.join(projectAssetsDirOf(projectId), `${stem}.cut.mp4`);
  if (path.resolve(outAbs) === path.resolve(sourceAbs)) {
    throw new Error(
      `File đích trùng file nguồn (${toRepoRel(outAbs)}) - từ chối cắt đè lên chính bản gốc.`,
    );
  }
  ensureDir(path.dirname(outAbs));
  const cutTranscriptAbs = path.join(projectDir, ...CUT_TRANSCRIPT_REL.split("/"));

  if (fs.existsSync(outAbs)) {
    fs.rmSync(outAbs, { force: true });

    fs.rmSync(cutTranscriptAbs, { force: true });
    ctx.log(`[trim] Đã xóa bản cắt cũ ${toRepoRel(outAbs)} (kèm transcript.cut.json) trước khi cắt lại.`);
  }

  const cutKeep = await alignKeepRangesToFrames(sourceAbs, keepRanges, {
    isCanceled: () => ctx.isCanceled(),
    onLog: (line) => ctx.log(line),
  });
  try {
    await applyTrim(sourceAbs, cutKeep, outAbs, {
      isCanceled: () => ctx.isCanceled(),
      onLog: (line) => ctx.log(line),
    });
  } catch (err) {

    fs.rmSync(outAbs, { force: true });
    throw err;
  }
  if (ctx.isCanceled()) {

    fs.rmSync(outAbs, { force: true });
    return;
  }
  const cut = fs.existsSync(outAbs);
  if (!cut) {
    ctx.log(
      "[trim] Không có gì đáng cắt - GIỮ NGUYÊN file gốc, không sinh bản .cut.mp4 " +
        "(encode lại một bản y hệt chỉ làm giảm chất).",
    );
  }

  ctx.progress(80, "Dời mốc transcript");
  const src = readSourceTranscript(projectId);
  let cutTranscriptRel: string | null = null;
  let cutWords: WordSpan[] = words;
  if (src && cut) {
    const remapped = remapWordTimestamps(src.json, cutKeep);
    const cutAbs = cutTranscriptAbs;
    ensureDir(path.dirname(cutAbs));
    fs.writeFileSync(cutAbs, JSON.stringify(remapped, null, 2) + "\n", "utf8");
    cutTranscriptRel = toRepoRel(cutAbs);
    cutWords = flattenWords(remapped);
    ctx.log(
      `[trim] Đã dời mốc transcript sang hệ thời gian bản cắt: ${cutTranscriptRel} ` +
        `(${words.length} -> ${cutWords.length} mốc chữ).`,
    );
  } else if (src && !cut) {

    ctx.log("[trim] Không cắt gì nên transcript gốc vẫn đúng - không ghi transcript.cut.json.");
  } else {
    ctx.log("[trim] Không có transcript để dời mốc.");
  }

  ctx.progress(88, "Nghiệm thu bản đã cắt");
  const measuredAbs = cut ? outAbs : sourceAbs;
  const verification = await verifyTrim(measuredAbs, level, {
    isCanceled: () => ctx.isCanceled(),

    ...(cutWords.length > 0 ? { words: cutWords } : {}),
  });
  if (ctx.isCanceled()) return;

  const afterMs = await ffprobeDurationMs(measuredAbs);
  const afterSec = afterMs === null ? null : round3(afterMs / 1000);

  const verdict: "pass" | "fail" = verification.pass ? "pass" : "fail";
  const report: AutoTrimReport = {
    createdAt: nowIso(),
    jobId: ctx.job.id,
    level,
    profile: analysis.silence.profile,
    source: toRepoRel(sourceAbs),
    output: cut ? toRepoRel(outAbs) : null,
    transcript: {
      source: analysis.transcript,
      cut: cutTranscriptRel,
      guarded: analysis.guarded,
    },
    duration: {
      beforeSec,
      afterSec,
      removedSec: afterSec === null ? round3(totalSec(allCuts)) : round3(beforeSec - afterSec),
    },
    removed: { silenceSec, approvedSec, ranges: allCuts.length },
    threshold: {
      db: analysis.silence.thresholdDb,
      noiseFloorDb: analysis.silence.noiseFloorDb,
      note: analysis.silence.thresholdNote ?? "",
    },
    candidates: {
      approved: guardedApproved.kept.length,
      rejected: guardedApproved.dropped.map((r) => ({ start: r.start, end: r.end })),
    },
    verification: {
      ...verification,
      measuredOn: toRepoRel(measuredAbs),
      guarded: cutWords.length > 0,
    },
    verdict,
    note: cut
      ? `Đã cắt ${round3(totalSec(allCuts))}s trong ${allCuts.length} khoảng.`
      : "Không cắt được gì - dùng tiếp file gốc.",
  };
  ensureDir(path.dirname(reportPathOf(projectId)));
  fs.writeFileSync(reportPathOf(projectId), JSON.stringify(report, null, 2) + "\n", "utf8");
  ctx.log(`[trim] Báo cáo: ${toRepoRel(reportPathOf(projectId))}`);

  if (cut) updateJob(ctx.job.id, { outputPath: toRepoRel(outAbs) });

  if (verdict === "fail") {
    ctx.log(
      `[trim] ⚠ CHƯA ĐẠT mức "${level}": ${verification.reason ?? "(không có lý do)"}`,
    );
    ctx.log(
      `[trim] ⚠ Còn ${verification.totalSilenceSec.toFixed(2)}s lặng ` +
        `(${(verification.ratio * 100).toFixed(1)}% thời lượng), chỗ dài nhất ${verification.longest.toFixed(2)}s. ` +
        "Kết quả KHÔNG đạt profile - duyệt thêm ứng viên mỡ thừa rồi chạy lại, hoặc chấp nhận có ý thức.",
    );
    ctx.progress(100, `Đã cắt nhưng CHƯA ĐẠT mức "${level}"`);
  } else {
    ctx.log(
      `[trim] Đạt mức "${level}": còn ${verification.totalSilenceSec.toFixed(2)}s lặng ` +
        `(${(verification.ratio * 100).toFixed(1)}%), chỗ dài nhất ${verification.longest.toFixed(2)}s.`,
    );
    ctx.progress(100, "Cắt xong, nghiệm thu đạt");
  }
}
