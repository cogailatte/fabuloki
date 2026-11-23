"use client";

import { Bot, Film, Image as ImageIcon, Sparkles, Type, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { Segmented } from "@/components/Segmented";
import {
  ApiError,
  generateProjectImage,
  generateProjectText,
  getGenerateImageTask,
  type Timeline,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAiImageErrorText } from "./AiImagePanel";
import { captionWordsOf } from "./ops";
import { formatSeconds } from "./timing";

export type TimelineAiMode = "layer" | "filler" | "text" | "chat";
export type TimelineAiJobMode = Exclude<TimelineAiMode, "chat">;

export interface TimelineAiAnchor {
  frame: number;
  clientX: number;
  clientY: number;
}

export interface TimelineAiJob {
  id: number;
  mode: TimelineAiJobMode;
  frame: number;
  prompt: string;
  status: "running" | "failed";
  startedAt: number;

  taskId?: string;
  error?: { message: string; detail?: string };
}

const POLL_MS = 2000;
const PROMPT_MAX = 1000;

const CONTEXT_SEC = 5;

let lastMode: TimelineAiMode = "layer";
const MODES: readonly TimelineAiMode[] = ["layer", "filler", "text", "chat"];
const NO_MODES: ReadonlySet<TimelineAiMode> = new Set();

export function spokenContextAt(timeline: Timeline, frame: number, fps: number): string {
  const lo = frame - CONTEXT_SEC * fps;
  const hi = frame + CONTEXT_SEC * fps;
  const near = (c: { from?: unknown; durationInFrames?: unknown } | null | undefined): boolean => {
    if (!c || typeof c.from !== "number" || typeof c.durationInFrames !== "number") return false;
    return c.from < hi && c.from + c.durationInFrames > lo;
  };
  const fromCaptions = (Array.isArray(timeline.captions) ? timeline.captions : [])
    .filter(near)
    .map((c) => (captionWordsOf(c) ?? []).map((w) => (typeof w?.text === "string" ? w.text : "")).join(" ").trim())
    .filter(Boolean);
  if (fromCaptions.length > 0) return fromCaptions.join("\n");
  return (Array.isArray(timeline.subtitles) ? timeline.subtitles : [])
    .filter(near)
    .map((c) => (typeof c.text === "string" ? c.text.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

export function useTimelineAiJobs({
  projectId,
  onImageReady,
  onTextReady,
}: {
  projectId: string;
  onImageReady: (job: TimelineAiJob, relPath: string) => void;
  onTextReady: (job: TimelineAiJob, text: string) => void;
}) {
  const { t } = useT();
  const imageErrorText = useAiImageErrorText();
  const [jobs, setJobs] = useState<TimelineAiJob[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const seq = useRef(0);

  const cbRef = useRef({ onImageReady, onTextReady, imageErrorText, t });
  cbRef.current = { onImageReady, onTextReady, imageErrorText, t };

  const remove = useCallback((id: number) => setJobs((cur) => cur.filter((j) => j.id !== id)), []);
  const fail = useCallback((id: number, error: { message: string; detail?: string }) => {
    setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, status: "failed", error } : j)));
  }, []);
  const patch = useCallback((id: number, p: Partial<TimelineAiJob>) => {
    setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }, []);

  const start = useCallback(
    async (mode: TimelineAiJobMode, prompt: string, frame: number, ctx: { atSec: number; context: string }) => {
      seq.current += 1;
      const job: TimelineAiJob = { id: seq.current, mode, frame, prompt, status: "running", startedAt: Date.now() };
      setJobs((cur) => [...cur, job]);
      const { imageErrorText: errText, t: tr } = cbRef.current;
      if (mode === "text") {
        try {
          const { text } = await generateProjectText(projectId, {
            prompt,
            atSec: ctx.atSec,
            ...(ctx.context ? { context: ctx.context } : {}),
          });

          if (!jobsRef.current.some((j) => j.id === job.id)) return;
          remove(job.id);
          cbRef.current.onTextReady(job, text);
        } catch (err) {
          const code = err instanceof ApiError ? err.code : "network";
          fail(job.id, {
            message: code === "NO_CLAUDE_AUTH" ? tr("editor.tlai.err-no-claude") : tr("editor.tlai.err-text"),
            detail: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      try {
        const { taskId } = await generateProjectImage(projectId, {
          prompt,
          provider: "auto",
          purpose: mode === "filler" ? "filler" : "layer",
        });
        patch(job.id, { taskId });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : "network";
        fail(job.id, { message: errText(code), detail: err instanceof Error ? err.message : String(err) });
      }
    },
    [fail, patch, projectId, remove],
  );

  const polling = jobs.some((j) => j.status === "running" && j.taskId);
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const inflight = new Set<number>();
    const netFails = new Map<number, number>();
    const tick = () => {
      for (const job of jobsRef.current) {
        const taskId = job.taskId;
        if (job.status !== "running" || !taskId || inflight.has(job.id)) continue;
        inflight.add(job.id);
        getGenerateImageTask(projectId, taskId)
          .then((task) => {
            if (stopped) return;
            netFails.delete(job.id);
            const { imageErrorText: errText } = cbRef.current;
            if (task.status === "done" && task.relPath) {
              remove(job.id);
              cbRef.current.onImageReady(job, task.relPath);
            } else if (task.status === "failed" || task.status === "done") {
              const code = task.error?.code ?? "GATEWAY_FAILED";
              fail(job.id, { message: errText(code), detail: task.error?.message });
            }
          })
          .catch((err: unknown) => {
            if (stopped) return;
            const { imageErrorText: errText } = cbRef.current;

            if (err instanceof ApiError && err.status === 404) {
              fail(job.id, { message: errText("lost"), detail: err.message });
              return;
            }
            const n = (netFails.get(job.id) ?? 0) + 1;
            netFails.set(job.id, n);
            if (n >= 5) {
              fail(job.id, {
                message: errText(err instanceof ApiError ? err.code : "network"),
                detail: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .finally(() => inflight.delete(job.id));
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [polling, projectId, fail, remove]);

  return { jobs, start, dismiss: remove };
}

const POPOVER_W = 340;
const GUTTER = 16;

export function TimelineAiPopover({
  anchor,
  fps,
  readOnly,
  lockedModes = NO_MODES,
  onClose,
  onSubmit,
}: {
  anchor: TimelineAiAnchor;
  fps: number;
  readOnly: boolean;

  lockedModes?: ReadonlySet<TimelineAiMode>;
  onClose: () => void;
  onSubmit: (mode: TimelineAiMode, prompt: string) => void;
}) {
  const { t, tf } = useT();
  const [mode, setMode] = useState<TimelineAiMode>(() =>
    lockedModes.has(lastMode) ? (MODES.find((m) => !lockedModes.has(m)) ?? "chat") : lastMode,
  );
  const [prompt, setPrompt] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const [viewportTick, setViewportTick] = useState(0);
  useEffect(() => {
    const onResize = () => setViewportTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(GUTTER, Math.min(anchor.clientX - 24, vw - POPOVER_W - GUTTER));
    const above = anchor.clientY - h - 8;
    const below = anchor.clientY + 8;
    const top = above >= GUTTER ? above : Math.max(GUTTER, Math.min(below, vh - h - GUTTER));
    setPos({ left, top });
  }, [anchor, mode, viewportTick]);

  const shown = pos !== null;
  useEffect(() => {
    if (shown) inputRef.current?.focus();
  }, [shown]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const pick = (next: TimelineAiMode) => {
    lastMode = next;
    setMode(next);
    inputRef.current?.focus();
  };

  const locked = lockedModes.has(mode);
  const blocked = (readOnly && mode !== "chat") || locked;
  const tooLong = prompt.length > PROMPT_MAX;
  const canSubmit = prompt.trim() !== "" && !tooLong && !blocked;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(mode, prompt.trim());
  };

  const time = formatSeconds(anchor.frame, fps);
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={tf("editor.tlai.title", { time })}
      className="editor-menu tl-ai-popover"
      style={{
        width: POPOVER_W,
        left: pos?.left ?? anchor.clientX,
        top: pos?.top ?? anchor.clientY,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Sparkles size={14} strokeWidth={2} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <span className="truncate">{tf("editor.tlai.title", { time })}</span>
        </span>
        <IconButton label={t("common.close")} size="sm" onClick={onClose}>
          <X size={14} strokeWidth={2} />
        </IconButton>
      </div>
      <Segmented
        label={t("editor.tlai.mode")}
        value={mode}
        onChange={pick}
        options={[
          { value: "layer", label: <ModeLabel icon={ImageIcon} text={t("editor.tlai.mode-layer")} />, title: t("editor.tlai.hint-layer"), disabled: lockedModes.has("layer") },
          { value: "filler", label: <ModeLabel icon={Film} text={t("editor.tlai.mode-filler")} />, title: t("editor.tlai.hint-filler"), disabled: lockedModes.has("filler") },
          { value: "text", label: <ModeLabel icon={Type} text={t("editor.tlai.mode-text")} />, title: t("editor.tlai.hint-text"), disabled: lockedModes.has("text") },
          { value: "chat", label: <ModeLabel icon={Bot} text={t("editor.tlai.mode-chat")} />, title: t("editor.tlai.hint-chat") },
        ]}
      />
      <p className="text-meta text-[var(--text-muted)]">{t(`editor.tlai.hint-${mode}`)}</p>
      <Field
        label={t("editor.tlai.prompt")}
        htmlFor="tl-ai-prompt"
        error={tooLong ? tf("editor.ai.prompt-too-long", { n: PROMPT_MAX }) : null}
      >
        <textarea
          ref={inputRef}
          id="tl-ai-prompt"
          className="input"
          rows={3}
          value={prompt}
          placeholder={t(`editor.tlai.placeholder-${mode}`)}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
      {readOnly && mode !== "chat" && <Banner tone="muted" message={t("editor.tlai.readonly")} />}
      {locked && !readOnly && <Banner tone="muted" message={t("editor.tlai.locked")} />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta text-[var(--text-muted)]">{t("editor.tlai.enter-hint")}</span>
        <Button small disabled={!canSubmit} onClick={submit}>
          <Sparkles size={14} strokeWidth={2} />
          {mode === "chat" ? t("editor.tlai.submit-chat") : t("editor.tlai.submit")}
        </Button>
      </div>
    </div>
  );
}

function ModeLabel({ icon: Icon, text }: { icon: typeof ImageIcon; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {text}
    </span>
  );
}

export function useJobLabel(): (job: TimelineAiJob) => string {
  const { t, tf } = useT();
  return (job) => {
    const what = jobWhat(t, job);
    return job.status === "failed"
      ? tf("editor.tlai.mark-failed", { what, prompt: job.prompt })
      : tf("editor.tlai.mark-running", { what, prompt: job.prompt });
  };
}

export function jobWhat(t: (key: string) => string, job: TimelineAiJob): string {
  return t(`editor.tlai.mode-${job.mode}`).toLocaleLowerCase();
}
