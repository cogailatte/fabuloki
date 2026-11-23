"use client";

import { Palette, Plus, SearchX, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  createVideoStyle,
  deleteVideoStyle,
  getManagedVideoStyles,
  type ManagedVideoStyle,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { VideoStylePreview } from "@/components/VideoStylePreview";
import { CardGridSkeleton } from "@/components/Skeleton";
import { Toolbar } from "@/components/Toolbar";
import { formatRelative } from "@/lib/format";
import { useEvents } from "@/lib/useEvents";
import { useT } from "@/lib/i18n";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

export default function VideoStylesPage() {
  const { t, tf, lang } = useT();
  const router = useRouter();
  const { resyncTick } = useEvents();

  const [list, setList] = useState<ManagedVideoStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setList(await getManagedVideoStyles());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, resyncTick]);

  function openCreate() {
    setName("");
    setCloneFrom("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDeleteSelected() {
    if (bulkDeleting || selected.size === 0 || !list) return;
    const targets = list.filter((s) => selected.has(s.id));
    setBulkDeleting(true);
    setBulkErrors([]);

    const errors: string[] = [];
    for (const s of targets) {
      try {

        await deleteVideoStyle(s.id, s.usageCount > 0);
      } catch (e) {
        errors.push(
          `${s.name} (${s.id}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelected(new Set());
    setBulkErrors(errors);
    await load();
  }

  async function onCreate() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {

      const style = await createVideoStyle(
        cloneFrom
          ? { name: name.trim(), cloneFrom }
          : {
              name: name.trim(),
              art: PLACEHOLDER_ART,
              avoid: PLACEHOLDER_AVOID,
              motion: PLACEHOLDER_MOTION,
              palette: "brand",
            },
      );
      setCreateOpen(false);
      router.push(`/video-styles/${style.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = (list ?? []).filter((s) =>
    q ? `${s.name} ${s.id} ${s.motion}`.toLowerCase().includes(q) : true
  );

  useEffect(() => {
    const visible = new Set(filtered.map((s) => s.id));
    setSelected((cur) => {
      const next = new Set([...cur].filter((id) => visible.has(id)));
      return next.size === cur.size ? cur : next;
    });

  }, [q, list]);

  const selectedInUse = (list ?? []).filter(
    (s) => selected.has(s.id) && s.usageCount > 0
  ).length;

  const createButton = (
    <Button onClick={openCreate}>
      <Plus size={16} strokeWidth={2} />
      {t("vstyle.page.create")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.video-styles")}
        hint={{
          titleKey: "help.video-styles.title",
          bodyKey: "help.video-styles.body",
        }}
        subtitle={t("vstyle.page.subtitle")}
        actions={createButton}
      />

      {error && (
        <ErrorBanner message={t("vstyle.page.load-error")} detail={error} />
      )}
      {bulkErrors.length > 0 && (
        <ErrorBanner
          message={tf("vstyle.page.delete-errors", { n: bulkErrors.length })}
          detail={bulkErrors.join("\n")}
        />
      )}

      <Card title={tf("vstyle.page.count", { n: list?.length ?? 0 })}>
        <Toolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("vstyle.search"),
          }}
          selectedCount={selected.size}
          onClearSelection={() => setSelected(new Set())}
          bulkActions={
            <Button
              variant="destructive"
              small
              disabled={bulkDeleting}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 size={14} strokeWidth={2} />
              {bulkDeleting ? t("common.deleting") : t("common.delete-selected")}
            </Button>
          }
        />
        <p className="mb-4 text-sm text-[var(--text-muted)]">{lang === "vi" ? "Xem mẫu minh họa" : "Xem mẫu minh họa"}</p>

        {list === null ? (
          !error && (
            <div className={GRID}>
              <CardGridSkeleton count={8} />
            </div>
          )
        ) : filtered.length > 0 ? (
          <div className={GRID}>
            {filtered.map((s) => (

              <div
                key={s.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/video-styles/${s.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/video-styles/${s.id}`);
                }}
                className="cursor-pointer"
              >
                <Panel className="h-full transition-colors duration-150 hover:border-[var(--primary)]">
                  <VideoStylePreview id={s.id} name={s.name} motion={s.motion} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="checkbox block"
                        aria-label={tf("common.select-aria", { name: s.name })}
                        checked={selected.has(s.id)}
                        disabled={bulkDeleting}
                        onChange={() => toggleSelect(s.id)}
                      />
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {s.name}
                    </p>
                    {s.builtin && (
                      <Badge
                        tone="muted"
                        dot={false}
                        label={t("vstyle.page.builtin")}
                      />
                    )}
                    {s.palette === "loose" && (
                      <Badge
                        tone="danger"
                        dot={false}
                        label={t("vstyle.loose-badge")}
                      />
                    )}
                  </div>

                  <p className="truncate font-mono text-meta text-[var(--text-muted)]">
                    {s.id}
                  </p>

                  <p className="line-clamp-3 text-sm text-[var(--text-muted)]">
                    {s.motion}
                  </p>

                  <div className="mt-auto flex items-center gap-2 pt-1 text-meta text-[var(--text-muted)]">
                    <span className="truncate">
                      {s.usageCount > 0
                        ? tf("vstyle.page.usage-n", { n: s.usageCount })
                        : t("vstyle.page.usage-none")}
                    </span>
                    <span className="ml-auto shrink-0">
                      {formatRelative(s.updatedAt)}
                    </span>
                  </div>
                </Panel>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Palette}
            description={t("vstyle.page.empty")}
            action={createButton}
          />
        ) : (
          <EmptyState icon={SearchX} description={t("vstyle.no-match")} />
        )}
      </Card>

      <ConfirmDeleteModal
        open={bulkDeleteOpen}
        title={t("vstyle.page.delete-selected-title")}
        description={
          <>
            <p>{tf("vstyle.page.delete-desc", { n: selected.size })}</p>
            {selectedInUse > 0 && (
              <p className="mt-2">
                {tf("vstyle.page.delete-in-use", { n: selectedInUse })}
              </p>
            )}
          </>
        }
        items={(list ?? [])
          .filter((s) => selected.has(s.id))
          .map((s) => s.name)}
        busy={bulkDeleting}
        confirmLabel={tf("vstyle.page.delete-n", { n: selected.size })}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={onDeleteSelected}
      />

      <Modal
        title={t("vstyle.page.create")}
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={onCreate} disabled={!name.trim() || creating}>
              <Plus size={15} strokeWidth={2} />
              {creating ? t("common.creating") : t("vstyle.page.create-short")}
            </Button>
          </>
        }
      >
        {createError && (
          <ErrorBanner message={t("vstyle.page.create-error")} detail={createError} />
        )}
        <Field label={t("vstyle.page.name-label")} htmlFor="vstyle-new-name">
          <input
            id="vstyle-new-name"
            className="input"
            autoFocus
            value={name}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("vstyle.page.name-placeholder")}
          />
        </Field>
        <Field
          label={t("vstyle.page.clone-from")}
          htmlFor="vstyle-new-clone"
          hint={t("vstyle.page.clone-hint")}
        >
          <select
            id="vstyle-new-clone"
            className="input"
            value={cloneFrom}
            disabled={creating}
            onChange={(e) => setCloneFrom(e.target.value)}
          >
            <option value="">{t("vstyle.page.blank")}</option>
            {(list ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </Modal>
    </div>
  );
}

const PLACEHOLDER_ART =
  "Describe the material and drawing technique here in English: what it is made of, how it is lit, how deep the scene is.";
const PLACEHOLDER_AVOID = "no photographic realism, no 3D glossy render";
const PLACEHOLDER_MOTION =
  "Mô tả cách hình vào/ra, kiểu chuyển cảnh, nhịp và kiểu chữ của phong cách này.";
