

import { resolveSceneDurationInFrames } from "@engine/manifest";
import type { Timeline, TimelineScene } from "@/lib/api";

export function sceneDurationFrames(scene: TimelineScene, fps: number): number | null {
  try {
    const frames = resolveSceneDurationInFrames(
      { ...scene, srcImage: scene.srcImage ?? null },
      fps,
    );
    return Number.isFinite(frames) && frames > 0 ? frames : null;
  } catch {
    return null;
  }
}

export interface SceneSpan {
  index: number;
  id: string;

  start: number;

  end: number;
  duration: number;

  overlapOut: number;

  invalid: boolean;
}

export function effectiveOverlap(scenes: TimelineScene[], i: number, fps: number): number {
  const raw = scenes[i]?.transitionOverlap;
  if (typeof raw !== "number" || !(raw > 0)) return 0;
  if (i >= scenes.length - 1) return raw;
  const cur = sceneDurationFrames(scenes[i], fps);
  const next = sceneDurationFrames(scenes[i + 1], fps);
  if (cur === null || next === null) return raw;
  return Math.min(raw, Math.max(0, Math.min(cur, next)));
}

export function computeSceneSpans(scenes: TimelineScene[], fps: number): SceneSpan[] {
  const spans: SceneSpan[] = [];
  let from = 0;
  scenes.forEach((scene, index) => {
    const resolved = sceneDurationFrames(scene, fps);
    const duration = resolved ?? 1;
    const overlapOut = effectiveOverlap(scenes, index, fps);
    spans.push({
      index,
      id: scene.id,
      start: from,
      end: from + duration,
      duration,
      overlapOut: index < scenes.length - 1 ? overlapOut : 0,
      invalid: resolved === null,
    });
    from += duration - overlapOut;
  });
  return spans;
}

export function totalFramesOf(spans: SceneSpan[]): number {
  let total = 0;
  for (const span of spans) total = Math.max(total, span.end);
  return Math.max(1, total);
}

export function contentEndFrame(timeline: Timeline, spans: SceneSpan[]): number {
  let end = totalFramesOf(spans);

  const add = (v: number) => {
    if (Number.isFinite(v)) end = Math.max(end, v);
  };
  for (const list of [timeline.captions, timeline.subtitles, timeline.overlays]) {
    for (const cue of list) add(cue?.from + cue?.durationInFrames);
  }
  for (const sfx of timeline.audio.sfx) add(sfx?.atFrame + 1);
  if (Array.isArray(timeline.layers)) {
    for (const layer of timeline.layers) add(layer?.from + layer?.durationInFrames);
  }
  return end;
}

export function packLanes(items: { start: number; end: number }[]): { lanes: number[]; count: number } {
  const order = items
    .map((it, index) => ({ index, start: it.start, end: Math.max(it.end, it.start + 1) }))
    .sort((a, b) => a.start - b.start || a.index - b.index);
  const laneEnd: number[] = [];
  const lanes = new Array<number>(items.length).fill(0);
  for (const it of order) {
    let lane = laneEnd.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(it.end);
    } else {
      laneEnd[lane] = it.end;
    }
    lanes[it.index] = lane;
  }
  return { lanes, count: Math.max(1, laneEnd.length) };
}

export const ZOOM_MIN_PPS = 8;
export const ZOOM_MAX_PPS = 600;

export const clampPps = (pps: number): number =>
  Math.min(ZOOM_MAX_PPS, Math.max(ZOOM_MIN_PPS, pps));

export const frameToPx = (frame: number, pps: number, fps: number): number =>
  (frame * pps) / fps;

export const pxToFrame = (px: number, pps: number, fps: number): number =>
  (px * fps) / pps;

export function rulerStep(pps: number, minGapPx = 72): { major: number; minor: number } {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * pps >= minGapPx) ?? 600;
  const minor = major >= 10 ? major / 5 : major / 2;
  return { major, minor };
}

export function formatTimecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const whole = Math.max(1, Math.round(fps));
  const totalSec = Math.floor(f / fps);
  const ff = Math.min(whole - 1, Math.floor(f - totalSec * fps));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ff).padStart(2, "0")}`;
}

export function formatSeconds(frames: number, fps: number): string {
  const sec = Math.max(0, Math.round((frames / fps) * 100) / 100);
  if (sec < 60) return `${sec.toFixed(2).replace(/\.?0+$/, "") || "0"}s`;
  const mm = Math.floor(sec / 60);
  const rest = (sec - mm * 60).toFixed(2).padStart(5, "0");
  return `${mm}:${rest}`;
}

export function formatRulerLabel(sec: number): string {
  const s = Math.round(sec * 10) / 10;
  const mm = Math.floor(s / 60);
  const rest = s - mm * 60;
  const ss = Number.isInteger(rest) ? String(rest).padStart(2, "0") : rest.toFixed(1).padStart(4, "0");
  return `${mm}:${ss}`;
}

export const framesToSec = (frames: number, fps: number): number =>
  Math.round((frames / fps) * 100) / 100;

export const secToFrames = (sec: number, fps: number): number => Math.round(sec * fps);
