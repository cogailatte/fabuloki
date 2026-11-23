"use client";

import { ArrowLeft, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  deleteVideoStyle,
  getVideoStyleDetail,
  resetVideoStyle,
  updateVideoStyle,
  type ManagedVideoStyleDetail,
  type VideoStyleInput,
} from "@/lib/api";
import { VideoStylePreview } from "@/components/VideoStylePreview";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { OptionCard, OptionCardGroup } from "@/components/OptionCard";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Workspace, WorkspaceColumn } from "@/components/Workspace";
import { useT } from "@/lib/i18n";

export default function VideoStyleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { t, tf } = useT();

  const [style, setStyle] = useState<ManagedVideoStyleDetail | null>(null);
  const [form, setForm] = useState<VideoStyleInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const apply = useCallback((s: ManagedVideoStyleDetail) => {
    setStyle(s);
    setForm({
      name: s.name,
      art: s.art,
      avoid: s.avoid,
      palette: s.palette,
      motion: s.motion,
    });
    setDirty(false);
  }, []);

  useEffect(() => {
    let stale = false;
    getVideoStyleDetail(id)
      .then((s) => {
        if (stale) return;
        apply(s);
        setError(null);
      })
      .catch((e) => {
        if (stale) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [id, apply]);

  function set<K extends keyof VideoStyleInput>(key: K, value: VideoStyleInput[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
    setSavedAt(null);
  }

  const valid =
    form !== null &&
    form.name.trim() !== "" &&
    form.art.trim() !== "" &&
    form.avoid.trim() !== "" &&
    form.motion.trim() !== "";

  async function onSave() {
    if (!form || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateVideoStyle(id, form);

      setStyle((cur) => (cur ? { ...cur, ...saved, usage: cur.usage } : cur));
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    if (resetting) return;
    setResetting(true);
    setError(null);
    try {
      await resetVideoStyle(id);
      apply(await getVideoStyleDetail(id));
      setSavedAt(Date.now());
      setResetOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  async function onDelete() {
    if (deleting || !style) return;
    setDeleting(true);
    try {

      await deleteVideoStyle(id, style.usage.length > 0);
      router.push("/video-styles");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  const nameKey = `vstyle.${id}.name`;
  const translatedName = t(nameKey);
  const hasTranslation = translatedName !== nameKey;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={style ? style.name : id}
        subtitle={t("vstyle.detail.subtitle")}
        actions={

          <>
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/video-styles">
                <Button variant="secondary">
                  <ArrowLeft size={15} strokeWidth={2} />
                  {t("common.back-to-list")}
                </Button>
              </Link>
              {style?.builtin && (
                <Button
                  variant="secondary"
                  disabled={resetting}
                  onClick={() => setResetOpen(true)}
                >
                  <RotateCcw size={15} strokeWidth={2} />
                  {resetting ? t("vstyle.detail.resetting") : t("vstyle.detail.reset")}
                </Button>
              )}
              <Button onClick={onSave} disabled={!dirty || !valid || saving}>
                <Save size={15} strokeWidth={2} />
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </span>
            <span className="flex items-center border-l border-[var(--border)] pl-2">
              <Button
                variant="destructive"
                disabled={!style}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={15} strokeWidth={2} />
                {t("common.delete")}
              </Button>
            </span>
          </>
        }
      />

      {error && (
        <ErrorBanner message={t("vstyle.detail.action-error")} detail={error} />
      )}
      {savedAt && !dirty && !error && (
        <Banner tone="success" message={t("common.saved")} />
      )}

      {form && style ? (
        <>
          {style.builtin && (
            <p className="text-meta text-[var(--text-muted)]">
              {t("vstyle.detail.builtin-note")}
            </p>
          )}

          <div className="max-w-2xl"><VideoStylePreview id={style.id} name={style.name} motion={form.motion} /></div>

          <Workspace>

            <WorkspaceColumn
              role="source"
              title={t("vstyle.detail.card-identity")}
              ariaLabel={t("vstyle.detail.card-identity")}
            >
              <Card>
                <div className="flex flex-col gap-4">
                  <Field
                    label={t("vstyle.detail.id-label")}
                    htmlFor="vstyle-id"
                    hint={t("vstyle.detail.id-hint")}
                  >
                    <input
                      id="vstyle-id"
                      className="input font-mono"
                      value={style.id}
                      readOnly
                      disabled
                    />
                  </Field>

                  <Field
                    label={t("vstyle.detail.name-label")}
                    htmlFor="vstyle-name"
                    required
                    hint={
                      <>
                        {t("vstyle.detail.name-hint")}
                        {hasTranslation && (
                          <span className="mt-1 block text-[var(--danger)]">
                            {tf("vstyle.detail.name-translated", {
                              name: translatedName,
                              id,
                            })}
                          </span>
                        )}
                      </>
                    }
                  >
                    <input
                      id="vstyle-name"
                      className="input"
                      value={form.name}
                      disabled={saving}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </Field>
                </div>
              </Card>
            </WorkspaceColumn>

            <WorkspaceColumn
              role="setup"
              title={t("vstyle.detail.card-art")}
              ariaLabel={t("vstyle.detail.card-art")}
            >
              <Card>
                <div className="flex flex-col gap-4">
                  <Field
                    label={t("vstyle.detail.art-label")}
                    htmlFor="vstyle-art"
                    hint={t("vstyle.detail.art-hint")}
                    required
                  >
                    <textarea
                      id="vstyle-art"
                      className="input min-h-[110px] resize-y leading-relaxed"
                      value={form.art}
                      disabled={saving}
                      spellCheck={false}
                      placeholder={t("vstyle.detail.art-placeholder")}
                      onChange={(e) => set("art", e.target.value)}
                    />
                  </Field>

                  <Field
                    label={t("vstyle.detail.avoid-label")}
                    htmlFor="vstyle-avoid"
                    hint={t("vstyle.detail.avoid-hint")}
                    required
                  >
                    <textarea
                      id="vstyle-avoid"
                      className="input min-h-[70px] resize-y leading-relaxed"
                      value={form.avoid}
                      disabled={saving}
                      spellCheck={false}
                      placeholder={t("vstyle.detail.avoid-placeholder")}
                      onChange={(e) => set("avoid", e.target.value)}
                    />
                  </Field>

                  <Field label={t("vstyle.detail.palette-label")}>
                    <OptionCardGroup
                      label={t("vstyle.detail.palette-label")}
                      className="grid-cols-[repeat(auto-fit,minmax(200px,1fr))]"
                    >
                      <OptionCard
                        selected={form.palette === "brand"}
                        disabled={saving}
                        title={t("vstyle.detail.palette-brand")}
                        description={t("vstyle.detail.palette-brand-desc")}
                        onSelect={() => set("palette", "brand")}
                      />
                      <OptionCard
                        selected={form.palette === "loose"}
                        disabled={saving}
                        title={t("vstyle.detail.palette-loose")}
                        description={t("vstyle.detail.palette-loose-desc")}
                        badge={
                          <Badge
                            tone="danger"
                            label={t("vstyle.loose-badge")}
                            dot={false}
                          />
                        }
                        onSelect={() => set("palette", "loose")}
                      />
                    </OptionCardGroup>
                  </Field>
                </div>
              </Card>
            </WorkspaceColumn>

            <WorkspaceColumn
              role="setup"
              title={t("vstyle.detail.card-motion")}
              ariaLabel={t("vstyle.detail.card-motion")}
            >
              <Card>
                <div className="flex flex-col gap-3">
                  <Field
                    label={t("vstyle.detail.motion-label")}
                    htmlFor="vstyle-motion"
                    hint={t("vstyle.detail.motion-hint")}
                    required
                  >
                    <textarea
                      id="vstyle-motion"
                      className="input min-h-[110px] resize-y leading-relaxed"
                      value={form.motion}
                      disabled={saving}
                      placeholder={t("vstyle.detail.motion-placeholder")}
                      onChange={(e) => set("motion", e.target.value)}
                    />
                  </Field>

                  <p className="text-meta text-[var(--text-muted)]">
                    {t("vstyle.detail.required")}
                  </p>
                </div>
              </Card>

              <Card title={t("vstyle.detail.usage-title")}>
                {style.usage.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <ul className="flex flex-col gap-1">
                      {style.usage.map((u) => (
                        <li
                          key={`${u.kind}:${u.id}`}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <span className="chip">
                            {t(`vstyle.detail.kind.${u.kind}`)}
                          </span>
                          <span className="font-medium">{u.name}</span>
                          <span className="font-mono text-meta text-[var(--text-muted)]">
                            {u.id}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-meta text-[var(--text-muted)]">
                      {t("vstyle.detail.usage-hint")}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("vstyle.detail.usage-empty")}
                  </p>
                )}
              </Card>
            </WorkspaceColumn>
          </Workspace>
        </>
      ) : !error ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("vstyle.detail.delete-title")}
        description={
          style && (
            <>
              <p>
                {t("vstyle.detail.delete-desc-1")}{" "}
                <span className="font-medium">{style.name}</span>?{" "}
                {t("common.no-undo")}
              </p>
              {style.usage.length > 0 && (
                <p className="mt-2">
                  {tf("vstyle.detail.delete-in-use", { n: style.usage.length })}
                </p>
              )}
              {style.builtin && (
                <p className="mt-2 text-[var(--text-muted)]">
                  {t("vstyle.detail.delete-builtin")}
                </p>
              )}
            </>
          )
        }
        items={style?.usage.map((u) => u.name)}
        busy={deleting}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />

      <Modal
        title={t("vstyle.detail.reset-title")}
        open={resetOpen}
        onClose={() => {
          if (!resetting) setResetOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={resetting}
              onClick={() => setResetOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={onReset} disabled={resetting}>
              <RotateCcw size={15} strokeWidth={2} />
              {resetting ? t("vstyle.detail.resetting") : t("vstyle.detail.reset")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("vstyle.detail.reset-desc")}</p>
      </Modal>
    </div>
  );
}
