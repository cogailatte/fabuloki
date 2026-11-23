"use client";


import { ExternalLink, FileText, Link2, Loader2, Trash2, Type } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTextToVideo,
  deleteTextToVideo,
  estimateScriptSeconds,
  extractTextToVideo,
  getTextToVideoSessions,
  isTextToVideoJob,
  TEXT_TO_VIDEO_STATUS_LABEL,
  TEXT_TO_VIDEO_STATUS_TONE,
  updateTextToVideo,
  type ScriptFormat,
  type TextSourceKind,
  type TextToVideoMeta,
  type TextToVideoStatus,
} from "@/lib/api";
import { useAgentEvents, useEvents, useJobEvents } from "@/lib/useEvents";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/Segmented";
import { TableSkeleton } from "@/components/Skeleton";
import { Toolbar } from "@/components/Toolbar";
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

function TtvStatusBadge({ status }: { status: TextToVideoStatus }) {
  const { t } = useT();
  const tone = TEXT_TO_VIDEO_STATUS_TONE[status] ?? "muted";
  const key = TEXT_TO_VIDEO_STATUS_LABEL[status];
  return <Badge tone={tone} label={key ? t(key) : t("common.status-unknown")} />;
}

function sourceLine(s: TextToVideoMeta): string {
  if (s.source.kind === "url") return s.source.url;
  const text = s.source.text.trim().replace(/\s+/g, " ");
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function CreateModal({
  open,
  onClose,
  onCreated,
  initialFormat,
}: {
  initialFormat: ScriptFormat | null;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<TextSourceKind>(initialFormat ? "text" : "url");
  const [format, setFormat] = useState<ScriptFormat | null>(initialFormat);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canCreate =
    !creating && (kind === "url" ? url.trim() !== "" : text.trim() !== "");

  async function onCreate() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    let id = createdId;
    try {
      if (!id) {
        const session = await createTextToVideo({
          ...(name.trim() ? { name: name.trim() } : {}),
          source: { kind, url: url.trim(), text: text.trim() },
          brief: { scriptFormat: format },
        });
        id = session.id;
        setCreatedId(id);
      } else {
        await updateTextToVideo(id, {
          ...(name.trim() ? { name: name.trim() } : {}),
          source: { kind, url: url.trim(), text: text.trim() },
          brief: { scriptFormat: format },
        });
      }
      if (kind === "url") await extractTextToVideo(id);
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title={t("ttv.create-title")}
      open={open}
      onClose={() => {
        if (!creating) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={creating} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {createdId && error ? (
            <Button onClick={() => onCreated(createdId)}>
              {t("ttv.open-session")}
            </Button>
          ) : null}
          <Button disabled={!canCreate} onClick={onCreate}>
            {creating ? (
              <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            ) : (
              <FileText size={15} strokeWidth={2} />
            )}
            {creating ? t("ttv.creating") : t("ttv.create")}
          </Button>
        </>
      }
    >
      {error && (
        <ErrorBanner
          message={createdId ? t("ttv.extract-error-created") : t("ttv.create-error")}
          detail={error}
        />
      )}

      <Field label={t("ttv.format")} htmlFor="ttv-new-format">
        <select id="ttv-new-format" className="input" value={format ?? ""}
          disabled={creating} onChange={(e) => setFormat((e.target.value || null) as ScriptFormat | null)}>
          <option value="">{t("ttv.format.default")}</option>
          <option value="mood">Voiceoff / Mood</option>
          <option value="painpoint">Painpoint</option>
          <option value="debate">{t("ttv.format.debate")}</option>
          <option value="tour">Housetour</option>
        </select>
      </Field>

      <Field
        label={t("ttv.source")}
        hintKeys={{
          titleKey: "help.ttv-source.title",
          bodyKey: "help.ttv-source.body",
        }}
      >
        <Segmented
          label={t("ttv.source")}
          value={kind}
          disabled={creating}
          onChange={(v) => setKind(v)}
          options={[
            {
              value: "url" as TextSourceKind,
              label: (
                <>
                  <Link2 size={13} strokeWidth={2} aria-hidden="true" />
                  {t("ttv.source.url")}
                </>
              ),
            },
            {
              value: "text" as TextSourceKind,
              label: (
                <>
                  <Type size={13} strokeWidth={2} aria-hidden="true" />
                  {t("ttv.source.text")}
                </>
              ),
            },
          ]}
        />
      </Field>

      {kind === "url" ? (
        <Field label={t("ttv.url")} htmlFor="ttv-url" hint={t("ttv.url-hint")}>
          <input
            id="ttv-url"
            className="input"
            value={url}
            disabled={creating}
            placeholder={t("ttv.url-placeholder")}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
      ) : (
        <Field label={t("ttv.text")} htmlFor="ttv-text" hint={t("ttv.text-hint")}>
          <textarea
            id="ttv-text"
            className="input"
            rows={8}
            value={text}
            disabled={creating}
            placeholder={t("ttv.text-placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      )}

      <Field label={t("ttv.name")} htmlFor="ttv-name">
        <input
          id="ttv-name"
          className="input"
          value={name}
          disabled={creating}
          placeholder={t("ttv.name-placeholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

export default function TextToVideoPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const { resyncTick } = useEvents();

  const [sessions, setSessions] = useState<TextToVideoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [initialFormat, setInitialFormat] = useState<ScriptFormat | null>(null);
  const [query, setQuery] = useState("");

  const [target, setTarget] = useState<TextToVideoMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await getTextToVideoSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, resyncTick]);

  useJobEvents((job) => {
    if (!isTextToVideoJob(job)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !sessions) return sessions;
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        sourceLine(s).toLowerCase().includes(q)
    );
  }, [sessions, query]);

  async function onDelete() {
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTextToVideo(target.id);
      setTarget(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.text-to-video")}
        hint={{ titleKey: "help.ttv.title", bodyKey: "help.ttv.body" }}
        subtitle={t("ttv.subtitle")}
        actions={
          <Button onClick={() => { setInitialFormat(null); setCreateOpen(true); }}>
            <FileText size={16} strokeWidth={2} />
            {t("ttv.new")}
          </Button>
        }
      />

      <section aria-label={t("ttv.choose-format")} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("ttv.choose-format")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([
            { id: "mood", label: "Voiceoff / Mood" },
            { id: "painpoint", label: "Painpoint" },
            { id: "debate", label: t("ttv.format.debate") },
            { id: "tour", label: "Housetour" },
          ] as const).map(({ id, label }, i) => (
            <button
              key={id}
              type="button"
              className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              onClick={() => { setInitialFormat(id); setCreateOpen(true); }}
            >
              <span className="text-xs font-semibold text-[var(--primary-ink)]">0{i + 1}</span>
              <span className="text-lg font-semibold">{label}</span>
              <span className="text-sm text-[var(--text-muted)]">{t(`ttv.format.${id}.edit`)}</span>
              <span className="text-xs text-[var(--text-muted)]">{t(`ttv.format.${id}.flow`).split("|").join(" → ")}</span>
              <span className="mt-auto pt-2 text-sm font-semibold text-[var(--primary-ink)]">{t("ttv.start-format")} →</span>
            </button>
          ))}
        </div>
      </section>

      {error && <ErrorBanner message={t("ttv.load-error")} detail={error} />}

      <Card>
        <Toolbar
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t("ttv.search"),
          }}
        />
        {shown && shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th className="hidden xl:table-cell">{t("ttv.col-source")}</th>
                  <th>{t("ttv.col-script")}</th>
                  <th className="hidden xl:table-cell">{t("ttv.col-voice")}</th>
                  <th>{t("ttv.col-project")}</th>
                  <th className="hidden xl:table-cell">{t("common.updated")}</th>
                  <th className="w-10">
                    <span className="sr-only">{t("common.delete")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s.id}
                    className="row-click"
                    onClick={() => router.push(`/text-to-video/${s.id}`)}
                  >
                    <td>
                      <span className="font-medium">{s.name}</span>
                      <span className="mt-1 block max-w-[360px] truncate text-meta text-[var(--text-muted)]">
                        {sourceLine(s)}
                      </span>
                    </td>
                    <td>
                      <TtvStatusBadge status={s.status} />
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {s.source.kind === "url"
                        ? t("ttv.source.url")
                        : t("ttv.source.text")}
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {s.script.length > 0
                        ? `${tf("ttv.chunk-count", { n: s.script.length })} · ~${clock(
                            estimateScriptSeconds(s.script)
                          )}`
                        : "-"}
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {s.voice.name || "-"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.projectId ? (
                        <Link
                          href={`/projects/${s.projectId}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("ttv.open-project")}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {formatDateTime(s.updatedAt)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        size="sm"
                        tone="danger"
                        label={tf("ttv.delete-aria", { name: s.name })}
                        onClick={() => {
                          setDeleteError(null);
                          setTarget(s);
                        }}
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : shown ? (
          query.trim() ? (
            <EmptyState icon={FileText} description={t("common.no-match")} />
          ) : (
            <EmptyState
              icon={FileText}
              description={t("ttv.empty")}
              action={
                <Button onClick={() => { setInitialFormat(null); setCreateOpen(true); }}>
                  <FileText size={16} strokeWidth={2} />
                  {t("ttv.new")}
                </Button>
              }
            />
          )
        ) : (
          !error && <TableSkeleton />
        )}
      </Card>

      {createOpen && <CreateModal
        open={createOpen}
        initialFormat={initialFormat}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          router.push(`/text-to-video/${id}`);
        }}
      />}

      <ConfirmDeleteModal
        open={target !== null}
        title={t("ttv.delete-title")}
        description={<p>{t("ttv.delete-desc")}</p>}
        items={target ? [`${target.name} - ${sourceLine(target)}`] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
