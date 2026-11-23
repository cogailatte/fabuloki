"use client";

import { useCallback, useEffect, useState } from "react";
import type { Timeline } from "@/lib/api";
import type { Selection } from "./ops";

export type LockableTrack = "scene" | "layer" | "overlay" | "caption" | "subtitle" | "sfx" | "voice" | "music";

export const LOCKABLE_TRACKS: readonly LockableTrack[] = [
  "scene",
  "layer",
  "overlay",
  "caption",
  "subtitle",
  "sfx",
  "voice",
  "music",
];

export const trackOfSelection = (sel: Selection | null): LockableTrack | null => (sel ? sel.kind : null);

function sliceOf(tl: Timeline, track: LockableTrack): unknown {
  switch (track) {
    case "scene":
      return tl.scenes;
    case "layer":
      return tl.layers;
    case "overlay":
      return tl.overlays;
    case "caption":
      return tl.captions;
    case "subtitle":
      return [tl.subtitles, tl.subtitleStyle];
    case "sfx":
      return tl.audio.sfx;
    case "music":
      return tl.audio.music;
    case "voice": {

      const { sfx: _sfx, music: _music, ...rest } = tl.audio;
      return rest;
    }
  }
}

export function lockedChange(prev: Timeline, next: Timeline, locks: ReadonlySet<LockableTrack>): LockableTrack | null {
  if (prev === next || locks.size === 0) return null;
  for (const track of locks) {
    const a = sliceOf(prev, track);
    const b = sliceOf(next, track);
    if (a === b) continue;
    if (track === "subtitle" && prev.subtitles === next.subtitles && prev.subtitleStyle === next.subtitleStyle) continue;
    if (track === "voice" && prev.audio === next.audio) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) return track;
  }
  return null;
}

const storageKey = (projectId: string) => `fabuloki.editor.locks.${projectId}`;

function readLocks(projectId: string): Set<LockableTrack> {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((t): t is LockableTrack => LOCKABLE_TRACKS.includes(t as LockableTrack)));
  } catch {
    return new Set();
  }
}

export function useTrackLocks(projectId: string) {
  const [locks, setLocks] = useState<ReadonlySet<LockableTrack>>(() => new Set());

  useEffect(() => {
    setLocks(readLocks(projectId));
  }, [projectId]);

  const toggle = useCallback(
    (track: LockableTrack) => {
      setLocks((cur) => {
        const next = new Set(cur);
        if (next.has(track)) next.delete(track);
        else next.add(track);
        try {
          localStorage.setItem(storageKey(projectId), JSON.stringify([...next]));
        } catch {

        }
        return next;
      });
    },
    [projectId],
  );

  return { locks, toggle };
}

export const TRACK_LABEL_KEY: Record<LockableTrack, string> = {
  scene: "editor.track.video",
  layer: "editor.track.layer",
  overlay: "editor.track.highlight",
  caption: "editor.track.karaoke",
  subtitle: "editor.track.subtitle",
  sfx: "editor.track.sfx",
  voice: "editor.track.voice",
  music: "editor.track.music",
};
