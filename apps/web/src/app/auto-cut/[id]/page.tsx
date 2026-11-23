"use client";


import {
  ArrowLeft,
  Clapperboard,
  ExternalLink,
  FileText,
  FileVideo,
  Loader2,
  RefreshCw,
  Scissors,
  ScrollText,
  Settings2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cutAutoCut,
  deleteAutoCut,
  getAutoCutSession,
  getJob,
  getJobs,
  isAutoCutJob,
  mediaUrl,
  planAutoCut,
  updateAutoCut,
  type AutoCutMeta,
  type AutoCutSegment,
  type AutoCutSegmentPatch,
  type Brief,
  type Job,
} from "@/lib/api";
import { useEvents, useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { StepperBar } from "@/components/PipelineTimeline";
import { ProgressBar } from "@/components/ProgressBar";
import { ShellRightPanel } from "@/components/Shell";
import { Skeleton } from "@/components/Skeleton";
import {
  OutputBlock,
  useCollapseGroup,
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
} from "@/components/Workspace";
import {
  AutoCutStatusBadge,
  BACKGROUND_LABEL,
  LAYOUT_LABEL,
  MODE_LABEL,
  aspectLabel,
  duration,
} from "@/components/AutoCutCommon";
import { BriefFields, DEFAULT_BRIEF } from "@/components/BriefFields";
import { clock, formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

const PATCH_DEBOUNCE_MS = 700;

const AC_BLOCKS = ["source", "config", "brief", "plan", "result"] as const;
type BlockKey = (typeof AC_BLOCKS)[number];

const AC_KEEP_EXPANDED: readonly BlockKey[] = ["result"];

const AC_STAGES = [
  "autocut.stage.source",
  "autocut.stage.plan",
  "autocut.stage.review",
  "autocut.stage.cut",
  "autocut.stage.done",
] as const;

function acStage(session: AutoCutMeta): { stage: number; active: boolean } {
  switch (session.status) {
    case "planning":
      return { stage: 2, active: true };
    case "planned":
      return { stage: 3, active: false };
    case "cutting":
      return { stage: 4, active: true };
    case "done":
      return { stage: 5, active: false };
    case "failed":
      return { stage: session.failedStep === "cut" ? 4 : 2, active: false };
    default:
      return { stage: 1, active: false };
  }
}

function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

function JobLogBlock({ job }: { job: Job }) {
  const { t } = useT();
  const jobId = job.id;
  const { resyncTick } = useEvents();
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    setLog("");
    setError(null);
    getJob(jobId)
      .then((j) => {
        if (!alive) return;
        const fetched = j.log ?? "";
        setLog((prev) => {
          if (!prev) return fetched;
          if (!fetched) return prev;
          if (fetched === prev || fetched.endsWith(prev)) return fetched;
          return `${fetched}\n${prev}`;
        });
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [jobId, resyncTick]);

  useJobLogEvents((e) => {
    if (e.jobId !== jobId) return;
    setLog((prev) => (prev ? `${prev}\n${e.line}` : e.line));
  });

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div className="card flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold">{t("autocut.job")}</span>
        <span className="shrink-0 text-meta text-[var(--text-muted)]">
          {job.status}
        </span>
      </div>
      <ProgressBar progress={job.progress} step={job.step} />
      {error && <ErrorBanner message={t("autocut.job-log-error")} detail={error} />}
      <pre
        ref={preRef}
        className="min-h-32 min-w-0 flex-1 overflow-auto rounded-[var(--radius)] bg-[var(--bg-subtle)] p-2 font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {log || t("autocut.job-no-log")}
      </pre>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-meta text-[var(--text-muted)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
        {value}
      </span>
    </div>
  );
}

export default function AutoCutDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const { resyncTick } = useEvents();

  const [session, setSession] = useState<AutoCutMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [segments, setSegments] = useState<AutoCutSegment[]>([]);
  const pending = useRef(new Map<number, AutoCutSegmentPatch>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [brief, setBrief] = useState<Brief | null>(null);
  const pendingBrief = useRef<Partial<Brief> | null>(null);
  const inflight = useRef<Promise<string | null> | null>(null);

  const [job, setJob] = useState<Job | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const group = useCollapseGroup({
    keys: AC_BLOCKS,
    finished: session?.status === "done",
    keepExpanded: AC_KEEP_EXPANDED,
  });

  const load = useCallback(async () => {
    try {
      const s = await getAutoCutSession(sessionId);
      setSession(s);
      if (pending.current.size === 0) setSegments(s.segments);
      if (!pendingBrief.current) setBrief({ ...DEFAULT_BRIEF, ...(s.brief ?? {}) });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, resyncTick]);

  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        const mine = list.filter((j) => isAutoCutJob(j, sessionId));
        if (alive && mine.length > 0) setJob(mine[0]);
      })
      .catch(() => {
      });
    return () => {
      alive = false;
    };
  }, [sessionId, resyncTick]);

  useJobEvents((j) => {
    if (!isAutoCutJob(j, sessionId)) return;
    setJob(j);
    if (["done", "failed", "canceled"].includes(j.status)) load();
    else if (
      j.status === "running" &&
      session &&
      session.status !== "planning" &&
      session.status !== "cutting"
    )
      load();
  });


  const flush = useCallback(async (): Promise<string | null> => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const isEmpty = () => pending.current.size === 0 && !pendingBrief.current;
    let prevErr: string | null = null;
    while (inflight.current) prevErr = await inflight.current;
    if (isEmpty()) return prevErr;
    const patches = [...pending.current.values()];
    const briefPatch = pendingBrief.current;
    pending.current.clear();
    pendingBrief.current = null;
    const run = (async (): Promise<string | null> => {
      try {
        const s = await updateAutoCut(sessionId, {
          ...(patches.length > 0 ? { segments: patches } : {}),
          ...(briefPatch ? { brief: briefPatch } : {}),
        });
        setSession(s);
        setSaveError(null);
        return null;
      } catch (e) {
        for (const p of patches) {
          pending.current.set(p.index, { ...p, ...(pending.current.get(p.index) ?? {}) });
        }
        if (briefPatch) {
          pendingBrief.current = { ...briefPatch, ...(pendingBrief.current ?? {}) };
        }
        const msg = e instanceof Error ? e.message : String(e);
        setSaveError(msg);
        return msg;
      }
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      if (inflight.current === run) inflight.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (pending.current.size > 0 || pendingBrief.current) {
        const patches = [...pending.current.values()];
        const briefPatch = pendingBrief.current;
        pending.current.clear();
        pendingBrief.current = null;
        updateAutoCut(sessionId, {
          ...(patches.length > 0 ? { segments: patches } : {}),
          ...(briefPatch ? { brief: briefPatch } : {}),
        }).catch(() => {
        });
      }
    };
  }, [sessionId]);

  const queuePatch = useCallback(
    (patch: AutoCutSegmentPatch, immediate = false) => {
      const cur = pending.current.get(patch.index) ?? { index: patch.index };
      pending.current.set(patch.index, { ...cur, ...patch });
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (immediate) {
        flush();
      } else {
        flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
      }
    },
    [flush]
  );

  function setTitle(index: number, title: string) {
    setSegments((prev) =>
      prev.map((s) => (s.index === index ? { ...s, title } : s))
    );
    queuePatch({ index, title });
  }

  function setSelected(index: number, selected: boolean) {
    setSegments((prev) =>
      prev.map((s) => (s.index === index ? { ...s, selected } : s))
    );
    queuePatch({ index, selected }, true);
  }

  function patchBrief(p: Partial<Brief>) {
    setBrief((b) => (b ? { ...b, ...p } : b));
    pendingBrief.current = { ...(pendingBrief.current ?? {}), ...p };
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
  }

  function toggleAll(next: boolean) {
    setSegments((prev) => prev.map((s) => ({ ...s, selected: next })));
    for (const s of segments) {
      const cur = pending.current.get(s.index) ?? { index: s.index };
      pending.current.set(s.index, { ...cur, selected: next });
    }
    flush();
  }


  async function run(step: "plan" | "cut") {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const saveErr = await flush();
      if (saveErr) {
        setActionError(saveErr);
        return;
      }
      const j = step === "plan" ? await planAutoCut(sessionId) : await cutAutoCut(sessionId);
      setJob(j);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAutoCut(sessionId);
      router.push("/auto-cut");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("nav.auto-cut")} />
        {loadError ? (
          <ErrorBanner message={t("autocut.not-found")} detail={loadError} />
        ) : (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>
    );
  }

  const running = session.status === "planning" || session.status === "cutting";
  const stage = acStage(session);
  const canEditSegments =
    session.status === "draft" || session.status === "planned";
  const selectedCount = segments.filter((s) => s.selected).length;
  const allSelected = segments.length > 0 && selectedCount === segments.length;
  const created = segments.filter((s) => s.projectId);
  const createdCount = created.length;
  const pendingCount = segments.filter((s) => s.selected && !s.projectId).length;
  const retryStep: "plan" | "cut" =
    session.failedStep === "cut" && segments.length > 0 ? "cut" : "plan";
  const canCut =
    session.status === "planned" ||
    (session.status === "failed" && retryStep === "cut");
  const src = session.source;
  const sourceUrl = `${mediaUrl(src.relPath)}?v=${encodeURIComponent(
    session.updatedAt
  )}`;
  const params_ = session.params;


  const sourceSummary = [
    baseName(src.relPath),
    `${src.width}x${src.height}`,
    clock(src.durationSec),
    `${src.fps}fps`,
  ].join(" · ");
  const configSummary = [
    t(MODE_LABEL[session.mode]),
    aspectLabel(session.output.aspect, t),
    session.output.aspect !== "keep" ? t(LAYOUT_LABEL[session.output.layout]) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const briefSummary =
    brief?.notes.trim().slice(0, 120) || t("brief.none");
  const planSummary =
    segments.length > 0
      ? tf("autocut.selected-count", { n: selectedCount })
      : t("autocut.no-segment-short");
  const resultSummary =
    createdCount > 0
      ? tf("autocut.created-count", { n: createdCount })
      : t("autocut.no-project-yet-short");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={session.name}
        hint={{ titleKey: "help.autocut.title", bodyKey: "help.autocut.body" }}
        subtitle={`${baseName(src.relPath)} · ${src.width}x${src.height} · ${src.fps}fps · ${clock(
          src.durationSec
        )}`}
        center={
          <StepperBar
            steps={AC_STAGES}
            stage={stage.stage}
            active={stage.active}
            done={session.status === "done"}
            ariaLabel={tf("autocut.stage-aria", {
              stage: stage.stage,
              label: t(AC_STAGES[stage.stage - 1]),
            })}
          />
        }
        actions={
          <>
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/auto-cut")}>
                <ArrowLeft size={15} strokeWidth={2} />
                {t("autocut.back")}
              </Button>
            </span>
            <span className="flex items-center border-l border-[var(--border)] pl-2">
              <Button
                variant="destructive"
                disabled={running}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 size={15} strokeWidth={2} />
                {t("common.delete")}
              </Button>
            </span>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-meta text-[var(--text-muted)]">
          <AutoCutStatusBadge status={session.status} />
          <span className="chip">{t(MODE_LABEL[session.mode])}</span>
          <span className="chip">{aspectLabel(session.output.aspect, t)}</span>
          {session.output.aspect !== "keep" && (
            <span className="chip">{t(LAYOUT_LABEL[session.output.layout])}</span>
          )}
          {session.transcribe && <span className="chip">{t("autocut.transcribe")}</span>}
          {session.autoEdit && <span className="chip">{t("autocut.auto-edit")}</span>}
          {createdCount > 0 && (
            <span className="chip">
              {tf("autocut.created-count", { n: createdCount })}
            </span>
          )}
          {session.status === "done" && group.anyCollapsed && (
            <span className="min-w-0">{t("workspace.done-collapsed")}</span>
          )}
          <span className="ml-auto shrink-0">
            {t("common.updated")}: {formatDateTime(session.updatedAt)}
          </span>
        </div>
      </Card>

      {loadError && (
        <ErrorBanner message={t("autocut.load-error")} detail={loadError} />
      )}
      {actionError && (
        <ErrorBanner message={t("autocut.action-error")} detail={actionError} />
      )}
      {saveError && (
        <ErrorBanner message={t("autocut.save-error")} detail={saveError} />
      )}
      {session.status === "failed" && (
        <ErrorBanner
          message={t("autocut.failed")}
          detail={session.error ?? undefined}
        />
      )}

      <Workspace>
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <WorkspaceBlock
            id="ac-block-source"
            icon={FileVideo}
            collapsed={group.isCollapsed("source")}
            onToggle={() => group.toggle("source")}
            summary={sourceSummary}
            title={t("autocut.source")}
          >
            <div className="flex flex-col gap-3">
              <video
                controls
                preload="metadata"
                src={sourceUrl}
                className="max-h-[360px] w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">
                  {src.width}x{src.height}
                </span>
                <span className="chip">{clock(src.durationSec)}</span>
                <span className="chip">{src.fps} fps</span>
                {src.rotation !== 0 && (
                  <span className="chip">{src.rotation}°</span>
                )}
              </div>
              <p className="min-w-0 text-meta text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {src.relPath}
              </p>
              {session.transcriptRel && (
                <span className="chip w-fit min-w-0">
                  <span className="min-w-0 truncate">
                    {t("autocut.transcript-file")}: {session.transcriptRel}
                  </span>
                </span>
              )}
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          <WorkspaceBlock
            id="ac-block-config"
            icon={Settings2}
            collapsed={group.isCollapsed("config")}
            onToggle={() => group.toggle("config")}
            summary={configSummary}
            title={t("autocut.card-config")}
          >
            <div className="flex flex-col gap-2">
              <ConfigRow label={t("autocut.how")} value={t(MODE_LABEL[session.mode])} />
              {session.mode === "time" && (
                <>
                  {params_.minutes !== undefined && (
                    <ConfigRow
                      label={t("autocut.minutes")}
                      value={String(params_.minutes)}
                    />
                  )}
                  {params_.overlapSec !== undefined && (
                    <ConfigRow
                      label={t("autocut.overlap")}
                      value={String(params_.overlapSec)}
                    />
                  )}
                </>
              )}
              {session.mode !== "time" && (
                <>
                  {params_.count !== undefined && (
                    <ConfigRow
                      label={t("autocut.count")}
                      value={String(params_.count)}
                    />
                  )}
                  {params_.minSec !== undefined && (
                    <ConfigRow
                      label={t("autocut.min-sec")}
                      value={String(params_.minSec)}
                    />
                  )}
                  {params_.maxSec !== undefined && (
                    <ConfigRow
                      label={t("autocut.max-sec")}
                      value={String(params_.maxSec)}
                    />
                  )}
                  {params_.request && (
                    <ConfigRow
                      label={t("autocut.request")}
                      value={params_.request}
                    />
                  )}
                </>
              )}
              <ConfigRow
                label={t("autocut.aspect")}
                value={aspectLabel(session.output.aspect, t)}
              />
              {session.output.aspect !== "keep" && (
                <>
                  <ConfigRow
                    label={t("autocut.layout")}
                    value={t(LAYOUT_LABEL[session.output.layout])}
                  />
                  <ConfigRow
                    label={t("autocut.background")}
                    value={t(BACKGROUND_LABEL[session.output.background])}
                  />
                </>
              )}
              <ConfigRow
                label={t("autocut.transcribe")}
                value={session.transcribe ? t("common.yes") : t("common.no")}
              />
              <ConfigRow
                label={t("autocut.auto-edit")}
                value={session.autoEdit ? t("common.yes") : t("common.no")}
              />
              <p className="mt-1 text-meta text-[var(--text-muted)]">
                {t("autocut.config-readonly")}
              </p>
            </div>
          </WorkspaceBlock>

          <WorkspaceBlock
            id="ac-block-brief"
            icon={FileText}
            collapsed={group.isCollapsed("brief")}
            onToggle={() => group.toggle("brief")}
            summary={briefSummary}
            title={
              <span className="inline-flex items-center gap-2">
                {t("autocut.brief-card")}
                <InfoHint
                  titleKey="help.autocut-brief.title"
                  bodyKey="help.autocut-brief.body"
                  size={14}
                />
              </span>
            }
          >
            {brief ? (
              <>
                <div className="mb-3 flex flex-col gap-1 text-meta text-[var(--text-muted)]">
                  <p>{running ? t("autocut.brief-locked") : t("autocut.brief-hint")}</p>
                  {createdCount > 0 && <p>{t("autocut.brief-applies-next")}</p>}
                  {!running && <p>{t("autocut.brief-autosave")}</p>}
                </div>
                <BriefFields
                  value={brief}
                  onChange={patchBrief}
                  show={{ styleId: false, sourceDescription: false }}
                  disabled={running}
                />
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
          </WorkspaceBlock>

          <WorkspaceBlock
            id="ac-block-plan"
            icon={Scissors}
            collapsed={group.isCollapsed("plan")}
            onToggle={() => group.toggle("plan")}
            summary={planSummary}
            title={
              <span className="inline-flex items-center gap-2">
                {t("autocut.segments")}
                <InfoHint
                  titleKey="help.autocut-segments.title"
                  bodyKey="help.autocut-segments.body"
                  size={14}
                />
              </span>
            }
            actions={
              !running && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={() => run("plan")}
                  >
                    <RefreshCw size={14} strokeWidth={2} />
                    {segments.length > 0 ? t("autocut.replan") : t("autocut.plan")}
                  </Button>
                  {pendingCount > 0 && canCut && (
                    <Button small disabled={busy} onClick={() => run("cut")}>
                      {busy ? (
                        <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                      ) : (
                        <Scissors size={14} strokeWidth={2} />
                      )}
                      {tf("autocut.cut-n", { n: pendingCount })}
                    </Button>
                  )}
                </div>
              )
            }
          >
            {segments.length === 0 ? (
              <EmptyState icon={Scissors} description={t("autocut.no-segment")} />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={allSelected}
                      disabled={!canEditSegments}
                      onChange={() => toggleAll(!allSelected)}
                    />
                    {t("autocut.select-all")}
                  </label>
                  <span className="text-meta text-[var(--text-muted)]">
                    {tf("autocut.selected-count", { n: selectedCount })}
                    {createdCount > 0
                      ? ` · ${tf("autocut.created-count", { n: createdCount })}`
                      : ""}
                  </span>
                </div>

                <ul className="flex flex-col">
                  {segments.map((s) => (
                    <li
                      key={s.index}
                      className="flex items-start gap-2 border-b border-[var(--border)] py-2 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        className="checkbox mt-2"
                        checked={s.selected}
                        disabled={!canEditSegments}
                        aria-label={tf("autocut.select-aria", { title: s.title })}
                        onChange={(e) => setSelected(s.index, e.target.checked)}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-meta text-[var(--text-muted)]">
                            {clock(s.start)} - {clock(s.end)} ({duration(s.end - s.start)})
                          </span>
                          {typeof s.score === "number" && (
                            <span className="chip">
                              {tf("autocut.score", { score: s.score })}
                            </span>
                          )}
                          {s.appliedLayout && (
                            <span className="chip">{t(LAYOUT_LABEL[s.appliedLayout])}</span>
                          )}
                          {s.projectId && (
                            <Link
                              href={`/projects/${s.projectId}`}
                              className="inline-flex items-center gap-1 text-meta font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                            >
                              <ExternalLink size={13} strokeWidth={2} />
                              {t("autocut.open-project")}
                            </Link>
                          )}
                        </div>
                        <input
                          className="input font-semibold"
                          value={s.title}
                          disabled={!canEditSegments}
                          aria-label={tf("autocut.title-aria", { n: s.index + 1 })}
                          onChange={(e) => setTitle(s.index, e.target.value)}
                          onBlur={() => flush()}
                        />
                        {(s.hook || s.reason) && (
                          <p
                            title={s.reason || undefined}
                            className="line-clamp-2 text-meta text-[var(--text-muted)] [overflow-wrap:anywhere]"
                          >
                            {s.hook || s.reason}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          {running && (
            <OutputBlock
              id="ac-block-progress"
              status="running"
              progress={job?.progress ?? null}
              step={job?.step}
              aspect={`${src.width} / ${src.height}`}
              title={
                session.status === "planning"
                  ? t("autocut.step-plan")
                  : t("autocut.step-cut")
              }
              summary={
                session.status === "planning"
                  ? t("autocut.planning-hint")
                  : t("autocut.cutting-hint")
              }
            >
              <p className="text-sm text-[var(--text-muted)]">
                {session.status === "planning"
                  ? t("autocut.planning-hint")
                  : t("autocut.cutting-hint")}
              </p>
            </OutputBlock>
          )}

          <WorkspaceBlock
            id="ac-block-result"
            icon={Clapperboard}
            collapsed={group.isCollapsed("result")}
            onToggle={() => group.toggle("result")}
            summary={resultSummary}
            title={t("autocut.card-result")}
            actions={
              session.status === "failed" ? (
                <Button small disabled={busy} onClick={() => run(retryStep)}>
                  <RefreshCw size={14} strokeWidth={2} />
                  {retryStep === "plan" ? t("autocut.replan") : t("autocut.cut")}
                </Button>
              ) : undefined
            }
          >
            {created.length > 0 ? (
              <ul className="flex flex-col">
                {created.map((s) => (
                  <li
                    key={s.index}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-2 last:border-b-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {s.title}
                      </span>
                      <span className="font-mono text-meta text-[var(--text-muted)]">
                        {clock(s.start)} - {clock(s.end)} (
                        {duration(s.end - s.start)})
                      </span>
                    </span>
                    <Link
                      href={`/projects/${s.projectId}`}
                      className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                    >
                      <ExternalLink size={13} strokeWidth={2} />
                      {t("autocut.open-project")}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : running ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <EmptyState
                icon={Clapperboard}
                description={t("autocut.no-project-yet")}
              />
            )}
          </WorkspaceBlock>
        </WorkspaceColumn>
      </Workspace>

      <ShellRightPanel title={t("autocut.card-job")}>
        {job ? (
          <JobLogBlock job={job} />
        ) : (
          <div className="card flex min-h-0 flex-1 flex-col items-center justify-center">
            <EmptyState icon={ScrollText} description={t("autocut.job-no-log")} />
          </div>
        )}
      </ShellRightPanel>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("autocut.delete-title")}
        description={<p>{t("autocut.delete-desc")}</p>}
        items={[`${session.name} - ${session.source.relPath}`]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />
    </div>
  );
}
