import { isScriptFormat, type ScriptFormat } from "./scriptFormats.js";
import { quizzyMotions } from "./quizzyMotions.js";
import fs from "node:fs";
import path from "node:path";
import type { TrimAggressiveness } from "./autoTrim.js";
import { findEditEffect } from "./editEffects.js";
import { paths } from "./config.js";
import { defaultVoice, normTtsSpeed, type TextToVideoVoice } from "./textToVideoMeta.js";
import { isTtsEngine } from "./ttsTypes.js";
import { IMAGE_TEXT_POSITIONS, type ImageTextPosition } from "./imageMeta.js";
import { videoStyleExists } from "./videoStyles.js";
import {
  HttpError,
  ensureDir,
  isKebabCase,
  listFilesRecursive,
  nowIso,
  type FileInfo,
} from "./util.js";

export interface SceneMeta {
  id: string;

  src?: string;

  srcVideo?: string;

  srcImage?: string;
  durationInFrames?: number;
  render?: string;
  from?: number;
  to?: number;
  transitionOverlap?: number;
  [key: string]: unknown;
}

export interface SfxMeta {
  file: string;
  atFrame?: number;
  volume?: number;
  [key: string]: unknown;
}

export interface MusicMeta {
  file: string;
  volume?: number;
  duckVolume?: number;
  speech?: [number, number][];
  [key: string]: unknown;
}

export type SfxMode = "recommended" | "library" | "none";

export const SFX_MODES: SfxMode[] = ["recommended", "library", "none"];

export type MusicMode = "auto" | "none";

export const MUSIC_MODES: MusicMode[] = ["auto", "none"];

const AUTO_CUT_LEVEL_TABLE: Record<TrimAggressiveness, true> = {
  natural: true,
  default: true,
  tight: true,
};

export const AUTO_CUT_LEVELS = Object.keys(AUTO_CUT_LEVEL_TABLE) as TrimAggressiveness[];

export type FinishMode = "draft" | "final";

export const FINISH_MODES: FinishMode[] = ["draft", "final"];

export type SourceKind = "video" | "article" | "request";
export const SOURCE_KINDS: readonly SourceKind[] = ["video", "article", "request"];

export const SOURCE_ARTICLE_REL = "assets/source-article.md";
export const SOURCE_TEXT_MAX = 20_000;

export type NarrationMode = "none" | "tts" | "file";
export const NARRATION_MODES: readonly NarrationMode[] = ["none", "tts", "file"];

export function normNarrationVoice(raw: unknown, base: TextToVideoVoice = defaultVoice()): TextToVideoVoice {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    engine: isTtsEngine(v.engine) ? v.engine : base.engine,
    model: v.model === null ? null : typeof v.model === "string" && v.model.trim() ? v.model.trim() : base.model,
    name: typeof v.name === "string" && v.name.trim() ? v.name.trim() : base.name,
    style: typeof v.style === "string" ? v.style : base.style,
    language: typeof v.language === "string" && v.language.trim() ? v.language.trim() : base.language,
    speed: "speed" in v ? normTtsSpeed(v.speed) : base.speed,
  };
}

export function isAssetRelPath(rel: string): boolean {
  if (!/^assets\/[^\\:\0]+$/.test(rel)) return false;
  return !rel.split("/").some((seg) => !seg || seg.startsWith("."));
}

function isSkillName(v: string): boolean {
  return v.length <= 100 && isKebabCase(v);
}

function isModelId(v: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{2,80}$/i.test(v);
}

export interface Brief {
  scriptFormat: ScriptFormat | null;

  sourceKind: SourceKind;

  sourceUrl: string;

  sourceText: string;

  narrationMode: NarrationMode;

  narrationVoice: TextToVideoVoice;

  narrationFile: string;

  sourceDescription: string;

  autoCut: boolean;

  autoCutLevel: TrimAggressiveness;

  subtitles: boolean;

  highlightEnabled: boolean;

  highlightKeywords: string[];

  keyLayoutEnabled: boolean;

  mainKey: string;

  relatedKeys: string[];

  skill: string | null;
  quizzyMotionIds?: string[];

  sfxMode: SfxMode;

  musicMode: MusicMode;

  autoIllustrations: boolean;

  illustrationModel: string | null;

  illustrationText: boolean;

  illustrationPosition: ImageTextPosition;

  illustrationsPerMinute: number | null;

  styleId: string | null;

  videoStyleEnabled: boolean;

  videoStyleId: string | null;

  finishMode: FinishMode;

  notes: string;
}

export function defaultBrief(): Brief {
  return {
    scriptFormat: null,
    sourceKind: "video",
    sourceUrl: "",
    sourceText: "",
    narrationMode: "none",
    narrationVoice: defaultVoice(),
    narrationFile: "",
    sourceDescription: "",
    autoCut: true,
    autoCutLevel: "default",
    subtitles: true,
    highlightEnabled: true,
    highlightKeywords: [],
    keyLayoutEnabled: true,
    mainKey: "",
    relatedKeys: [],
    skill: null,
    quizzyMotionIds: [],
    sfxMode: "recommended",
    musicMode: "auto",
    autoIllustrations: false,
    illustrationModel: null,
    illustrationText: false,
    illustrationPosition: "auto",
    illustrationsPerMinute: null,
    styleId: null,
    videoStyleEnabled: false,
    videoStyleId: null,
    finishMode: "draft",
    notes: "",
  };
}

export function activeVideoStyleId(brief: Brief): string | null {
  return brief.videoStyleEnabled ? brief.videoStyleId : null;
}

export function briefOf(meta: ProjectMeta): Brief {
  const base = defaultBrief();
  const raw = meta.brief as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const b = raw as Record<string, unknown>;
  if (isScriptFormat(b.scriptFormat)) base.scriptFormat = b.scriptFormat;
  if (SOURCE_KINDS.includes(b.sourceKind as SourceKind)) base.sourceKind = b.sourceKind as SourceKind;
  if (typeof b.sourceUrl === "string") base.sourceUrl = b.sourceUrl.trim();
  if (typeof b.sourceText === "string") base.sourceText = b.sourceText;
  if (NARRATION_MODES.includes(b.narrationMode as NarrationMode)) {
    base.narrationMode = b.narrationMode as NarrationMode;
  }
  base.narrationVoice = normNarrationVoice(b.narrationVoice);
  if (typeof b.narrationFile === "string" && isAssetRelPath(b.narrationFile)) base.narrationFile = b.narrationFile;
  if (typeof b.sourceDescription === "string") base.sourceDescription = b.sourceDescription;
  if (typeof b.autoCut === "boolean") base.autoCut = b.autoCut;
  if (AUTO_CUT_LEVELS.includes(b.autoCutLevel as TrimAggressiveness)) {
    base.autoCutLevel = b.autoCutLevel as TrimAggressiveness;
  }
  if (typeof b.subtitles === "boolean") base.subtitles = b.subtitles;
  if (typeof b.highlightEnabled === "boolean") base.highlightEnabled = b.highlightEnabled;
  if (Array.isArray(b.highlightKeywords)) {
    base.highlightKeywords = b.highlightKeywords.filter(
      (k): k is string => typeof k === "string",
    );
  }
  if (typeof b.keyLayoutEnabled === "boolean") base.keyLayoutEnabled = b.keyLayoutEnabled;
  if (typeof b.mainKey === "string") base.mainKey = b.mainKey;
  if (Array.isArray(b.relatedKeys)) {
    base.relatedKeys = b.relatedKeys.filter((k): k is string => typeof k === "string");
  }
  if (typeof b.skill === "string" && isSkillName(b.skill.trim())) base.skill = b.skill.trim();
  if (SFX_MODES.includes(b.sfxMode as SfxMode)) base.sfxMode = b.sfxMode as SfxMode;
  if (MUSIC_MODES.includes(b.musicMode as MusicMode)) base.musicMode = b.musicMode as MusicMode;
  if (typeof b.autoIllustrations === "boolean") base.autoIllustrations = b.autoIllustrations;
  if (typeof b.illustrationModel === "string" && isModelId(b.illustrationModel.trim())) {
    base.illustrationModel = b.illustrationModel.trim();
  }
  if (typeof b.illustrationText === "boolean") base.illustrationText = b.illustrationText;
  if (IMAGE_TEXT_POSITIONS.includes(b.illustrationPosition as ImageTextPosition)) {
    base.illustrationPosition = b.illustrationPosition as ImageTextPosition;
  }
  if (
    typeof b.illustrationsPerMinute === "number" &&
    Number.isInteger(b.illustrationsPerMinute) &&
    b.illustrationsPerMinute >= 1 &&
    b.illustrationsPerMinute <= 20
  ) {
    base.illustrationsPerMinute = b.illustrationsPerMinute;
  }
  if (typeof b.styleId === "string" && b.styleId.trim()) base.styleId = b.styleId.trim();

  if (typeof b.videoStyleId === "string" && videoStyleExists(b.videoStyleId.trim())) {
    base.videoStyleId = b.videoStyleId.trim();
  }

  if (typeof b.videoStyleEnabled === "boolean") base.videoStyleEnabled = b.videoStyleEnabled;
  else base.videoStyleEnabled = base.videoStyleId !== null;
  if (FINISH_MODES.includes(b.finishMode as FinishMode)) base.finishMode = b.finishMode as FinishMode;
  if (Array.isArray(b.quizzyMotionIds)) base.quizzyMotionIds = [...new Set(b.quizzyMotionIds.filter((id): id is string => typeof id === "string" && quizzyMotions.some(item => item.id === id)))];
  if (typeof b.notes === "string") base.notes = b.notes;
  return base;
}

export function applyBriefPatch(
  base: Brief,
  body: Record<string, unknown>,
  checkStyle?: (id: string) => boolean,
): Brief {
  const brief: Brief = { ...base };
  const bad = (msg: string): never => {
    throw new HttpError(400, "INVALID_BRIEF", msg);
  };

  if ("scriptFormat" in body) {
    const format = body.scriptFormat;
    if (format === null || isScriptFormat(format)) brief.scriptFormat = format;
    else bad("Dạng kịch bản không hợp lệ");
  }

  const str = (key: keyof Brief, trim = false): void => {
    if (!(key in body)) return;
    if (typeof body[key] !== "string") bad(`${key} phải là string`);
    const v = body[key] as string;
    (brief as unknown as Record<string, unknown>)[key] = trim ? v.trim() : v;
  };
  const bool = (key: keyof Brief): void => {
    if (!(key in body)) return;
    if (typeof body[key] !== "boolean") bad(`${key} phải là boolean`);
    (brief as unknown as Record<string, unknown>)[key] = body[key];
  };
  const strList = (key: keyof Brief): void => {
    if (!(key in body)) return;
    const raw = body[key];
    if (!Array.isArray(raw) || raw.some((k) => typeof k !== "string")) {
      bad(`${key} phải là mảng string`);
    }
    (brief as unknown as Record<string, unknown>)[key] = (raw as string[])
      .map((k) => k.trim())
      .filter(Boolean);
  };

  const nullableStr = (key: keyof Brief): string | null | undefined => {
    if (!(key in body)) return undefined;
    if (body[key] !== null && typeof body[key] !== "string") {
      bad(`${key} phải là string hoặc null`);
    }
    const v = typeof body[key] === "string" ? (body[key] as string).trim() : "";
    (brief as unknown as Record<string, unknown>)[key] = v || null;
    return v || null;
  };

  str("sourceDescription");
  if ("sourceKind" in body && !SOURCE_KINDS.includes(body.sourceKind as SourceKind)) {
    bad(`sourceKind phải là một trong: ${SOURCE_KINDS.join(" | ")}`);
  }
  if ("sourceKind" in body) brief.sourceKind = body.sourceKind as SourceKind;
  str("sourceUrl", true);
  if (brief.sourceUrl && !/^https?:\/\//i.test(brief.sourceUrl)) bad("sourceUrl phải bắt đầu bằng http:// hoặc https://");
  str("sourceText");
  if (brief.sourceText.length > SOURCE_TEXT_MAX) bad(`sourceText tối đa ${SOURCE_TEXT_MAX} ký tự`);
  if ("narrationMode" in body && !NARRATION_MODES.includes(body.narrationMode as NarrationMode)) {
    bad(`narrationMode phải là một trong: ${NARRATION_MODES.join(" | ")}`);
  }
  if ("narrationMode" in body) brief.narrationMode = body.narrationMode as NarrationMode;
  if ("narrationVoice" in body) {
    const v = body.narrationVoice;
    if (!v || typeof v !== "object" || Array.isArray(v)) bad("narrationVoice phải là object");
    if ("engine" in (v as object) && !isTtsEngine((v as Record<string, unknown>).engine)) {
      bad("narrationVoice.engine không hợp lệ");
    }

    brief.narrationVoice = normNarrationVoice(v, brief.narrationVoice);
  }
  str("narrationFile", true);
  if (brief.narrationFile && !isAssetRelPath(brief.narrationFile)) {
    bad('narrationFile phải là file trong assets/ của project (vd "assets/giong-doc.mp3")');
  }
  bool("autoCut");
  bool("subtitles");
  bool("highlightEnabled");
  strList("highlightKeywords");
  bool("keyLayoutEnabled");
  str("mainKey", true);
  strList("relatedKeys");
  const skill = nullableStr("skill");
  if (skill && !isSkillName(skill)) bad("skill phải là tên skill kebab-case (vd: vertical-short)");
  bool("autoIllustrations");
  const illustrationModel = nullableStr("illustrationModel");
  if (illustrationModel && !isModelId(illustrationModel)) bad("illustrationModel không hợp lệ");
  bool("illustrationText");
  str("notes");

  if (
    "illustrationPosition" in body &&
    !IMAGE_TEXT_POSITIONS.includes(body.illustrationPosition as ImageTextPosition)
  ) {
    bad(`illustrationPosition phải là một trong: ${IMAGE_TEXT_POSITIONS.join(" | ")}`);
  }
  if ("illustrationPosition" in body) {
    brief.illustrationPosition = body.illustrationPosition as ImageTextPosition;
  }

  if ("illustrationsPerMinute" in body) {
    const v = body.illustrationsPerMinute;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 20)) {
      bad("illustrationsPerMinute phải là null hoặc số nguyên 1-20");
    }
    brief.illustrationsPerMinute = v as number | null;
  }

  if (
    "autoCutLevel" in body &&
    !AUTO_CUT_LEVELS.includes(body.autoCutLevel as TrimAggressiveness)
  ) {
    bad(`autoCutLevel phải là một trong: ${AUTO_CUT_LEVELS.join(" | ")}`);
  }
  if ("autoCutLevel" in body) brief.autoCutLevel = body.autoCutLevel as TrimAggressiveness;

  if ("sfxMode" in body && !SFX_MODES.includes(body.sfxMode as SfxMode)) {
    bad(`sfxMode phải là một trong: ${SFX_MODES.join(" | ")}`);
  }
  if ("sfxMode" in body) brief.sfxMode = body.sfxMode as SfxMode;

  if ("musicMode" in body && !MUSIC_MODES.includes(body.musicMode as MusicMode)) {
    bad(`musicMode phải là một trong: ${MUSIC_MODES.join(" | ")}`);
  }
  if ("musicMode" in body) brief.musicMode = body.musicMode as MusicMode;

  if ("finishMode" in body && !FINISH_MODES.includes(body.finishMode as FinishMode)) {
    bad(`finishMode phải là một trong: ${FINISH_MODES.join(" | ")}`);
  }
  if ("finishMode" in body) brief.finishMode = body.finishMode as FinishMode;

  const styleId = nullableStr("styleId");
  if (styleId && checkStyle && !checkStyle(styleId)) {
    throw new HttpError(400, "STYLE_NOT_FOUND", `Không tìm thấy style "${styleId}"`);
  }

  if ("quizzyMotionIds" in body) {
    if (!Array.isArray(body.quizzyMotionIds) || body.quizzyMotionIds.length > 30 ||
      body.quizzyMotionIds.some(id => typeof id !== "string" || !quizzyMotions.some(item => item.id === id))) {
      bad("Motion Quizzy không hợp lệ");
    }
    brief.quizzyMotionIds = [...new Set(body.quizzyMotionIds as string[])];
  }
  bool("videoStyleEnabled");

  const videoStyleId = nullableStr("videoStyleId");
  if (videoStyleId && !videoStyleExists(videoStyleId)) {
    throw new HttpError(
      400,
      "VIDEO_STYLE_NOT_FOUND",
      `Không tìm thấy phong cách dựng "${videoStyleId}". Xem danh sách tại GET /api/video-styles.`,
    );
  }

  if (videoStyleId && !("videoStyleEnabled" in body)) brief.videoStyleEnabled = true;

  return brief;
}

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: string;
  brief?: Brief;
  scenes?: SceneMeta[];
  audio?: {
    voice?: string | null;
    sfx?: SfxMeta[];

    music?: MusicMeta | null;
    [key: string]: unknown;
  };
  output?: string | null;

  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: "draft" | "rendering" | "done";
  output: string | null;
  tags: string[];

  textToVideoId: string | null;
  createdAt: string | null;
  updatedAt: string;
}

export function normOutput(raw: unknown): string | null {
  if (typeof raw === "string" && raw) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.file === "string" && o.file) return o.file;
    if (typeof o.renderPath === "string" && o.renderPath) return o.renderPath;
  }
  return null;
}

export function normTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))];
}

export function projectDirOf(id: string): string {
  return path.join(paths.videoProjectsDir, id);
}

export function metaPathOf(id: string): string {
  return path.join(projectDirOf(id), "meta.json");
}

export function projectExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(metaPathOf(id));
}

export function readMeta(id: string): ProjectMeta {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_PROJECT_ID", `Project id không hợp lệ: ${id}`);
  }
  const file = metaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${id}"`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProjectMeta;
  } catch {
    throw new HttpError(500, "META_INVALID", `meta.json của project "${id}" không phải JSON hợp lệ`);
  }
}

export function writeMeta(id: string, meta: ProjectMeta): void {
  meta.updatedAt = nowIso();
  fs.writeFileSync(metaPathOf(id), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function normStatus(s: unknown): ProjectSummary["status"] {
  return s === "rendering" || s === "done" ? s : "draft";
}

export function projectSummaryOf(id: string): ProjectSummary | null {
  const file = metaPathOf(id);
  try {
    const meta = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectMeta;
    const updatedAt =
      typeof meta.updatedAt === "string" && meta.updatedAt
        ? meta.updatedAt
        : fs.statSync(file).mtime.toISOString();
    return {
      id,
      name: typeof meta.name === "string" ? meta.name : id,
      width: Number(meta.width) || 0,
      height: Number(meta.height) || 0,
      fps: Number(meta.fps) || 0,
      status: normStatus(meta.status),
      output: normOutput(meta.output),
      tags: normTags(meta.tags),
      textToVideoId:
        typeof meta.textToVideoId === "string" && meta.textToVideoId
          ? meta.textToVideoId
          : null,
      createdAt: typeof meta.createdAt === "string" && meta.createdAt ? meta.createdAt : null,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export type FileInfoWithDescription = FileInfo & {
  editEffectId?: string;
  editEffectName?: string;
  description?: string;

  colorGrade?: string;

  colorAdjust?: Record<string, number>;
};

export interface AssetEntry {
  editEffectId?: string;
  description?: string;
  colorGrade?: string;
  colorAdjust?: Record<string, number>;
}

export function readAssetEntries(id: string): Record<string, AssetEntry> {
  try {
    const raw = JSON.parse(fs.readFileSync(assetsJsonPathOf(id), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Object.create(null);

    const out: Record<string, AssetEntry> = Object.create(null);
    for (const [file, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const clean: AssetEntry = {};
      if (typeof e.editEffectId === "string") clean.editEffectId = e.editEffectId;
      if (typeof e.description === "string") clean.description = e.description;
      if (typeof e.colorGrade === "string" && e.colorGrade) clean.colorGrade = e.colorGrade;
      if (e.colorAdjust && typeof e.colorAdjust === "object" && !Array.isArray(e.colorAdjust)) {
        clean.colorAdjust = e.colorAdjust as Record<string, number>;
      }
      out[file] = clean;
    }
    return out;
  } catch {
    return Object.create(null);
  }
}

export function writeAssetEntry(
  id: string,
  fileName: string,
  patch: {
    description?: string;
    editEffectId?: string | null;
    colorGrade?: string | null;
    colorAdjust?: Record<string, number> | null;
  },
): void {
  const map = readAssetEntries(id);
  const cur = map[fileName] ?? {};
  if (patch.description !== undefined) cur.description = patch.description;
  if (patch.colorGrade !== undefined) {
    if (patch.colorGrade === null) delete cur.colorGrade;
    else cur.colorGrade = patch.colorGrade;
  }
  if (patch.colorAdjust !== undefined) {
    if (patch.colorAdjust === null) delete cur.colorAdjust;
    else cur.colorAdjust = patch.colorAdjust;
  }
  if (patch.editEffectId === null) delete cur.editEffectId;
  else if (patch.editEffectId !== undefined) cur.editEffectId = patch.editEffectId;
  map[fileName] = cur;
  ensureDir(projectAssetsDirOf(id));
  fs.writeFileSync(assetsJsonPathOf(id), JSON.stringify(map, null, 2) + "\n", "utf8");
}

export function removeAssetEntry(id: string, fileName: string): void {
  const map = readAssetEntries(id);
  if (!(fileName in map)) return;
  delete map[fileName];
  fs.writeFileSync(assetsJsonPathOf(id), JSON.stringify(map, null, 2) + "\n", "utf8");
}

export function projectAssetsDirOf(id: string): string {
  return path.join(projectDirOf(id), "assets");
}

export function assetsJsonPathOf(id: string): string {
  return path.join(projectAssetsDirOf(id), "assets.json");
}

export function listProjectAssets(id: string): FileInfoWithDescription[] {
  const files = listFilesRecursive(projectAssetsDirOf(id)).filter(
    (f) => f.name !== "assets.json",
  );
  const entries = readAssetEntries(id);
  return files.map((f) => {
    const e = entries[f.name];
    const effectId = entries[f.relPath]?.editEffectId;
    const out: FileInfoWithDescription = { ...f };
    if (effectId !== undefined) {
      out.editEffectId = effectId;
      out.editEffectName = findEditEffect(effectId)?.name;
    }
    if (!e) return out;
    if (e.description !== undefined) out.description = e.description;
    if (e.colorGrade !== undefined) out.colorGrade = e.colorGrade;
    if (e.colorAdjust !== undefined) out.colorAdjust = e.colorAdjust;
    return out;
  });
}

export function scanProjects(): ProjectSummary[] {
  if (!fs.existsSync(paths.videoProjectsDir)) return [];
  const out: ProjectSummary[] = [];
  for (const entry of fs.readdirSync(paths.videoProjectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!fs.existsSync(metaPathOf(entry.name))) continue;
    const summary = projectSummaryOf(entry.name);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}
