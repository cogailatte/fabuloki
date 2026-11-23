import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { metaPathOf, projectDirOf, readMeta, type ProjectMeta } from "./meta.js";
import { GRADE_PRESETS } from "./color.js";
import { ensureDir, execFileCaptureAll, fileKind, nowIso } from "./util.js";
import { ffprobeSafeArgs } from "./ffmpegSafe.js";

export const TIMELINE_KEYS = [
  "scenes",
  "audio",
  "captions",
  "subtitles",
  "subtitleStyle",
  "overlays",

  "layers",
] as const;

const VERSION_OPTIONAL_KEYS: readonly TimelineKey[] = ["layers"];

export type TimelineKey = (typeof TIMELINE_KEYS)[number];

type Obj = Record<string, unknown>;

export interface Timeline {
  scenes: Obj[];
  audio: Obj & { voice: string | null; sfx: Obj[]; music: Obj | null };
  captions: Obj[];
  subtitles: Obj[];

  subtitleStyle?: Obj;
  overlays: Obj[];

  layers: Obj[];
}

export type RawTimeline = Record<TimelineKey, unknown>;

export interface TimelineIssue {
  path: string;
  message: string;
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function rawTimelineOf(meta: ProjectMeta): RawTimeline {
  const out = {} as RawTimeline;
  for (const key of TIMELINE_KEYS) out[key] = meta[key] === undefined ? null : meta[key];
  return out;
}

export function versionOfRaw(raw: RawTimeline): string {
  const ordered: Obj = {};
  for (const key of TIMELINE_KEYS) {
    const v = raw[key] ?? null;
    if (v === null && VERSION_OPTIONAL_KEYS.includes(key)) continue;
    ordered[key] = v;
  }
  return crypto.createHash("sha1").update(JSON.stringify(ordered)).digest("hex").slice(0, 16);
}

export function timelineVersion(meta: ProjectMeta): string {
  return versionOfRaw(rawTimelineOf(meta));
}

export function timelineForClient(meta: ProjectMeta): Timeline {
  const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
  const audioRaw = isObj(meta.audio) ? (meta.audio as Obj) : {};
  const audio = {
    ...audioRaw,
    voice: typeof audioRaw.voice === "string" ? audioRaw.voice : null,
    sfx: arr(audioRaw.sfx),
    music: isObj(audioRaw.music) ? (audioRaw.music as Obj) : null,
  };
  const out: Timeline = {
    scenes: arr(meta.scenes),
    audio,
    captions: arr(meta.captions),
    subtitles: arr(meta.subtitles),
    overlays: arr(meta.overlays),
    layers: arr(meta.layers),
  };
  if (isObj(meta.subtitleStyle)) out.subtitleStyle = meta.subtitleStyle as Obj;
  return out;
}

export function resolveProjectPath(
  projectDir: string,
  rel: unknown,
): { abs: string } | { error: string } {
  if (typeof rel !== "string" || !rel) return { error: "đường dẫn phải là chuỗi không rỗng" };
  if (rel.includes("\0")) return { error: "đường dẫn chứa ký tự không hợp lệ" };
  if (
    path.posix.isAbsolute(rel) ||
    path.win32.isAbsolute(rel) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel)
  ) {
    return { error: "đường dẫn phải TƯƠNG ĐỐI thư mục project (vd assets/x.mp4)" };
  }
  const segs = rel.split(/[\\/]+/);
  if (segs.includes("..")) return { error: 'đường dẫn không được chứa ".."' };
  if (segs.some((s) => s.startsWith(".") && s !== ".")) {
    return { error: "đường dẫn không được trỏ vào file/thư mục ẩn" };
  }
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return { error: "đường dẫn nằm ngoài thư mục project" };
  return { abs };
}

class Issues {
  list: TimelineIssue[] = [];
  constructor(private projectDir: string) {}

  add(p: string, message: string): void {

    if (this.list.length < 200) this.list.push({ path: p, message });
  }

  optNum(o: Obj, key: string, p: string, min: number, max = Infinity, exclusiveMin = false): void {
    const v = o[key];
    if (v === undefined) return;
    this.num(v, `${p}.${key}`, min, max, exclusiveMin);
  }

  num(v: unknown, p: string, min: number, max = Infinity, exclusiveMin = false): boolean {
    const okMin = isNum(v) && (exclusiveMin ? v > min : v >= min);
    if (!isNum(v) || !okMin || v > max) {
      const range =
        max === Infinity ? `${exclusiveMin ? ">" : ">="} ${min}` : `trong khoảng ${min}..${max}`;
      this.add(p, `phải là số ${range}`);
      return false;
    }
    return true;
  }

  int(v: unknown, p: string, min: number, exclusiveMin = false): boolean {
    if (!isInt(v) || (exclusiveMin ? v <= min : v < min)) {
      this.add(p, `phải là số nguyên ${exclusiveMin ? ">" : ">="} ${min}`);
      return false;
    }
    return true;
  }

  optStr(o: Obj, key: string, p: string): void {
    if (o[key] !== undefined && typeof o[key] !== "string") this.add(`${p}.${key}`, "phải là chuỗi");
  }

  optBool(o: Obj, key: string, p: string): void {
    if (o[key] !== undefined && typeof o[key] !== "boolean") {
      this.add(`${p}.${key}`, "phải là true/false");
    }
  }

  optEnum(o: Obj, key: string, p: string, values: readonly string[]): void {
    const v = o[key];
    if (v !== undefined && !values.includes(v as string)) {
      this.add(`${p}.${key}`, `phải là một trong: ${values.join(" | ")}`);
    }
  }

  mediaPath(v: unknown, p: string): void {
    const r = resolveProjectPath(this.projectDir, v);
    if ("error" in r) this.add(p, r.error);
  }

  cueBase(c: Obj, p: string): void {
    this.int(c.from, `${p}.from`, 0);
    this.int(c.durationInFrames, `${p}.durationInFrames`, 0, true);
  }
}

function validateScenes(v: unknown, is: Issues): void {
  if (!Array.isArray(v)) {
    is.add("scenes", "phải là mảng");
    return;
  }
  const seen = new Map<string, number>();
  v.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (!isObj(s)) {
      is.add(p, "scene phải là object");
      return;
    }
    if (typeof s.id !== "string" || !s.id.trim()) {
      is.add(`${p}.id`, "id phải là chuỗi không rỗng");
    } else if (seen.has(s.id)) {
      is.add(`${p}.id`, `id "${s.id}" trùng với scenes[${seen.get(s.id)}]`);
    } else {
      seen.set(s.id, i);
    }

    for (const key of ["src", "srcVideo", "render"]) {
      if (s[key] === undefined) continue;
      if (typeof s[key] !== "string") is.add(`${p}.${key}`, "phải là chuỗi");
      else if (s[key]) is.mediaPath(s[key], `${p}.${key}`);
    }
    if (s.srcImage !== undefined && s.srcImage !== null) {
      if (typeof s.srcImage !== "string") is.add(`${p}.srcImage`, "phải là chuỗi hoặc null");
      else if (s.srcImage) is.mediaPath(s.srcImage, `${p}.srcImage`);
    }
    is.optNum(s, "from", p, 0);
    is.optNum(s, "to", p, 0);
    if (isNum(s.from) && isNum(s.to) && !(s.to > s.from)) {
      is.add(`${p}.to`, "to phải lớn hơn from");
    }
    if (s.durationInFrames !== undefined) is.int(s.durationInFrames, `${p}.durationInFrames`, 0, true);
    if (s.transitionOverlap !== undefined) is.int(s.transitionOverlap, `${p}.transitionOverlap`, 0);
    is.optBool(s, "muted", p);
    if (s.zoom !== undefined) validateZoom(s.zoom, `${p}.zoom`, is);

    is.optEnum(s, "fit", p, FIT_VALUES);
    if (s.transform !== undefined) validateFrameTransform(s.transform, `${p}.transform`, is);
    if (s.crop !== undefined) validateCrop(s.crop, `${p}.crop`, is);
    if (s.color !== undefined) validateColorAdjust(s.color, `${p}.color`, is);
    is.optNum(s, "volume", p, 0, 2);
    is.optNum(s, "fadeInSec", p, 0, 10);
    is.optNum(s, "fadeOutSec", p, 0, 10);
    is.optNum(s, "speed", p, SPEED_MIN, SPEED_MAX);
    if (s.transition !== undefined) {
      if (!isObj(s.transition)) is.add(`${p}.transition`, "phải là object { type }");
      else if (!TRANSITION_TYPES.includes(s.transition.type as string)) {
        is.add(`${p}.transition.type`, `phải là một trong: ${TRANSITION_TYPES.join(" | ")}`);
      }
    }

    const hasSource = ["src", "srcVideo", "srcImage", "render"].some((k) => nonEmptyStr(s[k]));
    const inferable = nonEmptyStr(s.srcVideo) && isNum(s.from) && isNum(s.to);
    if (!hasSource && s.durationInFrames === undefined) {
      is.add(p, "scene cần ít nhất một nguồn (src | srcVideo | srcImage | render) hoặc durationInFrames");
    } else if (s.durationInFrames === undefined && !inferable) {
      is.add(
        `${p}.durationInFrames`,
        "thiếu durationInFrames (chỉ scene srcVideo có đủ from/to mới được bỏ trống)",
      );
    }
  });
}

const FIT_VALUES = ["cover", "contain"] as const;

const TRANSITION_TYPES: readonly string[] = [
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "wipe-left",
  "wipe-right",
  "zoom-in",
  "zoom-out",
  "blur",
  "none",
];

const LAYER_ANIMS = ["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "zoom"] as const;
const LAYER_KINDS = ["image", "video", "text", "shape"] as const;
const KEYFRAME_EASES = ["linear", "in", "out", "inOut"] as const;

const SPEED_MIN = 0.25;
const SPEED_MAX = 4;

function validateFrameTransform(v: unknown, p: string, is: Issues): void {
  if (!isObj(v)) {
    is.add(p, "phải là object { x?, y?, scale?, rotate?, flipH?, flipV? }");
    return;
  }
  is.optNum(v, "x", p, -1, 1);
  is.optNum(v, "y", p, -1, 1);
  is.optNum(v, "scale", p, 0.1, 5);
  is.optNum(v, "rotate", p, -180, 180);
  is.optBool(v, "flipH", p);
  is.optBool(v, "flipV", p);
}

function validateCueTransform(v: unknown, p: string, is: Issues): void {
  if (!isObj(v)) {
    is.add(p, "phải là object { x?, y?, scale? }");
    return;
  }
  is.optNum(v, "x", p, -1, 1);
  is.optNum(v, "y", p, -1, 1);
  is.optNum(v, "scale", p, 0.3, 3);
}

function validateCrop(v: unknown, p: string, is: Issues): void {
  if (!isObj(v)) {
    is.add(p, "phải là object { top?, right?, bottom?, left? }");
    return;
  }
  for (const k of ["top", "right", "bottom", "left"]) is.optNum(v, k, p, 0, 0.45);
}

function validateColorAdjust(v: unknown, p: string, is: Issues): void {
  if (!isObj(v)) {
    is.add(p, "phải là object ColorAdjust");
    return;
  }
  if (v.preset !== undefined) {
    if (typeof v.preset !== "string") is.add(`${p}.preset`, "phải là chuỗi");
    else if (!GRADE_PRESETS.some((g) => g.id === v.preset)) {
      is.add(`${p}.preset`, `preset lạ - một trong: ${GRADE_PRESETS.map((g) => g.id).join(" | ")}`);
    }
  }
  for (const k of ["brightness", "contrast", "saturation", "temperature", "tint"]) is.optNum(v, k, p, -1, 1);
  is.optNum(v, "hue", p, -180, 180);
  is.optNum(v, "vignette", p, 0, 1);
  is.optNum(v, "blur", p, 0, 20);
}

function validateLayers(v: unknown, is: Issues): void {
  if (!Array.isArray(v)) {
    is.add("layers", "phải là mảng");
    return;
  }
  const seen = new Map<string, number>();
  v.forEach((l, i) => {
    const p = `layers[${i}]`;
    if (!isObj(l)) {
      is.add(p, "layer phải là object");
      return;
    }
    if (typeof l.id !== "string" || !l.id.trim()) {
      is.add(`${p}.id`, "id phải là chuỗi không rỗng");
    } else if (seen.has(l.id)) {
      is.add(`${p}.id`, `id "${l.id}" trùng với layers[${seen.get(l.id)}]`);
    } else {
      seen.set(l.id, i);
    }
    if (!LAYER_KINDS.includes(l.kind as (typeof LAYER_KINDS)[number])) {
      is.add(`${p}.kind`, `phải là một trong: ${LAYER_KINDS.join(" | ")}`);
    }
    is.cueBase(l, p);
    const media = l.kind === "image" || l.kind === "video";
    if (l.src !== undefined || media) {
      if (!nonEmptyStr(l.src)) is.add(`${p}.src`, "layer ảnh/video cần src là chuỗi không rỗng");
      else is.mediaPath(l.src, `${p}.src`);
    }
    is.optNum(l, "mediaStart", p, 0);
    is.optBool(l, "muted", p);
    is.optNum(l, "volume", p, 0, 2);
    is.optStr(l, "text", p);
    if (l.style !== undefined) {
      const st = l.style;
      const sp = `${p}.style`;
      if (!isObj(st)) {
        is.add(sp, "phải là object");
      } else {
        for (const k of ["fontFamily", "color", "backgroundColor", "strokeColor"]) is.optStr(st, k, sp);
        is.optNum(st, "fontSizePx", sp, 0, 1000, true);
        is.optNum(st, "fontWeight", sp, 100, 1000);
        is.optEnum(st, "align", sp, ["left", "center", "right"]);
        is.optNum(st, "lineHeight", sp, 0.5, 5);
        is.optNum(st, "paddingPx", sp, 0, 1000);
        is.optNum(st, "radiusPx", sp, 0, 5000);
        is.optNum(st, "strokeWidthPx", sp, 0, 100);
        is.optBool(st, "shadow", sp);
      }
    }
    is.optNum(l, "width", p, 0.05, 2);
    is.optNum(l, "aspect", p, 0.05, 20);
    if (l.transform !== undefined) validateFrameTransform(l.transform, `${p}.transform`, is);
    is.optNum(l, "opacity", p, 0, 1);
    is.optEnum(l, "fit", p, FIT_VALUES);
    if (l.crop !== undefined) validateCrop(l.crop, `${p}.crop`, is);
    if (l.color !== undefined) validateColorAdjust(l.color, `${p}.color`, is);
    is.optNum(l, "radiusPx", p, 0, 5000);
    if (l.animation !== undefined) {
      const ap = `${p}.animation`;
      if (!isObj(l.animation)) {
        is.add(ap, "phải là object { in?, out?, durationSec? }");
      } else {
        is.optEnum(l.animation, "in", ap, LAYER_ANIMS);
        is.optEnum(l.animation, "out", ap, LAYER_ANIMS);
        is.optNum(l.animation, "durationSec", ap, 0, 10);
      }
    }
    if (l.keyframes !== undefined) {
      if (!Array.isArray(l.keyframes)) {
        is.add(`${p}.keyframes`, "phải là mảng");
      } else {
        l.keyframes.forEach((k, j) => {
          const kp = `${p}.keyframes[${j}]`;
          if (!isObj(k)) {
            is.add(kp, "keyframe phải là object");
            return;
          }
          is.int(k.frame, `${kp}.frame`, 0);
          is.optNum(k, "x", kp, -1, 1);
          is.optNum(k, "y", kp, -1, 1);
          is.optNum(k, "scale", kp, 0.1, 5);
          is.optNum(k, "rotate", kp, -180, 180);
          is.optNum(k, "opacity", kp, 0, 1);
          is.optEnum(k, "ease", kp, KEYFRAME_EASES);
        });
      }
    }
  });
}

function validateZoom(v: unknown, p: string, is: Issues): void {
  if (!isObj(v)) {
    is.add(p, "phải là object { origin?, keys[] }");
    return;
  }
  is.optStr(v, "origin", p);
  if (!Array.isArray(v.keys) || v.keys.length < 2) {
    is.add(`${p}.keys`, "phải là mảng có ít nhất 2 mốc");
    return;
  }
  v.keys.forEach((k, i) => {
    const kp = `${p}.keys[${i}]`;
    if (!isObj(k)) {
      is.add(kp, "mốc zoom phải là object");
      return;
    }
    is.num(k.frame, `${kp}.frame`, 0);
    is.num(k.scale, `${kp}.scale`, 0, Infinity, true);
    is.optEnum(k, "ease", kp, ["linear", "out", "inOut"]);
  });
}

function validateAudio(v: unknown, is: Issues): void {
  if (!isObj(v)) {
    is.add("audio", "phải là object { voice, sfx, music }");
    return;
  }
  if (v.voice !== undefined && v.voice !== null) {
    if (typeof v.voice !== "string") is.add("audio.voice", "phải là chuỗi hoặc null");
    else if (v.voice) is.mediaPath(v.voice, "audio.voice");
  }
  if (v.sfx !== undefined) {
    if (!Array.isArray(v.sfx)) {
      is.add("audio.sfx", "phải là mảng");
    } else {
      v.sfx.forEach((x, i) => {
        const p = `audio.sfx[${i}]`;
        if (!isObj(x)) {
          is.add(p, "sfx phải là object");
          return;
        }
        if (!nonEmptyStr(x.file)) is.add(`${p}.file`, "file phải là chuỗi không rỗng");
        else is.mediaPath(x.file, `${p}.file`);
        is.int(x.atFrame, `${p}.atFrame`, 0);
        is.optNum(x, "volume", p, 0, 1);
        is.optNum(x, "mediaStart", p, 0);
        is.optNum(x, "fadeInSec", p, 0, 10);
        is.optNum(x, "fadeOutSec", p, 0, 10);
      });
    }
  }
  if (v.music !== undefined && v.music !== null) {
    const m = v.music;
    if (!isObj(m)) {
      is.add("audio.music", "phải là object hoặc null");
      return;
    }
    if (!nonEmptyStr(m.file)) is.add("audio.music.file", "file phải là chuỗi không rỗng");
    else is.mediaPath(m.file, "audio.music.file");
    is.optNum(m, "volume", "audio.music", 0, 1);
    is.optNum(m, "duckVolume", "audio.music", 0, 1);
    is.optNum(m, "fadeInSec", "audio.music", 0, 10);
    is.optNum(m, "fadeOutSec", "audio.music", 0, 10);
    if (m.speech !== undefined) {
      if (!Array.isArray(m.speech)) {
        is.add("audio.music.speech", "phải là mảng các cặp [giâyBắtĐầu, giâyKếtThúc]");
      } else {
        m.speech.forEach((r, i) => {
          if (!Array.isArray(r) || r.length !== 2 || !isNum(r[0]) || !isNum(r[1])) {
            is.add(`audio.music.speech[${i}]`, "phải là cặp số [giâyBắtĐầu, giâyKếtThúc]");
          }
        });
      }
    }
  }
}

function validateCaptions(v: unknown, is: Issues): void {
  if (!Array.isArray(v)) {
    is.add("captions", "phải là mảng");
    return;
  }
  v.forEach((c, i) => {
    const p = `captions[${i}]`;
    if (!isObj(c)) {
      is.add(p, "cue phải là object");
      return;
    }
    is.cueBase(c, p);
    if (c.transform !== undefined) validateCueTransform(c.transform, `${p}.transform`, is);
    if (!Array.isArray(c.words) || c.words.length < 1) {
      is.add(`${p}.words`, "phải là mảng có ít nhất 1 từ");
      return;
    }
    c.words.forEach((w, j) => {
      const wp = `${p}.words[${j}]`;
      if (!isObj(w)) {
        is.add(wp, "từ phải là object");
        return;
      }
      if (!nonEmptyStr(w.text)) is.add(`${wp}.text`, "text phải là chuỗi không rỗng");
      is.num(w.start, `${wp}.start`, 0);
      is.num(w.end, `${wp}.end`, 0);
      is.optBool(w, "hi", wp);
    });
  });
}

function validateSubtitles(v: unknown, is: Issues): void {
  if (!Array.isArray(v)) {
    is.add("subtitles", "phải là mảng");
    return;
  }
  v.forEach((c, i) => {
    const p = `subtitles[${i}]`;
    if (!isObj(c)) {
      is.add(p, "cue phải là object");
      return;
    }
    is.cueBase(c, p);
    if (c.transform !== undefined) validateCueTransform(c.transform, `${p}.transform`, is);
    if (!nonEmptyStr(c.text)) is.add(`${p}.text`, "text phải là chuỗi không rỗng");
  });
}

function validateSubtitleStyle(v: unknown, is: Issues): void {
  if (!isObj(v)) {
    is.add("subtitleStyle", "phải là object (gửi null để xóa)");
    return;
  }
  const p = "subtitleStyle";
  is.optStr(v, "fontFamily", p);
  is.optNum(v, "fontSizePx", p, 0, Infinity, true);
  is.optStr(v, "color", p);
  is.optEnum(v, "backdrop", p, ["blur", "solid", "none"]);
  is.optStr(v, "backdropColor", p);
  is.optNum(v, "blurPx", p, 0);
  is.optNum(v, "bottomPx", p, 0);
}

function validateOverlays(v: unknown, is: Issues): void {
  if (!Array.isArray(v)) {
    is.add("overlays", "phải là mảng");
    return;
  }
  v.forEach((c, i) => {
    const p = `overlays[${i}]`;
    if (!isObj(c)) {
      is.add(p, "cue phải là object");
      return;
    }
    is.cueBase(c, p);
    if (c.transform !== undefined) validateCueTransform(c.transform, `${p}.transform`, is);
    is.optStr(c, "kicker", p);
    is.optEnum(c, "tier", p, ["main", "sub"]);
    is.optEnum(c, "accent", p, ["hot", "cool"]);
    if (!Array.isArray(c.parts) || c.parts.length < 1) {
      is.add(`${p}.parts`, "phải là mảng có ít nhất 1 phần chữ");
      return;
    }
    c.parts.forEach((part, j) => {
      const pp = `${p}.parts[${j}]`;
      if (!isObj(part)) {
        is.add(pp, "phần chữ phải là object { t, hi? }");
        return;
      }
      if (!nonEmptyStr(part.t)) is.add(`${pp}.t`, "t phải là chuỗi không rỗng");
      is.optBool(part, "hi", pp);
    });
  });
}

export function validateTimelinePatch(patch: Obj, projectDir: string): TimelineIssue[] {
  const is = new Issues(projectDir);
  for (const key of Object.keys(patch)) {
    if (!(TIMELINE_KEYS as readonly string[]).includes(key)) {
      is.add(
        `timeline.${key}`,
        `khóa "${key}" không sửa được qua trình chỉnh sửa (chỉ: ${TIMELINE_KEYS.join(", ")})`,
      );
    }
  }
  if ("scenes" in patch) validateScenes(patch.scenes, is);
  if ("audio" in patch) validateAudio(patch.audio, is);
  if ("captions" in patch) validateCaptions(patch.captions, is);
  if ("subtitles" in patch) validateSubtitles(patch.subtitles, is);
  if ("subtitleStyle" in patch && patch.subtitleStyle !== null) {
    validateSubtitleStyle(patch.subtitleStyle, is);
  }
  if ("overlays" in patch) validateOverlays(patch.overlays, is);
  if ("layers" in patch && patch.layers !== null) validateLayers(patch.layers, is);
  return is.list;
}

const NULL_AS_ABSENT_KEYS = ["audio", "captions", "subtitles", "subtitleStyle", "overlays", "layers"] as const;

export function dropNullOptionalKeys<T extends Obj>(m: T): T {
  for (const key of NULL_AS_ABSENT_KEYS) {
    if (m[key] === null) delete m[key];
  }
  if (isObj(m.audio) && m.audio.sfx === null) delete m.audio.sfx;
  return m;
}

export function validateTimelineForRender(meta: ProjectMeta, projectDir: string): TimelineIssue[] {
  const is = new Issues(projectDir);
  const normalized = dropNullOptionalKeys({
    ...(meta as Obj),
    audio: isObj(meta.audio) ? { ...(meta.audio as Obj) } : meta.audio,
  });
  const raw = rawTimelineOf(normalized as ProjectMeta);
  if (raw.scenes === null || (Array.isArray(raw.scenes) && raw.scenes.length === 0)) {
    is.add("scenes", "cần ít nhất 1 scene để render");
  } else {
    validateScenes(raw.scenes, is);
  }
  if (raw.audio !== null) validateAudio(raw.audio, is);
  if (raw.captions !== null) validateCaptions(raw.captions, is);
  if (raw.subtitles !== null) validateSubtitles(raw.subtitles, is);
  if (raw.subtitleStyle !== null) validateSubtitleStyle(raw.subtitleStyle, is);
  if (raw.overlays !== null) validateOverlays(raw.overlays, is);
  if (raw.layers !== null) validateLayers(raw.layers, is);
  return is.list;
}

export function atomicWriteJson(file: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, text, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retriable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (retriable && attempt < 4) {

        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
        continue;
      }
      try {
        fs.rmSync(tmp, { force: true });
      } catch {

      }
      if (retriable) {
        fs.writeFileSync(file, text, "utf8");
        return;
      }
      throw err;
    }
  }
}

export function writeTimelineKeys(id: string, patch: Partial<Record<TimelineKey, unknown>>): ProjectMeta {
  const meta = readMeta(id);
  for (const key of TIMELINE_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === null || v === undefined) delete (meta as Obj)[key];
    else (meta as Obj)[key] = v;
  }
  meta.updatedAt = nowIso();
  atomicWriteJson(metaPathOf(id), meta);
  return meta;
}

export type RevisionSource = "editor" | "ai-before" | "ai-after" | "restore";

export interface RevisionSummary {
  rev: string;
  createdAt: string;
  label: string | null;
  source: RevisionSource;
  version: string;
}

export interface Revision extends RevisionSummary {
  timeline: RawTimeline;
}

const MAX_REVISIONS = 100;

const EDITOR_COALESCE_MS = 10_000;

export const EDITOR_OVERWRITE_LABEL = "editor-overwrite";

const REV_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{4}$/;

export function isValidRev(rev: string): boolean {
  return REV_RE.test(rev);
}

function newRev(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(4);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${suffix}`;
}

export function historyDirOf(id: string): string {
  return path.join(projectDirOf(id), ".history");
}

const summaryCache = new Map<string, RevisionSummary>();

function revFiles(id: string): string[] {
  try {
    return fs
      .readdirSync(historyDirOf(id))
      .filter((f) => f.endsWith(".json") && REV_RE.test(f.slice(0, -5)))
      .sort();
  } catch {
    return [];
  }
}

function parseRevision(raw: unknown, rev: string): Revision | null {
  if (!isObj(raw) || !isObj(raw.timeline)) return null;
  const sources: RevisionSource[] = ["editor", "ai-before", "ai-after", "restore"];
  const timeline = {} as RawTimeline;
  for (const key of TIMELINE_KEYS) {
    const v = (raw.timeline as Obj)[key];
    timeline[key] = v === undefined ? null : v;
  }
  return {
    rev,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    label: typeof raw.label === "string" ? raw.label : null,
    source: sources.includes(raw.source as RevisionSource) ? (raw.source as RevisionSource) : "editor",
    version: typeof raw.version === "string" ? raw.version : versionOfRaw(timeline),
    timeline,
  };
}

export function readRevision(id: string, rev: string): Revision | null {
  if (!REV_RE.test(rev)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(historyDirOf(id), `${rev}.json`), "utf8"));
    return parseRevision(raw, rev);
  } catch {
    return null;
  }
}

export function listRevisions(id: string): RevisionSummary[] {
  const out: RevisionSummary[] = [];
  const dir = historyDirOf(id);
  for (const f of revFiles(id).reverse()) {
    const key = path.join(dir, f);
    let summary = summaryCache.get(key);
    if (!summary) {
      const r = readRevision(id, f.slice(0, -5));
      if (!r) continue;
      summary = { rev: r.rev, createdAt: r.createdAt, label: r.label, source: r.source, version: r.version };
      summaryCache.set(key, summary);
    }
    out.push(summary);
  }
  return out;
}

export function snapshotTimeline(
  id: string,
  source: RevisionSource,
  label: string | null,
  meta?: ProjectMeta,
): RevisionSummary | null {
  const m = meta ?? readMeta(id);
  const timeline = rawTimelineOf(m);
  const version = versionOfRaw(timeline);
  const newest = listRevisions(id)[0];
  if (newest) {
    if (newest.version === version) return null;
    const age = Date.now() - Date.parse(newest.createdAt);
    if (
      source === "editor" &&
      newest.source === "editor" &&
      newest.label === label &&
      label !== EDITOR_OVERWRITE_LABEL &&
      Number.isFinite(age) &&
      age >= 0 &&
      age < EDITOR_COALESCE_MS
    ) {
      return null;
    }
  }
  const dir = historyDirOf(id);
  ensureDir(dir);
  const rev: Revision = { rev: newRev(), createdAt: nowIso(), label, source, version, timeline };
  atomicWriteJson(path.join(dir, `${rev.rev}.json`), rev);
  pruneHistory(id);
  return { rev: rev.rev, createdAt: rev.createdAt, label, source, version };
}

const KEEP_AI_REVISIONS = 20;

function pruneHistory(id: string): void {
  const files = revFiles(id);
  const excess = files.length - MAX_REVISIONS;
  if (excess <= 0) return;
  const dir = historyDirOf(id);

  const sourceOf = new Map(listRevisions(id).map((r) => [`${r.rev}.json`, r.source]));
  const protectedAi = new Set(
    files
      .filter((f) => {
        const s = sourceOf.get(f);
        return s === "ai-before" || s === "ai-after";
      })
      .slice(-KEEP_AI_REVISIONS),
  );

  const victims = files.filter((f) => !protectedAi.has(f)).slice(0, excess);
  for (const f of victims) {
    const abs = path.join(dir, f);
    try {
      fs.rmSync(abs, { force: true });
    } catch {

    }
    summaryCache.delete(abs);
  }
}

export function agentRunStarted(projectId: string, label: string | null): string | null {
  try {
    const meta = readMeta(projectId);
    snapshotTimeline(projectId, "ai-before", label, meta);
    return timelineVersion(meta);
  } catch (err) {
    console.warn(`[timeline] Không chụp được ai-before cho ${projectId}:`, err);
    return null;
  }
}

export function agentRunFinished(
  projectId: string,
  versionBefore: string | null,
  label: string | null,
): void {
  try {
    const meta = readMeta(projectId);
    if (versionBefore !== null && timelineVersion(meta) === versionBefore) return;
    snapshotTimeline(projectId, "ai-after", label, meta);
  } catch (err) {
    console.warn(`[timeline] Không chụp được ai-after cho ${projectId}:`, err);
  }
}

export interface MediaInfo {
  durationSec: number | null;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    disposition?: { attached_pic?: number };
    tags?: Record<string, string>;
    side_data_list?: Array<Record<string, unknown>>;
  }>;
  format?: { duration?: string };
}

const MEDIA_CACHE_MAX = 2000;
const mediaCache = new Map<string, { mtimeMs: number; size: number; info: MediaInfo }>();

export async function probeMediaInfo(abs: string): Promise<MediaInfo | null> {
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const hit = mediaCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.info;

  let info: MediaInfo = { durationSec: null };
  try {
    const { code, stdout } = await execFileCaptureAll(
      "ffprobe",
      ffprobeSafeArgs([
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height:stream_disposition=attached_pic:stream_side_data=rotation:stream_tags=rotate:format=duration",
        "-of",
        "json",
        abs,
      ]),
      { timeoutMs: 20_000 },
    );
    if (code === 0) info = parseProbe(JSON.parse(stdout) as ProbeJson, abs);
  } catch {

  }
  if (mediaCache.size >= MEDIA_CACHE_MAX) {
    const oldest = mediaCache.keys().next().value;
    if (oldest !== undefined) mediaCache.delete(oldest);
  }
  mediaCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

function parseProbe(data: ProbeJson, abs: string): MediaInfo {
  const streams = data.streams ?? [];

  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const isImage = fileKind(abs) === "image";
  const dur = Number(data.format?.duration);
  const info: MediaInfo = {

    durationSec: !isImage && Number.isFinite(dur) && dur > 0 ? Math.round(dur * 1000) / 1000 : null,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
  if (video?.width && video.height) {

    let rotation = 0;
    for (const sd of video.side_data_list ?? []) {
      const r = Number((sd as { rotation?: unknown }).rotation);
      if (Number.isFinite(r) && r !== 0) rotation = r;
    }
    if (rotation === 0) {
      const tag = Number(video.tags?.rotate);
      if (Number.isFinite(tag)) rotation = tag;
    }
    const swap = Math.abs(rotation) % 180 === 90;
    info.width = swap ? video.height : video.width;
    info.height = swap ? video.width : video.height;
  }
  return info;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function mediaInfoMap(
  projectDir: string,
  rels: string[],
): Promise<Record<string, MediaInfo>> {
  const out: Record<string, MediaInfo> = {};
  const unique = [...new Set(rels)];
  await mapLimit(unique, 4, async (rel) => {
    const r = resolveProjectPath(projectDir, rel);
    if ("error" in r) return;
    out[rel] = (await probeMediaInfo(r.abs)) ?? { durationSec: null };
  });
  return out;
}

export function projectFileMtimeMs(projectDir: string, rel: unknown): number | null {
  const r = resolveProjectPath(projectDir, rel);
  if ("error" in r) return null;
  try {
    const st = fs.statSync(r.abs);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

export interface SceneRenderState {
  finalRel: string;

  draftRel: string;
  finalMtime: number | null;
  draftMtime: number | null;
  srcMtime: number | null;
}

export function sceneRenderState(projectDir: string, scene: Obj): SceneRenderState {
  const id = typeof scene.id === "string" ? scene.id : "";
  const finalRel = nonEmptyStr(scene.render) ? scene.render : `renders/${id}.mp4`;
  const draftRel = finalRel.replace(/\.mp4$/i, ".draft.mp4");
  const finalMtime = projectFileMtimeMs(projectDir, finalRel);
  return {
    finalRel,
    draftRel,
    finalMtime,
    draftMtime: draftRel === finalRel ? finalMtime : projectFileMtimeMs(projectDir, draftRel),
    srcMtime: projectFileMtimeMs(projectDir, scene.src),
  };
}

export function isRenderStale(renderMtime: number, st: SceneRenderState): boolean {
  return st.srcMtime !== null && renderMtime < st.srcMtime;
}

export function sceneRenderFor(projectDir: string, scene: Obj): string | null {
  const st = sceneRenderState(projectDir, scene);
  if (st.finalMtime !== null && (st.draftMtime === null || st.finalMtime >= st.draftMtime)) {
    return st.finalRel;
  }
  return st.draftMtime !== null ? st.draftRel : null;
}

export function sceneRendersOf(projectDir: string, meta: ProjectMeta): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const s of Array.isArray(meta.scenes) ? meta.scenes : []) {
    if (!isObj(s) || !nonEmptyStr(s.src) || typeof s.id !== "string") continue;
    out[s.id] = sceneRenderFor(projectDir, s);
  }
  return out;
}

export function mediaVersionsOf(projectDir: string, rels: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rel of new Set(rels)) {
    const m = projectFileMtimeMs(projectDir, rel);
    if (m !== null) out[rel] = Math.floor(m);
  }
  return out;
}

export function referencedMediaPaths(
  meta: ProjectMeta,
  sceneRenders: Record<string, string | null>,
): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (nonEmptyStr(v)) out.push(v);
  };
  for (const s of Array.isArray(meta.scenes) ? meta.scenes : []) {
    if (!isObj(s)) continue;
    push(s.srcVideo);
    push(s.srcImage);

    if (nonEmptyStr(s.src)) push(typeof s.id === "string" ? sceneRenders[s.id] : null);
    else push(s.render);
  }
  const audio = isObj(meta.audio) ? (meta.audio as Obj) : {};
  push(audio.voice);
  if (Array.isArray(audio.sfx)) for (const x of audio.sfx) if (isObj(x)) push(x.file);
  if (isObj(audio.music)) push(audio.music.file);

  for (const l of Array.isArray(meta.layers) ? meta.layers : []) if (isObj(l)) push(l.src);
  return out;
}

export function sceneSpeedOf(scene: Obj): number {
  const v = scene.speed;
  return isNum(v) && v >= SPEED_MIN && v <= SPEED_MAX ? v : 1;
}

export function sceneDurationFrames(scene: Obj, fps: number): number | null {
  if (isNum(scene.durationInFrames)) return scene.durationInFrames;
  if (nonEmptyStr(scene.srcVideo) && isNum(scene.from) && isNum(scene.to)) {
    const sourceFrames = Math.round(scene.to * fps) - Math.round(scene.from * fps);
    return Math.max(1, Math.round(sourceFrames / sceneSpeedOf(scene)));
  }
  return null;
}

export interface SceneSlot {
  scene: Obj;

  start: number;

  duration: number;
}

export function layoutScenes(scenes: Obj[], fps: number): { slots: SceneSlot[]; total: number } {
  const durOf = (s: Obj): number | null => {
    if (isInt(s.durationInFrames) && s.durationInFrames > 0) return s.durationInFrames;
    return sceneDurationFrames(s, fps);
  };
  const slots: SceneSlot[] = [];
  let from = 0;
  let total = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const duration = durOf(s);
    if (duration === null) continue;
    let overlap = isInt(s.transitionOverlap) && s.transitionOverlap > 0 ? s.transitionOverlap : 0;
    const next = i + 1 < scenes.length ? durOf(scenes[i + 1]) : null;
    if (overlap > 0 && next !== null) overlap = Math.min(overlap, Math.max(0, Math.min(duration, next)));
    slots.push({ scene: s, start: from, duration });
    total = Math.max(total, from + duration);
    from += duration - overlap;
  }
  return { slots, total: Math.max(1, total) };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function xmlRate(fps: number): { timebase: number; ntsc: boolean } {
  const timebase = Math.max(1, Math.round(fps));
  const ntsc = Math.abs(fps - timebase) > 0.001 && Math.abs(fps - (timebase * 1000) / 1001) < 0.01;
  return { timebase, ntsc };
}

export interface Fcp7Input {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  meta: ProjectMeta;
  projectDir: string;
  sceneRenders: Record<string, string | null>;
  media: Record<string, MediaInfo>;
}

export function buildFcp7Xml(input: Fcp7Input): string {
  const { fps, meta, projectDir, sceneRenders, media } = input;
  const { timebase, ntsc } = xmlRate(fps);
  const rateXml = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;
  const scenes = (Array.isArray(meta.scenes) ? meta.scenes : []).filter(isObj) as Obj[];
  const { slots, total } = layoutScenes(scenes, fps);
  const audio = isObj(meta.audio) ? (meta.audio as Obj) : {};

  const fileIds = new Map<string, string>();
  const fileXml = (rel: string): string | null => {
    const r = resolveProjectPath(projectDir, rel);
    if ("error" in r) return null;
    const known = fileIds.get(r.abs);
    if (known) return `<file id="${known}"/>`;
    const fid = `file-${fileIds.size + 1}`;
    fileIds.set(r.abs, fid);
    const info = media[rel] ?? { durationSec: null };
    const isImage = fileKind(r.abs) === "image";
    const durFrames = info.durationSec ? Math.max(1, Math.ceil(info.durationSec * fps)) : total;
    const parts: string[] = [];
    if (isImage || info.width) {
      parts.push(
        `<video><samplecharacteristics>${rateXml}` +
          `<width>${info.width ?? input.width}</width><height>${info.height ?? input.height}</height>` +
          `</samplecharacteristics></video>`,
      );
    }
    if (info.hasAudio || (!isImage && !info.width)) {
      parts.push(
        "<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>" +
          "</samplecharacteristics><channelcount>2</channelcount></audio>",
      );
    }
    return (
      `<file id="${fid}"><name>${escapeXml(path.basename(r.abs))}</name>` +
      `<pathurl>${escapeXml(pathToFileURL(r.abs).href)}</pathurl>${rateXml}` +
      `<duration>${durFrames}</duration><media>${parts.join("")}</media></file>`
    );
  };

  interface ClipSpec {
    name: string;
    rel: string;
    start: number;
    end: number;
    inF: number;
    kind: "video" | "audio";
    level?: number;

    speed?: number;
  }

  const clip = (o: ClipSpec): ClipSpec | null => {
    if (o.end <= o.start) return null;
    if ("error" in resolveProjectPath(projectDir, o.rel)) return null;
    return o;
  };

  let clipSeq = 0;
  const renderClip = (o: ClipSpec): string => {
    const file = fileXml(o.rel);
    if (!file) return "";
    clipSeq++;
    const info = media[o.rel] ?? { durationSec: null };

    const speed = o.speed !== undefined && o.speed !== 1 ? o.speed : 1;
    const outF = o.inF + (speed === 1 ? o.end - o.start : Math.max(1, Math.round((o.end - o.start) * speed)));
    const fileFrames = info.durationSec ? Math.max(1, Math.ceil(info.durationSec * fps)) : outF;
    const remapXml =
      speed !== 1
        ? "<filter><effect><name>Time Remap</name><effectid>timeremap</effectid>" +
          "<effectcategory>motion</effectcategory><effecttype>motion</effecttype>" +
          `<mediatype>${o.kind}</mediatype>` +
          "<parameter><parameterid>variablespeed</parameterid><name>variablespeed</name>" +
          "<valuemin>0</valuemin><valuemax>1</valuemax><value>0</value></parameter>" +
          "<parameter><parameterid>speed</parameterid><name>speed</name>" +
          `<valuemin>-100000</valuemin><valuemax>100000</valuemax><value>${Math.round(speed * 10000) / 100}</value></parameter>` +
          "<parameter><parameterid>reverse</parameterid><name>reverse</name><value>FALSE</value></parameter>" +
          "<parameter><parameterid>frameblending</parameterid><name>frameblending</name><value>FALSE</value></parameter>" +
          "</effect></filter>"
        : "";
    const levelXml =
      o.level !== undefined
        ? "<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid>" +
          "<effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype>" +
          "<mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name>" +
          `<valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${o.level}</value>` +
          "</parameter></effect></filter>"
        : "";
    const sourceTrack =
      o.kind === "audio"
        ? "<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>"
        : "";
    return (
      `<clipitem id="clipitem-${clipSeq}"><name>${escapeXml(o.name)}</name><enabled>TRUE</enabled>` +
      `<duration>${fileFrames}</duration>${rateXml}<start>${o.start}</start><end>${o.end}</end>` +
      `<in>${o.inF}</in><out>${outF}</out>${file}${sourceTrack}${remapXml}${levelXml}</clipitem>`
    );
  };
  const keep = (c: ClipSpec | null): c is ClipSpec => c !== null;

  const videoClips: ClipSpec[] = [];
  const footageAudio: ClipSpec[] = [];
  slots.forEach((slot, i) => {
    const s = slot.scene;
    const nextStart = i + 1 < slots.length ? slots[i + 1].start : Infinity;
    const end = Math.min(slot.start + slot.duration, nextStart);
    const name = typeof s.id === "string" ? s.id : `scene-${i + 1}`;
    let v: ClipSpec | null = null;
    if (nonEmptyStr(s.src)) {
      const rel = typeof s.id === "string" ? sceneRenders[s.id] : null;
      if (rel) v = clip({ name, rel, start: slot.start, end, inF: 0, kind: "video" });
    } else if (nonEmptyStr(s.srcVideo)) {
      const inF = isNum(s.from) ? Math.round(s.from * fps) : 0;
      const speed = sceneSpeedOf(s);
      v = clip({ name, rel: s.srcVideo, start: slot.start, end, inF, kind: "video", ...(speed !== 1 ? { speed } : {}) });
      if (v && s.muted !== true && media[s.srcVideo]?.hasAudio) {
        footageAudio.push({ ...v, kind: "audio" });
      }
    } else if (nonEmptyStr(s.srcImage)) {
      v = clip({ name, rel: s.srcImage, start: slot.start, end, inF: 0, kind: "video" });
    } else if (nonEmptyStr(s.render)) {
      v = clip({ name, rel: s.render, start: slot.start, end, inF: 0, kind: "video" });
    }
    if (v) videoClips.push(v);
  });

  const framesOf = (rel: string): number | null => {
    const d = media[rel]?.durationSec;
    return d ? Math.max(1, Math.round(d * fps)) : null;
  };
  const audioTracks: ClipSpec[][] = [];
  if (footageAudio.length) audioTracks.push(footageAudio);

  if (nonEmptyStr(audio.voice)) {
    const len = framesOf(audio.voice) ?? total;
    const v = clip({ name: "voice", rel: audio.voice, start: 0, end: Math.min(total, len), inF: 0, kind: "audio" });
    if (v) audioTracks.push([v]);
  }

  const sfxTracks: { end: number; clips: ClipSpec[] }[] = [];
  const sfxList = (Array.isArray(audio.sfx) ? audio.sfx : []).filter(isObj) as Obj[];
  const sfxSorted = sfxList
    .filter((x) => nonEmptyStr(x.file) && isInt(x.atFrame) && x.atFrame >= 0)
    .sort((a, b) => (a.atFrame as number) - (b.atFrame as number));
  for (const x of sfxSorted) {
    const rel = x.file as string;
    const start = x.atFrame as number;
    if (start >= total) continue;
    const inF = isNum(x.mediaStart) && x.mediaStart > 0 ? Math.round(x.mediaStart * fps) : 0;
    const len = framesOf(rel);

    const end = Math.min(total, start + Math.max(1, (len ?? inF + timebase) - inF));
    const level = isNum(x.volume) ? x.volume : 0.3;
    const item = clip({ name: path.basename(rel), rel, start, end, inF, kind: "audio", level });
    if (!item) continue;
    let t = sfxTracks.find((tr) => tr.end <= start);
    if (!t) {
      t = { end: 0, clips: [] };
      sfxTracks.push(t);
    }
    t.clips.push(item);
    t.end = end;
  }
  for (const t of sfxTracks) audioTracks.push(t.clips);

  if (isObj(audio.music) && nonEmptyStr(audio.music.file)) {
    const rel = audio.music.file;
    const len = framesOf(rel) ?? total;
    const level = isNum(audio.music.volume) ? audio.music.volume : 0.35;
    const clips: ClipSpec[] = [];
    for (let start = 0; start < total; start += len) {
      const c = clip({
        name: path.basename(rel),
        rel,
        start,
        end: Math.min(total, start + len),
        inF: 0,
        kind: "audio",
        level,
      });
      if (c) clips.push(c);
    }
    if (clips.length) audioTracks.push(clips);
  }

  const videoFormat =
    `<format><samplecharacteristics>${rateXml}<width>${input.width}</width>` +
    `<height>${input.height}</height><pixelaspectratio>square</pixelaspectratio>` +
    `<fielddominance>none</fielddominance></samplecharacteristics></format>`;
  const audioFormat =
    "<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>" +
    "</samplecharacteristics></format>";

  const track = (clips: ClipSpec[]): string =>
    `<track>${clips.filter(keep).map(renderClip).join("")}</track>`;
  const videoXml = `<video>${videoFormat}${track(videoClips)}</video>`;
  const audioXml = `<audio>${audioFormat}${(audioTracks.length ? audioTracks : [[]]).map(track).join("")}</audio>`;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="5">',
    `<sequence id="sequence-1"><name>${escapeXml(input.name || input.id)}</name>`,
    `<duration>${total}</duration>${rateXml}`,
    `<timecode>${rateXml}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`,
    "<media>",
    videoXml,
    audioXml,
    "</media>",
    "</sequence>",
    "</xmeml>",
  ];
  return lines.join("\n") + "\n";
}
