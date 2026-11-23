

export const GUIDE_IDS = [
  "overview",
  "dashboard",
  "projects",
  "project-detail",
  "editor",
  "images",
  "auto-cut",
  "text-to-video",
  "translate-video",
  "voices",
  "styles",
  "video-styles",
  "assets",
  "sfx",
  "prompts",
  "skills",
  "queue",
  "config",
  "connections",
  "phone-upload",
  "troubleshooting",
] as const;

export type GuideId = (typeof GUIDE_IDS)[number];

export interface GuideBlock {
  heading?: string;
  paragraphs?: string[];

  steps?: string[];
  bullets?: string[];

  tip?: string;

  warning?: string;
}

export interface GuideSection {
  title: string;

  summary: string;
  blocks: GuideBlock[];
}

export type GuideContent = Record<GuideId, GuideSection>;
