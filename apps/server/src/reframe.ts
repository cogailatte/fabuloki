import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AutoCutBackground } from "./autoCutMeta.js";
import { ffmpegSafeArgs, ffprobeSafeArgs, isPlaylistFormat } from "./ffmpegSafe.js";
import { detectHardware, readRenderSettings } from "./renderSettings.js";
import { audioCutFade, execFileCaptureAll } from "./util.js";

function audioFadeArgs(durationSec: number): string[] {
  const fade = audioCutFade(durationSec);
  return fade ? ["-af", fade] : [];
}

export interface VideoProbe {

  width: number;
  height: number;
  fps: number;
  durationSec: number;

  rotation: number;
  hasAudio: boolean;
}

interface FfprobeJson {
  streams?: Array<{
    index?: number;
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    tags?: Record<string, string>;
    side_data_list?: Array<Record<string, unknown>>;
  }>;
  format?: { duration?: string; format_name?: string };
}

function parseRate(raw: string | undefined): number {
  if (!raw) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (m) {
    const den = Number(m[2]);
    return den > 0 ? Number(m[1]) / den : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function probeVideo(fileAbs: string): Promise<VideoProbe> {
  const { code, stdout, stderr } = await execFileCaptureAll(
    "ffprobe",
    ffprobeSafeArgs([
      "-v",
      "error",
      "-show_entries",

      "stream=index,codec_type,width,height,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration,format_name",
      "-of",
      "json",
      fileAbs,
    ]),
    { timeoutMs: 30_000 },
  );
  if (code !== 0) {
    throw new Error(
      `ffprobe không đọc được "${path.basename(fileAbs)}": ${stderr.trim().slice(0, 300) || `mã ${code}`}`,
    );
  }

  let data: FfprobeJson;
  try {
    data = JSON.parse(stdout) as FfprobeJson;
  } catch {
    throw new Error(`ffprobe trả về JSON hỏng cho "${path.basename(fileAbs)}"`);
  }

  if (isPlaylistFormat(data.format?.format_name)) {
    throw new Error(`File "${path.basename(fileAbs)}" là playlist (HLS/concat), không phải video`);
  }

  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video || !video.width || !video.height) {
    throw new Error(`File "${path.basename(fileAbs)}" không có luồng video đọc được`);
  }

  let rotation = 0;
  for (const sd of video.side_data_list ?? []) {
    const r = Number((sd as { rotation?: unknown }).rotation);
    if (Number.isFinite(r) && r !== 0) rotation = r;
  }
  if (rotation === 0) {
    const tagRotate = Number(video.tags?.rotate);
    if (Number.isFinite(tagRotate) && tagRotate !== 0) rotation = tagRotate;
  }

  const swap = Math.abs(rotation) % 180 === 90;
  const rawW = Math.round(video.width);
  const rawH = Math.round(video.height);

  return {
    width: swap ? rawH : rawW,
    height: swap ? rawW : rawH,
    fps: parseRate(video.r_frame_rate) || 30,
    durationSec: Number(data.format?.duration) || 0,
    rotation,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

const GEMINI_VISION_MODEL = "gemini-2.5-flash";
const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_VISION_MODEL}:generateContent`;

export interface SubjectCenter {
  found: boolean;

  centerX: number;
  centerY: number;
}

const CENTER_FALLBACK: SubjectCenter = { found: false, centerX: 0.5, centerY: 0.5 };

async function grabFrameJpeg(videoAbs: string, atSec: number): Promise<string | null> {
  const tmp = path.join(os.tmpdir(), `fabuloki-frame-${randomBytes(6).toString("hex")}.jpg`);
  const { code } = await execFileCaptureAll(
    "ffmpeg",
    ffmpegSafeArgs([
      "-y",
      "-v",
      "error",
      "-accurate_seek",
      "-ss",
      formatSec(Math.max(0, atSec)),
      "-i",
      videoAbs,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "4",
      tmp,
    ]),
    { timeoutMs: 60_000 },
  );
  if (code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {

    }
    return null;
  }
  return tmp;
}

async function askGeminiVision(
  jpegAbs: string,
  prompt: string,
  apiKey: string,
): Promise<string | null> {
  let base64: string;
  try {
    base64 = fs.readFileSync(jpegAbs).toString("base64");
  } catch {
    return null;
  }
  const body = {
    contents: [
      {
        parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64 } }],
      },
    ],
  };
  try {
    const res = await fetch(GEMINI_VISION_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return text || null;
  } catch {

    return null;
  }
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const i = cleaned.indexOf("{");
  const j = cleaned.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(i, j + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SUBJECT_PROMPT = [
  "You are a video reframing assistant.",
  "Find the MAIN SUBJECT of this video frame: the person who is speaking / on camera.",
  "If there is no person, use the most important visual element instead (the screen, slide, product or text block).",
  "Answer with ONLY one JSON object, no markdown, no explanation:",
  '{"found":true,"box":[ymin,xmin,ymax,xmax]}',
  "The box is the bounding box of that subject, coordinates normalized to 0-1000",
  "(ymin/ymax vertical from the top, xmin/xmax horizontal from the left).",
  'If you cannot identify any subject answer {"found":false,"box":[0,0,1000,1000]}.',
].join(" ");

export async function detectSubject(input: {
  videoAbs: string;
  atSec: number;
  apiKey: string | null;
}): Promise<SubjectCenter> {
  if (!input.apiKey) return { ...CENTER_FALLBACK };
  const jpeg = await grabFrameJpeg(input.videoAbs, input.atSec);
  if (!jpeg) return { ...CENTER_FALLBACK };
  try {
    const text = await askGeminiVision(jpeg, SUBJECT_PROMPT, input.apiKey);
    if (!text) return { ...CENTER_FALLBACK };
    const obj = firstJsonObject(text);
    if (!obj) return { ...CENTER_FALLBACK };
    if (obj.found === false) return { ...CENTER_FALLBACK };
    const box = obj.box;
    if (!Array.isArray(box) || box.length < 4) return { ...CENTER_FALLBACK };
    const [ymin, xmin, ymax, xmax] = box.map((v) => Number(v));
    if (![ymin, xmin, ymax, xmax].every((v) => Number.isFinite(v))) return { ...CENTER_FALLBACK };
    const centerX = clamp01(((xmin + xmax) / 2) / 1000);
    const centerY = clamp01(((ymin + ymax) / 2) / 1000);
    return { found: true, centerX, centerY };
  } finally {
    try {
      fs.rmSync(jpeg, { force: true });
    } catch {

    }
  }
}

export async function detectSubjectOverRange(input: {
  videoAbs: string;
  start: number;
  end: number;
  apiKey: string | null;
  onLog?: (line: string) => void;
}): Promise<SubjectCenter> {
  const { start, end } = input;
  const span = Math.max(0, end - start);
  const marks = [0.25, 0.5, 0.75].map((f) => start + span * f);
  const found: SubjectCenter[] = [];
  for (const at of marks) {
    const one = await detectSubject({ videoAbs: input.videoAbs, atSec: at, apiKey: input.apiKey });
    input.onLog?.(
      `[subject] ${at.toFixed(1)}s -> ${
        one.found ? `x=${one.centerX.toFixed(3)} y=${one.centerY.toFixed(3)}` : "không dò được"
      }`,
    );
    if (one.found) found.push(one);
  }
  if (found.length === 0) return { ...CENTER_FALLBACK };
  return {
    found: true,
    centerX: median(found.map((f) => f.centerX)),
    centerY: median(found.map((f) => f.centerY)),
  };
}

export type FrameKind = "person" | "screen";

const CLASSIFY_PROMPT = [
  "Look at this video frame and decide what it mostly shows.",
  'Answer with ONLY one JSON object, no markdown: {"kind":"person"} or {"kind":"screen"}.',
  '"person" = a talking head / people filmed by a camera (the face is the point of the shot).',
  '"screen" = a screen recording, slide, chart, document, code, product UI or any frame where text/graphics carry the information.',
].join(" ");

export async function classifyFrame(input: {
  videoAbs: string;
  atSec: number;
  apiKey: string | null;
}): Promise<FrameKind> {
  if (!input.apiKey) return "screen";
  const jpeg = await grabFrameJpeg(input.videoAbs, input.atSec);
  if (!jpeg) return "screen";
  try {
    const text = await askGeminiVision(jpeg, CLASSIFY_PROMPT, input.apiKey);
    if (!text) return "screen";
    const obj = firstJsonObject(text);
    const kind = typeof obj?.kind === "string" ? obj.kind.toLowerCase() : "";
    if (kind === "person") return "person";
    if (kind === "screen") return "screen";

    return /person|people|face|talking/i.test(text) ? "person" : "screen";
  } finally {
    try {
      fs.rmSync(jpeg, { force: true });
    } catch {

    }
  }
}

export type ReframeEncoder = "nvenc" | "x264";

export type ReframeLayout = "crop" | "fit";

export interface ReframeSpec {
  srcAbs: string;
  outAbs: string;

  start: number;
  end: number;

  source: { width: number; height: number };
  target: { width: number; height: number };
  layout: ReframeLayout;

  center?: { x: number; y: number } | null;

  backgroundKind?: AutoCutBackground;

  backgroundAbs?: string | null;

  backgroundColor?: string | null;
  encoder: ReframeEncoder;

  fps: number;
}

export interface CropBox {
  width: number;
  height: number;
  x: number;
  y: number;
}

export function computeCropBox(
  source: { width: number; height: number },
  target: { width: number; height: number },
  center?: { x: number; y: number } | null,
): CropBox {
  const srcAr = source.width / source.height;
  const dstAr = target.width / target.height;

  let cw: number;
  let ch: number;
  if (srcAr > dstAr) {

    ch = source.height;
    cw = Math.round(ch * dstAr);
  } else {

    cw = source.width;
    ch = Math.round(cw / dstAr);
  }
  cw = evenClamp(cw, 2, source.width);
  ch = evenClamp(ch, 2, source.height);

  const cx = clamp(
    Math.round(clamp01(center?.x ?? 0.5) * source.width - cw / 2),
    0,
    source.width - cw,
  );
  const cy = clamp(
    Math.round(clamp01(center?.y ?? 0.5) * source.height - ch / 2),
    0,
    source.height - ch,
  );
  return { width: cw, height: ch, x: cx, y: cy };
}

function encoderArgs(encoder: ReframeEncoder): string[] {
  return encoder === "nvenc"
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-pix_fmt", "yuv420p"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"];
}

export function buildReframeArgs(spec: ReframeSpec): string[] {
  const W = evenClamp(spec.target.width, 2, 8192);
  const H = evenClamp(spec.target.height, 2, 8192);
  const fps = Number.isFinite(spec.fps) && spec.fps > 0 ? Math.round(spec.fps * 1000) / 1000 : 30;

  const ssSec = Math.max(0, spec.start);
  const toSec = Math.max(spec.start + 0.04, spec.end);
  const inputs: string[] = [
    "-accurate_seek",
    "-ss",
    formatSec(ssSec),
    "-to",
    formatSec(toSec),
    "-i",
    spec.srcAbs,
  ];

  const useImageBg =
    spec.layout === "fit" &&
    spec.backgroundKind === "gemini" &&
    !!spec.backgroundAbs &&
    fs.existsSync(spec.backgroundAbs);

  if (useImageBg) {

    inputs.push("-loop", "1", "-framerate", String(fps), "-i", spec.backgroundAbs as string);
  }

  let filter: string;
  if (spec.layout === "crop") {
    const box = computeCropBox(spec.source, { width: W, height: H }, spec.center);
    filter =
      `[0:v]crop=${box.width}:${box.height}:${box.x}:${box.y},` +
      `scale=${W}:${H},setsar=1[v]`;
  } else {

    const fg = `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
    if (useImageBg) {
      filter =
        `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg];` +
        `[0:v]${fg}[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
    } else if (spec.backgroundKind === "style") {
      filter =
        `color=c=${ffColor(spec.backgroundColor)}:s=${W}x${H}:r=${fps}[bg];` +
        `[0:v]${fg}[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
    } else {

      filter =
        `[0:v]split=2[bgsrc][fgsrc];` +
        `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:2,eq=brightness=-0.15[bg];` +
        `[fgsrc]${fg}[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`;
    }
  }

  return [
    "-y",
    "-hide_banner",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",

    ...audioFadeArgs(toSec - ssSec),
    ...encoderArgs(spec.encoder),
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    spec.outAbs,
  ];
}

export async function chooseEncoder(): Promise<ReframeEncoder> {
  if (!readRenderSettings().gpuEncodeFinal) return "x264";
  try {
    const hw = await detectHardware();
    return hw.nvenc ? "nvenc" : "x264";
  } catch {
    return "x264";
  }
}

export async function runCutReframe(
  spec: ReframeSpec,
  runner: {
    exec: (file: string, args: string[]) => Promise<void>;
    log?: (line: string) => void;
  },
): Promise<ReframeEncoder> {
  try {
    await runner.exec("ffmpeg", ffmpegSafeArgs(buildReframeArgs(spec)));
    return spec.encoder;
  } catch (err) {
    if (spec.encoder !== "nvenc") throw err;
    const message = err instanceof Error ? err.message : String(err);
    runner.log?.(`[warn] Encode bằng NVENC thất bại (${message}) - chạy lại bằng libx264 (CPU).`);
    await runner.exec("ffmpeg", ffmpegSafeArgs(buildReframeArgs({ ...spec, encoder: "x264" })));
    return "x264";
  }
}

export function sameAspect(
  a: { width: number; height: number },
  b: { width: number; height: number },
  tolerance = 0.01,
): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.abs(ra - rb) / rb < tolerance;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? clamp(v, 0, 1) : 0.5;
}

function evenClamp(v: number, min: number, max: number): number {
  const even = Math.floor(clamp(Math.round(v), min, max) / 2) * 2;
  return Math.max(min, even);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatSec(sec: number): string {
  return (Math.round(sec * 1000) / 1000).toFixed(3);
}

function ffColor(hex?: string | null): string {
  const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec((hex ?? "").trim());
  return m ? `0x${m[1].toLowerCase()}` : "0x000000";
}
