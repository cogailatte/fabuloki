"use client";

import {
  ArrowLeft,
  Pencil,
  Plus,
  Save,
  ScrollText,
  SearchX,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPrompt,
  deletePrompt,
  getPrompts,
  updatePrompt,
  type PromptTemplate,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { CardGridSkeleton } from "@/components/Skeleton";
import { Toolbar } from "@/components/Toolbar";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

type Editor = { id: string | null; name: string; content: string };

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

export default function PromptsPage() {
  const { t, tf } = useT();
  const [prompts, setPrompts] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      setPrompts(await getPrompts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !prompts) return prompts;
    return prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
    );
  }, [prompts, query]);

  async function onSave() {
    if (!editor || saving) return;
    const name = editor.name.trim();
    if (!name || !editor.content.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editor.id) {
        await updatePrompt(editor.id, { name, content: editor.content });
      } else {
        await createPrompt({ name, content: editor.content });
      }
      setEditor(null);
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: PromptTemplate) {
    if (deletingId) return;
    setDeletingId(p.id);
    try {
      await deletePrompt(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  if (editor) {
    const valid = editor.name.trim() !== "" && editor.content.trim() !== "";
    return (

      <div className="flex h-[calc(100vh-56px-40px)] w-full flex-col gap-4">
        <PageHeader
          title={editor.id ? t("prompts.edit-title") : t("prompts.create")}
          subtitle={t("prompts.editor-subtitle")}
          actions={
            <>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {

                  setSaveError(null);
                  setEditor(null);
                }}
              >
                <ArrowLeft size={15} strokeWidth={2} />
                {t("common.back-to-list")}
              </Button>
              <Button onClick={onSave} disabled={!valid || saving}>
                <Save size={15} strokeWidth={2} />
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </>
          }
        />

        {saveError && (
          <ErrorBanner message={t("prompts.save-error")} detail={saveError} />
        )}

        <Card className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <Field label={t("prompts.name-label")} htmlFor="prompt-name">
              <input
                id="prompt-name"
                className="input"
                value={editor.name}
                onChange={(e) =>
                  setEditor((s) => (s ? { ...s, name: e.target.value } : s))
                }
                placeholder={t("prompts.name-placeholder")}
              />
            </Field>
            <Field
              label={t("prompts.content-label")}
              htmlFor="prompt-content"
              className="min-h-0 flex-1"
            >
              <textarea
                id="prompt-content"
                className="input h-full min-h-[320px] flex-1 resize-none leading-relaxed"
                value={editor.content}
                onChange={(e) =>
                  setEditor((s) => (s ? { ...s, content: e.target.value } : s))
                }
                placeholder={t("prompts.content-placeholder")}
              />
            </Field>
          </div>
        </Card>
      </div>
    );
  }

  const createButton = (
    <Button onClick={() => setEditor({ id: null, name: "", content: "" })}>
      <Plus size={16} strokeWidth={2} />
      {t("prompts.create")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.prompts")}
        hint={{ titleKey: "help.prompts.title", bodyKey: "help.prompts.body" }}
        subtitle={t("prompts.subtitle")}
        actions={createButton}
      />

      {error && (
        <ErrorBanner message={t("prompts.load-error")} detail={error} />
      )}

      <Card title={tf("prompts.count", { n: prompts?.length ?? 0 })}>
        <Toolbar
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t("prompts.search"),
          }}
        />

        {prompts === null ? (
          !error && (
            <div className={GRID}>
              <CardGridSkeleton />
            </div>
          )
        ) : filtered && filtered.length > 0 ? (
          <div className={GRID}>
            {filtered.map((p) => (
              <Panel key={p.id} className="h-full">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <ScrollText
                    size={18}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-[var(--primary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-[var(--text-muted)]">
                      {p.content}
                    </p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-meta text-[var(--text-muted)]">
                    {tf("prompts.edited", { time: formatRelative(p.updatedAt) })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      variant="secondary"
                      small
                      onClick={() =>
                        setEditor({ id: p.id, name: p.name, content: p.content })
                      }
                    >
                      <Pencil size={13} strokeWidth={2} />
                      {t("common.edit")}
                    </Button>
                    <Button
                      variant="destructive"
                      small
                      disabled={deletingId === p.id}
                      onClick={() => setDeleteTarget(p)}
                      aria-label={tf("prompts.delete-aria", { name: p.name })}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                      {deletingId === p.id ? t("common.deleting") : t("common.delete")}
                    </Button>
                  </span>
                </div>
              </Panel>
            ))}
          </div>
        ) : prompts.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            description={t("prompts.empty")}
            action={createButton}
          />
        ) : (
          <EmptyState icon={SearchX} description={t("common.no-match")} />
        )}
      </Card>

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("prompts.delete-title")}
        description={
          deleteTarget && (
            <>
              {t("prompts.delete-desc-1")}{" "}
              <span className="font-medium">{deleteTarget.name}</span>? {t("common.no-undo")}
            </>
          )
        }
        busy={deleteTarget !== null && deletingId === deleteTarget.id}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
        }}
      />
    </div>
  );
}
