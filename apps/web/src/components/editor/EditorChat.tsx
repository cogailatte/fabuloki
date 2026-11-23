"use client";

import { MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/Banner";
import { ChatThread } from "@/components/ChatThread";
import { IconButton } from "@/components/IconButton";
import { LinkButton } from "@/components/LinkButton";
import { ShellRightPanel, useRevealShellPanel } from "@/components/Shell";
import {
  getChatSessions,
  getHealth,
  sendEditorChat,
  type AgentEffort,
  type ChatSession,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useEvents } from "@/lib/useEvents";

const EDITOR_TITLE_PREFIX = "Trình chỉnh sửa:";

export function EditorChat({
  projectId,
  onSessionStarted,
  beforeSend,
  queued = null,
}: {
  projectId: string;

  beforeSend: () => Promise<boolean>;

  onSessionStarted: (sessionId: string) => void;

  queued?: { id: number; text: string } | null;
}) {
  const { t } = useT();
  const reveal = useRevealShellPanel();

  useEffect(() => {
    if (queued) reveal();
  }, [queued, reveal]);
  const { resyncTick } = useEvents();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  const loadSessions = useCallback(
    async (pick: boolean) => {
      try {
        const list = await getChatSessions(projectId);
        if (pick) {
          const latest = list
            .filter((s) => s.title.startsWith(EDITOR_TITLE_PREFIX))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          setSessionId(latest?.sessionId ?? null);
          setSession(latest ?? null);
        } else {
          const cur = sessionIdRef.current;
          setSession(list.find((s) => s.sessionId === cur) ?? null);
        }
      } catch {

      } finally {
        setReady(true);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadSessions(true);
  }, [loadSessions]);

  useEffect(() => {
    if (resyncTick > 0) void loadSessions(false);
  }, [resyncTick, loadSessions]);

  const [claudeAuth, setClaudeAuth] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => {
        if (alive) setClaudeAuth(h.checks?.claudeAuth !== false);
      })
      .catch(() => {
        if (alive) setClaudeAuth(null);
      });
    return () => {
      alive = false;
    };
  }, [resyncTick]);

  const send = useCallback(
    async (message: string, current: string | undefined, opts?: { model?: string; effort?: AgentEffort }) => {
      if (!(await beforeSend())) throw new Error(t("editor.chat.save-first"));
      return sendEditorChat(projectId, message, current, opts);
    },
    [projectId, beforeSend, t],
  );

  return (
    <ShellRightPanel title={t("editor.chat.title")}>
      <div className="flex shrink-0 items-start justify-between gap-2">
        <p className="min-w-0 text-meta text-[var(--text-muted)]">{t("editor.chat.hint")}</p>
        <IconButton
          label={t("editor.chat.new")}
          disabled={sessionId === null}
          onClick={() => {
            setSessionId(null);
            setSession(null);
          }}
        >
          <MessageSquarePlus size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      {claudeAuth === false && (
        <Banner
          tone="info"
          message={t("editor.chat.no-auth")}
          actions={
            <LinkButton href="/connections" small>
              {t("editor.chat.no-auth-link")}
            </LinkButton>
          }
        />
      )}
      {ready && (
        <ChatThread
          sendDisabled={claudeAuth === false}
          compact
          providersEnabled
          sessionId={sessionId}
          projectId={projectId}
          initialStatus={session?.status}
          session={session}
          send={send}
          emptyText={t("editor.chat.empty")}
          queued={queued}
          onSessionCreated={(id) => {
            sessionIdRef.current = id;
            setSessionId(id);
            onSessionStarted(id);
            void loadSessions(false);
          }}
        />
      )}
    </ShellRightPanel>
  );
}
