

import type {
  Timeline,
  TimelineAudio,
  TimelineCaptionCue,
  TimelineCaptionWord,
  TimelineHighlightCue,
  TimelineHighlightPart,
  TimelineMediaInfo,
  TimelineMusic,
  TimelinePreview,
  TimelineProject,
  TimelineScene,
  TimelineSfx,
  TimelineSubtitleCue,
  TimelineSubtitleStyle,
  TimelineZoom,
} from "@/lib/api";

export type EditorScene = TimelineScene;
export type EditorZoom = TimelineZoom;
export type EditorSfx = TimelineSfx;
export type EditorMusic = TimelineMusic;
export type EditorCaptionWord = TimelineCaptionWord;
export type EditorCaptionCue = TimelineCaptionCue;
export type EditorSubtitleCue = TimelineSubtitleCue;
export type EditorSubtitleStyle = TimelineSubtitleStyle;
export type EditorHighlightPart = TimelineHighlightPart;
export type EditorHighlightCue = TimelineHighlightCue;
export type EditorAudio = TimelineAudio;

export type EditorTimeline = Timeline;

export type EditorLayer = NonNullable<Timeline["layers"]>[number];

export type EditorProjectInfo = TimelineProject;

export type EditorMediaInfo = TimelineMediaInfo;

export type EditorPreview = TimelinePreview;
