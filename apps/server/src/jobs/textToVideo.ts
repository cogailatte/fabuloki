import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../config.js";
import { createChildProject, prepareEditSession } from "../childProject.js";
import { normOutput, readMeta, writeMeta } from "../meta.js";
import { runAgent } from "../agent.js";
import { transcribeVideo } from "../transcribe.js";
import { synthScript } from "../tts.js";
import {
  patchTextToVideo,
  readTextToVideo,
  scriptTextOf,
  textToVideoDirOf,
  type TextToVideoMeta,
} from "../textToVideoMeta.js";
import { ensureDir, toRepoRel } from "../util.js";
import type { JobCtx } from "../queue.js";

const MIN_SCRIPT_CHARS = 80;

export async function runTextToVideo(ctx: JobCtx): Promise<void> {

  const id = ctx.job.projectId;
  const meta = readTextToVideo(id);

  try {
    await build(ctx, meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (ctx.isCanceled()) {
      patchTextToVideo(id, { status: "ready", error: null });
    } else {
      patchTextToVideo(id, { status: "failed", error: message });
    }
    throw err;
  }
}

async function build(ctx: JobCtx, meta: TextToVideoMeta): Promise<void> {
  const id = meta.id;
  const dir = textToVideoDirOf(id);
  const script = scriptTextOf(meta).trim();

  if (script.length < MIN_SCRIPT_CHARS) {
    throw new Error(
      `Kịch bản đọc quá ngắn (${script.length} ký tự) - viết kịch bản trước khi dựng video.`,
    );
  }
  if (meta.projectId) {
    throw new Error(
      `Phiên này đã tạo project "${meta.projectId}" rồi - xóa project đó hoặc tạo phiên mới.`,
    );
  }

  patchTextToVideo(id, { status: "voicing", error: null });
  ctx.progress(2, "Tổng hợp giọng đọc");

  const voiceDir = path.join(dir, "voice");
  ensureDir(voiceDir);
  const wavAbs = path.join(dir, "voice.wav");

  const chunks = meta.script.map((c) => c.text.trim()).filter(Boolean);
  const synth = await synthScript({
    chunks,
    engine: meta.voice.engine,
    speed: meta.voice.speed,
    voice: meta.voice.name,
    model: meta.voice.model,
    style: meta.voice.style,
    language: meta.voice.language,
    workDir: voiceDir,
    outWavAbs: wavAbs,
    onProgress: (done, total) => {

      ctx.progress(2 + Math.round((done / Math.max(1, total)) * 43), `Đọc đoạn ${done}/${total}`);
    },
    onLog: (line) => ctx.log(line),
    isCanceled: () => ctx.isCanceled(),
  });
  if (ctx.isCanceled()) throw new Error("Job đã bị hủy");

  ctx.log(`[tts] giọng đọc dài ${synth.durationSec.toFixed(2)}s`);
  const scriptWithDurations = meta.script.map((c, i) => ({
    ...c,
    durationSec: synth.chunkDurations[i] ?? null,
  }));
  patchTextToVideo(id, {
    voiceFile: toRepoRel(wavAbs),
    voiceDurationSec: synth.durationSec,
    script: scriptWithDurations,
  });

  ctx.progress(48, "Lấy mốc thời gian từng từ");
  const transcriptAbs = path.join(dir, "transcript.json");
  await transcribeVideo({
    videoAbs: wavAbs,
    outJsonAbs: transcriptAbs,
    language: "vi",
    onLog: (line) => ctx.log(line),
    isCanceled: () => ctx.isCanceled(),
  });
  if (ctx.isCanceled()) throw new Error("Job đã bị hủy");
  patchTextToVideo(id, { transcriptFile: toRepoRel(transcriptAbs) });

  ctx.progress(72, "Tạo Videos Project");
  patchTextToVideo(id, { status: "building" });

  const fresh = readTextToVideo(id);
  const summary = createChildProject({
    parentId: null,
    name: fresh.name,
    width: fresh.output.width,
    height: fresh.output.height,
    fps: fresh.output.fps,
    brief: {
      ...fresh.brief,
      styleId: fresh.output.styleId,

      autoCut: false,
      sourceDescription: sourceDescriptionOf(fresh),
      notes: [briefNotesOf(fresh), fresh.brief.notes.trim()].filter(Boolean).join("\n\n"),
    },
    copyFiles: [
      { srcAbs: wavAbs, destRel: "voice.wav" },
      { srcAbs: transcriptAbs, destRel: "transcript.json" },
    ],
  });

  const projectMeta = readMeta(summary.id);
  projectMeta.audio = {
    ...(projectMeta.audio ?? { voice: null, sfx: [] }),

    voice: "assets/voice.wav",
  };

  projectMeta.textToVideoId = id;
  writeMeta(summary.id, projectMeta);

  patchTextToVideo(id, { projectId: summary.id, status: "editing", error: null });
  ctx.log(`[text-to-video] đã tạo project "${summary.id}"`);

  ctx.progress(88, "Bắt đầu edit bằng AI");
  const session = prepareEditSession({ id: summary.id, meta: readMeta(summary.id) });

  void runAgent(session.sessionId, session.prompt)
    .then(() => {

      const done = Boolean(normOutput(readMeta(summary.id).output));
      patchTextToVideo(id, {
        status: done ? "done" : "editing",
        error: done ? null : null,
      });
      ctx.log(`[text-to-video] phiên edit kết thúc - có video final: ${done ? "có" : "chưa"}`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      patchTextToVideo(id, { status: "failed", error: `Phiên edit lỗi: ${message}` });
      ctx.log(`[text-to-video] phiên edit lỗi: ${message}`);
    });

  ctx.progress(100, "Đã bàn giao cho AI dựng video");
}

function sourceDescriptionOf(meta: TextToVideoMeta): string {
  const from =
    meta.source.kind === "url" && meta.article
      ? `bài viết "${meta.article.title}"${meta.article.siteName ? ` (${meta.article.siteName})` : ""}`
      : "đoạn văn người dùng cung cấp";
  return (
    `Video dựng từ ${from}. Không có footage quay sẵn: nguồn duy nhất là file ` +
    `assets/voice.wav - giọng đọc tổng hợp bằng AI, kèm assets/transcript.json ` +
    `có mốc thời gian từng từ.`
  );
}

function briefNotesOf(meta: TextToVideoMeta): string {
  const secs = meta.voiceDurationSec ? meta.voiceDurationSec.toFixed(1) : "?";
  return [
    `Giọng đọc dài ${secs} giây (đã đo bằng ffprobe) và đã được gắn sẵn vào meta.audio.voice.`,
    "Tổng thời lượng video phải bám theo giọng đọc này.",
    "",
    "BẮT BUỘC vì không có scene video nguồn:",
    "- Mọi scene phải khai durationInFrames. Remotion chỉ tự suy thời lượng cho",
    "  scene srcVideo có from/to; scene ảnh hoặc HyperFrames mà thiếu là render ném lỗi.",

    meta.brief.autoIllustrations
      ? "- Hình ảnh lấy từ ảnh minh họa AI (POST /api/illustrations) hoặc scene\n" +
        "  HyperFrames tự dựng - không có footage để cắt."
      : "- Ảnh minh họa AI đang TẮT và không có footage: MỌI hình ảnh phải do scene\n" +
        "  HyperFrames tự dựng (typography, đồ họa, hình khối, chuyển động).\n" +
        "  KHÔNG gọi /api/illustrations - server sẽ từ chối.",
  ].join("\n");
}
