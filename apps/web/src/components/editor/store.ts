

import type { Timeline, TimelineIssue, TimelinePatch, TimelineSaved } from "@/lib/api";
import { sameSelection, selectionExists, type Selection } from "./ops";

export const TYPING_COALESCE_MS = 1000;
const HISTORY_LIMIT = 200;

interface HistoryEntry {
  timeline: Timeline;
  selection: Selection | null;
}

export type SaveProblem =
  | { kind: "error"; message: string }
  | { kind: "conflict"; current: TimelineSaved }
  | { kind: "invalid"; issues: TimelineIssue[]; message: string }
  | { kind: "locked"; message: string };

export interface EditorState {
  timeline: Timeline | null;

  version: string | null;
  selection: Selection | null;
  past: HistoryEntry[];
  future: HistoryEntry[];

  coalesce: { key: string; at: number; windowMs: number | null } | null;
  revision: number;

  savedTimeline: Timeline | null;

  overwrite: boolean;

  savingRevision: number | null;

  problem: (SaveProblem & { revision: number }) | null;
}

export type EditorAction =
  | { type: "loaded"; version: string; timeline: Timeline }
  | {
      type: "edit";
      apply: (timeline: Timeline) => Timeline;

      coalesce?: { key: string; windowMs: number | null };

      selection?: Selection | null;
      now: number;
    }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; selection: Selection | null }

  | { type: "endCoalesce" }
  | { type: "saveStart"; revision: number }

  | { type: "saveOk"; revision: number; version: string; timeline: Timeline }
  | { type: "saveFailed"; revision: number; problem: SaveProblem }

  | { type: "conflict"; current: TimelineSaved }
  | { type: "keepMine" }
  | { type: "clearProblem" };

export const initialEditorState: EditorState = {
  timeline: null,
  version: null,
  selection: null,
  past: [],
  future: [],
  coalesce: null,
  revision: 0,
  savedTimeline: null,
  overwrite: false,
  savingRevision: null,
  problem: null,
};

export const isDirty = (s: EditorState): boolean =>
  s.timeline !== null && s.timeline !== s.savedTimeline;

function settle(s: EditorState): EditorState {
  if (s.problem && s.problem.kind !== "conflict" && !isDirty(s)) return { ...s, problem: null };
  return s;
}

const keepSelection = (timeline: Timeline, sel: Selection | null): Selection | null =>
  sel && selectionExists(timeline, sel) ? sel : null;

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "loaded": {

      return {
        ...state,
        timeline: action.timeline,
        version: action.version,
        selection: keepSelection(action.timeline, state.selection),
        past: [],
        future: [],
        coalesce: null,
        savedTimeline: action.timeline,
        overwrite: false,
        problem: null,
      };
    }

    case "edit": {
      const current = state.timeline;
      if (!current) return state;
      let next: Timeline;
      try {
        next = action.apply(current);
      } catch (err) {

        console.error("[editor] thao tác sửa lỗi, bỏ qua:", err);
        return state;
      }
      const selection =
        action.selection === undefined
          ? keepSelection(next, state.selection)
          : action.selection;
      if (next === current) {
        return sameSelection(selection, state.selection) ? state : { ...state, selection };
      }
      const c = action.coalesce;
      const merge =
        c !== undefined &&
        state.coalesce !== null &&
        state.coalesce.key === c.key &&
        (c.windowMs === null || action.now - state.coalesce.at <= c.windowMs);
      const past = merge
        ? state.past
        : [...state.past, { timeline: current, selection: state.selection }].slice(-HISTORY_LIMIT);
      return settle({
        ...state,
        timeline: next,
        selection,
        past,
        future: [],
        coalesce: c ? { key: c.key, at: action.now, windowMs: c.windowMs } : null,
        revision: state.revision + 1,
      });
    }

    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev || !state.timeline) return state;
      return settle({
        ...state,
        timeline: prev.timeline,
        selection: keepSelection(prev.timeline, prev.selection),
        past: state.past.slice(0, -1),
        future: [{ timeline: state.timeline, selection: state.selection }, ...state.future],
        coalesce: null,
        revision: state.revision + 1,
      });
    }

    case "redo": {
      const next = state.future[0];
      if (!next || !state.timeline) return state;
      return settle({
        ...state,
        timeline: next.timeline,
        selection: keepSelection(next.timeline, next.selection),
        past: [...state.past, { timeline: state.timeline, selection: state.selection }],
        future: state.future.slice(1),
        coalesce: null,
        revision: state.revision + 1,
      });
    }

    case "select":
      return sameSelection(action.selection, state.selection)
        ? state
        : { ...state, selection: action.selection, coalesce: null };

    case "endCoalesce":
      return state.coalesce ? { ...state, coalesce: null } : state;

    case "saveStart":
      return { ...state, savingRevision: action.revision };

    case "saveOk":
      return {
        ...state,
        version: action.version,
        savedTimeline: action.timeline,
        overwrite: false,
        savingRevision: null,
        problem: null,
      };

    case "saveFailed":
      return {
        ...state,
        savingRevision: null,
        problem: { ...action.problem, revision: action.revision },
      };

    case "conflict":
      return {
        ...state,
        savingRevision: null,
        problem: { kind: "conflict", current: action.current, revision: state.revision },
      };

    case "keepMine": {

      if (state.problem?.kind !== "conflict") return state;
      return {
        ...state,
        version: state.problem.current.version,
        problem: null,

        savedTimeline: null,
        overwrite: true,
        revision: state.revision + 1,
      };
    }

    case "clearProblem":
      return state.problem ? { ...state, problem: null } : state;
  }
}

export function changedKeysPatch(tl: Timeline, saved: Timeline | null): TimelinePatch {
  const patch: TimelinePatch = {};
  if (!saved || tl.scenes !== saved.scenes) patch.scenes = tl.scenes;
  if (!saved || tl.audio !== saved.audio) patch.audio = tl.audio;
  if (!saved || tl.captions !== saved.captions) patch.captions = tl.captions;
  if (!saved || tl.subtitles !== saved.subtitles) patch.subtitles = tl.subtitles;
  if (!saved || tl.overlays !== saved.overlays) patch.overlays = tl.overlays;
  if (!saved || tl.subtitleStyle !== saved.subtitleStyle) patch.subtitleStyle = tl.subtitleStyle ?? null;

  if (saved ? tl.layers !== saved.layers : tl.layers !== undefined) {
    patch.layers = tl.layers && tl.layers.length > 0 ? tl.layers : null;
  }
  return patch;
}

export interface DragSession {
  origin: Timeline;
  produced: WeakSet<Timeline>;
}

export const dragOwns = (drag: DragSession, tl: Timeline): boolean =>
  tl === drag.origin || drag.produced.has(tl);

export function dragStep(drag: DragSession, next: Timeline): (tl: Timeline) => Timeline {
  drag.produced.add(next);
  return (tl) => (dragOwns(drag, tl) ? next : tl);
}
