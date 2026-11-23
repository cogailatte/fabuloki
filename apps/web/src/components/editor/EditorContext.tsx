"use client";

import { createContext, useContext } from "react";
import type { Timeline } from "@/lib/api";
import type { LockableTrack } from "./locks";
import type { OpsContext, Selection } from "./ops";
import type { PlaybackStore } from "./playback";

export interface EditOptions {

  coalesce?: string;

  windowMs?: number | null;

  selection?: Selection | null;
}

export interface EditorApi {
  fps: number;

  vertical: boolean;
  ops: OpsContext;
  readOnly: boolean;

  locks: ReadonlySet<LockableTrack>;
  toggleLock: (track: LockableTrack) => void;
  selection: Selection | null;
  edit: (apply: (timeline: Timeline) => Timeline, options?: EditOptions) => void;
  select: (selection: Selection | null) => void;

  endCoalesce: () => void;

  seek: (frame: number) => void;
  playback: PlaybackStore;

  dragActive: { current: boolean };
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("useEditor phải nằm trong <EditorContext.Provider>");
  return api;
}
