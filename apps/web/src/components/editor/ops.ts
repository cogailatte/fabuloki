

import type {
  Timeline,
  TimelineCaptionCue,
  TimelineHighlightCue,
  TimelineHighlightPart,
  TimelineMusic,
  TimelinePreview,
  TimelineScene,
  TimelineSfx,
  TimelineSubtitleCue,
  TimelineSubtitleStyle,
  TimelineZoom,
  TimelineZoomKey,
  TimelineCaptionWord,
  TimelineCueTransform,
} from "@/lib/api";
import { SPEED_MAX, SPEED_MIN, sceneSpeedOf as engineSceneSpeedOf } from "@engine/duration";
import { CUE_SCALE_MAX, CUE_SCALE_MIN } from "@engine/manifest";
import { keyframeValue, type LayerKeyframe as EngineLayerKeyframe } from "@engine/layerGeometry";
import { effectiveOverlap, sceneDurationFrames } from "./timing";

export type CueKind = "captions" | "subtitles" | "overlays";
export type CueSelKind = "caption" | "subtitle" | "overlay";

export type Selection =
  | { kind: "scene"; id: string }
  | { kind: "layer"; id: string }
  | { kind: CueSelKind; index: number }
  | { kind: "sfx"; index: number }
  | { kind: "music" }
  | { kind: "voice" };

export const CUE_KIND: Record<CueSelKind, CueKind> = {
  caption: "captions",
  subtitle: "subtitles",
  overlay: "overlays",
};

export const isCueSel = (kind: Selection["kind"]): kind is CueSelKind =>
  kind === "caption" || kind === "subtitle" || kind === "overlay";

export const sameSelection = (a: Selection | null, b: Selection | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if ("id" in a && "id" in b) return a.id === b.id;
  if ("index" in a && "index" in b) return a.index === b.index;
  return true;
};

export interface OpsContext {
  fps: number;

  mediaDurationSec: (relPath: string) => number | null;

  sceneRender: (scene: TimelineScene) => string | null;
}

export function contextFromPreview(preview: TimelinePreview, fps: number): OpsContext {
  return {
    fps,
    mediaDurationSec: (rel) => {
      const d = preview.media[rel]?.durationSec;
      return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
    },
    sceneRender: (scene) => {
      if (isNonEmpty(scene.src)) return preview.sceneRenders[scene.id] ?? null;
      return isNonEmpty(scene.render) ? scene.render : null;
    },
  };
}

const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

const frameToSec = (frame: number, fps: number): number =>
  Math.round((frame / fps) * 1e6) / 1e6;

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.round(Math.min(hi, Math.max(lo, v)));

export function applyPatch<T extends object>(obj: T, patch: Partial<T>): T {
  let changed = false;
  const next = { ...obj };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (Reflect.has(next, key)) {
        Reflect.deleteProperty(next, key);
        changed = true;
      }
    } else if (Reflect.get(next, key) !== value) {
      Reflect.set(next, key, value);
      changed = true;
    }
  }
  return changed ? next : obj;
}

function replaceAt<T>(list: T[], index: number, item: T): T[] {
  if (list[index] === item) return list;
  const next = list.slice();
  next[index] = item;
  return next;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export type SceneKind = "footage" | "image" | "hyperframes" | "render" | "empty";

export function sceneKind(scene: TimelineScene): SceneKind {
  if (isNonEmpty(scene.src)) return "hyperframes";
  if (isNonEmpty(scene.srcVideo)) return "footage";
  if (isNonEmpty(scene.srcImage)) return "image";
  if (isNonEmpty(scene.render)) return "render";
  return "empty";
}

export function isMediaMissing(preview: TimelinePreview, rel: unknown): boolean {
  if (typeof rel !== "string" || !rel) return false;
  const versions = preview.mediaVersions;
  return !!versions && !Object.prototype.hasOwnProperty.call(versions, rel);
}

export function sceneMissingMedia(scene: TimelineScene, preview: TimelinePreview): string | null {
  const kind = sceneKind(scene);
  const rel = kind === "footage" || kind === "image" || kind === "render" ? sceneSourcePath(scene) : null;
  return rel && isMediaMissing(preview, rel) ? rel : null;
}

export function sceneSourcePath(scene: TimelineScene): string | null {
  switch (sceneKind(scene)) {
    case "hyperframes":
      return scene.src ?? null;
    case "footage":
      return scene.srcVideo ?? null;
    case "image":
      return scene.srcImage ?? null;
    case "render":
      return scene.render ?? null;
    default:
      return null;
  }
}

export function sceneMaxFrames(scene: TimelineScene, ctx: OpsContext): number | null {
  const kind = sceneKind(scene);
  if (kind !== "hyperframes" && kind !== "render") return null;
  const render = ctx.sceneRender(scene);
  const sec = render ? ctx.mediaDurationSec(render) : null;
  return sec === null ? null : Math.max(1, Math.floor(sec * ctx.fps + 1e-6));
}

export { SPEED_MAX, SPEED_MIN };

export const sceneSpeedOf = (scene: TimelineScene): number =>
  engineSceneSpeedOf(scene as { speed?: unknown });

const toFileFrames = (frames: number, speed: number): number => Math.round(frames * speed);

const toTimelineFrames = (fileFrames: number, speed: number): number =>
  Math.max(1, Math.round(fileFrames / speed));

export function footageWindow(
  scene: TimelineScene,
  fps: number,
): { inFrame: number; outFrame: number } | null {
  if (sceneKind(scene) !== "footage") return null;
  const inFrame = Math.round((scene.from ?? 0) * fps);
  if (typeof scene.to === "number") return { inFrame, outFrame: Math.round(scene.to * fps) };
  if (typeof scene.durationInFrames === "number") {
    return { inFrame, outFrame: inFrame + toFileFrames(scene.durationInFrames, sceneSpeedOf(scene)) };
  }
  return null;
}

export const sceneIndexById = (tl: Timeline, id: string): number =>
  tl.scenes.findIndex((s) => s.id === id);

export function uniqueSceneId(scenes: TimelineScene[], base: string): string {
  const taken = new Set(scenes.map((s) => s.id));
  const stem = base.replace(/-\d+$/, "") || "scene";
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function reorderScene(tl: Timeline, from: number, to: number): Timeline {
  const n = tl.scenes.length;
  if (from < 0 || from >= n) return tl;
  const target = clampInt(to, 0, n - 1);
  if (target === from) return tl;
  return { ...tl, scenes: moveItem(tl.scenes, from, target) };
}

export function moveSceneBy(tl: Timeline, id: string, step: -1 | 1): Timeline {
  const from = sceneIndexById(tl, id);
  if (from < 0) return tl;
  const to = from + step;
  if (to < 0 || to >= tl.scenes.length) return tl;
  return reorderScene(tl, from, to);
}

export function trimScene(
  tl: Timeline,
  index: number,
  edge: "start" | "end",
  delta: number,
  ctx: OpsContext,
): Timeline {
  return withPunchInRetimed(tl, trimSceneRaw(tl, index, edge, delta, ctx), index, ctx.fps);
}

function trimSceneRaw(
  tl: Timeline,
  index: number,
  edge: "start" | "end",
  delta: number,
  ctx: OpsContext,
): Timeline {
  const scene = tl.scenes[index];
  if (!scene || !Number.isFinite(delta)) return tl;
  const d = Math.round(delta);
  if (d === 0) return tl;
  const { fps } = ctx;
  const kind = sceneKind(scene);

  if (kind === "footage") {
    const win = footageWindow(scene, fps);
    if (!win) return tl;
    const mediaSec = scene.srcVideo ? ctx.mediaDurationSec(scene.srcVideo) : null;
    const mediaFrames =
      mediaSec === null ? Number.POSITIVE_INFINITY : Math.floor(mediaSec * fps + 1e-6);

    const speed = sceneSpeedOf(scene);
    const fd = toFileFrames(d, speed);
    if (fd === 0) return tl;
    let { inFrame, outFrame } = win;
    const patch: Partial<TimelineScene> = {};
    if (edge === "start") {
      inFrame = clampInt(inFrame + fd, 0, outFrame - 1);
      if (inFrame === win.inFrame) return tl;
      patch.from = frameToSec(inFrame, fps);

      if (typeof scene.to !== "number") patch.to = frameToSec(outFrame, fps);
    } else {

      const upper = Math.max(outFrame, mediaFrames);
      outFrame = clampInt(outFrame + fd, inFrame + 1, upper);
      if (outFrame === win.outFrame) return tl;
      patch.to = frameToSec(outFrame, fps);
      if (typeof scene.from !== "number") patch.from = 0;
    }
    if (typeof scene.durationInFrames === "number") patch.durationInFrames = toTimelineFrames(outFrame - inFrame, speed);
    return { ...tl, scenes: replaceAt(tl.scenes, index, applyPatch(scene, patch)) };
  }

  if (typeof scene.durationInFrames !== "number") return tl;
  if ((kind === "hyperframes" || kind === "render") && edge === "start") return tl;
  const cur = scene.durationInFrames;
  const max = sceneMaxFrames(scene, ctx);
  const upper = max === null ? Number.POSITIVE_INFINITY : Math.max(max, cur);
  const next = clampInt(edge === "end" ? cur + d : cur - d, 1, upper);
  if (next === cur) return tl;
  return {
    ...tl,
    scenes: replaceAt(tl.scenes, index, applyPatch(scene, { durationInFrames: next })),
  };
}

function retimePunchIn(scene: TimelineScene, oldDur: number | null, newDur: number | null): TimelineScene {
  const keys = scene.zoom?.keys;
  if (!scene.zoom || !Array.isArray(keys) || keys.length !== 2 || oldDur === null || newDur === null) return scene;
  if (oldDur === newDur) return scene;
  const [a, b] = sortKeys(keys);
  if (!a || !b || a.frame !== 0 || (b.frame !== oldDur - 1 && b.frame !== oldDur)) return scene;
  const end = Math.max(1, newDur - 1);
  if (b.frame === end) return scene;
  return { ...scene, zoom: { ...scene.zoom, keys: [a, { ...b, frame: end }] } };
}

function withPunchInRetimed(before: Timeline, after: Timeline, index: number, fps: number): Timeline {
  if (after === before) return after;
  const old = before.scenes[index];
  const cur = after.scenes[index];
  if (!old || !cur) return after;
  const next = retimePunchIn(cur, sceneDurationFrames(old, fps), sceneDurationFrames(cur, fps));
  return next === cur ? after : { ...after, scenes: replaceAt(after.scenes, index, next) };
}

const EASE: Record<string, (t: number) => number> = {
  linear: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

const sortKeys = (keys: TimelineZoomKey[]): TimelineZoomKey[] =>
  [...keys].sort((a, b) => a.frame - b.frame);

export function zoomScaleAt(zoom: TimelineZoom, frame: number): number {
  const keys = sortKeys(zoom.keys);
  if (keys.length === 0) return 1;
  if (frame <= keys[0].frame) return keys[0].scale;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame <= b.frame) {
      const span = b.frame - a.frame;
      if (span <= 0) return b.scale;
      const ease = EASE[a.ease ?? "inOut"] ?? EASE.inOut;
      return a.scale + (b.scale - a.scale) * ease((frame - a.frame) / span);
    }
  }
  return keys[keys.length - 1].scale;
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

const ZOOM_SAMPLE_TOLERANCE = 0.0015;

const ZOOM_SAMPLE_MAX_STEP = 5;

const EASE_MAX_CURVATURE: Record<string, number> = { out: 6, inOut: 12 };

function linearizeSegmentAt(zoom: TimelineZoom, keys: TimelineZoomKey[], cut: number): TimelineZoomKey[] {
  const i = keys.findIndex((k, j) => j < keys.length - 1 && k.frame < cut && cut < keys[j + 1].frame);
  if (i < 0) return keys;
  const a = keys[i];
  const b = keys[i + 1];
  const ease = a.ease ?? "inOut";
  if (ease === "linear") return keys;
  const span = b.frame - a.frame;
  const curvature = (EASE_MAX_CURVATURE[ease] ?? EASE_MAX_CURVATURE.inOut) * Math.abs(b.scale - a.scale);
  let step = ZOOM_SAMPLE_MAX_STEP;
  while (step > 1 && (step * step * curvature) / (8 * span * span) > ZOOM_SAMPLE_TOLERANCE) step -= 1;

  const frames = new Set<number>([cut]);
  for (let f = a.frame; f < b.frame; f += step) frames.add(f);
  const samples: TimelineZoomKey[] = [...frames]
    .sort((x, y) => x - y)
    .map((frame) =>

      frame === a.frame
        ? { ...a, ease: "linear" as const }
        : { frame, scale: round4(zoomScaleAt(zoom, frame)), ease: "linear" as const },
    );
  return [...keys.slice(0, i), ...samples, ...keys.slice(i + 1)];
}

function splitZoom(
  zoom: TimelineZoom,
  cut: number,
  secondDuration: number,
): [TimelineZoom, TimelineZoom] {

  const keys = linearizeSegmentAt(zoom, sortKeys(zoom.keys), cut);
  const scale = round4(zoomScaleAt(zoom, cut));
  const segment = [...keys].reverse().find((k) => k.frame <= cut);
  const firstKeys: TimelineZoomKey[] = [
    ...keys.filter((k) => k.frame < cut),
    { frame: cut, scale },
  ];
  if (firstKeys.length < 2) firstKeys.unshift({ frame: 0, scale });
  const secondKeys: TimelineZoomKey[] = [
    { frame: 0, scale, ...(segment?.ease ? { ease: segment.ease } : {}) },
    ...keys.filter((k) => k.frame > cut).map((k) => ({ ...k, frame: k.frame - cut })),
  ];
  if (secondKeys.length < 2) secondKeys.push({ frame: Math.max(1, secondDuration), scale });
  return [
    { ...zoom, keys: firstKeys },
    { ...structuredClone(zoom), keys: secondKeys },
  ];
}

export function canSplitScene(scene: TimelineScene, fps: number): boolean {
  const kind = sceneKind(scene);
  if (kind === "footage") return footageWindow(scene, fps) !== null;
  if (kind === "image" || kind === "empty") return typeof scene.durationInFrames === "number";

  return false;
}

function footageCutPoint(
  win: { inFrame: number; outFrame: number },
  cut: number,
  duration: number,
  speed: number,
): { cutFrame: number; cut: number } | null {
  const span = win.outFrame - win.inFrame;
  if (speed === 1) return cut > 0 && cut < span ? { cutFrame: win.inFrame + cut, cut } : null;
  const lo = Math.max(1, Math.floor((cut - 1) * speed) - 1);
  const hi = Math.min(span - 1, Math.ceil((cut + 1) * speed) + 1);
  let best: { rel: number; first: number; score: number } | null = null;
  for (let rel = lo; rel <= hi; rel += 1) {
    const firstDur = toTimelineFrames(rel, speed);
    const secondDur = duration - firstDur;
    if (secondDur <= 0) continue;
    const covered = Math.ceil((span - rel) / speed) >= secondDur;
    const score = Math.abs(firstDur - cut) + (covered ? 0 : duration);
    if (!best || score < best.score) best = { rel, first: firstDur, score };
  }
  return best ? { cutFrame: win.inFrame + best.rel, cut: best.first } : null;
}

export function splitSceneAt(
  tl: Timeline,
  index: number,
  offset: number,
  newId: string,
  ctx: OpsContext,
): Timeline {
  const scene = tl.scenes[index];
  if (!scene || !canSplitScene(scene, ctx.fps)) return tl;
  if (!newId || tl.scenes.some((s) => s.id === newId)) return tl;
  const duration = sceneDurationFrames(scene, ctx.fps);
  let cut = Math.round(offset);
  if (duration === null || cut <= 0 || cut >= duration) return tl;

  const first: TimelineScene = { ...scene };
  const second: TimelineScene = { ...structuredClone(scene), id: newId };

  if (sceneKind(scene) === "footage") {
    const win = footageWindow(scene, ctx.fps);
    if (!win) return tl;
    const speed = sceneSpeedOf(scene);

    const point = footageCutPoint(win, cut, duration, speed);
    if (!point) return tl;
    cut = point.cut;
    const cutFrame = point.cutFrame;
    first.from = frameToSec(win.inFrame, ctx.fps);
    first.to = frameToSec(cutFrame, ctx.fps);
    second.from = first.to;
    second.to = frameToSec(win.outFrame, ctx.fps);

    if (typeof scene.from === "number") first.from = scene.from;
    if (typeof scene.to === "number") second.to = scene.to;
    if (typeof scene.durationInFrames === "number") {
      first.durationInFrames = cut;
      second.durationInFrames = duration - cut;
    } else if (toTimelineFrames(win.outFrame - cutFrame, speed) !== duration - cut) {

      second.durationInFrames = duration - cut;
    }
  } else {
    first.durationInFrames = cut;
    second.durationInFrames = duration - cut;
  }

  const overlapIn = index > 0 ? effectiveOverlap(tl.scenes, index - 1, ctx.fps) : 0;
  const overlapOut = index < tl.scenes.length - 1 ? effectiveOverlap(tl.scenes, index, ctx.fps) : 0;
  if (cut < overlapIn || duration - cut < overlapOut) return tl;

  if (scene.zoom && Array.isArray(scene.zoom.keys) && scene.zoom.keys.length > 0) {
    const [z1, z2] = splitZoom(scene.zoom, cut, duration - cut);
    first.zoom = z1;
    second.zoom = z2;
  }
  if (typeof scene.transitionOverlap === "number") first.transitionOverlap = 0;

  const scenes = tl.scenes.slice();
  scenes.splice(index, 1, first, second);
  return { ...tl, scenes };
}

export function patchScene(tl: Timeline, idOrIndex: string | number, patch: Partial<TimelineScene>): Timeline {
  const index = typeof idOrIndex === "number" ? idOrIndex : sceneIndexById(tl, idOrIndex);
  const scene = tl.scenes[index];
  if (!scene) return tl;
  const next = applyPatch(scene, patch);
  return next === scene ? tl : { ...tl, scenes: replaceAt(tl.scenes, index, next) };
}

export function setFootageWindow(
  tl: Timeline,
  index: number,
  inFrame: number,
  outFrame: number,
  ctx: OpsContext,
): Timeline {
  const scene = tl.scenes[index];
  if (!scene || sceneKind(scene) !== "footage") return tl;
  const mediaSec = scene.srcVideo ? ctx.mediaDurationSec(scene.srcVideo) : null;
  const max = mediaSec === null ? Number.POSITIVE_INFINITY : Math.floor(mediaSec * ctx.fps + 1e-6);
  const a = clampInt(inFrame, 0, Math.max(0, max - 1));
  const b = clampInt(outFrame, a + 1, Math.max(a + 1, max));
  const patch: Partial<TimelineScene> = {
    from: frameToSec(a, ctx.fps),
    to: frameToSec(b, ctx.fps),
  };

  if (typeof scene.durationInFrames === "number") patch.durationInFrames = toTimelineFrames(b - a, sceneSpeedOf(scene));
  return withPunchInRetimed(tl, patchScene(tl, index, patch), index, ctx.fps);
}

export function setSceneSpeed(tl: Timeline, index: number, speed: number, ctx: OpsContext): Timeline {
  const scene = tl.scenes[index];
  if (!scene || sceneKind(scene) !== "footage" || !Number.isFinite(speed)) return tl;
  const v = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  const patch: Partial<TimelineScene> = { speed: v === 1 ? undefined : v };
  if (typeof scene.durationInFrames === "number") {
    const win = footageWindow(scene, ctx.fps);
    if (win) {
      if (typeof scene.from !== "number") patch.from = 0;
      if (typeof scene.to !== "number") patch.to = frameToSec(win.outFrame, ctx.fps);
      patch.durationInFrames = toTimelineFrames(win.outFrame - win.inFrame, v);
    }
  }
  return withPunchInRetimed(tl, patchScene(tl, index, patch), index, ctx.fps);
}

export function setSceneDuration(
  tl: Timeline,
  index: number,
  frames: number,
  ctx: OpsContext,
): Timeline {
  const scene = tl.scenes[index];
  if (!scene || sceneKind(scene) === "footage") return tl;
  const max = sceneMaxFrames(scene, ctx);
  const cur = typeof scene.durationInFrames === "number" ? scene.durationInFrames : 1;
  const upper = max === null ? Number.POSITIVE_INFINITY : Math.max(max, cur);
  return withPunchInRetimed(tl, patchScene(tl, index, { durationInFrames: clampInt(frames, 1, upper) }), index, ctx.fps);
}

export function setTransitionOverlap(tl: Timeline, index: number, frames: number): Timeline {
  if (index < 0 || index >= tl.scenes.length) return tl;
  const v = Math.max(0, Math.round(frames));
  return patchScene(tl, index, { transitionOverlap: v > 0 ? v : undefined });
}

export interface PunchIn {
  startScale: number;
  endScale: number;
  ease: "linear" | "out" | "inOut";
}

export function setScenePunchIn(
  tl: Timeline,
  index: number,
  punch: PunchIn | null,
  ctx: OpsContext,
): Timeline {
  const scene = tl.scenes[index];
  if (!scene) return tl;
  if (punch === null) return patchScene(tl, index, { zoom: undefined });
  const duration = sceneDurationFrames(scene, ctx.fps) ?? 1;

  const keys: TimelineZoomKey[] = [
    { frame: 0, scale: punch.startScale, ease: punch.ease },
    { frame: Math.max(1, duration - 1), scale: punch.endScale },
  ];
  return patchScene(tl, index, { zoom: { ...(scene.zoom ?? {}), keys } });
}

export function readPunchIn(
  scene: TimelineScene,
): { punch: PunchIn; custom: boolean } | null {
  const keys = scene.zoom?.keys;
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const sorted = sortKeys(keys);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    punch: { startScale: first.scale, endScale: last.scale, ease: first.ease ?? "inOut" },
    custom: sorted.length > 2 || first.frame !== 0,
  };
}

type BaseCue = { from: number; durationInFrames: number };

const cueEnd = (cue: BaseCue): number => cue.from + cue.durationInFrames;

export const captionWordsOf = (cue: TimelineCaptionCue | undefined): TimelineCaptionWord[] | null =>
  cue && Array.isArray(cue.words) ? cue.words : null;

export const highlightPartsOf = (cue: TimelineHighlightCue | undefined): TimelineHighlightPart[] | null =>
  cue && Array.isArray(cue.parts) ? cue.parts : null;

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isWellFormed(tl: Timeline, sel: Selection): boolean {
  const timed = (c: { from?: unknown; durationInFrames?: unknown } | undefined | null): boolean =>
    !!c && typeof c === "object" && isFiniteNum(c.from) && isFiniteNum(c.durationInFrames);
  switch (sel.kind) {
    case "caption": {
      const cue = tl.captions[sel.index];
      const words = captionWordsOf(cue);
      return (
        timed(cue) &&
        !!words &&
        words.length > 0 &&
        words.every(
          (w) => !!w && typeof w === "object" && typeof w.text === "string" && isFiniteNum(w.start) && isFiniteNum(w.end),
        )
      );
    }
    case "subtitle": {
      const cue = tl.subtitles[sel.index];
      return timed(cue) && typeof cue.text === "string";
    }
    case "overlay": {
      const cue = tl.overlays[sel.index];
      const parts = highlightPartsOf(cue);
      return (
        timed(cue) &&
        !!parts &&
        parts.length > 0 &&
        parts.every((p) => !!p && typeof p === "object" && typeof p.t === "string") &&
        (cue.kicker === undefined || cue.kicker === null || typeof cue.kicker === "string")
      );
    }
    case "sfx": {
      const sfx = tl.audio.sfx[sel.index];
      return !!sfx && typeof sfx === "object" && typeof sfx.file === "string" && isFiniteNum(sfx.atFrame);
    }
    case "music": {
      const music = tl.audio.music;
      return !!music && typeof music === "object" && typeof music.file === "string";
    }
    case "voice":
      return tl.audio.voice === null || typeof tl.audio.voice === "string";
    case "scene": {
      const scene = tl.scenes[sceneIndexById(tl, sel.id)];
      return !!scene && typeof scene === "object" && typeof scene.id === "string";
    }
    case "layer":
      return isLayerWellFormed(layersOf(tl)[layerIndexById(tl, sel.id)]);
  }
}

function shiftWords(cue: TimelineCaptionCue, delta: number): TimelineCaptionCue {
  if (delta === 0 || !captionWordsOf(cue)) return cue;
  return {
    ...cue,
    words: cue.words.map((w) => ({
      ...w,
      start: Math.max(0, w.start + delta),
      end: Math.max(0, w.end + delta),
    })),
  };
}

function clampWords(cue: TimelineCaptionCue): TimelineCaptionCue {
  if (!captionWordsOf(cue)) return cue;
  const lo = cue.from;
  const hi = cueEnd(cue);
  const n = cue.words.length;
  if (hi - lo < n) {

    let changed = false;
    const words = cue.words.map((w) => {
      const start = Math.min(hi, Math.max(lo, w.start));
      const end = Math.min(hi, Math.max(start, w.end));
      if (start === w.start && end === w.end) return w;
      changed = true;
      return { ...w, start, end };
    });
    return changed ? { ...cue, words } : cue;
  }
  let changed = false;
  let cursor = lo;
  const words = cue.words.map((w, i) => {

    const start = Math.min(hi - (n - i), Math.max(cursor, lo, w.start));
    const end = Math.max(start + 1, Math.min(hi - (n - i - 1), w.end));
    cursor = end;
    if (start === w.start && end === w.end) return w;
    changed = true;
    return { ...w, start, end };
  });
  return changed ? { ...cue, words } : cue;
}

function minCueFrames(tl: Timeline, kind: CueKind, index: number): number {
  if (kind !== "captions") return 1;
  return Math.max(1, captionWordsOf(tl.captions[index])?.length ?? 1);
}

function editCue(
  tl: Timeline,
  kind: CueKind,
  index: number,
  fn: <C extends BaseCue>(cue: C) => C,
  captionFix?: (before: TimelineCaptionCue, after: TimelineCaptionCue) => TimelineCaptionCue,
): Timeline {
  switch (kind) {
    case "captions": {
      const cue = tl.captions[index];
      if (!cue) return tl;
      let next = fn(cue);
      if (next !== cue && captionFix) next = captionFix(cue, next);
      return next === cue ? tl : { ...tl, captions: replaceAt(tl.captions, index, next) };
    }
    case "subtitles": {
      const cue = tl.subtitles[index];
      if (!cue) return tl;
      const next = fn(cue);
      return next === cue ? tl : { ...tl, subtitles: replaceAt(tl.subtitles, index, next) };
    }
    case "overlays": {
      const cue = tl.overlays[index];
      if (!cue) return tl;
      const next = fn(cue);
      return next === cue ? tl : { ...tl, overlays: replaceAt(tl.overlays, index, next) };
    }
  }
}

export function cueList(tl: Timeline, kind: CueKind): BaseCue[] {
  return tl[kind];
}

export function moveCue(
  tl: Timeline,
  kind: CueKind,
  index: number,
  delta: number,
  maxStart: number = Number.POSITIVE_INFINITY,
): Timeline {
  const d = Math.round(delta);
  if (!Number.isFinite(d) || d === 0) return tl;
  return editCue(
    tl,
    kind,
    index,
    (cue) => {
      const from = Math.min(Math.max(0, cue.from + d), Math.max(cue.from, maxStart));
      return from === cue.from ? cue : { ...cue, from };
    },
    (before, after) => shiftWords(after, after.from - before.from),
  );
}

export function setCueStart(tl: Timeline, kind: CueKind, index: number, frame: number): Timeline {
  const cue = cueList(tl, kind)[index];
  if (!cue) return tl;
  return moveCue(tl, kind, index, Math.max(0, Math.round(frame)) - cue.from);
}

export function resizeCue(
  tl: Timeline,
  kind: CueKind,
  index: number,
  edge: "start" | "end",
  delta: number,
): Timeline {
  const d = Math.round(delta);
  if (!Number.isFinite(d) || d === 0) return tl;
  const minDur = minCueFrames(tl, kind, index);
  return editCue(
    tl,
    kind,
    index,
    (cue) => {
      const end = cueEnd(cue);
      if (edge === "start") {

        const from = clampInt(cue.from + d, 0, Math.max(cue.from, end - minDur));
        return from === cue.from ? cue : { ...cue, from, durationInFrames: end - from };
      }
      const durationInFrames = Math.max(Math.min(minDur, cue.durationInFrames), cue.durationInFrames + d, 1);
      return durationInFrames === cue.durationInFrames ? cue : { ...cue, durationInFrames };
    },
    (_before, after) => clampWords(after),
  );
}

export function setCueDuration(tl: Timeline, kind: CueKind, index: number, frames: number): Timeline {
  const cue = cueList(tl, kind)[index];
  if (!cue) return tl;
  return resizeCue(tl, kind, index, "end", Math.max(1, Math.round(frames)) - cue.durationInFrames);
}

export function splitCueAt(tl: Timeline, kind: CueKind, index: number, frame: number): Timeline {
  const list = cueList(tl, kind);
  const cue = list[index];
  if (!cue) return tl;
  const at = Math.round(frame);
  if (at <= cue.from || at >= cueEnd(cue)) return tl;
  const local = at - cue.from;

  const halves = <C extends BaseCue>(c: C): [C, C] => [
    { ...c, durationInFrames: local },
    { ...structuredClone(c), from: at, durationInFrames: c.durationInFrames - local },
  ];

  switch (kind) {
    case "captions": {
      if (!captionWordsOf(tl.captions[index])) return tl;
      const [a, b] = halves(tl.captions[index]);
      const wordsA = a.words.filter((w) => w.start < at).map((w) => (w.end > at ? { ...w, end: at } : w));
      const wordsB = b.words.filter((w) => w.start >= at);
      if (wordsA.length === 0 || wordsB.length === 0) return tl;
      const captions = tl.captions.slice();
      captions.splice(index, 1, { ...a, words: wordsA }, { ...b, words: wordsB });
      return { ...tl, captions };
    }
    case "subtitles": {
      const subtitles = tl.subtitles.slice();
      subtitles.splice(index, 1, ...halves(tl.subtitles[index]));
      return { ...tl, subtitles };
    }
    case "overlays": {
      const overlays = tl.overlays.slice();
      overlays.splice(index, 1, ...halves(tl.overlays[index]));
      return { ...tl, overlays };
    }
  }
}

export function patchSubtitle(
  tl: Timeline,
  index: number,
  patch: Partial<TimelineSubtitleCue>,
): Timeline {
  const cue = tl.subtitles[index];
  if (!cue) return tl;
  const next = applyPatch(cue, patch);
  return next === cue ? tl : { ...tl, subtitles: replaceAt(tl.subtitles, index, next) };
}

export function patchOverlay(
  tl: Timeline,
  index: number,
  patch: Partial<TimelineHighlightCue>,
): Timeline {
  const cue = tl.overlays[index];
  if (!cue) return tl;
  const next = applyPatch(cue, patch);
  return next === cue ? tl : { ...tl, overlays: replaceAt(tl.overlays, index, next) };
}

export function patchHighlightPart(
  tl: Timeline,
  cueIndex: number,
  partIndex: number,
  patch: Partial<TimelineHighlightPart>,
): Timeline {
  const cue = tl.overlays[cueIndex];
  const part = highlightPartsOf(cue)?.[partIndex];
  if (!cue || !part) return tl;
  return patchOverlay(tl, cueIndex, {
    parts: replaceAt(cue.parts, partIndex, applyPatch(part, patch)),
  });
}

export function insertHighlightPart(
  tl: Timeline,
  cueIndex: number,
  afterIndex: number,
  text: string,
): Timeline {
  const cue = tl.overlays[cueIndex];
  if (!cue || !text || !highlightPartsOf(cue)) return tl;
  const parts = cue.parts.slice();
  parts.splice(Math.min(parts.length, Math.max(0, afterIndex + 1)), 0, { t: text });
  return patchOverlay(tl, cueIndex, { parts });
}

export function removeHighlightPart(tl: Timeline, cueIndex: number, partIndex: number): Timeline {
  const cue = tl.overlays[cueIndex];
  if (!cue || !highlightPartsOf(cue) || cue.parts.length <= 1 || !cue.parts[partIndex]) return tl;
  return patchOverlay(tl, cueIndex, { parts: cue.parts.filter((_, i) => i !== partIndex) });
}

export function patchCaptionWord(
  tl: Timeline,
  cueIndex: number,
  wordIndex: number,
  patch: Partial<TimelineCaptionWord>,
): Timeline {
  const cue = tl.captions[cueIndex];
  const word = captionWordsOf(cue)?.[wordIndex];
  if (!cue || !word) return tl;
  const next = applyPatch(word, patch);
  if (next === word) return tl;
  return {
    ...tl,
    captions: replaceAt(tl.captions, cueIndex, { ...cue, words: replaceAt(cue.words, wordIndex, next) }),
  };
}

export function insertCaptionWord(
  tl: Timeline,
  cueIndex: number,
  afterIndex: number,
  text: string,
): Timeline {
  const cue = tl.captions[cueIndex];
  if (!cue || !text || !captionWordsOf(cue)) return tl;
  const words = cue.words.slice();
  const at = Math.min(words.length, Math.max(0, afterIndex + 1));
  const prev = words[at - 1];
  let start: number;
  let end: number;
  if (prev) {
    const mid = Math.round((prev.start + prev.end) / 2);
    start = mid;
    end = prev.end;
    words[at - 1] = { ...prev, end: mid };
  } else {
    start = cue.from;
    end = words[0] ? words[0].start : cueEnd(cue);
  }
  words.splice(at, 0, { text, start, end: Math.max(start, end) });
  return { ...tl, captions: replaceAt(tl.captions, cueIndex, { ...cue, words }) };
}

export function removeCaptionWord(tl: Timeline, cueIndex: number, wordIndex: number): Timeline {
  const cue = tl.captions[cueIndex];
  if (!cue || !captionWordsOf(cue) || cue.words.length <= 1 || !cue.words[wordIndex]) return tl;
  return {
    ...tl,
    captions: replaceAt(tl.captions, cueIndex, {
      ...cue,
      words: cue.words.filter((_, i) => i !== wordIndex),
    }),
  };
}

export function setSubtitleStyle(
  tl: Timeline,
  patch: Partial<TimelineSubtitleStyle> | null,
): Timeline {
  if (patch === null) {
    if (tl.subtitleStyle === undefined) return tl;
    const next = { ...tl };
    delete next.subtitleStyle;
    return next;
  }
  const next = applyPatch(tl.subtitleStyle ?? {}, patch);
  return next === tl.subtitleStyle ? tl : { ...tl, subtitleStyle: next };
}

export function cueTransformOf(tl: Timeline, kind: CueKind, index: number): TimelineCueTransform {
  const t = (cueList(tl, kind)[index] as { transform?: unknown } | undefined)?.transform;
  return t && typeof t === "object" && !Array.isArray(t) ? (t as TimelineCueTransform) : {};
}

function normalizeCueTransform(t: TimelineCueTransform): TimelineCueTransform | null {
  const next: TimelineCueTransform = { ...t };
  const set = (key: "x" | "y" | "scale", v: unknown, lo: number, hi: number, digits: number, def: number) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      delete next[key];
      return;
    }
    const p = 10 ** digits;
    const r = Math.round(Math.min(hi, Math.max(lo, v)) * p) / p;
    if (r === def) delete next[key];
    else next[key] = r;
  };
  set("x", t.x, -1, 1, 4, 0);
  set("y", t.y, -1, 1, 4, 0);
  set("scale", t.scale, CUE_SCALE_MIN, CUE_SCALE_MAX, 3, 1);
  return Object.keys(next).length > 0 ? next : null;
}

const sameCueTransform = (a: unknown, b: TimelineCueTransform | null): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b);

function withCueTransform<C extends BaseCue>(cue: C, t: TimelineCueTransform | null): C {
  if (sameCueTransform((cue as { transform?: unknown }).transform, t)) return cue;
  const next = { ...cue } as C & { transform?: TimelineCueTransform };
  if (t) next.transform = t;
  else delete next.transform;
  return next;
}

export function setCueTransform(
  tl: Timeline,
  kind: CueKind,
  index: number,
  transform: TimelineCueTransform | null,
): Timeline {
  const t = transform ? normalizeCueTransform(transform) : null;
  return editCue(tl, kind, index, (cue) => withCueTransform(cue, t));
}

export function applyCueTransformToAll(tl: Timeline, kind: CueKind, index: number): Timeline {
  if (!cueList(tl, kind)[index]) return tl;
  const t = normalizeCueTransform(cueTransformOf(tl, kind, index));
  const list = cueList(tl, kind);
  let changed = false;
  const next = list.map((cue) => {
    if (!cue || typeof cue !== "object") return cue;
    const out = withCueTransform(cue, t);
    if (out !== cue) changed = true;
    return out;
  });
  return changed ? ({ ...tl, [kind]: next } as Timeline) : tl;
}

export function setCaptionText(tl: Timeline, index: number, text: string): Timeline {
  const cue = tl.captions[index];
  const old = captionWordsOf(cue);
  if (!cue || !old) return tl;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return tl;
  let words: TimelineCaptionWord[];
  if (tokens.length === old.length) {
    words = old.map((w, i) => (w.text === tokens[i] ? w : { ...w, text: tokens[i] }));
    if (words.every((w, i) => w === old[i])) return tl;
  } else {
    const start = cue.from;
    const span = Math.max(tokens.length, cue.durationInFrames);
    const weights = tokens.map((tk) => Math.max(1, tk.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    words = tokens.map((tk, i) => {
      const s = start + Math.round((acc / total) * span);
      acc += weights[i];
      const e = i === tokens.length - 1 ? start + span : start + Math.round((acc / total) * span);
      return { ...old[i], text: tk, start: s, end: Math.max(s, e) };
    });
  }
  return {
    ...tl,
    captions: replaceAt(tl.captions, index, { ...cue, words, durationInFrames: Math.max(cue.durationInFrames, tokens.length) }),
  };
}

export function normalizeTimeline(tl: Timeline): Timeline {
  const raw: Partial<Record<keyof Timeline, unknown>> = tl;
  const audioRaw: unknown = raw.audio;
  const audio = audioRaw !== null && typeof audioRaw === "object" ? tl.audio : null;
  const ok =
    Array.isArray(raw.scenes) &&
    Array.isArray(raw.captions) &&
    Array.isArray(raw.subtitles) &&
    Array.isArray(raw.overlays) &&
    audio !== null &&
    Array.isArray(audio.sfx) &&
    audio.voice !== undefined &&
    audio.music !== undefined &&
    raw.subtitleStyle !== null;
  if (ok) return tl;
  const next: Timeline = {
    ...tl,
    scenes: Array.isArray(raw.scenes) ? tl.scenes : [],
    captions: Array.isArray(raw.captions) ? tl.captions : [],
    subtitles: Array.isArray(raw.subtitles) ? tl.subtitles : [],
    overlays: Array.isArray(raw.overlays) ? tl.overlays : [],
    audio: {
      ...(audio ?? {}),
      voice: audio?.voice ?? null,
      sfx: audio && Array.isArray(audio.sfx) ? audio.sfx : [],
      music: audio?.music ?? null,
    },
  };
  if (raw.subtitleStyle === null) delete next.subtitleStyle;
  return next;
}

export function moveSfx(
  tl: Timeline,
  index: number,
  delta: number,
  maxStart: number = Number.POSITIVE_INFINITY,
): Timeline {
  const sfx = tl.audio.sfx[index];
  const d = Math.round(delta);
  if (!sfx || !Number.isFinite(d) || d === 0) return tl;
  const atFrame = Math.min(Math.max(0, sfx.atFrame + d), Math.max(sfx.atFrame, maxStart));
  if (atFrame === sfx.atFrame) return tl;
  return patchSfx(tl, index, { atFrame });
}

export function patchSfx(tl: Timeline, index: number, patch: Partial<TimelineSfx>): Timeline {
  const sfx = tl.audio.sfx[index];
  if (!sfx) return tl;
  const next = applyPatch(sfx, patch);
  if (next === sfx) return tl;
  return { ...tl, audio: { ...tl.audio, sfx: replaceAt(tl.audio.sfx, index, next) } };
}

export function patchMusic(tl: Timeline, patch: Partial<TimelineMusic>): Timeline {
  const music = tl.audio.music;
  if (!music) return tl;
  const next = applyPatch(music, patch);
  return next === music ? tl : { ...tl, audio: { ...tl.audio, music: next } };
}

export function selectionExists(tl: Timeline, sel: Selection | null): boolean {
  if (!sel) return false;
  switch (sel.kind) {
    case "scene":
      return sceneIndexById(tl, sel.id) >= 0;
    case "caption":
    case "subtitle":
    case "overlay":
      return sel.index >= 0 && sel.index < cueList(tl, CUE_KIND[sel.kind]).length;
    case "sfx":
      return sel.index >= 0 && sel.index < tl.audio.sfx.length;
    case "music":
      return tl.audio.music !== null;
    case "voice":
      return tl.audio.voice !== null;
    case "layer":
      return layerIndexById(tl, sel.id) >= 0;
  }
}

export function canDelete(tl: Timeline, sel: Selection | null): boolean {
  if (!sel || !selectionExists(tl, sel)) return false;
  if (sel.kind === "scene") return tl.scenes.length > 1;
  return sel.kind !== "voice";
}

export function deleteSelection(tl: Timeline, sel: Selection | null): Timeline {
  if (!sel || !canDelete(tl, sel)) return tl;
  switch (sel.kind) {
    case "scene":
      return { ...tl, scenes: tl.scenes.filter((s) => s.id !== sel.id) };
    case "caption":
      return { ...tl, captions: tl.captions.filter((_, i) => i !== sel.index) };
    case "subtitle":
      return { ...tl, subtitles: tl.subtitles.filter((_, i) => i !== sel.index) };
    case "overlay":
      return { ...tl, overlays: tl.overlays.filter((_, i) => i !== sel.index) };
    case "sfx":
      return { ...tl, audio: { ...tl.audio, sfx: tl.audio.sfx.filter((_, i) => i !== sel.index) } };
    case "music":
      return { ...tl, audio: { ...tl.audio, music: null } };
    case "layer":
      return removeLayer(tl, sel.id);
    case "voice":
      return tl;
  }
}

function freeSlotAfter(list: BaseCue[], index: number, dur: number): number {
  const self = list[index];
  let at = cueEnd(self);
  const others = list
    .filter((c, i) => i !== index && c && Number.isFinite(c.from) && Number.isFinite(c.durationInFrames))
    .sort((a, b) => a.from - b.from);
  for (const c of others) {
    if (cueEnd(c) <= at) continue;
    if (c.from >= at + dur) break;
    at = Math.max(at, cueEnd(c));
  }
  return at;
}

const sortedInsertIndex = (list: BaseCue[], from: number): number => {
  const i = list.findIndex((c) => c && c.from > from);
  return i === -1 ? list.length : i;
};

export function canDuplicate(tl: Timeline, sel: Selection | null): boolean {
  if (!sel || !selectionExists(tl, sel)) return false;

  if (!isWellFormed(tl, sel)) return false;
  return sel.kind !== "music" && sel.kind !== "voice";
}

export function duplicateSelection(
  tl: Timeline,
  sel: Selection | null,
  fps: number,
): { timeline: Timeline; selection: Selection | null } {
  if (!sel || !canDuplicate(tl, sel)) return { timeline: tl, selection: sel };
  switch (sel.kind) {
    case "scene": {
      const index = sceneIndexById(tl, sel.id);
      const copy: TimelineScene = {
        ...structuredClone(tl.scenes[index]),
        id: uniqueSceneId(tl.scenes, sel.id),
      };
      const scenes = tl.scenes.slice();
      scenes.splice(index + 1, 0, copy);
      return { timeline: { ...tl, scenes }, selection: { kind: "scene", id: copy.id } };
    }
    case "caption": {
      const cue = tl.captions[sel.index];
      const from = freeSlotAfter(tl.captions, sel.index, cue.durationInFrames);
      const copy = shiftWords({ ...structuredClone(cue), from }, from - cue.from);
      const at = sortedInsertIndex(tl.captions, from);
      const captions = tl.captions.slice();
      captions.splice(at, 0, copy);
      return { timeline: { ...tl, captions }, selection: { kind: "caption", index: at } };
    }
    case "subtitle": {
      const cue = tl.subtitles[sel.index];
      const from = freeSlotAfter(tl.subtitles, sel.index, cue.durationInFrames);
      const at = sortedInsertIndex(tl.subtitles, from);
      const subtitles = tl.subtitles.slice();
      subtitles.splice(at, 0, { ...structuredClone(cue), from });
      return { timeline: { ...tl, subtitles }, selection: { kind: "subtitle", index: at } };
    }
    case "overlay": {
      const cue = tl.overlays[sel.index];
      const from = freeSlotAfter(tl.overlays, sel.index, cue.durationInFrames);
      const at = sortedInsertIndex(tl.overlays, from);
      const overlays = tl.overlays.slice();
      overlays.splice(at, 0, { ...structuredClone(cue), from });
      return { timeline: { ...tl, overlays }, selection: { kind: "overlay", index: at } };
    }
    case "sfx": {
      const sfx = tl.audio.sfx[sel.index];
      const list = tl.audio.sfx.slice();
      list.splice(sel.index + 1, 0, {
        ...structuredClone(sfx),
        atFrame: sfx.atFrame + Math.max(1, Math.round(fps)),
      });
      return {
        timeline: { ...tl, audio: { ...tl.audio, sfx: list } },
        selection: { kind: "sfx", index: sel.index + 1 },
      };
    }
    case "layer": {

      const layers = layersOf(tl);
      const index = layerIndexById(tl, sel.id);
      const src = layers[index];
      const copy: TimelineLayer = {
        ...structuredClone(src),
        id: uniqueLayerId(layers, src.id),
        from: src.from + src.durationInFrames,
      };
      const next = layers.slice();
      next.splice(index + 1, 0, copy);
      return { timeline: { ...tl, layers: next }, selection: { kind: "layer", id: copy.id } };
    }
    default:
      return { timeline: tl, selection: sel };
  }
}

export function splitAtPlayhead(
  tl: Timeline,
  sel: Selection | null,
  frame: number,
  spans: { id: string; start: number; end: number }[],
  ctx: OpsContext,
): { timeline: Timeline; selection: Selection | null } | null {
  if (sel && isCueSel(sel.kind) && "index" in sel) {
    const next = splitCueAt(tl, CUE_KIND[sel.kind], sel.index, frame);
    if (next !== tl) return { timeline: next, selection: sel };
  }
  if (sel?.kind === "layer") {

    const next = splitLayerAt(tl, sel.id, frame, uniqueLayerId(layersOf(tl), sel.id), ctx.fps);
    if (next !== tl) return { timeline: next, selection: sel };
  }

  const under = spans.filter((s) => frame > s.start && frame < s.end);
  const chosen =
    (sel?.kind === "scene" ? under.find((s) => s.id === sel.id) : undefined) ??
    under[under.length - 1];
  if (!chosen) return null;
  const index = sceneIndexById(tl, chosen.id);
  const newId = uniqueSceneId(tl.scenes, chosen.id);
  const next = splitSceneAt(tl, index, frame - chosen.start, newId, ctx);
  if (next === tl) return null;
  return { timeline: next, selection: { kind: "scene", id: chosen.id } };
}

export function sceneIdFromFile(scenes: TimelineScene[], relPath: string): string {
  const name = relPath.split(/[\\/]/).pop() ?? relPath;
  const stem = name.replace(/\.[^.]+$/, "");
  const kebab = stem
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const base = kebab || "scene";
  return scenes.some((s) => s.id === base) ? uniqueSceneId(scenes, base) : base;
}

export const NEW_FOOTAGE_FALLBACK_SEC = 5;

export const NEW_IMAGE_SEC = 3;

export function newFootageScene(
  id: string,
  relPath: string,
  durationSec: number | null,
  fps: number,
): TimelineScene {
  const fileFrames =
    durationSec !== null && Number.isFinite(durationSec) && durationSec > 0
      ? Math.floor(durationSec * fps + 1e-6)
      : Math.round(NEW_FOOTAGE_FALLBACK_SEC * fps);
  const frames = Math.max(1, fileFrames);
  return { id, srcVideo: relPath, from: 0, to: frameToSec(frames, fps) };
}

export function newImageScene(id: string, relPath: string, fps: number): TimelineScene {
  return { id, srcImage: relPath, durationInFrames: Math.max(1, Math.round(NEW_IMAGE_SEC * fps)) };
}

export function addScene(tl: Timeline, index: number, scene: TimelineScene): Timeline {
  if (!scene.id || tl.scenes.some((s) => s.id === scene.id)) return tl;
  const at = clampInt(Number.isFinite(index) ? index : tl.scenes.length, 0, tl.scenes.length);
  const scenes = tl.scenes.slice();
  scenes.splice(at, 0, scene);
  return { ...tl, scenes };
}

export const NEW_SFX_VOLUME = 0.8;

export function addSfx(
  tl: Timeline,
  file: string,
  atFrame: number,
  volume: number = NEW_SFX_VOLUME,
): { timeline: Timeline; selection: Selection | null } {
  if (!file || !Number.isFinite(atFrame)) return { timeline: tl, selection: null };
  const sfx: TimelineSfx = {
    file,
    atFrame: Math.max(0, Math.round(atFrame)),
    volume: Math.min(1, Math.max(0, volume)),
  };
  const list = [...tl.audio.sfx, sfx];
  return {
    timeline: { ...tl, audio: { ...tl.audio, sfx: list } },
    selection: { kind: "sfx", index: list.length - 1 },
  };
}

export const NEW_MUSIC_DEFAULTS = { volume: 0.25, duckVolume: 0.1 } as const;

export function setMusic(tl: Timeline, file: string): Timeline {
  if (!file) return tl;
  const cur = tl.audio.music;
  if (!cur) {
    return { ...tl, audio: { ...tl.audio, music: { file, ...NEW_MUSIC_DEFAULTS } } };
  }
  if (cur.file === file) return tl;
  return { ...tl, audio: { ...tl.audio, music: { ...cur, file } } };
}

export const NEW_CUE_SEC = 2;

export type NewCue =
  | { kind: "overlay"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "caption"; word: string };

export function addCue(
  tl: Timeline,
  cue: NewCue,
  from: number,
  durationInFrames: number,
): { timeline: Timeline; selection: Selection | null } {
  const start = Math.max(0, Math.round(from));
  const dur = Math.max(1, Math.round(durationInFrames));
  if (!Number.isFinite(start) || !Number.isFinite(dur)) return { timeline: tl, selection: null };
  const insertAt = (list: BaseCue[]): number => {
    const i = list.findIndex((c) => c.from > start);
    return i === -1 ? list.length : i;
  };
  switch (cue.kind) {
    case "overlay": {
      const text = cue.text.trim();
      if (!text) return { timeline: tl, selection: null };
      const at = insertAt(tl.overlays);
      const overlays = tl.overlays.slice();
      overlays.splice(at, 0, {
        from: start,
        durationInFrames: dur,
        parts: [{ t: text }],
        tier: "main",
        accent: "hot",
      });
      return { timeline: { ...tl, overlays }, selection: { kind: "overlay", index: at } };
    }
    case "subtitle": {
      const text = cue.text.trim();
      if (!text) return { timeline: tl, selection: null };
      const at = insertAt(tl.subtitles);
      const subtitles = tl.subtitles.slice();
      subtitles.splice(at, 0, { from: start, durationInFrames: dur, text });
      return { timeline: { ...tl, subtitles }, selection: { kind: "subtitle", index: at } };
    }
    case "caption": {
      const word = cue.word.trim();
      if (!word) return { timeline: tl, selection: null };
      const at = insertAt(tl.captions);
      const captions = tl.captions.slice();
      captions.splice(at, 0, {
        from: start,
        durationInFrames: dur,
        words: [{ text: word, start, end: start + dur }],
      });
      return { timeline: { ...tl, captions }, selection: { kind: "caption", index: at } };
    }
  }
}

export function newCuePlacement(
  frame: number,
  totalFrames: number,
  fps: number,
): { from: number; durationInFrames: number } {
  const total = Math.max(1, Math.round(totalFrames));
  const full = Math.max(1, Math.round(NEW_CUE_SEC * fps));
  const from = Math.min(Math.max(0, Math.round(frame)), total - 1);
  const remaining = total - from;
  if (remaining >= full) return { from, durationInFrames: full };
  if (remaining >= Math.round(fps / 2)) return { from, durationInFrames: remaining };
  const start = Math.max(0, total - full);
  return { from: start, durationInFrames: Math.max(1, total - start) };
}

export function sceneInsertIndexAt(spans: { start: number; end: number }[], frame: number): number {
  const i = spans.findIndex((s) => frame < (s.start + s.end) / 2);
  return i === -1 ? spans.length : i;
}

export function insertSceneAtFrame(
  tl: Timeline,
  scene: TimelineScene,
  frame: number,
  spans: { id: string; start: number; end: number }[],
  ctx: OpsContext,
  locked: ReadonlySet<string> = new Set(),
): Timeline {
  const margin = Math.round(ctx.fps / 2);
  const under = spans.filter((s) => frame - s.start >= margin && s.end - frame >= margin);
  const chosen = under[under.length - 1];
  let base = tl;
  let at = -1;
  let cut = 0;
  if (chosen) {
    const index = sceneIndexById(tl, chosen.id);
    const split = splitSceneAt(tl, index, frame - chosen.start, uniqueSceneId(tl.scenes, chosen.id), ctx);
    if (split !== tl) {
      base = split;
      at = index + 1;
      cut = Math.round(frame);
    }
  }
  if (at === -1) {
    at = sceneInsertIndexAt(spans, frame);
    cut = at < spans.length ? spans[at].start : (spans[spans.length - 1]?.end ?? 0);
  }
  const next = addScene(base, at, scene);
  if (next === base) return tl;
  const delta = sceneDurationFrames(scene, ctx.fps);
  if (tl.audio.voice || !delta) return next;
  return shiftTimedFrom(next, cut, delta, locked);
}

function shiftTimedFrom(tl: Timeline, at: number, delta: number, skip: ReadonlySet<string>): Timeline {
  const late = (c: { from?: unknown } | null | undefined): boolean =>
    !!c && typeof c.from === "number" && c.from >= at;
  const shift = <T extends { from: number }>(c: T): T => ({ ...c, from: c.from + delta });
  const next: Timeline = { ...tl };
  if (!skip.has("caption")) next.captions = tl.captions.map((c) => (late(c) ? shiftWords(shift(c), delta) : c));
  if (!skip.has("subtitle")) next.subtitles = tl.subtitles.map((c) => (late(c) ? shift(c) : c));
  if (!skip.has("overlay")) next.overlays = tl.overlays.map((c) => (late(c) ? shift(c) : c));
  if (!skip.has("sfx")) {
    next.audio = {
      ...tl.audio,
      sfx: tl.audio.sfx.map((s) =>
        s && typeof s.atFrame === "number" && s.atFrame >= at ? { ...s, atFrame: s.atFrame + delta } : s,
      ),
    };
  }

  if (Array.isArray(tl.layers) && !skip.has("layer")) next.layers = tl.layers.map((l) => (late(l) ? shift(l) : l));
  return next;
}

export type TimelineLayer = NonNullable<Timeline["layers"]>[number];
export type TimelineLayerKeyframe = NonNullable<TimelineLayer["keyframes"]>[number];
export type LayerKind = TimelineLayer["kind"];

const LAYER_KINDS: readonly string[] = ["image", "video", "text", "shape"];

export const layersOf = (tl: Timeline): TimelineLayer[] => (Array.isArray(tl.layers) ? tl.layers : []);

export const layerIndexById = (tl: Timeline, id: string): number =>
  layersOf(tl).findIndex((l) => !!l && typeof l === "object" && l.id === id);

export const layerById = (tl: Timeline, id: string): TimelineLayer | null =>
  layersOf(tl)[layerIndexById(tl, id)] ?? null;

export function isLayerWellFormed(layer: TimelineLayer | undefined | null): layer is TimelineLayer {
  return (
    !!layer &&
    typeof layer === "object" &&
    typeof layer.id === "string" &&
    LAYER_KINDS.includes(layer.kind) &&
    isFiniteNum(layer.from) &&
    isFiniteNum(layer.durationInFrames)
  );
}

const layerEnd = (l: TimelineLayer): number => l.from + l.durationInFrames;

function withLayers(tl: Timeline, layers: TimelineLayer[]): Timeline {
  return layers === tl.layers ? tl : { ...tl, layers };
}

function editLayer(tl: Timeline, id: string, fn: (layer: TimelineLayer) => TimelineLayer): Timeline {
  const index = layerIndexById(tl, id);
  if (index < 0) return tl;
  const layers = layersOf(tl);
  const cur = layers[index];
  const next = fn(cur);
  return next === cur ? tl : withLayers(tl, replaceAt(layers, index, next));
}

export function uniqueLayerId(layers: TimelineLayer[], base: string): string {
  const taken = new Set(layers.map((l) => l?.id));
  const stem = base.replace(/-\d+$/, "") || "layer";
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function newLayerId(layers: TimelineLayer[], prefix: string): string {
  const taken = new Set(layers.map((l) => l?.id));
  const stem = prefix.replace(/-\d+$/, "") || "layer";
  for (let n = 1; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function layerIdFromFile(layers: TimelineLayer[], relPath: string): string {
  const stem = sceneIdFromFile([], relPath);
  return newLayerId(layers, stem === "scene" ? "media" : stem);
}

export function patchLayer(tl: Timeline, id: string, patch: Partial<TimelineLayer>): Timeline {
  return editLayer(tl, id, (layer) => applyPatch(layer, patch));
}

export function addLayer(tl: Timeline, layer: TimelineLayer): Timeline {
  if (!layer?.id || layerIndexById(tl, layer.id) >= 0) return tl;
  return { ...tl, layers: [...layersOf(tl), layer] };
}

export function removeLayer(tl: Timeline, id: string): Timeline {
  const index = layerIndexById(tl, id);
  if (index < 0) return tl;
  return { ...tl, layers: layersOf(tl).filter((_, i) => i !== index) };
}

const timeOverlaps = (a: TimelineLayer, b: TimelineLayer): boolean =>
  isLayerWellFormed(a) && isLayerWellFormed(b) && a.from < layerEnd(b) && b.from < layerEnd(a);

export function moveLayerZ(tl: Timeline, id: string, delta: 1 | -1): Timeline {
  const layers = layersOf(tl);
  const index = layerIndexById(tl, id);
  if (index < 0) return tl;
  const self = layers[index];
  let target = -1;
  for (let i = index + delta; i >= 0 && i < layers.length; i += delta) {
    if (timeOverlaps(self, layers[i])) {
      target = i;
      break;
    }
  }
  if (target < 0) return tl;
  return withLayers(tl, moveItem(layers, index, target));
}

export function moveLayer(
  tl: Timeline,
  id: string,
  delta: number,
  maxStart: number = Number.POSITIVE_INFINITY,
): Timeline {
  const d = Math.round(delta);
  if (!Number.isFinite(d) || d === 0) return tl;
  return editLayer(tl, id, (layer) => {
    if (!isLayerWellFormed(layer)) return layer;
    const from = Math.min(Math.max(0, layer.from + d), Math.max(layer.from, maxStart));
    return from === layer.from ? layer : { ...layer, from };
  });
}

export function setLayerStart(tl: Timeline, id: string, frame: number): Timeline {
  const layer = layerById(tl, id);
  if (!isLayerWellFormed(layer)) return tl;
  return moveLayer(tl, id, Math.max(0, Math.round(frame)) - layer.from);
}

type KeyProp = "x" | "y" | "scale" | "rotate" | "opacity";
const KEY_PROPS: KeyProp[] = ["x", "y", "scale", "rotate", "opacity"];

export interface LayerKeyValues {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
}

const keyframesOf = (layer: TimelineLayer): TimelineLayerKeyframe[] =>
  Array.isArray(layer.keyframes)
    ? layer.keyframes.filter((k) => !!k && typeof k === "object" && isFiniteNum(k.frame))
    : [];

const keyValueAt = (kfs: TimelineLayerKeyframe[], prop: KeyProp, rel: number): number | undefined =>
  keyframeValue(kfs as EngineLayerKeyframe[], prop, rel);

export function layerValuesAt(layer: TimelineLayer, rel: number): LayerKeyValues {
  const tr: Record<string, unknown> = layer.transform && typeof layer.transform === "object" ? layer.transform : {};
  const base: LayerKeyValues = {
    x: isFiniteNum(tr.x) ? tr.x : 0,
    y: isFiniteNum(tr.y) ? tr.y : 0,
    scale: isFiniteNum(tr.scale) ? tr.scale : 1,
    rotate: isFiniteNum(tr.rotate) ? tr.rotate : 0,
    opacity: isFiniteNum(layer.opacity) ? layer.opacity : 1,
  };
  const kfs = keyframesOf(layer);
  for (const prop of KEY_PROPS) {
    const v = keyValueAt(kfs, prop, rel);
    if (v !== undefined) base[prop] = round4(v);
  }
  return base;
}

function sampleKeyframe(kfs: TimelineLayerKeyframe[], rel: number, frame: number): TimelineLayerKeyframe {
  const kf: TimelineLayerKeyframe = { frame };
  for (const prop of KEY_PROPS) {
    const v = keyValueAt(kfs, prop, rel);
    if (v !== undefined) kf[prop] = round4(v);
  }
  return kf;
}

function rebaseKeyframes(kfs: TimelineLayerKeyframe[], offset: number): TimelineLayerKeyframe[] {
  if (kfs.length === 0 || offset <= 0) return kfs;
  const kept = kfs.filter((k) => k.frame >= offset).map((k) => ({ ...k, frame: k.frame - offset }));
  if (!kept.some((k) => k.frame === 0)) {
    const before = [...kfs].sort((a, b) => a.frame - b.frame).reverse().find((k) => k.frame < offset);
    const sample = sampleKeyframe(kfs, offset, 0);
    if (before?.ease) sample.ease = before.ease;
    kept.unshift(sample);
  }
  return kept.sort((a, b) => a.frame - b.frame);
}

export function addLayerKeyframe(
  tl: Timeline,
  id: string,
  relFrame: number,
  values: Partial<LayerKeyValues>,
): Timeline {
  return editLayer(tl, id, (layer) => {
    if (!isLayerWellFormed(layer) || !Number.isFinite(relFrame)) return layer;
    const frame = clampInt(relFrame, 0, Math.max(0, layer.durationInFrames - 1));
    const clean: Partial<LayerKeyValues> = {};
    for (const prop of KEY_PROPS) {
      const v = values[prop];
      if (isFiniteNum(v)) clean[prop] = round4(v);
    }
    const kfs: TimelineLayerKeyframe[] = Array.isArray(layer.keyframes) ? layer.keyframes : [];
    const at = kfs.findIndex((k) => k?.frame === frame);
    let next: TimelineLayerKeyframe[];
    if (at >= 0) {
      const merged = applyPatch(kfs[at], clean);
      if (merged === kfs[at]) return layer;
      next = replaceAt(kfs, at, merged);
    } else {
      next = [...kfs, { frame, ...clean }].sort((a, b) => (a?.frame ?? 0) - (b?.frame ?? 0));
    }
    return { ...layer, keyframes: next };
  });
}

export function removeLayerKeyframe(tl: Timeline, id: string, relFrame: number): Timeline {
  return editLayer(tl, id, (layer) => {
    if (!Array.isArray(layer.keyframes)) return layer;
    const target = Math.round(relFrame);
    const next = layer.keyframes.filter((k) => k?.frame !== target);
    if (next.length === layer.keyframes.length) return layer;
    if (next.length > 0) return { ...layer, keyframes: next };
    const copy = { ...layer };
    delete copy.keyframes;
    return copy;
  });
}

export function applyLayerCanvasTransform(
  tl: Timeline,
  id: string,
  transform: Record<string, unknown>,
  absFrame: number,
): Timeline {
  const layer = layerById(tl, id);
  if (!isLayerWellFormed(layer)) return tl;
  const kfs = keyframesOf(layer);
  const keyed = (["x", "y", "scale", "rotate"] as const).filter((p) => kfs.some((k) => isFiniteNum(k[p])));
  if (keyed.length === 0) return patchLayer(tl, id, { transform: transform as TimelineLayer["transform"] });
  const rel = Math.round(absFrame) - layer.from;
  const inside = rel >= 0 && rel < layer.durationInFrames;
  const oldBase: Record<string, unknown> =
    layer.transform && typeof layer.transform === "object" ? layer.transform : {};
  const base: Record<string, unknown> = { ...transform };
  const keyValues: Partial<LayerKeyValues> = {};
  for (const p of keyed) {

    if (p in oldBase) base[p] = oldBase[p];
    else delete base[p];
    const v = transform[p];
    if (isFiniteNum(v)) keyValues[p] = v;
  }
  let next = patchLayer(tl, id, { transform: base as TimelineLayer["transform"] });
  if (inside && Object.keys(keyValues).length > 0) next = addLayerKeyframe(next, id, rel, keyValues);
  return next;
}

function layerMaxFrames(layer: TimelineLayer, ctx: OpsContext): number | null {
  if (layer.kind !== "video" || typeof layer.src !== "string") return null;
  const sec = ctx.mediaDurationSec(layer.src);
  if (sec === null) return null;
  const start = isFiniteNum(layer.mediaStart) ? layer.mediaStart : 0;
  return Math.max(1, Math.floor((sec - start) * ctx.fps + 1e-6));
}

export function resizeLayer(
  tl: Timeline,
  id: string,
  edge: "start" | "end",
  delta: number,
  ctx: OpsContext,
): Timeline {
  const d = Math.round(delta);
  if (!Number.isFinite(d) || d === 0) return tl;
  return editLayer(tl, id, (layer) => {
    if (!isLayerWellFormed(layer)) return layer;
    const end = layerEnd(layer);
    if (edge === "start") {
      const mediaStart = isFiniteNum(layer.mediaStart) ? layer.mediaStart : 0;
      const mediaStartFrames = Math.round(mediaStart * ctx.fps);

      const lower = layer.kind === "video" ? Math.max(0, layer.from - mediaStartFrames) : 0;
      const from = clampInt(layer.from + d, lower, end - 1);
      const shift = from - layer.from;
      if (shift === 0) return layer;
      const next: TimelineLayer = { ...layer, from, durationInFrames: end - from };
      if (layer.kind === "video") next.mediaStart = Math.max(0, frameToSec(mediaStartFrames + shift, ctx.fps));
      const kfs = keyframesOf(layer);
      if (kfs.length > 0) {
        next.keyframes = shift > 0 ? rebaseKeyframes(kfs, shift) : kfs.map((k) => ({ ...k, frame: k.frame - shift }));
      }
      return next;
    }
    const max = layerMaxFrames(layer, ctx);
    const upper = max === null ? Number.POSITIVE_INFINITY : Math.max(max, layer.durationInFrames);
    const dur = clampInt(layer.durationInFrames + d, 1, upper);
    return dur === layer.durationInFrames ? layer : { ...layer, durationInFrames: dur };
  });
}

export function setLayerDuration(tl: Timeline, id: string, frames: number, ctx: OpsContext): Timeline {
  const layer = layerById(tl, id);
  if (!isLayerWellFormed(layer)) return tl;
  return resizeLayer(tl, id, "end", Math.max(1, Math.round(frames)) - layer.durationInFrames, ctx);
}

export function splitLayerAt(tl: Timeline, id: string, frame: number, newId: string, fps: number): Timeline {
  const index = layerIndexById(tl, id);
  const layer = layersOf(tl)[index];
  if (!isLayerWellFormed(layer)) return tl;
  if (!newId || layerIndexById(tl, newId) >= 0) return tl;
  const at = Math.round(frame);
  if (at <= layer.from || at >= layerEnd(layer)) return tl;
  const local = at - layer.from;

  const first: TimelineLayer = { ...layer, durationInFrames: local };
  const second: TimelineLayer = {
    ...structuredClone(layer),
    id: newId,
    from: at,
    durationInFrames: layer.durationInFrames - local,
  };
  const kfs = keyframesOf(layer);
  if (kfs.length > 0) {
    const head = kfs.filter((k) => k.frame <= local);
    if (!head.some((k) => k.frame === local)) head.push(sampleKeyframe(kfs, local, local));
    first.keyframes = head.sort((a, b) => a.frame - b.frame);
    second.keyframes = rebaseKeyframes(structuredClone(kfs), local);
  }
  if (layer.kind === "video") {
    const start = isFiniteNum(layer.mediaStart) ? layer.mediaStart : 0;
    second.mediaStart = frameToSec(Math.round(start * fps) + local, fps);
  }
  const anim = layer.animation && typeof layer.animation === "object" ? layer.animation : null;
  if (anim) {
    const a1 = { ...anim };
    delete a1.out;
    const a2 = { ...structuredClone(anim) };
    delete a2.in;
    first.animation = a1;
    second.animation = a2;
  }
  const layers = layersOf(tl).slice();
  layers.splice(index, 1, first, second);
  return { ...tl, layers };
}

export const NEW_LAYER_SEC = 3;

export const NEW_LAYER_VIDEO_FALLBACK_SEC = 5;

export function newLayerPlacement(
  frame: number,
  totalFrames: number,
  fps: number,
  sec: number = NEW_LAYER_SEC,
): { from: number; durationInFrames: number } {
  const total = Math.max(1, Math.round(totalFrames));
  const full = Math.max(1, Math.round(sec * fps));
  const from = Math.min(Math.max(0, Math.round(frame)), total - 1);
  const remaining = total - from;
  if (remaining >= full) return { from, durationInFrames: full };
  if (remaining >= Math.round(fps / 2)) return { from, durationInFrames: remaining };
  const start = Math.max(0, total - full);
  return { from: start, durationInFrames: Math.max(1, total - start) };
}

const DEFAULT_LAYER_ANIMATION = { in: "fade", out: "fade" } as const;

export function newTextLayer(
  id: string,
  text: string,
  from: number,
  durationInFrames: number,
  opts: { vertical?: boolean } = {},
): TimelineLayer {
  return {
    id,
    kind: "text",
    from: Math.max(0, Math.round(from)),
    durationInFrames: Math.max(1, Math.round(durationInFrames)),
    text,
    width: 0.8,
    style: {
      fontSizePx: opts.vertical ? 84 : 72,
      fontWeight: 700,
      color: "#ffffff",
      align: "center",
      lineHeight: 1.2,
      shadow: true,
    },
    animation: { ...DEFAULT_LAYER_ANIMATION },
  } as TimelineLayer;
}

export function newShapeLayer(id: string, from: number, durationInFrames: number, color = "#ed3c47"): TimelineLayer {
  return {
    id,
    kind: "shape",
    from: Math.max(0, Math.round(from)),
    durationInFrames: Math.max(1, Math.round(durationInFrames)),
    width: 0.4,
    aspect: 16 / 9,
    style: { backgroundColor: color, radiusPx: 24 },
    animation: { ...DEFAULT_LAYER_ANIMATION },
  } as TimelineLayer;
}

export function newMediaLayer(
  id: string,
  kind: "image" | "video",
  src: string,
  from: number,
  durationInFrames: number,
): TimelineLayer {
  const layer: Record<string, unknown> = {
    id,
    kind,
    from: Math.max(0, Math.round(from)),
    durationInFrames: Math.max(1, Math.round(durationInFrames)),
    src,
    width: 0.5,
    animation: { ...DEFAULT_LAYER_ANIMATION },
  };
  if (kind === "video") {
    layer.mediaStart = 0;
    layer.muted = false;
  }
  return layer as TimelineLayer;
}

export type ClipboardEntry =
  | { kind: "scene"; scene: TimelineScene }
  | { kind: "layer"; layer: TimelineLayer }
  | { kind: "caption"; cue: TimelineCaptionCue }
  | { kind: "subtitle"; cue: TimelineSubtitleCue }
  | { kind: "overlay"; cue: TimelineHighlightCue }
  | { kind: "sfx"; sfx: TimelineSfx };

export function copySelection(tl: Timeline, sel: Selection | null): ClipboardEntry | null {
  if (!sel || !selectionExists(tl, sel) || !isWellFormed(tl, sel)) return null;
  switch (sel.kind) {
    case "scene":
      return { kind: "scene", scene: structuredClone(tl.scenes[sceneIndexById(tl, sel.id)]) };
    case "layer": {
      const layer = layerById(tl, sel.id);
      return layer ? { kind: "layer", layer: structuredClone(layer) } : null;
    }
    case "caption":
      return { kind: "caption", cue: structuredClone(tl.captions[sel.index]) };
    case "subtitle":
      return { kind: "subtitle", cue: structuredClone(tl.subtitles[sel.index]) };
    case "overlay":
      return { kind: "overlay", cue: structuredClone(tl.overlays[sel.index]) };
    case "sfx":
      return { kind: "sfx", sfx: structuredClone(tl.audio.sfx[sel.index]) };
    default:
      return null;
  }
}

export function pasteClipboard(
  tl: Timeline,
  clip: ClipboardEntry,
  frame: number,
  spans: { start: number; end: number }[],
): { timeline: Timeline; selection: Selection | null } | null {
  const at = Math.max(0, Math.round(frame));
  if (!Number.isFinite(at)) return null;
  switch (clip.kind) {
    case "scene": {
      const src = structuredClone(clip.scene);
      const id = tl.scenes.some((s) => s.id === src.id) ? uniqueSceneId(tl.scenes, src.id) : src.id;
      const next = addScene(tl, sceneInsertIndexAt(spans, at), { ...src, id });
      return next === tl ? null : { timeline: next, selection: { kind: "scene", id } };
    }
    case "layer": {
      const src = structuredClone(clip.layer);
      const layers = layersOf(tl);
      const id = layers.some((l) => l?.id === src.id) ? uniqueLayerId(layers, src.id) : src.id;
      const next = addLayer(tl, { ...src, id, from: at });
      return next === tl ? null : { timeline: next, selection: { kind: "layer", id } };
    }
    case "caption": {
      const src = structuredClone(clip.cue);
      const cue = shiftWords({ ...src, from: at }, at - src.from);
      const index = sortedInsertIndex(tl.captions, at);
      const captions = tl.captions.slice();
      captions.splice(index, 0, cue);
      return { timeline: { ...tl, captions }, selection: { kind: "caption", index } };
    }
    case "subtitle": {
      const index = sortedInsertIndex(tl.subtitles, at);
      const subtitles = tl.subtitles.slice();
      subtitles.splice(index, 0, { ...structuredClone(clip.cue), from: at });
      return { timeline: { ...tl, subtitles }, selection: { kind: "subtitle", index } };
    }
    case "overlay": {
      const index = sortedInsertIndex(tl.overlays, at);
      const overlays = tl.overlays.slice();
      overlays.splice(index, 0, { ...structuredClone(clip.cue), from: at });
      return { timeline: { ...tl, overlays }, selection: { kind: "overlay", index } };
    }
    case "sfx": {
      const list = [...tl.audio.sfx, { ...structuredClone(clip.sfx), atFrame: at }];
      return {
        timeline: { ...tl, audio: { ...tl.audio, sfx: list } },
        selection: { kind: "sfx", index: list.length - 1 },
      };
    }
  }
}

export const FILLER_PUNCH_SCALE = 1.08;

export function newFillerScene(id: string, relPath: string, fps: number): TimelineScene {
  const scene = newImageScene(id, relPath, fps);
  const dur = scene.durationInFrames ?? Math.round(NEW_IMAGE_SEC * fps);
  return {
    ...scene,
    zoom: {
      keys: [
        { frame: 0, scale: 1, ease: "inOut" },
        { frame: Math.max(1, dur - 1), scale: FILLER_PUNCH_SCALE },
      ],
    },
  };
}
