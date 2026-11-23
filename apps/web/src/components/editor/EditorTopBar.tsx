"use client";

import {
  ArrowLeft,
  Film,
  MoreHorizontal,
  Play,
  Redo2,
  RefreshCw,
  Sparkles,
  Undo2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { LinkButton } from "@/components/LinkButton";
import { ProgressBar } from "@/components/ProgressBar";
import { mediaUrl, type Job } from "@/lib/api";
import { useT } from "@/lib/i18n";

export type SaveState = "saved" | "saving" | "unsaved" | "error" | "conflict" | "invalid" | "readonly";

export interface EditorMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;

  hint?: string;
}

export interface EditorAiReview {

  onKeep: () => void;

  onUndo: () => void;
  onHistory: () => void;

  busy?: boolean;
}

const SAVE_TONE: Record<SaveState, BadgeTone> = {
  saved: "success",
  saving: "running",
  unsaved: "muted",
  error: "danger",
  conflict: "danger",
  invalid: "danger",
  readonly: "muted",
};

export function EditorTopBar({
  projectId,
  name,
  subtitle,
  saveState,
  onRetrySave,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  activeJob,
  activeCount,
  lastOutput,
  renderBusy,
  renderDisabled,
  onRender,
  menuItems,
  onHandoff,
  handoffDisabled = false,
  onExport,
  aiReview,
}: {
  projectId: string;
  name: string;
  subtitle: string;
  saveState: SaveState;
  onRetrySave: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  activeJob: Job | null;

  activeCount: number;

  lastOutput: Job | null;
  renderBusy: boolean;
  renderDisabled: boolean;
  onRender: (quality: "draft" | "final") => void;
  menuItems: EditorMenuItem[];

  onHandoff?: () => void;

  handoffDisabled?: boolean;

  onExport?: () => void;
  aiReview?: EditorAiReview | null;
}) {
  const { t, tf } = useT();
  const saveLabel: Record<SaveState, string> = {
    saved: t("editor.save.saved"),
    saving: t("editor.save.saving"),
    unsaved: t("editor.save.unsaved"),
    error: t("editor.save.error"),
    conflict: t("editor.save.conflict"),
    invalid: t("editor.save.invalid"),
    readonly: t("editor.save.readonly"),
  };

  const jobLabel = (job: Job): string => {
    switch (job.type) {
      case "scene-draft":
        return tf("editor.render.job-scene-draft", { id: job.sceneId ?? "" });
      case "scene-final":
        return tf("editor.render.job-scene-final", { id: job.sceneId ?? "" });
      case "assemble-final":
        return t("editor.render.job-assemble-final");
      default:
        return t("editor.render.job-assemble-draft");
    }
  };

  return (
    <>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <LinkButton
          href={`/projects/${encodeURIComponent(projectId)}`}
          small
          aria-label={t("editor.back")}
          title={t("editor.back")}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          <span className="hidden sm:inline">{t("editor.back-short")}</span>
        </LinkButton>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold" title={name}>
            {name}
          </h1>
          <p className="truncate text-meta text-[var(--text-muted)]">{subtitle}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1" aria-live="polite">
          <Badge tone={SAVE_TONE[saveState]} label={saveLabel[saveState]} />
          {saveState === "error" && (
            <IconButton label={t("editor.save.retry")} size="sm" onClick={onRetrySave}>
              <RefreshCw size={13} strokeWidth={2} />
            </IconButton>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <IconButton label={t("editor.undo")} disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t("editor.redo")} disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      {activeJob ? (
        <div className="flex w-56 min-w-0 flex-col gap-1">
          <span className="truncate text-meta text-[var(--text-muted)]">
            {activeCount > 1
              ? tf("editor.render.active-n", { label: jobLabel(activeJob), n: activeCount })
              : jobLabel(activeJob)}
          </span>
          {activeJob.status === "running" ? (
            <ProgressBar progress={activeJob.progress} />
          ) : (
            <div className="progress-indeterminate" aria-label={t("editor.render.queued")} />
          )}
        </div>
      ) : (
        lastOutput?.outputPath && (
          <LinkButton href={mediaUrl(lastOutput.outputPath)} external small>
            <Film size={14} strokeWidth={2} />
            {lastOutput.type === "assemble-final"
              ? t("editor.render.open-final")
              : t("editor.render.open-draft")}
          </LinkButton>
        )
      )}

      <div className="flex items-center gap-2">
        {onHandoff && (
          <Button
            variant="secondary"
            small
            disabled={handoffDisabled}
            onClick={onHandoff}
            title={t("editor.handoff.button-hint")}
          >
            <Sparkles size={14} strokeWidth={2} />
            {t("editor.handoff.button")}
          </Button>
        )}
        <Button
          variant="secondary"
          small
          disabled={renderBusy || renderDisabled}
          onClick={() => onRender("draft")}
          title={t("editor.render.draft-hint")}
        >
          <Play size={14} strokeWidth={2} />
          {t("editor.render.draft")}
        </Button>
        <Button
          small
          disabled={renderBusy || renderDisabled}
          onClick={() => (onExport ? onExport() : onRender("final"))}
          title={t("editor.review.export-hint")}
        >
          <Upload size={14} strokeWidth={2} />
          {t("editor.review.export")}
        </Button>
        <EditorMenu items={menuItems} />
      </div>
    </div>
    {aiReview && (
      <Banner
        tone="success"
        message={t("editor.review.title")}
        actions={
          <>
            <Button small disabled={aiReview.busy} onClick={aiReview.onKeep}>
              {t("editor.review.keep")}
            </Button>
            <Button variant="secondary" small disabled={aiReview.busy} onClick={aiReview.onUndo}>
              <Undo2 size={14} strokeWidth={2} />
              {aiReview.busy ? t("editor.review.undoing") : t("editor.review.undo")}
            </Button>
            <Button variant="secondary" small disabled={aiReview.busy} onClick={aiReview.onHistory}>
              {t("editor.review.history")}
            </Button>
          </>
        }
      >
        <p className="mt-1 text-meta text-[var(--text-muted)]">{t("editor.review.body")}</p>
      </Banner>
    )}
    </>
  );
}

function EditorMenu({ items }: { items: EditorMenuItem[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTrigger = () =>
    rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus();

  const menuItems = (): HTMLButtonElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => {
    if (!open) return;

    menuItems()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      focusTrigger();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = menuItems();
    if (list.length === 0) return;
    const i = list.findIndex((el) => el === document.activeElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (i + 1) % list.length;
    else if (e.key === "ArrowUp") next = i <= 0 ? list.length - 1 : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next === null) return;

    e.preventDefault();
    e.stopPropagation();
    list[next].focus();
  };

  if (items.length === 0) return null;
  return (
    <div ref={rootRef} className="relative">
      <IconButton
        label={t("editor.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} />
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("editor.menu")}
          className="editor-menu"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="editor-menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <item.icon size={14} strokeWidth={2} className="mt-0.5 shrink-0 self-start text-[var(--text-muted)]" />
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                {item.hint && <span className="block text-meta text-[var(--text-muted)]">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
