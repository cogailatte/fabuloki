"use client";

import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Download,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ProgressBar } from "@/components/ProgressBar";
import { useT } from "@/lib/i18n";

export type WorkspaceStatus = "idle" | "running" | "done" | "failed";

export type WorkspaceRole = "source" | "setup" | "output";

export function Workspace({
  children,
  ariaLabel,
  className = "",
}: {

  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const { t } = useT();
  return (

    <div className={`workspace ${className}`}>
      <div
        className="workspace-grid"
        role="group"
        aria-label={ariaLabel ?? t("workspace.aria")}
      >
        {children}
      </div>
    </div>
  );
}

export function WorkspaceColumn({
  role,
  title,
  ariaLabel,
  actions,
  children,
  className = "",
}: {
  role: WorkspaceRole;

  title?: ReactNode;

  ariaLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useT();
  return (
    <section
      className={`workspace-col workspace-col-${role} flex min-w-0 flex-col gap-4 ${className}`}
      aria-label={ariaLabel ?? t(`workspace.col.${role}`)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && <h2 className="workspace-col-title min-w-0">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export interface WorkspaceBlockProps {

  id: string;
  title: ReactNode;

  hint?: { titleKey: string; bodyKey: string };

  summary?: ReactNode;
  icon?: LucideIcon;

  actions?: ReactNode;

  collapsed?: boolean;

  defaultCollapsed?: boolean;

  onToggle?: (collapsed: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function WorkspaceBlock({
  id,
  title,
  hint,
  summary,
  icon: Icon,
  actions,
  collapsed,
  defaultCollapsed = false,
  onToggle,
  children,
  className = "",
}: WorkspaceBlockProps) {
  const { t } = useT();
  const [internal, setInternal] = useState(defaultCollapsed);
  const controlled = collapsed !== undefined;
  const isCollapsed = controlled ? collapsed : internal;

  function toggle() {
    const next = !isCollapsed;
    if (!controlled) setInternal(next);
    onToggle?.(next);
  }

  const label = isCollapsed
    ? t("workspace.block.expand")
    : t("workspace.block.collapse");

  return (
    <Card
      className={className}
      hint={hint}
      title={
        <span className="inline-flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon
              size={15}
              strokeWidth={1.75}
              className="shrink-0 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0">{title}</span>
        </span>
      }
      actions={

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">

          {!isCollapsed && actions}
          <Button
            variant="secondary"
            small
            onClick={toggle}
            aria-expanded={!isCollapsed}
            aria-controls={id}
          >
            {isCollapsed ? (
              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {label}
          </Button>
        </div>
      }
    >
      {isCollapsed && summary != null && (
        <p className="truncate text-meta text-[var(--text-muted)]">{summary}</p>
      )}

      <div id={id} hidden={isCollapsed}>
        {children}
      </div>
    </Card>
  );
}

export interface OutputBlockProps {
  status: WorkspaceStatus;

  videoUrl?: string | null;

  posterUrl?: string | null;

  progress?: number | null;

  step?: string;

  aspect?: string;
  error?: string | null;
  title?: ReactNode;

  hint?: { titleKey: string; bodyKey: string };
  summary?: ReactNode;
  actions?: ReactNode;

  children?: ReactNode;
  id?: string;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onToggle?: (collapsed: boolean) => void;
}

export function OutputBlock({
  status,
  videoUrl,
  posterUrl,
  progress,
  step,
  aspect = "16 / 9",
  error,
  title,
  hint,
  summary,
  actions,
  children,
  id = "workspace-output",
  collapsed,
  defaultCollapsed = false,
  onToggle,
}: OutputBlockProps) {
  const { t } = useT();

  const statusText =
    status === "running"
      ? t("workspace.output.running")
      : status === "done"
        ? videoUrl
          ? t("workspace.output.done")
          : t("workspace.output.no-video")
        : status === "failed"
          ? t("workspace.output.failed")
          : t("workspace.output.idle");

  return (
    <WorkspaceBlock
      id={id}
      icon={Clapperboard}
      title={title ?? t("workspace.output.title")}
      hint={hint}
      summary={summary ?? statusText}
      collapsed={collapsed}
      defaultCollapsed={defaultCollapsed}
      onToggle={onToggle}
      actions={actions}
    >
      <div className="flex flex-col gap-3">
        <div
          className="workspace-media"

          style={{ "--workspace-aspect": aspect } as CSSProperties}
        >
          {status === "done" && videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              poster={posterUrl ?? undefined}
              controls
              preload="metadata"
              className="workspace-video"
            />
          ) : status === "running" ? (
            <>
              <span className="workspace-shimmer" aria-hidden="true" />
              <div
                className="relative flex flex-col items-center gap-2 px-4 text-center"
                role="status"
                aria-live="polite"
              >
                <Loader2
                  size={22}
                  strokeWidth={1.75}
                  className="animate-spin text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <p className="text-sm text-[var(--text-muted)]">
                  {step ? `${statusText} · ${step}` : statusText}
                </p>
              </div>
            </>
          ) : status === "failed" ? (
            <EmptyState
              icon={TriangleAlert}
              description={error || t("workspace.output.failed")}
            />
          ) : (
            <EmptyState
              icon={Clapperboard}
              description={
                status === "done" ? t("workspace.output.no-video") : t("workspace.output.idle")
              }
            />
          )}
        </div>

        {status === "running" &&
          (progress == null ? (
            <div
              className="progress-indeterminate"
              role="progressbar"
              aria-label={statusText}
            />
          ) : (
            <ProgressBar progress={progress} step={step} />
          ))}

        {status === "done" && videoUrl && (
          <a
            href={videoUrl}
            download
            className="inline-flex w-fit items-center gap-2 text-meta text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]"
          >
            <Download size={14} strokeWidth={2} aria-hidden="true" />
            {t("workspace.output.download")}
          </a>
        )}

        {children}
      </div>
    </WorkspaceBlock>
  );
}

export { useCollapseGroup } from "@/lib/useCollapsible";
export type { CollapseGroup } from "@/lib/useCollapsible";
