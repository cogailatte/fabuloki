import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { updateJob } from "../db.js";
import {
  autoAssignVoices,
  measureSpeakerF0,
  mixOriginalUnder,
  synthesizeDub,
  ttsLanguageFor,
  type DubVoiceAssignment,
} from "../dub.js";
import type { JobCtx } from "../queue.js";
import { remotionSpeedArgs } from "../renderSettings.js";
import { transcribeWith } from "../stt.js";
import { segmentsToCues } from "../subtitles.js";
import { parseTranscriptJson } from "../transcript.js";
import {
  dubCuesOf,
  dubDirOf,
  dubMixPathOf,
  dubSignature,
  dubWavPathOf,
  effectiveDubLang,
  outputPathOf,
  patchTranslateVideo,
  readTranslateVideo,
  sourceAbsOf,
  transcriptPathOf,
  translateVideoDirOf,
  wantsDub,
  wantsSubtitle,
  type SubtitleStyle,
  type TranslateVideoMeta,
  type TranslatedCue,
} from "../translateVideoMeta.js";
import { DEFAULT_TTS_VOICE, listVoices } from "../tts.js";
import { listLocalVoices } from "../ttsLocal.js";
import type { TtsEngine, TtsVoice } from "../ttsTypes.js";
import { ensureDir, nowIso, remotionCli, toRepoRel } from "../util.js";
import { parseProgressLine, shortenStep } from "./progress.js";

export async function runTranslateVideo(ctx: JobCtx): Promise<void> {

  const id = ctx.job.projectId;
  const step = ctx.job.sceneId === "render" ? "render" : "transcribe";

  try {
    if (step === "render") await stepRender(ctx, id);
    else await stepTranscribe(ctx, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      if (ctx.isCanceled()) {

        const cur = readTranslateVideo(id);
        patchTranslateVideo(id, { status: recoverableStatus(cur, step), error: null });
      } else {
        patchTranslateVideo(id, { status: "failed", error: message });
      }
    } catch {

    }
    throw err;
  }
}

function recoverableStatus(
  meta: TranslateVideoMeta,
  step: "transcribe" | "render",
): TranslateVideoMeta["status"] {
  if (step === "render") return meta.cues.length > 0 ? "translated" : "transcribed";
  return meta.transcriptFile ? "transcribed" : "draft";
}

async function stepTranscribe(ctx: JobCtx, id: string): Promise<void> {
  const meta = patchTranslateVideo(id, { status: "transcribing", error: null });
  const videoAbs = sourceAbsOf(meta);
  const outJsonAbs = transcriptPathOf(id);
  ensureDir(translateVideoDirOf(id));

  const language = meta.sourceLang === "auto" ? "auto" : meta.sourceLang;
  if (language === "auto") {
    ctx.log("[translate] sourceLang = auto - để AI bóc lời tự dò ngôn ngữ của video");
  }

  ctx.progress(2, `Bóc lời video nguồn (${meta.sttProvider})`);
  const res = await transcribeWith({
    provider: meta.sttProvider,
    videoAbs,
    outJsonAbs,
    language,

    diarize: true,
    onLog: (line) => ctx.log(line),

    isCanceled: () => ctx.isCanceled(),
  });
  if (ctx.isCanceled()) throw new Error("Job đã bị hủy");
  ctx.log(
    `[translate] transcript: ${res.segments.length} đoạn, ${res.durationSec.toFixed(1)}s, ` +
      `ngôn ngữ ${res.language}, provider ${res.provider}` +
      (res.diarized ? `, ${res.speakers.length} người nói (${res.speakers.join(", ")})` : "") +
      (res.wordTimestamps ? "" : ", KHÔNG có mốc từng từ"),
  );

  patchTranslateVideo(id, {
    transcriptFile: toRepoRel(outJsonAbs),

    transcriptInfo: {
      provider: res.provider,
      language: res.language,
      diarized: res.diarized,
      speakers: res.speakers,
      wordTimestamps: res.wordTimestamps,
    },

    ...(meta.sourceLang === "auto" && res.language !== "und" ? { sourceLang: res.language } : {}),
  });

  ctx.progress(88, "Chia câu phụ đề");
  const cues = cuesFromTranscript(outJsonAbs);
  if (cues.length === 0) {
    throw new Error(
      "Transcript không chia được câu phụ đề nào - kiểm tra lại video có tiếng nói không.",
    );
  }
  ctx.log(`[translate] ${cues.length} câu phụ đề gốc, sẵn sàng để dịch`);

  patchTranslateVideo(id, { cues, outputFile: null, status: "transcribed", error: null });
  ctx.progress(100, `Đã bóc ${cues.length} câu`);
}

export function cuesFromTranscript(transcriptAbs: string): TranslatedCue[] {
  if (!fs.existsSync(transcriptAbs)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(transcriptAbs, "utf8"));
  } catch {
    return [];
  }
  const segments = parseTranscriptJson(raw);
  if (!segments || segments.length === 0) return [];

  const speakerRanges = readSpeakerRanges(raw);
  return segmentsToCues(segments).map((c) => {
    const start = Math.round(c.start * 1000) / 1000;
    const end = Math.round(c.end * 1000) / 1000;
    const cue: TranslatedCue = { start, end, text: c.text, original: c.text };
    const speaker = speakerAt(speakerRanges, start, end);
    if (speaker) cue.speaker = speaker;
    return cue;
  });
}

interface SpeakerRange {
  start: number;
  end: number;
  speaker: string;
}

function readSpeakerRanges(raw: unknown): SpeakerRange[] {
  const segs =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).segments)
      ? ((raw as Record<string, unknown>).segments as unknown[])
      : [];
  const out: SpeakerRange[] = [];
  for (const s of segs) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const speaker = typeof o.speaker === "string" ? o.speaker.trim() : "";
    const start = typeof o.start === "number" && Number.isFinite(o.start) ? o.start : null;
    const end = typeof o.end === "number" && Number.isFinite(o.end) ? o.end : null;
    if (!speaker || start === null || end === null || end <= start) continue;
    out.push({ start, end, speaker });
  }
  return out;
}

function speakerAt(ranges: SpeakerRange[], start: number, end: number): string | null {
  let best: string | null = null;
  let bestOverlap = 0;
  for (const r of ranges) {
    const overlap = Math.min(end, r.end) - Math.max(start, r.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = r.speaker;
    }
  }
  return bestOverlap > 0 ? best : null;
}

const FALLBACK_WIDTH = 1080;
const FALLBACK_HEIGHT = 1920;

const DUB_PROGRESS_SHARE = 65;

async function stepRender(ctx: JobCtx, id: string): Promise<void> {
  const meta = patchTranslateVideo(id, { status: "rendering", error: null });
  const dubbing = wantsDub(meta.mode);
  if (meta.cues.length === 0) {
    throw new Error(
      dubbing
        ? "Chưa có câu nào để lồng tiếng - chạy bước bóc lời và dịch trước."
        : "Chưa có câu phụ đề nào để ghép - chạy bước bóc lời và dịch trước.",
    );
  }
  const videoAbs = sourceAbsOf(meta);
  const dir = translateVideoDirOf(id);
  ensureDir(dir);

  const voiceAbs = dubbing ? await buildDubTrack(ctx, id, videoAbs) : null;

  ctx.progress(dubbing ? DUB_PROGRESS_SHARE : 0, "Stage video nguồn vào Remotion staging");
  const stagingId = `tvd-${id}`;
  const stagingAbs = path.join(paths.stagingDir, stagingId);
  fs.rmSync(stagingAbs, { recursive: true, force: true });
  ensureDir(stagingAbs);

  const ext = path.extname(videoAbs).toLowerCase() || ".mp4";
  const stagedName = `source${ext}`;
  const stagedAbs = path.join(stagingAbs, stagedName);
  stageFile(videoAbs, stagedAbs);
  const stagedRel = `staging/${stagingId}/${stagedName}`;
  ctx.log(`[stage] ${meta.source.relPath} -> ${stagedRel}`);

  let voiceRel: string | null = null;
  if (voiceAbs) {
    stageFile(voiceAbs, path.join(stagingAbs, "dub.wav"));
    voiceRel = `staging/${stagingId}/dub.wav`;
    ctx.log(`[stage] ${toRepoRel(voiceAbs)} -> ${voiceRel}`);
  }

  const props = buildProps(readTranslateVideo(id), stagedRel, voiceRel);
  const propsAbs = path.join(dir, "props.resolved.json");
  fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2) + "\n", "utf8");
  ctx.log(
    `[props] ${props.width}x${props.height} @${props.fps}fps, ` +
      (dubbing
        ? `lồng tiếng (track ${voiceRel}), tiếng gốc ${props.scenes[0].muted ? "tắt" : "giữ"}`
        : `${props.subtitles.length} câu`) +
      ` -> ${propsAbs}`,
  );

  const outAbs = outputPathOf(id);
  const base = dubbing ? DUB_PROGRESS_SHARE : 0;
  const span = 100 - base;
  ctx.progress(base, dubbing ? "Remotion ghép track lồng tiếng" : "Remotion ghép phụ đề");
  const args = [
    remotionCli(),
    "render",
    "Assemble",
    `--props=${propsAbs}`,
    `--output=${outAbs}`,
    ...remotionSpeedArgs(),
  ];
  await ctx.exec(process.execPath, args, paths.remotionDir, (line) => {
    const pct = parseProgressLine(line);
    if (pct !== null) ctx.progress(base + (pct * span) / 100, shortenStep(line));
  });

  if (!fs.existsSync(outAbs)) {
    throw new Error("Remotion render xong nhưng không thấy file output.mp4");
  }

  const outputRel = toRepoRel(outAbs);
  updateJob(ctx.job.id, { outputPath: outputRel });
  patchTranslateVideo(id, { outputFile: outputRel, status: "done", error: null });
  ctx.progress(100, dubbing ? "Đã lồng tiếng" : "Đã ghép phụ đề");
}

function stageFile(srcAbs: string, dstAbs: string): void {
  try {
    fs.linkSync(srcAbs, dstAbs);
  } catch {
    fs.copyFileSync(srcAbs, dstAbs);
  }
}

async function loadVoiceCatalog(engine: TtsEngine): Promise<TtsVoice[]> {

  if (engine !== "vieneu") return listVoices();
  const voices: TtsVoice[] = await listLocalVoices().catch(() => []);
  if (voices.length === 0) {
    throw new Error(
      "Chưa có giọng đọc offline nào - cài engine VieNeu-TTS (trang Cấu hình) rồi chạy lại, " +
        'hoặc đổi engine lồng tiếng sang "gemini".',
    );
  }
  return voices;
}

async function buildDubTrack(ctx: JobCtx, id: string, videoAbs: string): Promise<string> {
  const meta = readTranslateVideo(id);
  const dubDir = dubDirOf(id);
  ensureDir(dubDir);

  const language = meta.dub.language ?? ttsLanguageFor(effectiveDubLang(meta));

  const speechCues = dubCuesOf(meta);

  const speakers = (meta.transcriptInfo?.diarized ? meta.transcriptInfo.speakers : []).filter(
    (s) => meta.cues.some((c) => (c.speaker ?? "") === s),
  );

  let speakerF0: Record<string, number> = { ...(meta.dubInfo?.speakerF0 ?? {}) };
  if (speakers.some((s) => !(speakerF0[s] > 0))) {
    ctx.progress(1, "Đo cao độ giọng của từng người nói trong video gốc");
    const measured = await measureSpeakerF0({
      videoAbs,
      cues: meta.cues,
      workDir: path.join(dubDir, "probe"),
      onLog: (line) => ctx.log(line),
      isCanceled: () => ctx.isCanceled(),
    });
    speakerF0 = { ...speakerF0, ...measured };
    fs.rmSync(path.join(dubDir, "probe"), { recursive: true, force: true });
  }

  const voices = await loadVoiceCatalog(meta.dub.engine);
  const assignments = autoAssignVoices(speakers, {
    engine: meta.dub.engine,
    voices,
    speakerF0,

    locked: meta.dub.voices,
    defaultVoice: DEFAULT_TTS_VOICE,
  });
  for (const a of assignments) {
    const who = a.speaker ? `người nói "${a.speaker}"` : "cả video";
    const f0 = speakerF0[a.speaker];
    ctx.log(`[dub] ${who} -> giọng ${a.voice}${f0 ? ` (gốc ${f0} Hz)` : ""}`);
  }

  const chosen: Record<string, string> = {};
  for (const a of assignments) chosen[a.speaker] = a.voice;
  patchTranslateVideo(id, { dub: { ...meta.dub, voices: chosen } });

  const signature = dubSignature({

    cues: speechCues,
    assignments,
    engine: meta.dub.engine,
    model: meta.dub.model,
    language,
  });
  const dubWavAbs = dubWavPathOf(id);
  const durationSec = meta.source.durationSec ?? lastCueEnd(meta.cues);

  if (meta.dubInfo?.signature === signature && fs.existsSync(dubWavAbs)) {
    ctx.log(
      `[dub] bản dịch/giọng/engine không đổi so với lần trước - dùng lại track đã có ` +
        `(${meta.dubInfo.cues} câu), không đọc lại`,
    );
  } else {

    for (const name of fs.readdirSync(dubDir)) {
      if (/^cue-\d+\.wav$/.test(name)) fs.rmSync(path.join(dubDir, name), { force: true });
    }
    ctx.log(
      `[dub] đọc ${meta.cues.length} câu bằng engine ${meta.dub.engine} (${language}) - ` +
        `mỗi câu một lượt gọi để đo và co riêng từng câu`,
    );
    const res = await synthesizeDub({
      cues: speechCues,
      assignments,
      engine: meta.dub.engine,
      model: meta.dub.model,
      language,
      durationSec,
      dubDir,
      outWavAbs: dubWavAbs,
      onProgress: (done, total) =>
        ctx.progress(
          2 + ((DUB_PROGRESS_SHARE - 6) * done) / total,
          `Lồng tiếng câu ${done}/${total}`,
        ),
      onLog: (line) => ctx.log(line),
      isCanceled: () => ctx.isCanceled(),
    });
    patchTranslateVideo(id, {
      dubInfo: {
        file: toRepoRel(res.wavAbs),
        durationSec: res.durationSec,
        cues: res.cues.length,
        stretched: res.stretched,
        overflowed: res.overflowed,
        clipped: res.clipped,
        minTempo: res.minTempo,
        maxTempo: res.maxTempo,
        assignments: res.assignments as DubVoiceAssignment[],
        speakerF0,
        signature,
        createdAt: nowIso(),
      },
    });
  }

  if (!meta.dub.keepOriginal) return dubWavAbs;
  const mixAbs = dubMixPathOf(id);
  ctx.progress(DUB_PROGRESS_SHARE - 3, "Trộn tiếng gốc chạy nhỏ dưới giọng lồng");
  await mixOriginalUnder({
    dubWavAbs,
    videoAbs,
    originalVolume: meta.dub.originalVolume,
    durationSec,
    workDir: dubDir,
    outWavAbs: mixAbs,
    isCanceled: () => ctx.isCanceled(),
  });
  ctx.log(`[dub] giữ tiếng gốc ở mức ${meta.dub.originalVolume} dưới giọng lồng`);
  return mixAbs;
}

interface SubtitleProp {
  from: number;
  durationInFrames: number;
  text: string;
}

interface TranslateProps {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: string;
  scenes: Array<Record<string, unknown> & { muted: boolean }>;
  audio: { voice: string | null; sfx: never[]; music: null };
  captions: never[];
  overlays: never[];
  watermark: null;
  output: null;
  subtitles: SubtitleProp[];
  subtitleStyle: SubtitleStyle;
}

function buildProps(
  meta: TranslateVideoMeta,
  stagedRel: string,
  voiceRel: string | null,
): TranslateProps {
  const fps = pickFps(meta.source.fps);
  const { width, height } = pickSize(meta.source);
  const durationSec = meta.source.durationSec ?? lastCueEnd(meta.cues);
  const durationInFrames = Math.max(1, Math.round(durationSec * fps));
  const dubbing = wantsDub(meta.mode) && voiceRel !== null;

  return {
    id: meta.id,
    name: meta.name,
    width,
    height,
    fps,
    status: "rendering",
    scenes: [
      {
        id: "source",
        srcVideo: stagedRel,
        from: 0,
        durationInFrames,

        muted: dubbing,
        srcImage: null,
      },
    ],
    audio: { voice: dubbing ? voiceRel : null, sfx: [], music: null },
    captions: [],
    overlays: [],
    watermark: null,
    output: null,

    subtitles: wantsSubtitle(meta.mode)
      ? toSubtitleProps(meta.cues, fps, durationInFrames)
      : [],

    subtitleStyle: meta.subtitleStyle,
  };
}

function toSubtitleProps(
  cues: TranslatedCue[],
  fps: number,
  totalFrames: number,
): SubtitleProp[] {
  const out: SubtitleProp[] = [];
  for (const cue of cues) {
    const from = Math.max(0, Math.round(cue.start * fps));
    if (from >= totalFrames) continue;
    const end = Math.min(totalFrames, Math.round(cue.end * fps));
    const durationInFrames = Math.max(1, end - from);
    out.push({ from, durationInFrames, text: cue.text });
  }
  return out;
}

function pickFps(raw: number | null): number {
  const fps = raw && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 30;
  return Math.min(120, Math.max(1, fps));
}

function pickSize(source: { width: number | null; height: number | null }): {
  width: number;
  height: number;
} {
  const even = (v: number | null, fallback: number): number => {
    const n = v && Number.isFinite(v) && v > 0 ? v : fallback;
    return Math.max(2, Math.round(n / 2) * 2);
  };
  return {
    width: even(source.width, FALLBACK_WIDTH),
    height: even(source.height, FALLBACK_HEIGHT),
  };
}

function lastCueEnd(cues: TranslatedCue[]): number {
  let max = 0;
  for (const c of cues) max = Math.max(max, c.end);
  return max;
}
