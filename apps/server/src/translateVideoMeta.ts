import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { paths, repoRoot } from "./config.js";
import { DUB_ORIGINAL_VOLUME_MAX, type DubVoiceAssignment } from "./dub.js";
import { DEFAULT_STT_PROVIDER, isSttProvider, type SttProvider } from "./stt.js";
import { DEFAULT_TTS_ENGINE, isTtsEngine, type TtsEngine } from "./ttsTypes.js";
import { HttpError, isKebabCase, nowIso } from "./util.js";

export type TranslateMode = "subtitle" | "dub" | "both";
export const TRANSLATE_MODES: TranslateMode[] = ["subtitle", "dub", "both"];

export function wantsSubtitle(mode: TranslateMode): boolean {
  return mode === "subtitle" || mode === "both";
}

export function wantsDub(mode: TranslateMode): boolean {
  return mode === "dub" || mode === "both";
}

export type TranslateStatus =
  | "draft"
  | "transcribing"
  | "transcribed"
  | "translating"
  | "translated"
  | "rendering"
  | "done"
  | "failed";

export type SubtitleBackdrop = "blur" | "solid" | "none";
export const SUBTITLE_BACKDROPS: SubtitleBackdrop[] = ["blur", "solid", "none"];

export interface SubtitleFontOption {
  id: string;
  label: string;
  cssStack: string;
}

export const SUBTITLE_FONTS: SubtitleFontOption[] = [
  {
    id: "vietnamese",
    label: "Inter tiếng Việt (mặc định)",
    cssStack: "'CaptionInter', 'Segoe UI', sans-serif",
  },
  { id: "sans", label: "Arial / Helvetica", cssStack: "Arial, Helvetica, sans-serif" },
  {
    id: "serif",
    label: "Georgia / Times New Roman",
    cssStack: "Georgia, 'Times New Roman', serif",
  },
  { id: "mono", label: "Courier New / Consolas", cssStack: "'Courier New', Consolas, monospace" },
];

export const DEFAULT_SUBTITLE_FONT = "vietnamese";

export function isSubtitleFont(v: unknown): v is string {
  return typeof v === "string" && SUBTITLE_FONTS.some((f) => f.id === v);
}

export interface SubtitleStyle {

  fontFamily: string;
  fontSizePx: number;

  color: string;
  backdrop: SubtitleBackdrop;

  backdropColor: string;
  blurPx: number;

  bottomPx: number;
}

export const DEFAULT_BOTTOM_PX = { vertical: 320, horizontal: 130 } as const;

export function defaultBottomPx(vertical: boolean): number {
  return vertical ? DEFAULT_BOTTOM_PX.vertical : DEFAULT_BOTTOM_PX.horizontal;
}

export function isDefaultBottomPx(v: number): boolean {
  return v === DEFAULT_BOTTOM_PX.vertical || v === DEFAULT_BOTTOM_PX.horizontal;
}

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    fontFamily: DEFAULT_SUBTITLE_FONT,
    fontSizePx: 62,
    color: "rgba(255,255,255,0.92)",
    backdrop: "blur",
    backdropColor: "rgba(10,16,32,0.52)",
    blurPx: 20,
    bottomPx: DEFAULT_BOTTOM_PX.vertical,
  };
}

export interface TranslatedCue {
  start: number;
  end: number;

  text: string;

  dubText?: string;

  original?: string;

  speaker?: string;
}

export interface TranscriptInfo {

  provider: SttProvider;

  language: string;

  diarized: boolean;

  speakers: string[];

  wordTimestamps: boolean;
}

export interface DubSettings {
  engine: TtsEngine;

  model: string | null;

  language: string | null;

  voices: Record<string, string>;

  keepOriginal: boolean;

  originalVolume: number;
}

export interface DubInfo {

  file: string;
  durationSec: number;
  cues: number;

  stretched: number;

  overflowed: number;

  clipped: number;
  minTempo: number;
  maxTempo: number;

  assignments: DubVoiceAssignment[];

  speakerF0: Record<string, number>;

  signature: string;
  createdAt: string;
}

export interface TranslateVideoSource {

  relPath: string | null;
  durationSec: number | null;

  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface TranslateVideoMeta {
  id: string;
  name: string;

  autoNamed: boolean;
  source: TranslateVideoSource;

  sourceLang: string;

  targetLang: string;

  dubLang: string | null;
  mode: TranslateMode;

  sttProvider: SttProvider;

  transcriptFile: string | null;

  transcriptInfo: TranscriptInfo | null;

  cues: TranslatedCue[];
  subtitleStyle: SubtitleStyle;

  dub: DubSettings;

  dubInfo: DubInfo | null;

  outputFile: string | null;
  status: TranslateStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function translateVideoDirOf(id: string): string {
  return path.join(paths.translateVideoDir, id);
}

export function translateVideoMetaPathOf(id: string): string {
  return path.join(translateVideoDirOf(id), "meta.json");
}

export function translateVideoExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(translateVideoMetaPathOf(id));
}

export function transcriptPathOf(id: string): string {
  return path.join(translateVideoDirOf(id), "transcript.json");
}

export function outputPathOf(id: string): string {
  return path.join(translateVideoDirOf(id), "output.mp4");
}

export function dubDirOf(id: string): string {
  return path.join(translateVideoDirOf(id), "dub");
}

export function dubWavPathOf(id: string): string {
  return path.join(dubDirOf(id), "dub.wav");
}

export function dubMixPathOf(id: string): string {
  return path.join(dubDirOf(id), "dub-mix.wav");
}

export function sourceAbsOf(meta: TranslateVideoMeta): string {
  if (!meta.source.relPath) {
    throw new HttpError(
      400,
      "NO_SOURCE",
      `Phiên "${meta.id}" chưa có video nguồn - upload file trước.`,
    );
  }
  const abs = path.join(repoRoot, meta.source.relPath);
  if (!fs.existsSync(abs)) {
    throw new HttpError(
      404,
      "SOURCE_NOT_FOUND",
      `Không thấy video nguồn "${meta.source.relPath}" - file đã bị xóa hoặc di chuyển khỏi repo.`,
    );
  }
  return abs;
}

function posNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

const LANG_RE = /^[A-Za-z0-9-]{2,16}$/;

export function normLang(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  if (!v) return fallback;

  return LANG_RE.test(v) ? v.toLowerCase() : fallback;
}

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/;

function normColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  return COLOR_RE.test(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function numInRange(raw: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.round(clamp(raw, lo, hi) * 100) / 100;
}

export function normSubtitleStyle(raw: unknown, fallback: SubtitleStyle): SubtitleStyle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  return {
    fontFamily: isSubtitleFont(o.fontFamily) ? o.fontFamily : fallback.fontFamily,

    fontSizePx: numInRange(o.fontSizePx, 16, 200, fallback.fontSizePx),
    color: normColor(o.color, fallback.color),
    backdrop: SUBTITLE_BACKDROPS.includes(o.backdrop as SubtitleBackdrop)
      ? (o.backdrop as SubtitleBackdrop)
      : fallback.backdrop,
    backdropColor: normColor(o.backdropColor, fallback.backdropColor),
    blurPx: numInRange(o.blurPx, 0, 80, fallback.blurPx),
    bottomPx: numInRange(o.bottomPx, 0, 1600, fallback.bottomPx),
  };
}

function normCueText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r/g, "").replace(/\n{2,}/g, "\n").trim();
}

export function normCues(raw: unknown): TranslatedCue[] {
  if (!Array.isArray(raw)) return [];
  const out: TranslatedCue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const start = typeof o.start === "number" && Number.isFinite(o.start) ? Math.max(0, o.start) : null;
    const end = typeof o.end === "number" && Number.isFinite(o.end) ? Math.max(0, o.end) : null;
    const text = normCueText(o.text);
    if (start === null || end === null || end <= start || !text) continue;
    const cue: TranslatedCue = {
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      text,
    };
    const dubText = normCueText(o.dubText);
    if (dubText) cue.dubText = dubText;
    const original = normCueText(o.original);
    if (original) cue.original = original;
    if (typeof o.speaker === "string" && o.speaker.trim()) cue.speaker = o.speaker.trim();
    out.push(cue);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export function effectiveDubLang(meta: TranslateVideoMeta): string {
  return meta.dubLang ?? meta.targetLang;
}

export function dubLangDiffers(meta: TranslateVideoMeta): boolean {
  return effectiveDubLang(meta) !== meta.targetLang;
}

export function dubCuesOf(meta: TranslateVideoMeta): TranslatedCue[] {
  return meta.cues.map((c) => (c.dubText ? { ...c, text: c.dubText } : c));
}

export function normTranscriptInfo(raw: unknown): TranscriptInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isSttProvider(o.provider)) return null;
  const speakers = Array.isArray(o.speakers)
    ? o.speakers.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  return {
    provider: o.provider,
    language: typeof o.language === "string" && o.language.trim() ? o.language.trim() : "und",
    diarized: o.diarized === true,
    speakers,
    wordTimestamps: o.wordTimestamps === true,
  };
}

export function normSttProvider(raw: unknown, fallback: SttProvider): SttProvider {
  return isSttProvider(raw) ? raw : fallback;
}

export function isDubVoiceName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= 80 && !/[\\/\r\n\0]/.test(v);
}

export { DUB_ORIGINAL_VOLUME_MAX };
export const DEFAULT_DUB_ORIGINAL_VOLUME = 0.1;

export function defaultDubSettings(): DubSettings {
  return {
    engine: DEFAULT_TTS_ENGINE,
    model: null,

    language: null,
    voices: {},

    keepOriginal: false,
    originalVolume: DEFAULT_DUB_ORIGINAL_VOLUME,
  };
}

export function normDubSettings(raw: unknown, fallback: DubSettings): DubSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;

  let voices = fallback.voices;
  if (o.voices && typeof o.voices === "object" && !Array.isArray(o.voices)) {
    voices = {};
    for (const [k, v] of Object.entries(o.voices as Record<string, unknown>)) {

      if (typeof k !== "string" || k.length > 80) continue;
      if (isDubVoiceName(v)) voices[k] = v.trim();
    }
  }

  return {
    engine: isTtsEngine(o.engine) ? o.engine : fallback.engine,
    model:
      typeof o.model === "string" && o.model.trim()
        ? o.model.trim().slice(0, 80)
        : o.model === null
          ? null
          : fallback.model,
    language:
      typeof o.language === "string" && LANG_RE.test(o.language.trim())
        ? o.language.trim()
        : o.language === null
          ? null
          : fallback.language,
    voices,
    keepOriginal: typeof o.keepOriginal === "boolean" ? o.keepOriginal : fallback.keepOriginal,
    originalVolume: numInRange(
      o.originalVolume,
      0,
      DUB_ORIGINAL_VOLUME_MAX,
      fallback.originalVolume,
    ),
  };
}

export function normDubInfo(raw: unknown): DubInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.file !== "string" || !o.file) return null;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const assignments: DubVoiceAssignment[] = [];
  if (Array.isArray(o.assignments)) {
    for (const a of o.assignments) {
      if (!a || typeof a !== "object") continue;
      const x = a as Record<string, unknown>;
      if (typeof x.speaker !== "string" || !isDubVoiceName(x.voice)) continue;
      assignments.push({
        speaker: x.speaker,
        voice: x.voice.trim(),
        engine: isTtsEngine(x.engine) ? x.engine : DEFAULT_TTS_ENGINE,
      });
    }
  }
  const speakerF0: Record<string, number> = {};
  if (o.speakerF0 && typeof o.speakerF0 === "object" && !Array.isArray(o.speakerF0)) {
    for (const [k, v] of Object.entries(o.speakerF0 as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) speakerF0[k] = v;
    }
  }
  return {
    file: o.file,
    durationSec: num(o.durationSec),
    cues: num(o.cues),
    stretched: num(o.stretched),
    overflowed: num(o.overflowed),
    clipped: num(o.clipped),
    minTempo: num(o.minTempo) || 1,
    maxTempo: num(o.maxTempo) || 1,
    assignments,
    speakerF0,
    signature: typeof o.signature === "string" ? o.signature : "",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : nowIso(),
  };
}

export function dubSignature(input: {
  cues: TranslatedCue[];
  assignments: DubVoiceAssignment[];
  engine: TtsEngine;
  model: string | null;
  language: string;
}): string {
  const h = crypto.createHash("sha1");
  h.update(`${input.engine}|${input.model ?? ""}|${input.language}\n`);
  for (const a of [...input.assignments].sort((x, y) => x.speaker.localeCompare(y.speaker))) {
    h.update(`v:${a.speaker}=${a.engine}:${a.voice}\n`);
  }
  for (const c of input.cues) {
    h.update(`c:${c.start}-${c.end}|${c.speaker ?? ""}|${c.text}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

export function defaultTranslateVideoMeta(id: string, name: string): TranslateVideoMeta {
  const now = nowIso();
  return {
    id,
    name,
    autoNamed: false,
    source: { relPath: null, durationSec: null, width: null, height: null, fps: null },
    sourceLang: "auto",
    targetLang: "vi",

    dubLang: null,
    mode: "subtitle",

    sttProvider: DEFAULT_STT_PROVIDER,
    transcriptFile: null,
    transcriptInfo: null,
    cues: [],
    subtitleStyle: defaultSubtitleStyle(),
    dub: defaultDubSettings(),
    dubInfo: null,
    outputFile: null,
    status: "draft",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

const TRANSLATE_STATUSES: TranslateStatus[] = [
  "draft",
  "transcribing",
  "transcribed",
  "translating",
  "translated",
  "rendering",
  "done",
  "failed",
];

export function readTranslateVideo(id: string): TranslateVideoMeta {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_ID", `Id phiên dịch không hợp lệ: ${id}`);
  }
  const file = translateVideoMetaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên dịch "${id}"`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "META_INVALID", `meta.json của phiên dịch "${id}" hỏng`);
  }

  const base = defaultTranslateVideoMeta(id, typeof raw.name === "string" ? raw.name : id);
  const src = (raw.source ?? {}) as Record<string, unknown>;
  const status = raw.status;

  return {
    ...base,
    autoNamed: raw.autoNamed === true,
    source: {
      relPath: typeof src.relPath === "string" && src.relPath ? src.relPath : null,
      durationSec: posNum(src.durationSec),
      width: posNum(src.width),
      height: posNum(src.height),
      fps: posNum(src.fps),
    },
    sourceLang: normLang(raw.sourceLang, base.sourceLang),
    targetLang: normLang(raw.targetLang, base.targetLang),

    dubLang:
      typeof raw.dubLang === "string" && LANG_RE.test(raw.dubLang.trim())
        ? raw.dubLang.trim().toLowerCase()
        : null,
    mode: TRANSLATE_MODES.includes(raw.mode as TranslateMode)
      ? (raw.mode as TranslateMode)
      : base.mode,
    sttProvider: normSttProvider(raw.sttProvider, base.sttProvider),
    transcriptFile: typeof raw.transcriptFile === "string" ? raw.transcriptFile : null,
    transcriptInfo: normTranscriptInfo(raw.transcriptInfo),
    cues: normCues(raw.cues),
    subtitleStyle: normSubtitleStyle(raw.subtitleStyle, base.subtitleStyle),
    dub: normDubSettings(raw.dub, base.dub),
    dubInfo: normDubInfo(raw.dubInfo),
    outputFile: typeof raw.outputFile === "string" ? raw.outputFile : null,
    status: TRANSLATE_STATUSES.includes(status as TranslateStatus)
      ? (status as TranslateStatus)
      : base.status,
    error: typeof raw.error === "string" ? raw.error : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeTranslateVideo(meta: TranslateVideoMeta): void {
  fs.mkdirSync(translateVideoDirOf(meta.id), { recursive: true });
  const next: TranslateVideoMeta = { ...meta, updatedAt: nowIso() };
  fs.writeFileSync(
    translateVideoMetaPathOf(meta.id),
    JSON.stringify(next, null, 2) + "\n",
    "utf8",
  );
}

export function patchTranslateVideo(
  id: string,
  patch: Partial<TranslateVideoMeta>,
): TranslateVideoMeta {
  const cur = readTranslateVideo(id);
  const next: TranslateVideoMeta = { ...cur, ...patch };
  writeTranslateVideo(next);
  return next;
}

export function scanTranslateVideos(): TranslateVideoMeta[] {
  if (!fs.existsSync(paths.translateVideoDir)) return [];
  const out: TranslateVideoMeta[] = [];
  for (const entry of fs.readdirSync(paths.translateVideoDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !translateVideoExists(entry.name)) continue;
    try {
      out.push(readTranslateVideo(entry.name));
    } catch {

    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
