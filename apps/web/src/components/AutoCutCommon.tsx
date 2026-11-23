"use client";

import { Badge } from "@/components/Badge";
import {
  AUTO_CUT_SIZES,
  type AutoCutAspect,
  type AutoCutBackground,
  type AutoCutLayout,
  type AutoCutMode,
  type AutoCutStatus,
} from "@/lib/api";
import { clock } from "@/lib/format";
import { useT } from "@/lib/i18n";

export { clock };

export function duration(sec: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  return total < 60 ? `${total}s` : clock(total);
}

export const MODE_LABEL: Record<AutoCutMode, string> = {
  time: "autocut.mode.time",
  ai: "autocut.mode.ai",
  prompt: "autocut.mode.prompt",
};

export const MODE_DESC: Record<AutoCutMode, string> = {
  time: "autocut.mode.time-desc",
  ai: "autocut.mode.ai-desc",
  prompt: "autocut.mode.prompt-desc",
};

export const LAYOUT_LABEL: Record<AutoCutLayout, string> = {
  auto: "autocut.layout.auto",
  crop: "autocut.layout.crop",
  fit: "autocut.layout.fit",
};

export const LAYOUT_DESC: Record<AutoCutLayout, string> = {
  auto: "autocut.layout.auto-desc",
  crop: "autocut.layout.crop-desc",
  fit: "autocut.layout.fit-desc",
};

export const BACKGROUND_LABEL: Record<AutoCutBackground, string> = {
  gemini: "autocut.bg.gemini",
  blur: "autocut.bg.blur",
  style: "autocut.bg.style",
};

export const BACKGROUND_DESC: Record<AutoCutBackground, string> = {
  gemini: "autocut.bg.gemini-desc",
  blur: "autocut.bg.blur-desc",
  style: "autocut.bg.style-desc",
};

const STATUS_LABEL: Record<AutoCutStatus, string> = {
  draft: "autocut.status.draft",
  planning: "autocut.status.planning",
  planned: "autocut.status.planned",
  cutting: "autocut.status.cutting",
  done: "autocut.status.done",
  failed: "autocut.status.failed",
};

const STATUS_TONE: Record<
  AutoCutStatus,
  "success" | "running" | "danger" | "muted"
> = {
  draft: "muted",
  planning: "running",
  planned: "muted",
  cutting: "running",
  done: "success",
  failed: "danger",
};

export function AutoCutStatusBadge({ status }: { status: AutoCutStatus }) {
  const { t } = useT();
  const tone = STATUS_TONE[status] ?? "muted";

  const label = STATUS_LABEL[status]
    ? t(STATUS_LABEL[status])
    : t("common.status-unknown");
  return <Badge tone={tone} label={label} />;
}

export function aspectLabel(
  aspect: AutoCutAspect,
  t: (key: string) => string
): string {
  return aspect === "keep" ? t("autocut.aspect.keep") : aspect;
}

export function aspectSize(
  aspect: AutoCutAspect
): { width: number; height: number } | null {
  return aspect === "keep" ? null : AUTO_CUT_SIZES[aspect];
}
