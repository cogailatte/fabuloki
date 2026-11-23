"use client";

import type { ReactNode } from "react";
import type { JobStatus, ProjectStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

export type BadgeTone = "success" | "running" | "danger" | "muted";

const JOB_LABEL: Record<JobStatus, string> = {
  queued: "badge.job.queued",
  running: "badge.job.running",
  done: "badge.job.done",
  failed: "badge.job.failed",
  canceled: "badge.job.canceled",
};

const JOB_TONE: Record<JobStatus, BadgeTone> = {
  queued: "muted",
  running: "running",
  done: "success",
  failed: "danger",
  canceled: "muted",
};

const PROJECT_LABEL: Record<ProjectStatus, string> = {
  draft: "badge.project.draft",
  rendering: "badge.project.rendering",
  done: "badge.project.done",
};

const PROJECT_TONE: Record<ProjectStatus, BadgeTone> = {
  draft: "muted",
  rendering: "running",
  done: "success",
};

export function Badge({
  tone,
  label,
  dot = true,
  className = "",
}: {
  tone: BadgeTone;
  label: ReactNode;

  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <span className="badge-dot" />}
      {label}
    </span>
  );
}

export function JobBadge({ status }: { status: JobStatus }) {
  const { t } = useT();
  return <Badge tone={JOB_TONE[status]} label={t(JOB_LABEL[status])} />;
}

export function ProjectBadge({ status }: { status: ProjectStatus }) {
  const { t } = useT();
  const tone = PROJECT_TONE[status] ?? "muted";
  const label = PROJECT_LABEL[status]
    ? t(PROJECT_LABEL[status])
    : String(status);
  return <Badge tone={tone} label={label} />;
}
