"use client";


import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Link2,
  ListVideo,
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildTextToVideo,
  deleteTextToVideo,
  estimateChunkSeconds,
  estimateScriptSeconds,
  extractTextToVideo,
  getChatSessions,
  getJob,
  getJobs,
  getProject,
  getTextToVideoSession,
  isTextToVideoJob,
  isVideoProjectJob,
  mediaUrl,
  scriptChars,
  scriptTextToVideo,
  updateTextToVideo,
  TEXT_TO_VIDEO_DEFAULT_OUTPUT,
  TEXT_TO_VIDEO_FPS,
  TEXT_TO_VIDEO_SIZES,
  TEXT_TO_VIDEO_STATUS_LABEL,
  TEXT_TO_VIDEO_STATUS_TONE,
  type Brief,
  type ScriptFormat,
  type ChatSession,
  type Job,
  type ProjectDetail,
  type ScriptChunk,
  type TextSourceKind,
  type TextToVideoAspect,
  type TextToVideoMeta,
  type TextToVideoOutput,
  type TextToVideoSource,
  type TextToVideoVoice,
} from "@/lib/api";
import {
  useAgentEvents,
  useEvents,
  useJobEvents,
  useJobLogEvents,
} from "@/lib/useEvents";
import { Badge, JobBadge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChatThread } from "@/components/ChatThread";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { useClaudeModels, useProviders } from "@/components/ModelPicker";
import { OptionCard, OptionCardGroup } from "@/components/OptionCard";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { Segmented } from "@/components/Segmented";
import { deriveStage, PipelineTimeline, StepperBar } from "@/components/PipelineTimeline";
import { ProgressBar } from "@/components/ProgressBar";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { ShellRightPanel } from "@/components/Shell";
import { StyleSelect, styleDisplayName, useStyles } from "@/components/StyleSelect";
import {
  OutputBlock,
  useCollapseGroup,
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
  type WorkspaceStatus,
} from "@/components/Workspace";
import { VoicePicker } from "@/components/VoicePicker";
import { BriefFields, DEFAULT_BRIEF } from "@/components/BriefFields";
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime, httpUrlOrNull } from "@/lib/format";
import { useT } from "@/lib/i18n";

const PATCH_DEBOUNCE_MS = 700;

const ASPECTS: TextToVideoAspect[] = ["9:16", "16:9", "1:1", "4:5"];

const RUNNING_STATUS = ["extracting", "scripting", "voicing", "building"];

const TARGET_SECONDS_MIN = 15;
const TARGET_SECONDS_MAX = 600;

const ERROR_PREVIEW_MAX = 240;

function shortError(e: string | null | undefined): string | null {
  if (!e) return null;
  const s = e.replace(/\s+/g, " ").trim();
  return s.length > ERROR_PREVIEW_MAX ? `${s.slice(0, ERROR_PREVIEW_MAX)}…` : s;
}

interface Patch {
  name?: string;
  source?: TextToVideoSource;
  voice?: TextToVideoVoice;
  output?: TextToVideoOutput;
  brief?: Partial<Brief>;
  script?: ScriptChunk[];
  scriptModel?: string | null;
}

const TTV_BLOCKS = [
  "source",
  "script",
  "voice",
  "config",
  "build",
  "child",
] as const;
type BlockKey = (typeof TTV_BLOCKS)[number];

const TTV_KEEP_EXPANDED: readonly BlockKey[] = ["build"];

const STAGE_LABELS = [
  "ttv.stage.source",
  "ttv.stage.script",
  "ttv.stage.voice",
  "ttv.stage.config",
  "ttv.stage.build",
] as const;

function deriveTtvStage(m: TextToVideoMeta): {
  stage: number;
  active: boolean;
  complete: boolean;
} {
  if (m.status === "extracting") return { stage: 1, active: true, complete: false };
  if (m.status === "scripting") return { stage: 2, active: true, complete: false };
  if (m.status === "voicing" || m.status === "building" || m.status === "editing") {
    return { stage: 5, active: true, complete: false };
  }
  if (m.projectId) {
    return { stage: 5, active: false, complete: m.status === "done" };
  }
  if (m.script.length > 0) {
    return { stage: m.voice.name ? 4 : 3, active: false, complete: false };
  }
  const hasSource =
    m.article !== null || m.source.text.trim() !== "" || m.source.url.trim() !== "";
  return { stage: hasSource ? 2 : 1, active: false, complete: false };
}

interface ChildProject {
  url: string | null;
  output: string | null;
  runningJob: Job | null;
  pipelineInput: Parameters<typeof PipelineTimeline>[0] | null;
  error: string | null;
}

function useChildProject(projectId: string | null): ChildProject {
  const { resyncTick } = useEvents();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);

  const reload = useCallback(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    getProject(projectId)
      .then((p) => {
        setProject(p);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  useEffect(reload, [reload, resyncTick]);

  const loadSessions = useCallback(() => {
    if (!projectId) return;
    getChatSessions(projectId)
      .then((list) => setAiRunning(list.some((s) => s.status === "running")))
      .catch(() => {
      });
  }, [projectId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions, resyncTick]);

  useEffect(() => {
    if (!projectId) {
      setJobs([]);
      return;
    }
    let alive = true;
    getJobs(50, projectId)
      .then((list) => {
        if (alive) setJobs(list.filter((j) => isVideoProjectJob(j)));
      })
      .catch(() => {
      });
    return () => {
      alive = false;
    };
  }, [projectId, resyncTick]);

  useJobEvents((e) => {
    if (!projectId || !isVideoProjectJob(e, projectId)) return;
    setJobs((prev) => {
      const i = prev.findIndex((j) => j.id === e.id);
      if (i < 0) return [...prev, e];
      const next = prev.slice();
      next[i] = e;
      return next;
    });
    reload();
  });
  useAgentEvents((e) => {
    if (!projectId) return;
    if (e.kind === "done" || e.kind === "result") {
      reload();
      loadSessions();
    }
  });

  const output = project?.output ?? null;

  return {
    output,
    url: output
      ? `${mediaUrl(output)}?v=${encodeURIComponent(project?.updatedAt ?? "")}`
      : null,
    runningJob: jobs.find((j) => j.status === "running") ?? null,
    pipelineInput: project
      ? {
          metaStatus: project.status,
          hasOutput: project.output != null,
          scenes: project.scenes ?? [],
          renders: project.files?.renders ?? [],
          jobs,
          sessionRunning: aiRunning,
        }
      : null,
    error: err,
  };
}

function ScriptModelSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const { models: liveModels, load } = useClaudeModels();
  const models = liveModels ?? claude?.models ?? [];
  const missing = value !== "" && !models.some((m) => m.id === value);

  return (
    <Field
      label={t("ttv.script-model")}
      htmlFor="ttv-script-model"
      hintKeys={{
        titleKey: "help.ttv-script-model.title",
        bodyKey: "help.ttv-script-model.body",
      }}
    >
      <select
        id="ttv-script-model"
        className="input"
        value={value}
        disabled={disabled}
        onFocus={load}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("ttv.script-model-default")}</option>
        {missing && <option value={value}>{value}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ClaudeAuthLine() {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  if (!claude) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-[var(--text-muted)]">
      <Badge
        tone={claude.connected ? "success" : "danger"}
        label={
          claude.connected
            ? claude.source === "api-key"
              ? t("model.connected-api-key")
              : t("model.connected-subscription")
            : t("model.not-connected")
        }
      />
      <span className="min-w-0">
        {claude.connected ? t("ttv.script-model-hint") : t("model.claude-warning")}
      </span>
    </p>
  );
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
    <Panel
      className="shrink-0"
      title={t("ttv.panel-job")}
      actions={<JobBadge status={job.status} />}
    >
      <ProgressBar progress={job.progress} step={job.step} />
      {error && <ErrorBanner message={t("ttv.panel-log-error")} detail={error} />}
      <pre
        ref={preRef}
        className="max-h-48 min-h-16 overflow-auto rounded-[var(--radius)] bg-[var(--surface)] p-2 font-mono text-meta whitespace-pre-wrap"
      >
        {log || t("ttv.panel-no-log")}
      </pre>
    </Panel>
  );
}

export default function TextToVideoDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const { resyncTick } = useEvents();

  const [session, setSession] = useState<TextToVideoMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"extract" | "script" | "build" | null>(null);

  const [source, setSource] = useState<TextToVideoSource | null>(null);
  const [script, setScript] = useState<ScriptChunk[]>([]);
  const [voice, setVoice] = useState<TextToVideoVoice | null>(null);
  const [output, setOutput] = useState<TextToVideoOutput | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [scriptModel, setScriptModel] = useState("");

  const pending = useRef<Patch>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<string | null> | null>(null);

  const [targetSeconds, setTargetSeconds] = useState("");

  const [job, setJob] = useState<Job | null>(null);
  const buildJobId = useRef<string | null>(null);

  const group = useCollapseGroup({
    keys: TTV_BLOCKS,
    finished: session?.status === "done",
    keepExpanded: TTV_KEEP_EXPANDED,
  });

  const { data: stylesData } = useStyles();

  const [chatSessions, setChatSessions] = useState<ChatSession[] | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const adopt = useCallback((s: TextToVideoMeta) => {
    setSession(s);
    const p = pending.current;
    if (!p.source) setSource(s.source);
    if (!p.script) setScript(s.script);
    if (!p.voice) setVoice(s.voice);
    if (!p.output) setOutput({ ...TEXT_TO_VIDEO_DEFAULT_OUTPUT, ...(s.output ?? {}) });
    if (!("scriptModel" in p)) setScriptModel(s.scriptModel ?? "");
    if (!p.brief) setBrief({ ...DEFAULT_BRIEF, ...(s.brief ?? {}) });
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await getTextToVideoSession(sessionId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId, adopt]);

  useEffect(() => {
    load();
  }, [load, resyncTick]);

  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        const mine = list.filter((j) => isTextToVideoJob(j, sessionId));
        if (alive && mine.length > 0) setJob(mine[0]);
      })
      .catch(() => {
      });
    return () => {
      alive = false;
    };
  }, [sessionId, resyncTick]);

  useJobEvents((j) => {
    if (!isTextToVideoJob(j, sessionId) && j.id !== buildJobId.current) return;
    setJob(j);
    if (["done", "failed", "canceled"].includes(j.status)) load();
  });

  const projectId = session?.projectId ?? null;

  const child = useChildProject(projectId);

  const loadChatSessions = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await getChatSessions(projectId);
      list.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setChatSessions(list);
      setActiveSessionId((cur) => cur ?? list[0]?.sessionId ?? null);
    } catch {
      setChatSessions((s) => s ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    loadChatSessions();
  }, [loadChatSessions, resyncTick]);

  useAgentEvents((e) => {
    if (e.kind !== "done") return;
    load();
    if (projectId) loadChatSessions();
  });


  const flush = useCallback(async (): Promise<string | null> => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    let prevErr: string | null = null;
    while (inflight.current) prevErr = await inflight.current;
    if (Object.keys(pending.current).length === 0) return prevErr;
    const patch = pending.current;
    pending.current = {};
    const run = (async (): Promise<string | null> => {
      try {
        const s = await updateTextToVideo(sessionId, patch);
        setSession(s);
        setSaveError(null);
        return null;
      } catch (e) {
        const later = pending.current;
        pending.current = {
          ...patch,
          ...later,
          ...(patch.brief || later.brief
            ? { brief: { ...(patch.brief ?? {}), ...(later.brief ?? {}) } }
            : {}),
        };
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
      if (Object.keys(pending.current).length > 0) {
        const patch = pending.current;
        pending.current = {};
        updateTextToVideo(sessionId, patch).catch(() => {
        });
      }
    };
  }, [sessionId]);

  const queue = useCallback(
    (patch: Patch, immediate = false) => {
      pending.current = {
        ...pending.current,
        ...patch,
        ...(patch.brief
          ? { brief: { ...(pending.current.brief ?? {}), ...patch.brief } }
          : {}),
      };
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (immediate) {
        flush();
      } else {
        flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
      }
    },
    [flush]
  );

  function patchSource(p: Partial<TextToVideoSource>, immediate = false) {
    if (!source) return;
    const next = { ...source, ...p };
    setSource(next);
    queue({ source: next }, immediate);
  }

  function patchVoice(p: Partial<TextToVideoVoice>) {
    if (!voice) return;
    const next = { ...voice, ...p };
    setVoice(next);
    queue({ voice: next });
  }

  function patchOutput(p: Partial<TextToVideoOutput>) {
    if (!output) return;
    const next = { ...output, ...p };
    setOutput(next);
    queue({ output: next }, true);
  }

  function patchBrief(p: Partial<Brief>) {
    setBrief((b) => (b ? { ...b, ...p } : b));
    queue({ brief: p });
  }

  function patchScriptModel(id: string) {
    setScriptModel(id);
    queue({ scriptModel: id === "" ? null : id }, true);
  }

  function setChunks(next: ScriptChunk[], immediate = false) {
    setScript(next);
    queue({ script: next }, immediate);
  }

  function setChunkText(index: number, text: string) {
    setChunks(
      script.map((c, i) => ({
        ...c,
        text: i === index ? text : c.text,
        durationSec: null,
      })),
      false
    );
  }


  async function run(step: "extract" | "script" | "build") {
    if (busy) return;
    if (step === "script" && targetSeconds.trim() !== "") {
      const target = Number(targetSeconds);
      if (
        !Number.isFinite(target) ||
        target < TARGET_SECONDS_MIN ||
        target > TARGET_SECONDS_MAX
      ) {
        setActionError(
          tf("ttv.target-invalid", {
            min: TARGET_SECONDS_MIN,
            max: TARGET_SECONDS_MAX,
          })
        );
        return;
      }
    }
    setBusy(step);
    setActionError(null);
    try {
      const saveErr = await flush();
      if (saveErr) {
        setActionError(saveErr);
        return;
      }
      if (step === "extract") {
        adopt(await extractTextToVideo(sessionId));
      } else if (step === "script") {
        const target = Number(targetSeconds);
        adopt(
          await scriptTextToVideo(sessionId, {
            ...(targetSeconds.trim() !== "" ? { targetSeconds: target } : {}),
            ...(scriptModel ? { model: scriptModel } : {}),
          })
        );
      } else {
        const { jobId } = await buildTextToVideo(sessionId);
        buildJobId.current = jobId;
        await load();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      load();
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTextToVideo(sessionId);
      router.push("/text-to-video");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  if (!session || !source || !voice || !output || !brief) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("nav.text-to-video")} />
        {loadError ? (
          <ErrorBanner message={t("ttv.not-found")} detail={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </div>
    );
  }

  const running = RUNNING_STATUS.includes(session.status);
  const stage = deriveTtvStage(session);
  const article = session.article;
  const articleLink = httpUrlOrNull(article?.canonicalUrl);
  const chars = scriptChars(script);
  const estSeconds = estimateScriptSeconds(script);
  const hasSourceText = source.text.trim() !== "" || article !== null;
  const canScript = hasSourceText && !running;
  const canBuild =
    script.length > 0 && voice.name.trim() !== "" && !running && !session.projectId;
  const locked = running;
  const currentAspect =
    ASPECTS.find(
      (a) =>
        TEXT_TO_VIDEO_SIZES[a].width === output.width &&
        TEXT_TO_VIDEO_SIZES[a].height === output.height
    ) ?? null;
  const activeSession =
    chatSessions?.find((s) => s.sessionId === activeSessionId) ?? null;
  const statusLabel = TEXT_TO_VIDEO_STATUS_LABEL[session.status]
    ? t(TEXT_TO_VIDEO_STATUS_LABEL[session.status])
    : String(session.status);


  const done = session.status === "done";

  const activeJob =
    child.runningJob ?? (job && job.status === "running" ? job : null);

  const outputStatus: WorkspaceStatus =
    session.status === "failed"
      ? "failed"
      : child.url
        ? "done"
        : running || session.projectId
          ? "running"
          : "idle";

  const aspect = `${output.width} / ${output.height}`;


  const sourceSummary =
    (source.kind === "url" ? source.url.trim() : "") ||
    article?.title ||
    source.text.trim().slice(0, 140) ||
    t("ttv.no-source-yet");
  const scriptSummary =
    script.length > 0
      ? `${tf("ttv.chunk-count", { n: script.length })} · ${tf("ttv.char-count", {
          n: chars,
        })} · ${tf("ttv.est-duration", { time: clock(estSeconds) })}`
      : hasSourceText
        ? t("ttv.no-script")
        : t("ttv.no-source-yet");
  const voiceSummary = voice.name.trim() || t("ttv.voice-not-chosen");
  const configSummary = `${output.width}x${output.height} · ${output.fps}fps · ${styleDisplayName(
    stylesData,
    output.styleId,
    t
  )}`;
  const buildSummary =
    session.voiceDurationSec !== null
      ? `${statusLabel} · ${tf("ttv.real-duration", {
          time: clock(session.voiceDurationSec),
        })}`
      : statusLabel;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={session.name}
        hint={{ titleKey: "help.ttv.title", bodyKey: "help.ttv.body" }}
        subtitle={`${output.width}x${output.height} · ${output.fps}fps`}
        center={
          <StepperBar
            steps={STAGE_LABELS}
            stage={stage.stage}
            active={stage.active}
            done={stage.complete}
            ariaLabel={tf("ttv.stage-aria", {
              stage: stage.stage,
              label: t(STAGE_LABELS[stage.stage - 1]),
            })}
          />
        }
        actions={
          <>
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/text-to-video")}>
                <ArrowLeft size={15} strokeWidth={2} />
                {t("ttv.back")}
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
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          <Badge
            tone={TEXT_TO_VIDEO_STATUS_TONE[session.status] ?? "muted"}
            label={statusLabel}
          />
          <span className="chip">
            {source.kind === "url" ? t("ttv.source.url") : t("ttv.source.text")}
          </span>
          {script.length > 0 && (
            <span className="chip">{tf("ttv.chunk-count", { n: script.length })}</span>
          )}
          {voice.name && <span className="chip">{voice.name}</span>}
          {session.voiceDurationSec !== null && (
            <span className="chip">
              {tf("ttv.real-duration", { time: clock(session.voiceDurationSec) })}
            </span>
          )}
          {done && group.anyCollapsed && (
            <span className="min-w-0">{t("ttv.section.done-collapsed")}</span>
          )}
          <span className="ml-auto text-meta">
            {t("common.updated")}: {formatDateTime(session.updatedAt)}
          </span>
        </div>
      </Card>

      {loadError && <ErrorBanner message={t("ttv.load-error")} detail={loadError} />}
      {actionError && (
        <ErrorBanner message={t("ttv.action-error")} detail={actionError} />
      )}
      {saveError && <ErrorBanner message={t("ttv.save-error")} detail={saveError} />}

      {session.status === "failed" && (
        <ErrorBanner message={t("ttv.failed")} detail={session.error ?? undefined} />
      )}

      <Workspace>
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <WorkspaceBlock
            id="ttv-block-source"
            icon={FileText}
            collapsed={group.isCollapsed("source")}
            onToggle={() => group.toggle("source")}
            summary={sourceSummary}
            title={t("ttv.card-source")}
            hint={{
              titleKey: "help.ttv-source.title",
              bodyKey: "help.ttv-source.body",
            }}
            actions={
              source.kind === "url" ? (
                <Button
                  variant="secondary"
                  small
                  disabled={locked || busy !== null || !source.url.trim()}
                  onClick={() => run("extract")}
                >
                  {busy === "extract" ? (
                    <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} strokeWidth={2} />
                  )}
                  {article ? t("ttv.re-extract") : t("ttv.extract")}
                </Button>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-3">
              <Segmented
                label={t("ttv.source")}
                value={source.kind}
                disabled={locked}
                onChange={(kind: TextSourceKind) => patchSource({ kind }, true)}
                options={[
                  {
                    value: "url",
                    label: (
                      <>
                        <Link2 size={13} strokeWidth={2} aria-hidden="true" />
                        {t("ttv.source.url")}
                      </>
                    ),
                  },
                  {
                    value: "text",
                    label: (
                      <>
                        <Type size={13} strokeWidth={2} aria-hidden="true" />
                        {t("ttv.source.text")}
                      </>
                    ),
                  },
                ]}
              />

              {source.kind === "url" && (
                <Field label={t("ttv.url")} htmlFor="ttv-detail-url">
                  <input
                    id="ttv-detail-url"
                    className="input"
                    value={source.url}
                    disabled={locked}
                    placeholder={t("ttv.url-placeholder")}
                    onChange={(e) => patchSource({ url: e.target.value })}
                    onBlur={() => flush()}
                  />
                </Field>
              )}

              {session.status === "extracting" && (
                <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  {t("ttv.extracting-hint")}
                </p>
              )}

              {article && (
                <Panel title={article.title}>
                  <div className="flex flex-wrap items-center gap-2">
                    {article.siteName && <span className="chip">{article.siteName}</span>}
                    {article.byline && <span className="chip">{article.byline}</span>}
                    {article.publishedTime && (
                      <span className="chip">{formatDateTime(article.publishedTime)}</span>
                    )}
                    {article.lang && <span className="chip">{article.lang}</span>}
                    <span className="chip">
                      {tf("ttv.block-count", { n: article.blocks.length })}
                    </span>
                    <span className="chip">
                      {tf("ttv.char-count", { n: article.chars })}
                    </span>
                  </div>
                  {articleLink && (
                    <a
                      href={articleLink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex max-w-full items-center gap-1 text-meta font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                    >
                      <ExternalLink size={13} strokeWidth={2} className="shrink-0" />
                      <span className="truncate">{articleLink}</span>
                    </a>
                  )}
                </Panel>
              )}

              <Field
                label={t("ttv.content")}
                htmlFor="ttv-detail-text"
                hint={`${t("ttv.content-hint")} · ${tf("ttv.char-count", {
                  n: source.text.trim().length,
                })}`}
              >
                <textarea
                  id="ttv-detail-text"
                  className="input"
                  rows={10}
                  value={source.text}
                  disabled={locked}
                  placeholder={
                    source.kind === "url"
                      ? t("ttv.content-placeholder-url")
                      : t("ttv.text-placeholder")
                  }
                  onChange={(e) => patchSource({ text: e.target.value })}
                  onBlur={() => flush()}
                />
              </Field>
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          <WorkspaceBlock
            id="ttv-block-script"
            icon={Sparkles}
            collapsed={group.isCollapsed("script")}
            onToggle={() => group.toggle("script")}
            summary={scriptSummary}
            title={t("ttv.card-script")}
            hint={{
              titleKey: "help.ttv-script.title",
              bodyKey: "help.ttv-script.body",
            }}
            actions={
              <Button
                small
                disabled={!canScript || busy !== null}
                onClick={() => run("script")}
              >
                {busy === "script" ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Wand2 size={14} strokeWidth={2} />
                )}
                {script.length > 0 ? t("ttv.rewrite-script") : t("ttv.write-script")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <Panel>
                <Field label={t("ttv.format")} htmlFor="ttv-script-format">
                  <select
                    id="ttv-script-format"
                    className="input"
                    value={brief.scriptFormat ?? ""}
                    disabled={locked}
                    onChange={(e) =>
                      patchBrief({ scriptFormat: (e.target.value || null) as ScriptFormat | null })
                    }
                  >
                    <option value="">{t("ttv.format.default")}</option>
                    <option value="mood">Voiceoff / Mood</option>
                    <option value="painpoint">Painpoint</option>
                    <option value="debate">{t("ttv.format.debate")}</option>
                    <option value="tour">Housetour</option>
                  </select>
                </Field>
                {brief.scriptFormat && (
                  <div className="mt-3">
                    <ol className="grid grid-cols-2 gap-2">
                      {t(`ttv.format.${brief.scriptFormat}.flow`).split("|").map((beat, i) => (
                        <li key={beat} className="rounded-md border border-[var(--border)] p-2 text-xs">
                          <span className="mr-1 font-semibold">{i + 1}.</span> {beat}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-2 text-sm">{t(`ttv.format.${brief.scriptFormat}.edit`)}</p>
                  </div>
                )}
                <p className="mt-2 text-xs text-[var(--text-muted)]">{t("ttv.format.hint")}</p>
              </Panel>

              <Panel>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <ScriptModelSelect
                    value={scriptModel}
                    disabled={locked}
                    onChange={patchScriptModel}
                  />
                  <Field label={t("ttv.target-seconds")} htmlFor="ttv-target-seconds">
                    <input
                      id="ttv-target-seconds"
                      className="input"
                      type="number"
                      min={TARGET_SECONDS_MIN}
                      max={TARGET_SECONDS_MAX}
                      value={targetSeconds}
                      disabled={locked}
                      placeholder={t("ttv.target-auto")}
                      onChange={(e) => setTargetSeconds(e.target.value)}
                    />
                  </Field>
                </div>
                <ClaudeAuthLine />
              </Panel>

              {session.status === "scripting" ? (
                <p className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  {t("ttv.scripting-hint")}
                </p>
              ) : script.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  description={hasSourceText ? t("ttv.no-script") : t("ttv.no-source-yet")}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <ul className="flex flex-col gap-2">
                    {script.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-2 w-5 shrink-0 text-center font-mono text-meta text-[var(--text-muted)]">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <textarea
                            className="input"
                            rows={2}
                            value={c.text}
                            disabled={locked}
                            aria-label={tf("ttv.chunk-aria", { n: i + 1 })}
                            onChange={(e) => setChunkText(i, e.target.value)}
                            onBlur={() => flush()}
                          />
                          <p className="mt-1 text-meta text-[var(--text-muted)]">
                            {tf("ttv.char-count", { n: c.text.trim().length })} ·{" "}
                            {c.durationSec !== null
                              ? tf("ttv.chunk-real", { time: clock(c.durationSec) })
                              : tf("ttv.chunk-est", {
                                  time: clock(estimateChunkSeconds(c)),
                                })}
                          </p>
                        </div>
                        <IconButton
                          size="sm"
                          tone="danger"
                          className="mt-2"
                          label={tf("ttv.remove-chunk-aria", { n: i + 1 })}
                          disabled={locked}
                          onClick={() =>
                            setChunks(
                              script.filter((_, idx) => idx !== i),
                              true
                            )
                          }
                        >
                          <X size={14} strokeWidth={2} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      variant="secondary"
                      small
                      disabled={locked}
                      onClick={() =>
                        setChunks([...script, { text: "", durationSec: null }], true)
                      }
                    >
                      <Plus size={14} strokeWidth={2} />
                      {t("ttv.add-chunk")}
                    </Button>
                    <span className="text-meta text-[var(--text-muted)]">
                      {tf("ttv.chunk-count", { n: script.length })} ·{" "}
                      {tf("ttv.char-count", { n: chars })} ·{" "}
                      {tf("ttv.est-duration", { time: clock(estSeconds) })}
                      {session.voiceDurationSec !== null
                        ? ` · ${tf("ttv.real-duration", { time: clock(session.voiceDurationSec) })}`
                        : ""}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--text-muted)]">
                    {t("ttv.estimate-warning")}
                  </p>
                </div>
              )}
            </div>
          </WorkspaceBlock>

          <WorkspaceBlock
            id="ttv-block-voice"
            icon={Mic}
            collapsed={group.isCollapsed("voice")}
            onToggle={() => group.toggle("voice")}
            summary={voiceSummary}
            hint={{
              titleKey: "help.ttv-voice.title",
              bodyKey: "help.ttv-voice.body",
            }}
            title={
              <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                {t("ttv.card-voice")}
                <Badge
                  tone={voice.name ? "running" : "muted"}
                  dot={false}
                  label={voice.name || t("ttv.voice-not-chosen")}
                  className="min-w-0 [&>span]:truncate truncate"
                />
              </span>
            }
          >
            <VoicePicker value={voice} onChange={patchVoice} disabled={locked} />
          </WorkspaceBlock>

          <WorkspaceBlock
            id="ttv-block-config"
            icon={Settings2}
            collapsed={group.isCollapsed("config")}
            onToggle={() => group.toggle("config")}
            summary={configSummary}
            title={t("ttv.card-config")}
            hint={{
              titleKey: "help.ttv-config.title",
              bodyKey: "help.ttv-config.body",
            }}
          >
            <div className="flex flex-col gap-4">
              <Field
                label={t("ttv.aspect")}
                hint={
                  currentAspect === null
                    ? tf("ttv.custom-size", {
                        size: `${output.width}x${output.height}`,
                      })
                    : undefined
                }
              >
                <OptionCardGroup
                  label={t("ttv.aspect")}
                  className="grid-cols-[repeat(auto-fit,minmax(120px,1fr))]"
                >
                  {ASPECTS.map((a) => {
                    const size = TEXT_TO_VIDEO_SIZES[a];
                    return (
                      <OptionCard
                        key={a}
                        selected={currentAspect === a}
                        disabled={locked}
                        onSelect={() =>
                          patchOutput({ width: size.width, height: size.height })
                        }
                        title={a}
                        description={`${size.width}x${size.height}`}
                      />
                    );
                  })}
                </OptionCardGroup>
              </Field>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                <Field label={t("ttv.fps")} htmlFor="ttv-fps">
                  <select
                    id="ttv-fps"
                    className="input"
                    value={output.fps}
                    disabled={locked}
                    onChange={(e) => patchOutput({ fps: Number(e.target.value) })}
                  >
                    {!TEXT_TO_VIDEO_FPS.includes(
                      output.fps as (typeof TEXT_TO_VIDEO_FPS)[number]
                    ) && <option value={output.fps}>{output.fps}</option>}
                    {TEXT_TO_VIDEO_FPS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Style Design" htmlFor="ttv-style">
                  <StyleSelect
                    id="ttv-style"
                    value={output.styleId}
                    disabled={locked}
                    onChange={(styleId) => patchOutput({ styleId })}
                  />
                </Field>
              </div>

              <div className="border-t border-[var(--border)] pt-4">
                <div className="mb-3 flex flex-col gap-1 text-sm text-[var(--text-muted)]">
                  <p>{locked ? t("ttv.brief-locked") : t("ttv.brief-hint")}</p>
                  {!locked && <p>{t("ttv.brief-autosave")}</p>}
                </div>
                <BriefFields
                  value={brief}
                  onChange={patchBrief}
                  show={{ styleId: false, sourceDescription: false }}
                  disabled={locked}
                />
              </div>
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          <OutputBlock
            id="ttv-block-build"
            status={outputStatus}
            videoUrl={child.url}
            progress={activeJob ? activeJob.progress : null}
            step={activeJob?.step}
            aspect={aspect}
            error={shortError(session.error)}
            collapsed={group.isCollapsed("build")}
            onToggle={() => group.toggle("build")}
            summary={buildSummary}
            title={t("ttv.card-build")}
            hint={{
              titleKey: "help.ttv-build.title",
              bodyKey: "help.ttv-build.body",
            }}
            actions={
              !session.projectId && (
                <Button disabled={!canBuild || busy !== null} onClick={() => run("build")}>
                  {busy === "build" ? (
                    <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <FileText size={15} strokeWidth={2} />
                  )}
                  {t("ttv.build")}
                </Button>
              )
            }
          >
            {child.error && <ErrorBanner message={child.error} />}

            {running ? (
              <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                {session.status === "voicing"
                  ? t("ttv.voicing-hint")
                  : t("ttv.building-hint")}
              </p>
            ) : session.projectId ? (
              !child.url && (
                <p className="text-sm text-[var(--text-muted)]">
                  {t("ttv.result-waiting")}
                </p>
              )
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                {canBuild
                  ? t("ttv.build-hint")
                  : script.length === 0
                    ? t("ttv.build-need-script")
                    : t("ttv.build-need-voice")}
              </p>
            )}

            {child.output && (
              <span className="min-w-0 truncate text-meta text-[var(--text-muted)]">
                {child.output}
              </span>
            )}

            {(session.voiceFile || session.transcriptFile) && (
              <div className="flex flex-wrap items-center gap-2">
                {session.voiceFile && (
                  <span className="chip">
                    {t("ttv.voice-file")}: {session.voiceFile}
                  </span>
                )}
                {session.transcriptFile && (
                  <span className="chip">
                    {t("ttv.transcript-file")}: {session.transcriptFile}
                  </span>
                )}
              </div>
            )}

            {session.projectId && (
              <Link
                href={`/projects/${session.projectId}`}
                className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--primary)]"
              >
                <ExternalLink size={14} strokeWidth={2} />
                {t("ttv.open-project-advanced")}
              </Link>
            )}
          </OutputBlock>

          <WorkspaceBlock
            id="ttv-block-child"
            icon={ListVideo}
            collapsed={group.isCollapsed("child")}
            onToggle={() => group.toggle("child")}
            summary={session.projectId ?? t("ttv.build.no-project")}
            title={t("ttv.build.child-title")}
          >
            {!session.projectId ? (
              <p className="text-sm text-[var(--text-muted)]">
                {t("ttv.build.no-project")}
              </p>
            ) : child.pipelineInput && deriveStage(child.pipelineInput) !== null ? (
              <div className="flex flex-col gap-2">
                <PipelineTimeline {...child.pipelineInput} />
                {child.runningJob ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <Loader2
                      size={14}
                      strokeWidth={2}
                      className="animate-spin shrink-0"
                    />
                    {tf("ttv.build.running-job", { label: child.runningJob.type })}
                    {child.runningJob.progress > 0
                      ? ` · ${child.runningJob.progress}%`
                      : ""}
                  </p>
                ) : (
                  !child.url && (
                    <p className="text-sm text-[var(--text-muted)]">
                      {t("ttv.build.long-warning")}
                    </p>
                  )
                )}
                <Link
                  href={`/projects/${session.projectId}`}
                  className="inline-flex w-fit items-center gap-1 text-sm font-medium text-[var(--primary)] hover:underline"
                >
                  <ExternalLink size={14} strokeWidth={2} />
                  {t("ttv.build.open-project")}
                </Link>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                {t("ttv.build.waiting")}
              </p>
            )}
          </WorkspaceBlock>
        </WorkspaceColumn>
      </Workspace>

      <ShellRightPanel title={t("ttv.ai-panel")}>
        {activeSession && (
          <div className="flex shrink-0 justify-end">
            <SessionStatusBadge status={activeSession.status} />
          </div>
        )}

        {job && <JobLogBlock job={job} />}

        {session.projectId ? (
          activeSessionId || (chatSessions !== null && chatSessions.length > 0) ? (
            <ChatThread
              compact
              sessionId={activeSessionId}
              projectId={session.projectId}
              initialStatus={activeSession?.status}
              session={activeSession}
              onSessionCreated={(id) => {
                setActiveSessionId(id);
                loadChatSessions();
              }}
            />
          ) : (
            <div className="card flex min-h-0 flex-1 flex-col items-center justify-center">
              <EmptyState
                icon={Sparkles}
                description={
                  chatSessions === null
                    ? t("ttv.panel-chat-loading")
                    : t("ttv.panel-no-session")
                }
              />
            </div>
          )
        ) : (
          <div className="card flex min-h-0 flex-1 flex-col items-center justify-center">
            <EmptyState icon={MessageSquare} description={t("ttv.panel-empty")} />
          </div>
        )}
      </ShellRightPanel>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("ttv.delete-title")}
        description={<p>{t("ttv.delete-desc")}</p>}
        items={[session.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />
    </div>
  );
}
