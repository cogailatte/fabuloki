"use client";

import { MessageSquare, Send, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatMessages,
  getChatSessions,
  interruptChat,
  sendChat,
  setChatAutoResume,
  type AgentEffort,
  type ChatSession,
  type ChatSessionStatus,
} from "@/lib/api";
import { useAgentEvents } from "@/lib/useEvents";
import {
  AiModelInlineRow,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
} from "@/components/ModelPicker";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { useT } from "@/lib/i18n";

interface UiMessage {
  role: "user" | "assistant";
  kind: "text" | "tool";
  content: string;
  toolName?: string;
}

function truncate(s: string, max = 100): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function ToolChip({ name, input }: { name: string; input?: string }) {
  return (
    <span className="chip">
      <Wrench size={12} strokeWidth={2} className="shrink-0" />
      <span className="font-medium text-[var(--text)]">{name}</span>
      {input && <span className="truncate">{truncate(input)}</span>}
    </span>
  );
}

export function toolActionLabel(
  name: string,
  input: unknown,
  t: (key: string) => string
): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const file =
    typeof inp.file_path === "string"
      ? String(inp.file_path).split(/[\\/]/).pop()
      : undefined;
  const sub = (key: string, vars: Record<string, string>) => {
    let out = t(key);
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(v);
    }
    return out;
  };
  switch (name) {
    case "Bash":
      return typeof inp.description === "string" && inp.description
        ? sub("chat.tool.bash-desc", { desc: inp.description })
        : t("chat.tool.bash");
    case "Read":
      return file ? sub("chat.tool.read-file", { file }) : t("chat.tool.read");
    case "Write":
      return file ? sub("chat.tool.write-file", { file }) : t("chat.tool.write");
    case "Edit":
      return file ? sub("chat.tool.edit-file", { file }) : t("chat.tool.edit");
    case "Glob":
    case "Grep":
      return t("chat.tool.search");
    case "Skill":
      return typeof inp.skill === "string"
        ? sub("chat.tool.skill-name", { skill: inp.skill })
        : t("chat.tool.skill");
    case "TodoWrite":
      return t("chat.tool.todo");
    case "WebFetch":
    case "WebSearch":
      return t("chat.tool.web");
    default:
      return sub("chat.tool.generic", { name });
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Bubble({ msg, compact }: { msg: UiMessage; compact: boolean }) {
  if (msg.kind === "tool") {
    return (
      <div className="flex justify-start">
        <ToolChip name={msg.toolName ?? "tool"} input={msg.content} />
      </div>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>

      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-[var(--radius-lg)] text-sm ${
          compact ? "px-3 py-2" : "px-4 py-2.5"
        } ${
          isUser
            ? "bg-[var(--primary-soft)]"
            : "border border-[var(--border)] bg-[var(--surface)]"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}

function SessionEndBlock({
  status,
  finalText,
}: {
  status: ChatSessionStatus;
  finalText: string | null;
}) {
  const { t } = useT();
  const text = finalText ? (
    <p className="mt-1.5 whitespace-pre-wrap text-sm">{finalText}</p>
  ) : null;

  if (status === "done") {
    return (
      <Banner tone="success" message={t("chat.done")}>
        {text}
      </Banner>
    );
  }
  if (status === "error") {
    return (
      <Banner tone="danger" message={t("chat.ended-error")}>
        {text}
      </Banner>
    );
  }
  if (status === "interrupted") {
    return <Banner tone="muted" message={t("chat.interrupted")} />;
  }
  return null;
}

export function ChatThread({
  sessionId,
  projectId,
  initialStatus,
  session = null,
  onSessionCreated,
  compact = false,
  providersEnabled = false,
  send,
  emptyText,
  sendDisabled = false,
  queued = null,
}: {
  sessionId: string | null;
  projectId?: string;

  initialStatus?: ChatSessionStatus;

  session?: ChatSession | null;
  onSessionCreated?: (id: string) => void;
  compact?: boolean;

  providersEnabled?: boolean;

  send?: (
    message: string,
    sessionId: string | undefined,
    opts?: { model?: string; effort?: AgentEffort }
  ) => Promise<{ sessionId: string }>;

  emptyText?: string;

  sendDisabled?: boolean;

  queued?: { id: number; text: string } | null;
}) {
  const { t, tf } = useT();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streamText, setStreamText] = useState("");
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [status, setStatus] = useState<ChatSessionStatus | null>(null);

  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState<AgentEffort>(DEFAULT_EFFORT);
  const initialStatusRef = useRef(initialStatus);
  initialStatusRef.current = initialStatus;
  const sessionPropRef = useRef(session);
  sessionPropRef.current = session;

  const [sessionInfo, setSessionInfo] = useState<ChatSession | null>(null);

  const [steps, setSteps] = useState(0);
  const [currentAction, setCurrentAction] = useState(t("chat.thinking"));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [justFailed, setJustFailed] = useState(false);

  useEffect(() => {
    if (!running || startedAt === null) return;

    const t = setInterval(
      () => setElapsed(Math.max(0, Date.now() - startedAt)),
      1000
    );
    return () => clearInterval(t);
  }, [running, startedAt]);

  const markRunning = useCallback(() => {
    setRunning((r) => {
      if (!r) {
        setStartedAt((s) => s ?? Date.now());
      }
      return true;
    });
  }, []);

  const activeIdRef = useRef<string | null | undefined>(undefined);
  const streamRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const stickRef = useRef(true);

  const flushStream = useCallback(() => {
    const text = streamRef.current;
    streamRef.current = "";
    setStreamText("");
    if (text) {
      setMessages((m) => [
        ...m,
        { role: "assistant", kind: "text", content: text },
      ]);
    }
  }, []);

  useEffect(() => {
    if (sessionId === activeIdRef.current) return;
    activeIdRef.current = sessionId;
    stickRef.current = true;
    streamRef.current = "";
    setStreamText("");
    setMessages([]);
    setAgentError(null);
    setLoadError(null);
    const savedSession =
      sessionId && sessionPropRef.current?.sessionId === sessionId
        ? sessionPropRef.current
        : null;
    setSessionInfo(savedSession);

    const saved = sessionId ? (initialStatusRef.current ?? null) : null;
    setStatus(saved);
    setJustFailed(false);
    if (saved === "running") {
      setRunning(true);

      const runStarted = savedSession?.runStartedAt
        ? Date.parse(savedSession.runStartedAt)
        : NaN;
      const started = Number.isFinite(runStarted) ? runStarted : Date.now();
      setStartedAt(started);
      setElapsed(Math.max(0, Date.now() - started));
      setSteps(0);
      setCurrentAction(t("chat.working"));
    } else {
      setRunning(false);
    }
    if (!sessionId) return;
    let stale = false;
    (async () => {
      try {
        const history = await getChatMessages(sessionId);
        if (stale) return;
        setMessages(
          history.map((m) => ({
            role: m.role,
            kind: m.kind,
            content: m.content,
          }))
        );
      } catch (e) {
        if (!stale) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      stale = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (session && session.sessionId === activeIdRef.current) {
      setSessionInfo(session);

      if (session.status === "running" && session.runStartedAt) {
        const t = Date.parse(session.runStartedAt);
        if (Number.isFinite(t)) {
          setStartedAt((s) => (s !== null && t < s ? t : s));
        }
      }

      if (session.status === "running" && !running) {
        setRunning(true);
        setStatus("running");
        const ts = session.runStartedAt
          ? Date.parse(session.runStartedAt)
          : NaN;
        setStartedAt(Number.isFinite(ts) ? ts : Date.now());
        setCurrentAction(t("chat.working"));
      }

      const finished = session.runFinishedAt ? Date.parse(session.runFinishedAt) : NaN;
      if (
        running &&
        session.status !== "running" &&
        Number.isFinite(finished) &&
        startedAt !== null &&
        finished >= startedAt
      ) {
        flushStream();
        setStatus(session.status);
        setRunning(false);
        setStartedAt(null);
        setJustFailed(session.status === "error");
      }
    }

  }, [session]);

  const refreshSession = useCallback(async () => {
    const current = activeIdRef.current;
    if (!current) return;
    try {
      const list = await getChatSessions(projectId);
      const found = list.find((s) => s.sessionId === current);
      if (found && activeIdRef.current === current) {
        setSessionInfo(found);

        setStatus(found.status);
      }
    } catch {

    }
  }, [projectId]);

  useAgentEvents((e) => {
    if (!activeIdRef.current || e.sessionId !== activeIdRef.current) return;
    switch (e.kind) {
      case "text":
        markRunning();
        setStatus("running");
        setCurrentAction(t("dash.composing"));
        streamRef.current += e.text ?? "";
        setStreamText(streamRef.current);
        break;
      case "tool":
        markRunning();
        setStatus("running");
        setSteps((n) => n + 1);
        setCurrentAction(
          toolActionLabel(e.tool?.name ?? "tool", e.tool?.input, t)
        );

        flushStream();
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            kind: "tool",
            toolName: e.tool?.name ?? "tool",
            content:
              e.tool?.input !== undefined ? JSON.stringify(e.tool.input) : "",
          },
        ]);
        break;
      case "result":

        if (!streamRef.current && e.text) {
          setMessages((m) => [
            ...m,
            { role: "assistant", kind: "text", content: e.text ?? "" },
          ]);
        } else {
          flushStream();
        }
        break;
      case "error":
        flushStream();
        setAgentError(e.error ?? t("chat.unknown-error"));
        setStatus("error");
        setRunning(false);

        setStartedAt(null);
        setJustFailed(true);
        refreshSession();
        break;
      case "done":

        flushStream();
        if (e.status) setStatus(e.status);
        setRunning(false);
        setStartedAt(null);
        setJustFailed(e.status === "error");

        refreshSession();
        break;
    }
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, status]);

  const onSendRef = useRef<(override?: string) => Promise<void>>(async () => {});
  onSendRef.current = onSend;
  const takenQueuedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!queued || takenQueuedRef.current === queued.id) return;
    takenQueuedRef.current = queued.id;
    if (running || sendDisabled) {
      setInput((cur) => (cur.trim() ? `${cur}
${queued.text}` : queued.text));
      return;
    }
    void onSendRef.current(queued.text);
  }, [queued, running, sendDisabled]);

  async function onSend(override?: string) {
    const message = (override ?? input).trim();
    if (!message || running || sendDisabled) return;
    if (override === undefined) setInput("");

    stickRef.current = true;
    setAgentError(null);
    setMessages((m) => [...m, { role: "user", kind: "text", content: message }]);
    setSteps(0);
    setCurrentAction(t("chat.thinking"));
    setStartedAt(Date.now());
    setElapsed(0);
    setRunning(true);
    setStatus("running");
    setJustFailed(false);

    const runStartedBefore = sessionInfo?.runStartedAt ?? null;
    try {
      const current = activeIdRef.current;

      const opts = !current && providersEnabled ? { model, effort } : undefined;
      const res = send
        ? await send(message, current ?? undefined, opts)
        : await sendChat(
            message,
            current ?? undefined,
            current ? undefined : projectId,
            opts
          );
      if (res.sessionId !== current) {
        activeIdRef.current = res.sessionId;
        onSessionCreated?.(res.sessionId);
      }
      void reconcileAfterSend(res.sessionId, runStartedBefore, message);
    } catch (e) {

      setMessages((m) => m.slice(0, -1));
      setInput((cur) => (override === undefined ? message : cur || message));
      setRunning(false);
      setStatus(null);
      setAgentError(e instanceof Error ? e.message : String(e));
    }
  }

  async function reconcileAfterSend(id: string, runStartedBefore: string | null, sent: string) {
    let found: ChatSession | undefined;
    try {
      found = (await getChatSessions(projectId)).find((s) => s.sessionId === id);
    } catch {
      return;
    }
    if (!found || activeIdRef.current !== id || found.status === "running") return;
    const started = found.runStartedAt !== null && found.runStartedAt !== runStartedBefore;
    setSessionInfo(found);
    flushStream();
    setRunning(false);
    setStartedAt(null);
    if (started) {

      setStatus(found.status);
      setJustFailed(found.status === "error");
      return;
    }

    setMessages((m) => (m.length > 0 && m[m.length - 1].role === "user" ? m.slice(0, -1) : m));
    setInput((cur) => cur || sent);
    setStatus(null);
    setAgentError((e) => e ?? t("chat.run-not-started"));
  }

  async function onInterrupt() {
    const current = activeIdRef.current;
    if (!current) return;
    try {
      await interruptChat(current);
      setRunning(false);
      setStartedAt(null);
      setStatus("interrupted");
      refreshSession();
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onToggleAutoResume() {
    const current = activeIdRef.current;
    if (!current || !sessionInfo) return;
    const next = !sessionInfo.autoResume;
    setSessionInfo((s) => (s ? { ...s, autoResume: next } : s));
    try {
      await setChatAutoResume(current, next);
    } catch (e) {
      setSessionInfo((s) => (s ? { ...s, autoResume: !next } : s));
      setAgentError(e instanceof Error ? e.message : String(e));
    }
  }

  const showEndBlock =
    !running &&
    (status === "done" || status === "error" || status === "interrupted");

  let runDurationMs: number | null = null;
  if (
    showEndBlock &&
    sessionInfo?.runStartedAt &&
    sessionInfo?.runFinishedAt
  ) {
    const d =
      Date.parse(sessionInfo.runFinishedAt) -
      Date.parse(sessionInfo.runStartedAt);
    if (Number.isFinite(d)) runDurationMs = Math.max(0, d);
  }
  const runDurationLabel =
    runDurationMs !== null
      ? status === "done"
        ? tf("chat.done-in", { time: formatElapsed(runDurationMs) })
        : tf("chat.stopped-after", { time: formatElapsed(runDurationMs) })
      : null;

  const willAutoResume =
    !running && justFailed && status === "error" && sessionInfo?.autoResume === true;
  let visibleMessages = messages;
  let finalText: string | null = null;
  if (showEndBlock) {
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant" && last.kind === "text") {
      finalText = last.content;
      visibleMessages = messages.slice(0, -1);
    }
  }

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-0">

      {sessionId && status && (

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
          <h2 className="text-sm font-semibold">{t("chat.session")}</h2>
          <div className="flex min-w-0 items-center gap-3">
            {runDurationLabel && (
              <span className="truncate text-meta text-[var(--text-muted)]">
                {runDurationLabel}
              </span>
            )}
            {sessionInfo && (
              <span
                className="flex shrink-0 items-center gap-2"
                title={t("chat.auto-resume-title")}
              >
                <button
                  type="button"
                  className="cursor-pointer text-meta text-[var(--text-muted)]"
                  onClick={onToggleAutoResume}
                >
                  {t("chat.auto-resume")}
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sessionInfo.autoResume}
                  aria-label={t("chat.auto-resume-aria")}
                  className="switch"
                  onClick={onToggleAutoResume}
                />
              </span>
            )}
            <SessionStatusBadge status={status} large />
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
          compact ? "gap-2 p-3" : "gap-3 p-4"
        }`}
      >
        {loadError && (
          <ErrorBanner message={t("chat.history-error")} detail={loadError} />
        )}
        {messages.length === 0 && !streamText && !loadError && !running && (
          <EmptyState
            icon={MessageSquare}
            description={emptyText ?? t("chat.empty")}
          />
        )}
        {visibleMessages.map((m, i) => (
          <Bubble key={i} msg={m} compact={compact} />
        ))}
        {streamText && (
          <Bubble
            msg={{ role: "assistant", kind: "text", content: streamText }}
            compact={compact}
          />
        )}
        {running && !streamText && (
          <p className="text-sm text-[var(--text-muted)]">
            {t("chat.claude-working")}
          </p>
        )}
        {agentError && (
          <ErrorBanner message={t("chat.agent-error")} detail={agentError} />
        )}
        {showEndBlock && status && (
          <SessionEndBlock status={status} finalText={finalText} />
        )}
        {willAutoResume && (
          <p className="text-sm text-[var(--text-muted)]">
            {t("chat.will-resume")}
          </p>
        )}
      </div>

      {running && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
          <div className="progress-indeterminate" aria-label={t("dash.ai-working")} />
          <div className="flex items-center justify-between text-meta text-[var(--text-muted)]">
            <span className="truncate">{currentAction}</span>
            <span className="shrink-0 pl-3">
              {steps > 0 && <>{tf("chat.step-n", { n: steps })} · </>}
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>
      )}

      {providersEnabled && !sessionId && !running && (
        <div
          className={`border-t border-[var(--border)] bg-[var(--bg-subtle)] ${
            compact ? "px-2 py-1.5" : "px-3 py-2"
          }`}
        >
          <AiModelInlineRow
            model={model}
            effort={effort}
            onModelChange={setModel}
            onEffortChange={setEffort}
          />
        </div>
      )}

      <div
        className={`flex items-end gap-2 border-t border-[var(--border)] ${
          compact ? "p-2" : "p-3"
        }`}
      >
        <textarea

          className="input flex-1"
          rows={1}
          placeholder={
            compact ? t("chat.placeholder-compact") : t("chat.placeholder")
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
        />
        {running ? (
          <Button variant="destructive" small={compact} onClick={onInterrupt}>
            <Square size={14} strokeWidth={2} />
            {t("chat.stop")}
          </Button>
        ) : (
          <Button small={compact} onClick={() => void onSend()} disabled={!input.trim() || sendDisabled}>
            <Send size={14} strokeWidth={2} />
            {t("chat.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
