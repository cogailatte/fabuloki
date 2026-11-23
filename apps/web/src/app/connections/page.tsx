"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Bot,
  Loader2,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Sparkles,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getConnections,
  getTunnelStatus,
  setConnectionKey,
  setTunnelDomain,
  startTunnel,
  stopTunnel,
  testConnection,
  type ConnectionInfo,
  type TunnelStatus,
} from "@/lib/api";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { CopyButton } from "@/components/CopyButton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { Skeleton } from "@/components/Skeleton";
import { refreshProviders } from "@/components/ModelPicker";
import { useT } from "@/lib/i18n";
import {
  CardIcon,
  Row,
  SavedNotice,
  type ErrorReporter,
} from "./shared";

const ROLE_LABELS: Record<string, string> = {
  edit: "conn.role.edit",
  chat: "conn.role.chat",
  image: "conn.role.image",
};

const PROVIDER_ICONS: Record<ConnectionInfo["id"], LucideIcon> = {
  claude: Sparkles,
  gemini: ImageIcon,
  openai: Bot,
};

const KEY_PLACEHOLDERS: Record<ConnectionInfo["id"], string> = {
  claude: "sk-ant-...",
  gemini: "AIza...",
  openai: "sk-...",
};

function StatusBadge({ conn }: { conn: ConnectionInfo }) {
  const { t } = useT();
  if (!conn.connected) {
    return <Badge tone="muted" label={t("model.not-connected")} />;
  }
  return (
    <Badge
      tone="success"
      label={
        conn.source === "oauth"
          ? t("conn.connected-sub")
          : t("conn.connected-key")
      }
    />
  );
}

function ProviderCard({
  conn,
  onUpdate,
  onError,
}: {
  conn: ConnectionInfo;
  onUpdate: (list: ConnectionInfo[]) => void;
  onError: ErrorReporter;
}) {
  const { t } = useT();
  const Icon = PROVIDER_ICONS[conn.id] ?? Plug;

  const errKey = `key-${conn.id}`;

  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection(conn.id));
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  }, [conn.id]);

  async function onSaveKey() {
    const value = keyValue.trim();
    if (!value || saving) return;
    setSaving(true);
    onError(errKey, null);
    setSavedNotice(false);
    try {
      const res = await setConnectionKey(conn.id, value);
      onUpdate(res.connections);
      refreshProviders();
      setKeyValue("");
      setEditing(false);
      setShowKey(false);
      setSavedNotice(true);

      runTest();
    } catch (e) {
      onError(errKey, {
        message: t("conn.save-key-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false);

  async function onDeleteKey() {
    if (saving) return;
    setSaving(true);
    onError(errKey, null);
    setSavedNotice(false);
    setTestResult(null);
    try {
      const res = await setConnectionKey(conn.id, null);
      onUpdate(res.connections);
      refreshProviders();
      setEditing(false);
      setKeyValue("");
      setShowKey(false);
    } catch (e) {
      onError(errKey, {
        message: t("conn.delete-key-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
      setDeleteOpen(false);
    }
  }

  const showInput = !conn.key.present || editing;
  const inputId = `conn-key-${conn.id}`;

  const getKeyLink = (
    <a
      href={conn.keyHelpUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] hover:underline"
    >
      {t("conn.get-key")}
      <ExternalLink size={12} strokeWidth={2} className="shrink-0" />
    </a>
  );

  return (
    <Card
      title={
        <span className="flex min-w-0 items-center gap-2">
          <CardIcon icon={Icon} />
          <span className="truncate">{conn.label}</span>
        </span>
      }
      actions={<StatusBadge conn={conn} />}
    >
      <div className="divide-y divide-[var(--border)]">
        <Row>
          <div className="flex flex-wrap gap-1">
            {conn.roles.map((r) => (
              <span key={r} className="chip">
                {ROLE_LABELS[r] ? t(ROLE_LABELS[r]) : r}
              </span>
            ))}
          </div>
          {conn.note && (
            <p className="mt-2 text-sm text-[var(--text-muted)]">{conn.note}</p>
          )}
        </Row>

        <Row>
          <Field
            label={`API key (${conn.key.envVar})`}
            htmlFor={showInput ? inputId : undefined}
            hintKeys={{
              titleKey: "help.connections-key.title",
              bodyKey: "help.connections-key.body",
            }}
          >
            {showInput ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <input
                    id={inputId}
                    className="input pr-9"
                    type={showKey ? "text" : "password"}
                    value={keyValue}
                    placeholder={KEY_PLACEHOLDERS[conn.id] ?? "API key"}
                    autoComplete="off"
                    spellCheck={false}

                    disabled={saving}
                    onChange={(e) => setKeyValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveKey();
                    }}
                  />
                  <IconButton
                    label={showKey ? t("conn.hide-key") : t("conn.show-key")}
                    size="sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? (
                      <EyeOff size={15} strokeWidth={1.75} />
                    ) : (
                      <Eye size={15} strokeWidth={1.75} />
                    )}
                  </IconButton>
                </div>
                <Button
                  small
                  onClick={onSaveKey}
                  disabled={!keyValue.trim() || saving}
                >
                  {saving ? (
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <KeyRound size={13} strokeWidth={2} />
                  )}
                  {saving ? t("common.saving") : t("conn.save-key")}
                </Button>
                {editing && (
                  <Button
                    variant="secondary"
                    small
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      setKeyValue("");
                      setShowKey(false);
                      onError(errKey, null);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
                {getKeyLink}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-[var(--radius)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-meta">
                  {conn.key.masked}
                </code>
                <Button
                  variant="secondary"
                  small
                  disabled={saving}
                  onClick={() => {
                    setEditing(true);
                    setKeyValue("");
                    setSavedNotice(false);
                  }}
                >
                  <Pencil size={13} strokeWidth={2} />
                  {t("conn.change-key")}
                </Button>
                {getKeyLink}

                <Button
                  variant="destructive"
                  small
                  className="ml-auto"
                  disabled={saving}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  {saving ? t("common.deleting") : t("conn.delete-key")}
                </Button>
              </div>
            )}
          </Field>
          {savedNotice && (
            <p className="mt-2">
              <SavedNotice>{t("conn.saved")}</SavedNotice>
            </p>
          )}
        </Row>

        <Row>
          <div className="flex flex-col gap-2">
            <div>
              <Button
                variant="secondary"
                small
                onClick={runTest}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <PlugZap size={14} strokeWidth={2} />
                )}
                {testing ? t("conn.testing") : t("conn.test")}
              </Button>
            </div>
            {testResult && (
              <Banner
                tone={testResult.ok ? "success" : "danger"}
                message={testResult.message}
              />
            )}
          </div>
        </Row>

        {conn.id === "claude" && (
          <Row>
            <p className="text-meta text-[var(--text-muted)]">
              {t("conn.claude-note")}
            </p>
          </Row>
        )}
      </div>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("conn.delete-key-title")}
        description={
          <>
            {t("conn.delete-desc-1")}{" "}
            <span className="font-medium">{conn.label}</span>? {t("conn.delete-desc-2")}
          </>
        }
        busy={saving}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDeleteKey}
      />
    </Card>
  );
}

const CLOUDFLARED_DL_URL =
  "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

function TunnelCard({ onError }: { onError: ErrorReporter }) {
  const { t } = useT();
  const [status, setStatus] = useState<TunnelStatus | null>(null);

  const [domainValue, setDomainValue] = useState("");
  const [domainDirty, setDomainDirty] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);

  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getTunnelStatus();
      setStatus(s);
      onError("tunnel-load", null);
    } catch (e) {
      onError("tunnel-load", {
        message: t("tunnel.load-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }, [onError, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const iv = setInterval(load, status?.running ? 4000 : 10000);
    return () => clearInterval(iv);
  }, [load, status?.running]);

  useEffect(() => {
    if (status && !domainDirty) setDomainValue(status.domain ?? "");
  }, [status, domainDirty]);

  async function onSaveDomain() {
    if (savingDomain) return;
    setSavingDomain(true);
    onError("tunnel-action", null);
    setDomainSaved(false);
    try {
      const s = await setTunnelDomain(domainValue.trim() || null);
      setStatus(s);
      setDomainDirty(false);
      setDomainSaved(true);
    } catch (e) {
      onError("tunnel-action", {
        message: t("tunnel.domain-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingDomain(false);
    }
  }

  async function onToggle() {
    if (!status || busy) return;
    const wasRunning = status.running;
    setBusy(true);
    onError("tunnel-action", null);
    try {
      if (wasRunning) await stopTunnel();
      else await startTunnel();
      await load();
    } catch (e) {
      onError("tunnel-action", {
        message: wasRunning ? t("tunnel.stop-error") : t("tunnel.start-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const running = !!status?.running;

  return (
    <Card
      title={
        <span className="flex min-w-0 items-center gap-2">
          <CardIcon icon={Globe} />
          <span className="truncate">{t("tunnel.title")}</span>
        </span>
      }
      hint={{ titleKey: "help.tunnel.title", bodyKey: "help.tunnel.body" }}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          {status && (
            <Badge
              tone={running ? "success" : "muted"}
              label={running ? t("tunnel.running") : t("tunnel.stopped")}
            />
          )}
          {running && status?.mode && (
            <span className="chip">
              {status.mode === "named"
                ? t("tunnel.mode-named")
                : t("tunnel.mode-quick")}
            </span>
          )}
        </span>
      }
    >
      <div className="divide-y divide-[var(--border)]">
        <Row>
          <p className="text-sm text-[var(--text-muted)]">{t("tunnel.desc")}</p>

          {status && !status.installed && (
            <div className="mt-2">
              <Banner tone="danger" message={t("tunnel.not-installed")}>
                <p className="mt-1 text-meta">
                  {t("tunnel.install-cmd")}{" "}
                  <code className="select-all font-mono">
                    winget install --id Cloudflare.cloudflared
                  </code>
                </p>
                <a
                  href={CLOUDFLARED_DL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-meta font-medium text-[var(--primary)] hover:underline"
                >
                  {t("tunnel.install-link")}
                  <ExternalLink size={12} strokeWidth={2} className="shrink-0" />
                </a>
              </Banner>
            </div>
          )}
        </Row>

        <Row>
          <Field
            label={t("tunnel.domain-label")}
            htmlFor="tunnel-domain"
            hint={t("tunnel.domain-hint")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="tunnel-domain"
                className="input min-w-[220px] flex-1"
                type="text"
                value={domainValue}
                placeholder="upload.example.com"
                autoComplete="off"
                spellCheck={false}
                disabled={savingDomain}
                onChange={(e) => {
                  setDomainValue(e.target.value);
                  setDomainDirty(true);
                  setDomainSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveDomain();
                }}
              />
              <Button
                small
                variant="secondary"
                onClick={onSaveDomain}
                disabled={savingDomain || !domainDirty}
              >
                {savingDomain ? (
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Check size={13} strokeWidth={2} />
                )}
                {savingDomain ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </Field>
          {domainSaved && (
            <p className="mt-2">
              <SavedNotice>{t("tunnel.domain-saved")}</SavedNotice>
            </p>
          )}
        </Row>

        <Row>
          <div className="flex flex-wrap items-center gap-3">

            <Button
              small
              variant={running ? "secondary" : "primary"}
              onClick={onToggle}
              disabled={busy || !status || (!running && !status.installed)}
            >
              {busy ? (
                <Loader2 size={13} strokeWidth={2} className="animate-spin" />
              ) : running ? (
                <Square size={13} strokeWidth={2} />
              ) : (
                <Play size={13} strokeWidth={2} />
              )}
              {busy
                ? running
                  ? t("tunnel.stopping")
                  : t("tunnel.starting")
                : running
                  ? t("tunnel.stop")
                  : t("tunnel.start")}
            </Button>
            {running && !status?.url && (
              <span className="text-meta text-[var(--text-muted)]">
                {t("tunnel.url-pending")}
              </span>
            )}
          </div>

          {running && status?.url && (
            <div className="mt-3">
              <p className="label mb-1">{t("tunnel.url-label")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="select-all break-all rounded-[var(--radius)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-meta">
                  {status.url}
                </code>
                <CopyButton value={status.url} label={t("tunnel.copy")} />
              </div>
              <p className="mt-1 text-meta text-[var(--text-muted)]">
                {t("tunnel.qr-note")}
              </p>
            </div>
          )}
        </Row>

        {status && status.lastLog.length > 0 && (
          <Row>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-meta font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]"
              aria-expanded={logOpen}
              onClick={() => setLogOpen((v) => !v)}
            >
              <ChevronDown
                size={13}
                strokeWidth={2}
                className={`shrink-0 transition-transform ${logOpen ? "" : "-rotate-90"}`}
              />
              {t("tunnel.log")}
            </button>
            {logOpen && (
              <Panel className="mt-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-meta text-[var(--text-muted)]">
                  {status.lastLog.join("\n")}
                </pre>
              </Panel>
            )}
          </Row>
        )}

        <Row>
          <Banner tone="danger" message={t("tunnel.warn-public")} />
        </Row>
      </div>
    </Card>
  );
}

export default function ConnectionsPage() {
  const { t } = useT();
  const [connections, setConnections] = useState<ConnectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [actionErrors, setActionErrors] = useState<
    Record<string, { message: string; detail?: string }>
  >({});
  const report = useCallback<ErrorReporter>((key, err) => {
    setActionErrors((prev) => {
      if (!err) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: err };
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await getConnections();
      setConnections(res.connections);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={t("nav.connections")}
        hint={{
          titleKey: "help.connections.title",
          bodyKey: "help.connections.body",
        }}
        subtitle={t("conn.subtitle")}
      />

      {error && (
        <ErrorBanner message={t("conn.load-error")} detail={error} />
      )}

      {Object.entries(actionErrors).map(([key, e]) => (
        <ErrorBanner key={key} message={e.message} detail={e.detail} />
      ))}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {connections === null && !error
          ? [0, 1, 2].map((i) => (
              <Skeleton key={i} className="w-full" height={220} />
            ))
          : (connections ?? []).map((c) => (
              <ProviderCard
                key={c.id}
                conn={c}
                onUpdate={setConnections}
                onError={report}
              />
            ))}
        <TunnelCard onError={report} />
      </div>

      {connections && connections.length === 0 && (
        <Card>
          <EmptyState icon={Plug} description={t("conn.empty")} />
        </Card>
      )}
    </div>
  );
}
