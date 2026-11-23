import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { defaultBrief, briefOf, type Brief, type ProjectMeta } from "./meta.js";
import { DEFAULT_TTS_ENGINE, isTtsEngine, type TtsEngine } from "./ttsTypes.js";
import { isKebabCase } from "./util.js";

export type TextSourceKind = "url" | "text";

export const TEXT_SOURCE_KINDS: TextSourceKind[] = ["url", "text"];

export interface TextToVideoSource {
  kind: TextSourceKind;

  url: string;

  text: string;
}

export interface ExtractedArticle {
  title: string;

  blocks: string[];
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  canonicalUrl: string | null;
  leadImage: string | null;
  lang: string | null;

  chars: number;
}

export interface ScriptChunk {
  text: string;

  durationSec: number | null;
}

export const TTS_CHUNK_MIN_CHARS = 400;
export const TTS_CHUNK_MAX_CHARS = 800;

export const TTS_CHUNK_SAFE_MIN_CHARS = 30;

export interface TextToVideoVoice {

  engine: TtsEngine;

  model: string | null;

  name: string;

  style: string;

  language: string;

  speed: number;
}

export const TTS_SPEED_MIN = 0.8;
export const TTS_SPEED_MAX = 1.6;

export function normTtsSpeed(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  return Math.min(TTS_SPEED_MAX, Math.max(TTS_SPEED_MIN, Math.round(n * 100) / 100));
}

export function defaultVoice(): TextToVideoVoice {
  return {
    engine: DEFAULT_TTS_ENGINE,
    model: null,
    name: "Kore",
    style: "",
    language: "vi-VN",
    speed: 1,
  };
}

export interface TextToVideoOutput {
  width: number;
  height: number;
  fps: number;

  styleId: string | null;
}

export function defaultOutput(): TextToVideoOutput {
  return { width: 1080, height: 1920, fps: 30, styleId: null };
}

export type TextToVideoStatus =
  | "draft"
  | "extracting"
  | "scripting"
  | "ready"
  | "voicing"
  | "building"
  | "editing"
  | "done"
  | "failed";

export interface TextToVideoMeta {
  id: string;
  name: string;

  autoNamed: boolean;
  source: TextToVideoSource;

  article: ExtractedArticle | null;

  script: ScriptChunk[];
  voice: TextToVideoVoice;

  scriptModel: string | null;
  output: TextToVideoOutput;

  brief: Brief;

  voiceFile: string | null;

  voiceDurationSec: number | null;

  transcriptFile: string | null;

  projectId: string | null;
  status: TextToVideoStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TTS_CHARS_PER_SEC_ESTIMATE = 14.9;

export function textToVideoDirOf(id: string): string {
  return path.join(paths.textToVideoDir, id);
}

export function textToVideoMetaPathOf(id: string): string {
  return path.join(textToVideoDirOf(id), "meta.json");
}

export function textToVideoExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(textToVideoMetaPathOf(id));
}

export function defaultTextToVideoMeta(id: string, name: string): TextToVideoMeta {
  const now = new Date().toISOString();
  const brief = defaultBrief();

  brief.autoCut = false;
  return {
    id,
    name,
    autoNamed: false,
    source: { kind: "url", url: "", text: "" },
    article: null,
    script: [],
    voice: defaultVoice(),
    scriptModel: null,
    output: defaultOutput(),
    brief,
    voiceFile: null,
    voiceDurationSec: null,
    transcriptFile: null,
    projectId: null,
    status: "draft",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function readTextToVideo(id: string): TextToVideoMeta {
  const raw = JSON.parse(fs.readFileSync(textToVideoMetaPathOf(id), "utf8")) as Record<
    string,
    unknown
  >;
  const base = defaultTextToVideoMeta(id, typeof raw.name === "string" ? raw.name : id);
  const src = (raw.source ?? {}) as Record<string, unknown>;
  const voice = (raw.voice ?? {}) as Record<string, unknown>;
  const out = (raw.output ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fb;
  return {
    ...base,

    autoNamed: raw.autoNamed === true,
    source: {
      kind: src.kind === "text" ? "text" : "url",
      url: typeof src.url === "string" ? src.url : "",
      text: typeof src.text === "string" ? src.text : "",
    },
    article: (raw.article as ExtractedArticle | null) ?? null,
    script: Array.isArray(raw.script) ? (raw.script as ScriptChunk[]) : [],
    voice: {

      engine: isTtsEngine(voice.engine) ? voice.engine : DEFAULT_TTS_ENGINE,
      model: typeof voice.model === "string" ? voice.model : null,
      name: typeof voice.name === "string" && voice.name ? voice.name : base.voice.name,
      style: typeof voice.style === "string" ? voice.style : "",
      language:
        typeof voice.language === "string" && voice.language.trim()
          ? voice.language.trim()
          : base.voice.language,
      speed: normTtsSpeed(voice.speed),
    },
    scriptModel: typeof raw.scriptModel === "string" && raw.scriptModel ? raw.scriptModel : null,
    output: {
      width: num(out.width, base.output.width),
      height: num(out.height, base.output.height),
      fps: num(out.fps, base.output.fps),
      styleId: typeof out.styleId === "string" ? out.styleId : null,
    },

    brief: briefOf({ brief: raw.brief } as unknown as ProjectMeta),
    voiceFile: typeof raw.voiceFile === "string" ? raw.voiceFile : null,
    voiceDurationSec:
      typeof raw.voiceDurationSec === "number" && Number.isFinite(raw.voiceDurationSec)
        ? raw.voiceDurationSec
        : null,
    transcriptFile: typeof raw.transcriptFile === "string" ? raw.transcriptFile : null,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    status: (raw.status as TextToVideoStatus) ?? "draft",
    error: typeof raw.error === "string" ? raw.error : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeTextToVideo(meta: TextToVideoMeta): void {
  const dir = textToVideoDirOf(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  const next: TextToVideoMeta = { ...meta, updatedAt: new Date().toISOString() };
  fs.writeFileSync(textToVideoMetaPathOf(meta.id), JSON.stringify(next, null, 2), "utf8");
}

export function patchTextToVideo(
  id: string,
  patch: Partial<TextToVideoMeta>,
): TextToVideoMeta {
  const cur = readTextToVideo(id);
  const next = { ...cur, ...patch };
  writeTextToVideo(next);
  return next;
}

export function sourceTextOf(meta: TextToVideoMeta): string {
  if (meta.article && meta.article.blocks.length > 0) {
    return [meta.article.title, ...meta.article.blocks].filter(Boolean).join("\n\n");
  }
  return meta.source.text.trim();
}

export function scriptTextOf(meta: TextToVideoMeta): string {
  return meta.script.map((c) => c.text).join("\n\n");
}
