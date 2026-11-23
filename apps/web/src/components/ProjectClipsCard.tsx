"use client";

import { Crop, Loader2, Scissors, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  createClipProjects,
  getClips,
  repurposeProject,
  REPURPOSE_SIZES,
  suggestClips,
  type Clip,
  type CreatedClipProject,
  type ProjectSummary,
  type RepurposeAspect,
} from "@/lib/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { CheckboxField, Field } from "@/components/Field";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { OptionCard, OptionCardGroup } from "@/components/OptionCard";
import { clock, formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

const ASPECTS: RepurposeAspect[] = ["9:16", "16:9", "1:1", "4:5"];

function isSameAspect(
  aspect: RepurposeAspect,
  width?: number,
  height?: number
): boolean {
  if (!width || !height) return false;
  const target = REPURPOSE_SIZES[aspect];
  return Math.abs(width / height - target.width / target.height) < 0.01;
}

export function ProjectClipsCard({
  projectId,
  width,
  height,
  onCreated,
}: {
  projectId: string;

  width?: number;
  height?: number;

  onCreated?: () => void;
}) {
  const { t, tf } = useT();

  const [clips, setClips] = useState<Clip[]>([]);
  const [suggestedAt, setSuggestedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [count, setCount] = useState("5");
  const [minSec, setMinSec] = useState("20");
  const [maxSec, setMaxSec] = useState("60");

  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [selected, setSelected] = useState<number[]>([]);
  const [autoEdit, setAutoEdit] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedClipProject[]>([]);
  const [createNote, setCreateNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getClips(projectId);
      setClips(res.clips);
      setSuggestedAt(res.suggestedAt);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await suggestClips(projectId, {
        count: Number(count) || 5,
        minSec: Number(minSec) || 20,
        maxSec: Number(maxSec) || 60,
      });
      setClips(res.clips);
      setSuggestedAt(res.suggestedAt);

      setSelected([]);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  function toggle(i: number) {
    setSelected((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  }

  const allSelected = clips.length > 0 && selected.length === clips.length;

  async function onCreate() {
    if (creating || selected.length === 0) return;
    setCreating(true);
    setCreateError(null);
    setCreated([]);
    setCreateNote(null);
    try {
      const res = await createClipProjects(projectId, {
        indexes: [...selected].sort((a, b) => a - b),
        autoEdit,
      });
      setCreated(res.created);
      setCreateNote(res.note ?? null);
      setSelected([]);
      onCreated?.();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const [aspect, setAspect] = useState<RepurposeAspect | null>(null);
  const [newName, setNewName] = useState("");
  const [repurposeAutoEdit, setRepurposeAutoEdit] = useState(false);
  const [repurposing, setRepurposing] = useState(false);
  const [repurposeError, setRepurposeError] = useState<string | null>(null);
  const [repurposed, setRepurposed] = useState<ProjectSummary | null>(null);

  async function onRepurpose() {
    if (repurposing || !aspect) return;
    setRepurposing(true);
    setRepurposeError(null);
    setRepurposed(null);
    try {
      const res = await repurposeProject(projectId, {
        aspect,
        ...(newName.trim() ? { name: newName.trim() } : {}),
        autoEdit: repurposeAutoEdit,
      });
      setRepurposed(res.project);
      setNewName("");
      onCreated?.();
    } catch (e) {
      setRepurposeError(e instanceof Error ? e.message : String(e));
    } finally {
      setRepurposing(false);
    }
  }

  return (
    <>
      <Card
        title={t("clips.title")}
        hint={{ titleKey: "help.clips.title", bodyKey: "help.clips.body" }}
      >
        {loadError && (
          <div className="mb-3">
            <ErrorBanner message={t("clips.load-error")} detail={loadError} />
          </div>
        )}

        <div className="grid grid-cols-3 items-end gap-2">
          <Field label={t("clips.count")} htmlFor={`clips-count-${projectId}`}>
            <input
              id={`clips-count-${projectId}`}
              className="input"
              type="number"
              min={1}
              max={10}
              value={count}
              disabled={suggesting}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          <Field label={t("clips.min-sec")} htmlFor={`clips-min-${projectId}`}>
            <input
              id={`clips-min-${projectId}`}
              className="input"
              type="number"
              min={5}
              value={minSec}
              disabled={suggesting}
              onChange={(e) => setMinSec(e.target.value)}
            />
          </Field>
          <Field label={t("clips.max-sec")} htmlFor={`clips-max-${projectId}`}>
            <input
              id={`clips-max-${projectId}`}
              className="input"
              type="number"
              min={6}
              value={maxSec}
              disabled={suggesting}
              onChange={(e) => setMaxSec(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Button
            className="w-full"
            disabled={suggesting}
            onClick={onSuggest}
          >
            {suggesting ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <Sparkles size={14} strokeWidth={2} />
            )}
            {suggesting ? t("clips.suggesting") : t("clips.suggest")}
          </Button>
        </div>

        {suggesting && (
          <p className="mt-2 flex items-center gap-2 text-meta text-[var(--text-muted)]">
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            {t("clips.suggest-hint")}
          </p>
        )}
        {suggestError && (
          <div className="mt-2">
            <ErrorBanner
              message={t("clips.suggest-error")}
              detail={suggestError}
            />
          </div>
        )}

        {clips.length === 0 ? (
          <EmptyState icon={Scissors} description={t("clips.none")} />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CheckboxField
                id={`clips-all-${projectId}`}
                label={t("clips.select-all")}
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? [] : clips.map((_, i) => i))
                }
              />
              {suggestedAt && (
                <span className="text-meta text-[var(--text-muted)]">
                  {tf("clips.suggested-at", {
                    time: formatRelative(suggestedAt),
                  })}
                </span>
              )}
            </div>

            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {clips.map((c, i) => {
                const desc = c.hook || c.reason;
                return (
                  <li
                    key={`${c.start}-${c.end}-${i}`}
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        className="checkbox shrink-0"
                        checked={selected.includes(i)}
                        aria-label={tf("clips.select-aria", { title: c.title })}
                        onChange={() => toggle(i)}
                      />
                      <span className="font-mono text-meta text-[var(--text-muted)]">
                        {clock(c.start)} - {clock(c.end)} (
                        {Math.round(c.end - c.start)}s)
                      </span>
                      <span className="chip">
                        {tf("clips.score", { score: c.score })}
                      </span>
                    </div>

                    <p className="text-sm font-semibold leading-snug">
                      {c.title}
                    </p>

                    {desc && (
                      <p className="line-clamp-2 text-sm leading-snug text-[var(--text-muted)]">
                        {desc}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <CheckboxField
              id={`clips-auto-edit-${projectId}`}
              label={t("clips.auto-edit")}
              hint={t("clips.auto-edit-hint")}
              checked={autoEdit}
              onChange={setAutoEdit}
            />

            <Button
              className="w-full"
              disabled={creating || selected.length === 0}
              onClick={onCreate}
            >
              {creating ? (
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              ) : (
                <Scissors size={14} strokeWidth={2} />
              )}
              {creating
                ? t("clips.creating")
                : tf("clips.create", { n: selected.length })}
            </Button>
          </div>
        )}

        {createError && (
          <div className="mt-2">
            <ErrorBanner
              message={t("clips.create-error")}
              detail={createError}
            />
          </div>
        )}
        {created.length > 0 && (
          <div className="mt-2">
            <Banner
              tone="success"
              message={tf("clips.created", { n: created.length })}
            >
              <div className="mt-1 flex flex-col gap-1">
                {created.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="truncate text-sm font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                  >
                    {p.name}
                  </Link>
                ))}
              </div>
              {createNote && (
                <p className="mt-1 text-meta text-[var(--text-muted)]">
                  {createNote}
                </p>
              )}
            </Banner>
          </div>
        )}
      </Card>

      <Card
        title={t("clips.repurpose-title")}
        hint={{
          titleKey: "help.repurpose.title",
          bodyKey: "help.repurpose.body",
        }}
      >
        <p className="text-sm text-[var(--text-muted)]">
          {t("clips.repurpose-desc")}
        </p>

        <div className="@container mt-3">
          <OptionCardGroup
            label={t("clips.repurpose-title")}
            className="grid-cols-2 @md:grid-cols-4"
          >
            {ASPECTS.map((a) => {
              const size = REPURPOSE_SIZES[a];
              const same = isSameAspect(a, width, height);
              return (
                <div key={a} title={same ? t("clips.same-aspect") : undefined}>
                  <OptionCard
                    className="h-full w-full items-center text-center"
                    selected={aspect === a}
                    disabled={same || repurposing}
                    onSelect={() => setAspect(a)}
                    title={a}
                    description={`${size.width}x${size.height}`}
                  />
                </div>
              );
            })}
          </OptionCardGroup>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <Field
            label={t("clips.new-name")}
            htmlFor={`repurpose-name-${projectId}`}
          >
            <input
              id={`repurpose-name-${projectId}`}
              className="input"
              value={newName}
              disabled={repurposing}
              placeholder={t("clips.new-name-placeholder")}
              onChange={(e) => setNewName(e.target.value)}
            />
          </Field>

          <CheckboxField
            id={`repurpose-auto-edit-${projectId}`}
            label={t("clips.auto-edit")}
            checked={repurposeAutoEdit}
            onChange={setRepurposeAutoEdit}
          />
        </div>

        <div className="mt-3">
          <Button
            className="w-full"
            disabled={repurposing || !aspect}
            onClick={onRepurpose}
          >
            {repurposing ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <Crop size={14} strokeWidth={2} />
            )}
            {repurposing
              ? t("clips.repurpose-creating")
              : t("clips.repurpose-create")}
          </Button>
        </div>

        {repurposeError && (
          <div className="mt-2">
            <ErrorBanner
              message={t("clips.repurpose-error")}
              detail={repurposeError}
            />
          </div>
        )}
        {repurposed && (
          <div className="mt-2">
            <Banner
              tone="success"
              message={
                <span className="flex flex-wrap items-center gap-1">
                  {t("clips.repurpose-done")}
                  <Link
                    href={`/projects/${repurposed.id}`}
                    className="font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                  >
                    {repurposed.name}
                  </Link>
                </span>
              }
            />
          </div>
        )}
      </Card>
    </>
  );
}
