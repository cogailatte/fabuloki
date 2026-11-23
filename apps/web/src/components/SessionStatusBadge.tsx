"use client";

import type { ChatSessionStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

const LABEL: Record<ChatSessionStatus, string> = {
  idle: "badge.session.idle",
  running: "badge.session.running",
  done: "badge.session.done",
  error: "badge.session.error",
  interrupted: "badge.session.interrupted",
};

const TONE: Record<ChatSessionStatus, string> = {
  idle: "badge-muted",
  running: "badge-running",
  done: "badge-success",
  error: "badge-danger",
  interrupted: "badge-muted",
};

export function sessionStatusLabel(
  status: ChatSessionStatus,
  t: (key: string) => string
): string {
  return LABEL[status] ? t(LABEL[status]) : String(status);
}

export function SessionStatusBadge({
  status,
  large = false,
}: {
  status: ChatSessionStatus;
  large?: boolean;
}) {
  const { t } = useT();
  const tone = TONE[status] ?? "badge-muted";
  return (
    <span
      className={`badge ${tone} ${large ? "px-3 py-1 text-meta" : ""}`}
    >
      <span
        className={`badge-dot ${status === "running" ? "badge-dot-pulse" : ""}`}
      />
      {sessionStatusLabel(status, t)}
    </span>
  );
}
