"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Clapperboard,
  Coins,
  Film,
  ListVideo,
  MessagesSquare,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatSessions,
  getJobs,
  getOverview,
  getProjects,
  getUsageByModel,
  getUsageTimeline,
  type ChatSession,
  type Job,
  type Overview,
  type ProjectSummary,
  type UsageByModel,
  type UsageScope,
  type UsageTimelinePoint,
} from "@/lib/api";
import { useAgentEvents, useEvents, useJobEvents } from "@/lib/useEvents";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { Badge, ProjectBadge } from "@/components/Badge";
import { ProgressBar } from "@/components/ProgressBar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Segmented } from "@/components/Segmented";
import { Skeleton, TableSkeleton } from "@/components/Skeleton";
import { StatTile } from "@/components/StatTile";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { TokenTimelineChart } from "@/components/TokenTimelineChart";
import { formatRelative, formatTokens, formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";

const JOB_TYPE_LABEL: Record<Job["type"], string> = {
  "scene-draft": "dash.job.scene-draft",
  "scene-final": "dash.job.scene-final",
  "assemble-draft": "dash.job.assemble-draft",
  "assemble-final": "dash.job.assemble-final",
  "image-gen": "dash.job.image-gen",
  "auto-cut": "dash.job.auto-cut",
  "auto-trim": "dash.job.auto-trim",
  "text-to-video": "dash.job.text-to-video",
  "translate-video": "dash.job.translate-video",
};

function healthProblems(
  overview: Overview,
  t: (key: string) => string
): string[] {
  const problems: string[] = [];
  const c = overview.health?.checks;
  if (!c) return problems;
  if (!c.ffmpeg) problems.push(t("dash.health.ffmpeg"));
  if (!c.claudeAuth) problems.push(t("dash.health.claude"));
  if (!c.hyperframes) problems.push(t("dash.health.hyperframes"));
  return problems;
}

function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const FAILED_CLEARED_KEY = "fabuloki.dashboard.failedClearedAt";

function readFailedClearedAt(): number {
  try {
    const v = Number(localStorage.getItem(FAILED_CLEARED_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function jobEndedAt(j: Job): number {
  return new Date(j.finishedAt ?? j.createdAt).getTime();
}

const TILE_SKELETON = "h-28 w-full";

const USAGE_DAYS_OPTIONS = [7, 30, 90] as const;

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  gemini: "Gemini",
  openai: "OpenAI",
};

const providerLabel = (p: string) =>
  PROVIDER_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

const USAGE_SCOPE_OPTIONS: { value: UsageScope; label: string }[] = [
  { value: "all", label: "dash.scope.all" },
  { value: "video", label: "dash.scope.video" },
  { value: "image", label: "dash.scope.image" },
];

export default function DashboardPage() {
  const { t, tf } = useT();
  const { resyncTick } = useEvents();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overviewRef = useRef<Overview | null>(null);
  overviewRef.current = overview;

  const [timeline, setTimeline] = useState<UsageTimelinePoint[] | null>(null);
  const [usageDays, setUsageDays] = useState<number>(30);
  const [usageScope, setUsageScope] = useState<UsageScope>("all");

  const [byModel, setByModel] = useState<UsageByModel[] | null>(null);
  const [byModelError, setByModelError] = useState<string | null>(null);

  const [timeline30, setTimeline30] = useState<UsageTimelinePoint[] | null>(
    null
  );
  const [jobs, setJobs] = useState<Job[] | null>(null);

  const [failedClearedAt, setFailedClearedAt] = useState(0);
  useEffect(() => {
    setFailedClearedAt(readFailedClearedAt());
  }, []);
  const clearFailedBanner = useCallback(() => {
    const now = Date.now();
    setFailedClearedAt(now);
    try {
      localStorage.setItem(FAILED_CLEARED_KEY, String(now));
    } catch {

    }
  }, []);
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await getOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadJobs = useCallback(() => {
    getJobs(300)
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  const loadSessions = useCallback(() => {
    getChatSessions()
      .then((list) => {
        setSessions(list);

        const running = new Set(
          list.filter((s) => s.status === "running").map((s) => s.sessionId)
        );
        setAgentActivities((m) => {
          const stale = Object.keys(m).filter((sid) => !running.has(sid));
          if (stale.length === 0) return m;
          const next = { ...m };
          for (const sid of stale) delete next[sid];
          return next;
        });
      })
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    loadOverview();
    loadJobs();
    loadSessions();
    getUsageTimeline(30)
      .then(setTimeline30)
      .catch(() => setTimeline30([]));
    getProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [loadOverview, loadJobs, loadSessions, resyncTick]);

  useEffect(() => {
    let stale = false;
    setTimeline(null);
    getUsageTimeline(usageDays, usageScope)
      .then((data) => {
        if (!stale) setTimeline(data);
      })
      .catch(() => {
        if (!stale) setTimeline([]);
      });
    return () => {
      stale = true;
    };
  }, [usageDays, usageScope]);

  useEffect(() => {
    let stale = false;
    setByModel(null);
    setByModelError(null);
    getUsageByModel(usageDays)
      .then((data) => {
        if (!stale) setByModel(data);
      })
      .catch((e) => {

        if (!stale) setByModelError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [usageDays]);

  useJobEvents((job) => {
    const prev = overviewRef.current;
    if (!prev) {

      loadOverview();
      loadJobs();
      return;
    }
    if (job.status === "running") {
      setOverview((cur) => {
        if (!cur) return cur;
        const list = cur.runningJobs ?? (cur.runningJob ? [cur.runningJob] : []);
        const idx = list.findIndex((j) => j.id === job.id);
        const runningJobs =
          idx === -1
            ? [...list, job]
            : list.map((j) => (j.id === job.id ? job : j));
        return {
          ...cur,
          runningJobs,

          runningJob:
            cur.runningJob && cur.runningJob.id !== job.id
              ? cur.runningJob
              : job,
        };
      });
    } else {

      setOverview((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          runningJobs: (cur.runningJobs ?? []).filter((j) => j.id !== job.id),
          runningJob: cur.runningJob?.id === job.id ? null : cur.runningJob,
        };
      });
      loadOverview();
      loadJobs();
      getProjects()
        .then(setProjects)
        .catch(() => {});
    }
  });

  const [agentActivities, setAgentActivities] = useState<
    Record<string, { steps: number; action: string }>
  >({});

  const sessionProjectRef = useRef<Record<string, string | null>>({});
  const [, setSessionMapVersion] = useState(0);
  const fetchingSessionsRef = useRef(false);
  useAgentEvents((e) => {
    if (e.kind === "done" || e.kind === "error") {

      setAgentActivities((m) => {
        if (!(e.sessionId in m)) return m;
        const next = { ...m };
        delete next[e.sessionId];
        return next;
      });
      loadSessions();
      return;
    }
    setAgentActivities((m) => {
      const cur = m[e.sessionId] ?? { steps: 0, action: "" };
      return {
        ...m,
        [e.sessionId]: {
          steps: cur.steps + (e.kind === "tool" ? 1 : 0),
          action:
            e.kind === "tool"
              ? tf("dash.using-tool", {
                  tool: e.tool?.name ?? t("dash.tool-fallback"),
                })
              : t("dash.composing"),
        },
      };
    });
    if (
      sessionProjectRef.current[e.sessionId] === undefined &&
      !fetchingSessionsRef.current
    ) {
      fetchingSessionsRef.current = true;
      getChatSessions()
        .then((list) => {
          setSessions(list);
          for (const s of list) {
            sessionProjectRef.current[s.sessionId] = s.projectId;
          }
          setSessionMapVersion((v) => v + 1);
        })
        .catch(() => {

        })
        .finally(() => {
          fetchingSessionsRef.current = false;
        });
    }
  });
  const agentEntries = Object.entries(agentActivities);

  const usageTotal = (timeline ?? []).reduce(
    (acc, d) => ({
      tokens: acc.tokens + d.tokens,
      tokensIn: acc.tokensIn + (d.tokensIn ?? 0),
      tokensOut: acc.tokensOut + (d.tokensOut ?? 0),
      costUsd: acc.costUsd + d.costUsd,
    }),
    { tokens: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }
  );

  const usage30Total = (timeline30 ?? []).reduce(
    (acc, d) => ({
      tokens: acc.tokens + d.tokens,
      costUsd: acc.costUsd + d.costUsd,
    }),
    { tokens: 0, costUsd: 0 }
  );

  const byModelTotal = (byModel ?? []).reduce(
    (acc, r) => ({
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      costUsd: acc.costUsd + r.costUsd,
      costInUsd: acc.costInUsd + (r.costInUsd ?? 0),
      costOutUsd: acc.costOutUsd + (r.costOutUsd ?? 0),
      unallocatedUsd: acc.unallocatedUsd + (r.price === null ? r.costUsd : 0),
      unpricedRows: acc.unpricedRows + (r.price === null ? 1 : 0),
    }),
    {
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      costInUsd: 0,
      costOutUsd: 0,
      unallocatedUsd: 0,
      unpricedRows: 0,
    }
  );

  const doneProjects = (projects ?? []).filter((p) => p.status === "done").length;
  const exportedProjects = (projects ?? []).filter((p) => p.output).length;

  const todayKey = localDayKey(new Date());
  const todayJobs = (jobs ?? []).filter(
    (j) => localDayKey(new Date(j.createdAt)) === todayKey
  );
  const todayDone = todayJobs.filter((j) => j.status === "done").length;
  const todayFailed = todayJobs.filter((j) => j.status === "failed");

  const failedUncleared = todayFailed.filter(
    (j) => jobEndedAt(j) > failedClearedAt
  );
  const failedRecent = [...failedUncleared]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 3);

  const projectName = (id: string) =>
    projects?.find((p) => p.id === id)?.name ?? id;

  const recentSessions = [...(sessions ?? [])]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 5);

  const problems = overview ? healthProblems(overview, t) : [];

  const runningList =
    overview?.runningJobs ??
    (overview?.runningJob ? [overview.runningJob] : []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.dashboard")}
        hint={{ titleKey: "help.dashboard.title", bodyKey: "help.dashboard.body" }}
        subtitle={t("dash.subtitle")}
      />

      {error && (
        <ErrorBanner message={t("dash.load-error")} detail={error} />
      )}
      {problems.length > 0 && (
        <ErrorBanner
          message={t("dash.health-title")}
          detail={problems.join("\n")}
        />
      )}

      {failedRecent.length > 0 && (
        <Banner
          tone="danger"
          message={tf("dash.failed-today", { n: failedUncleared.length })}
          actions={
            <>
              <Button
                variant="secondary"
                small
                onClick={clearFailedBanner}
                title={t("dash.failed-clear-hint")}
              >
                <X size={14} strokeWidth={2} />
                {t("dash.failed-clear")}
              </Button>
              <Link href="/queue">
                <Button variant="secondary" small>
                  <ListVideo size={14} strokeWidth={2} />
                  {t("dash.view-queue")}
                </Button>
              </Link>
            </>
          }
        >
          <ul className="mt-1 flex flex-col gap-1">
            {failedRecent.map((j) => (
              <li key={j.id} className="text-meta text-[var(--text-muted)]">
                {projectName(j.projectId)} · {t(JOB_TYPE_LABEL[j.type])} ·{" "}
                {formatRelative(j.createdAt)}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {projects === null ? (
          <Skeleton className={TILE_SKELETON} />
        ) : (
          <StatTile
            icon={Clapperboard}
            value={String(projects.length)}
            label={t("dash.total-projects")}
            sub={tf("dash.done-count", { n: doneProjects })}
            href="/projects"
          />
        )}
        {projects === null ? (
          <Skeleton className={TILE_SKELETON} />
        ) : (
          <StatTile
            icon={Film}
            value={String(exportedProjects)}
            label={t("dash.exported")}
            sub={t("dash.has-output")}
            href="/projects"
          />
        )}
        {timeline30 === null ? (
          <Skeleton className={TILE_SKELETON} />
        ) : (
          <StatTile
            icon={BarChart3}
            value={formatTokens(usage30Total.tokens)}
            label={t("dash.tokens-30d")}
            sub={formatUsd(usage30Total.costUsd)}

          />
        )}
        {jobs === null ? (
          <Skeleton className={TILE_SKELETON} />
        ) : (
          <StatTile
            icon={Activity}
            value={String(todayJobs.length)}
            label={t("dash.jobs-today")}
            sub={tf("dash.jobs-today-sub", {
              done: todayDone,
              failed: todayFailed.length,
            })}
            href="/queue"
          />
        )}

        {overview === null ? (
          error ? (
            <StatTile
              icon={ListVideo}
              value="-"
              label={t("dash.queue")}
              sub={t("dash.jobs-waiting")}
            />
          ) : (
            <Skeleton className={TILE_SKELETON} />
          )
        ) : (
          <StatTile
            icon={ListVideo}
            value={String(overview.queuedCount)}
            label={t("dash.queue")}
            sub={t("dash.jobs-waiting")}
            href="/queue"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          title={t("dash.tokens-by-day")}
          className="lg:col-span-2"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Segmented

                size="md"
                label={t("dash.days-aria")}
                value={String(usageDays)}
                onChange={(v) => setUsageDays(Number(v))}
                options={USAGE_DAYS_OPTIONS.map((d) => ({
                  value: String(d),
                  label: tf("dash.days", { n: d }),
                }))}
              />
              <select
                className="input w-auto"
                aria-label={t("dash.scope-aria")}
                value={usageScope}
                onChange={(e) => setUsageScope(e.target.value as UsageScope)}
              >
                {USAGE_SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </div>
          }
        >

          {timeline && usageTotal.tokens > 0 && (
            <p
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-[var(--text-muted)]"
              title={`${usageTotal.tokens.toLocaleString("vi-VN")} token`}
            >
              <span>
                {tf("dash.total-days", {
                  days: usageDays,
                  tokens: formatTokens(usageTotal.tokens),
                  cost: formatUsd(usageTotal.costUsd),
                })}
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowDownToLine
                  size={13}
                  strokeWidth={2}
                  className="shrink-0"
                  aria-hidden
                />
                {formatTokens(usageTotal.tokensIn)} in
                <span aria-hidden>·</span>
                <ArrowUpFromLine
                  size={13}
                  strokeWidth={2}
                  className="shrink-0"
                  aria-hidden
                />
                {formatTokens(usageTotal.tokensOut)} out
              </span>
            </p>
          )}

          {timeline === null ? (
            <Skeleton className="w-full" height={220} />
          ) : usageTotal.tokens > 0 ? (
            <TokenTimelineChart data={timeline} days={usageDays} />
          ) : (
            <EmptyState
              icon={BarChart3}
              description={t("dash.no-usage")}
            />
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {agentEntries.length > 0 && (
            <Card
              title={
                agentEntries.length === 1
                  ? t("dash.ai-working")
                  : tf("dash.ai-working-n", { n: agentEntries.length })
              }
              actions={<SessionStatusBadge status="running" />}
            >
              <div className="flex flex-col gap-3">
                <div className="progress-indeterminate" />
                {agentEntries.map(([sid, act]) => {
                  const pid = sessionProjectRef.current[sid] ?? null;
                  return (
                    <div
                      key={sid}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Sparkles
                          size={14}
                          strokeWidth={2}
                          className="shrink-0 text-[var(--primary)]"
                        />
                        <span className="truncate text-[var(--text-muted)]">
                          {act.action}
                          {act.steps > 0 &&
                            ` · ${tf("dash.step", { n: act.steps })}`}
                        </span>
                      </span>
                      {pid && (
                        <Link
                          href={`/projects/${encodeURIComponent(pid)}`}
                          className="shrink-0 text-sm font-medium text-[var(--primary)] hover:underline"
                        >
                          {t("dash.open-project")}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card
            className="flex-1"
            title={
              runningList.length > 1
                ? tf("dash.running-job-n", { n: runningList.length })
                : t("dash.running-job")
            }
          >
            {runningList.length > 0 ? (
              <div className="flex flex-col">
                {runningList.map((job, i) => (
                  <div
                    key={job.id}
                    className={`flex flex-col gap-2 py-2 first:pt-0 last:pb-0 ${
                      i < runningList.length - 1
                        ? "border-b border-[var(--border)]"
                        : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <Link
                        href={

                          job.type === "auto-cut"
                            ? `/auto-cut/${job.projectId}`
                            : job.type === "text-to-video"
                              ? `/text-to-video/${job.projectId}`
                              : job.type === "translate-video"
                                ? `/translate-video/${job.projectId}`
                                : job.type === "image-gen"
                                  ? `/images/${job.projectId}`
                                  : `/projects/${job.projectId}`
                        }
                        className="truncate text-sm font-medium hover:text-[var(--primary)]"
                      >

                        {projectName(job.projectId)}
                      </Link>
                      <span className="shrink-0 text-meta text-[var(--text-muted)]">
                        {t(JOB_TYPE_LABEL[job.type])}
                        {job.sceneId ? ` · ${job.sceneId}` : ""}
                      </span>
                    </div>
                    <ProgressBar progress={job.progress} step={job.step} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Play} description={t("dash.no-running-job")} />
            )}
          </Card>
        </div>
      </div>

      <Card
        title={t("dash.cost-by-model")}
        hint={{
          titleKey: "help.cost-by-model.title",
          bodyKey: "help.cost-by-model.body",
        }}
        actions={
          <span className="text-meta text-[var(--text-muted)]">
            {tf("dash.cost-by-model-scope", { n: usageDays })}
          </span>
        }
      >
        {byModelError ? (
          <ErrorBanner
            message={t("dash.cost-by-model-error")}
            detail={byModelError}
          />
        ) : byModel === null ? (
          <TableSkeleton rows={4} />
        ) : byModel.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t("dash.col-ai")}</th>
                <th>{t("dash.col-model")}</th>
                <th className="text-right">{t("dash.col-tokens-in")}</th>
                <th className="text-right">{t("dash.col-tokens-out")}</th>
                <th className="text-right">{t("dash.col-cost-in")}</th>
                <th className="text-right">{t("dash.col-cost-out")}</th>
                <th className="text-right">{t("dash.col-cost-total")}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((r) => (
                <tr key={`${r.provider}:${r.model ?? ""}`}>
                  <td>

                    <Badge
                      tone="muted"
                      dot={false}
                      label={providerLabel(r.provider)}
                    />
                  </td>
                  <td className="text-sm">
                    {r.model ?? (
                      <span className="text-[var(--text-muted)]">
                        {t("dash.model-none")}
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatTokens(r.tokensIn)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatTokens(r.tokensOut)}
                  </td>
                  <td className="text-right tabular-nums">
                    {r.costInUsd === null ? (
                      <span className="text-[var(--text-muted)]">-</span>
                    ) : (
                      formatUsd(r.costInUsd)
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {r.costOutUsd === null ? (
                      <span className="text-[var(--text-muted)]">-</span>
                    ) : (
                      formatUsd(r.costOutUsd)
                    )}
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    {formatUsd(r.costUsd)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border)] font-semibold">
                <td colSpan={2}>{t("dash.total-row")}</td>
                <td className="text-right tabular-nums">
                  {formatTokens(byModelTotal.tokensIn)}
                </td>
                <td className="text-right tabular-nums">
                  {formatTokens(byModelTotal.tokensOut)}
                </td>
                <td className="text-right tabular-nums">
                  {formatUsd(byModelTotal.costInUsd)}
                </td>
                <td className="text-right tabular-nums">
                  {formatUsd(byModelTotal.costOutUsd)}
                </td>
                <td className="text-right tabular-nums">
                  {formatUsd(byModelTotal.costUsd)}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <EmptyState icon={Coins} description={t("dash.no-usage-by-model")} />
        )}

        {byModel !== null &&
          byModel.length > 0 &&
          byModelTotal.unpricedRows > 0 && (
            <p className="mt-3 text-meta text-[var(--text-muted)]">
              {tf("dash.unallocated-note", {
                n: byModelTotal.unpricedRows,
                amount: formatUsd(byModelTotal.unallocatedUsd),
              })}
            </p>
          )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title={t("dash.recent-projects")}
          actions={
            <Link
              href="/projects"
              className="text-sm font-medium text-[var(--primary)] hover:underline"
            >
              {t("dash.view-all")}
            </Link>
          }
        >
          {overview === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : overview.recentProjects.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("dash.col-token")}</th>
                  <th>{t("common.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentProjects.slice(0, 5).map((p) => (
                  <tr key={p.id}>
                    <td className="max-w-0 w-2/5">
                      <Link
                        href={`/projects/${p.id}`}
                        className="block truncate font-medium hover:text-[var(--primary)]"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td>
                      <ProjectBadge status={p.status} />
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {(p.tokensUsed ?? 0) > 0 ? formatTokens(p.tokensUsed) : "-"}
                    </td>
                    <td className="whitespace-nowrap text-[var(--text-muted)]">
                      {formatRelative(p.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon={Clapperboard}
              description={t("projects.empty")}
              action={
                <Link href="/projects">
                  <Button>{t("projects.create")}</Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card title={t("dash.recent-sessions")}>
          {sessions === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : recentSessions.length > 0 ? (
            <ul className="flex flex-col">
              {recentSessions.map((s, i) => (
                <li
                  key={s.sessionId}
                  className={`flex items-center gap-3 py-2 ${
                    i < recentSessions.length - 1
                      ? "border-b border-[var(--border)]"
                      : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {s.title || t("dash.chat-session")}
                  </span>
                  <SessionStatusBadge status={s.status} />
                  <span className="shrink-0 text-meta text-[var(--text-muted)]">
                    {formatRelative(s.updatedAt)}
                  </span>
                  {s.projectId && (
                    <Link
                      href={`/projects/${encodeURIComponent(s.projectId)}`}
                      className="shrink-0 text-sm font-medium text-[var(--primary)] hover:underline"
                    >
                      {t("dash.open-project")}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={MessagesSquare}
              description={t("dash.no-sessions")}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
