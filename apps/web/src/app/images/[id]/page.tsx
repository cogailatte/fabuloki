"use client";

import {
  ArrowLeft,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Save,
  ScrollText,
  Trash2,
  Upload,
  Wand2,
  Zap,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  cloneImageProject,
  deleteImageProject,
  generateImage,
  getImageProject,
  getJobs,
  imageFileUrl,
  renameImageProject,
  updateImageProject,
  uploadImageBackground,
  type FileInfo,
  type ImageGenStep,
  type ImageProject,
  type JobStatus,
} from "@/lib/api";
import {
  MediaPreviewModal,
  ZoomableThumb,
  imageFileInfo,
} from "@/components/MediaPreviewModal";
import { useEvents, useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { JobBadge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { CloneProjectModal } from "@/components/CloneProjectModal";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EditableTitle } from "@/components/EditableTitle";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import {
  AspectChip,
  ImageModelOptions,
  ImageProjectFields,
  ImageStatusBadge,
  KIND_LABEL,
  useGeminiImageModels,
  useImageModelChoices,
  type ImageDraft,
} from "@/components/ImageProjectForm";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ProgressBar } from "@/components/ProgressBar";
import { ShellRightPanel } from "@/components/Shell";
import { Skeleton } from "@/components/Skeleton";
import {
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
} from "@/components/Workspace";
import { useProviders } from "@/components/ModelPicker";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

interface ActiveJob {
  id: string;
  progress: number;
  step: string;
  status: JobStatus;
}

const JOB_LINGER_MS = 3000;

const MAX_LOG_LINES = 300;

function StepThumb({
  label,
  file,
  alt,
  onOpen,
}: {
  label: string;
  file: FileInfo | null;
  alt: string;
  onOpen: (file: FileInfo) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-meta text-[var(--text-muted)]" title={label}>
        {label}
      </span>

      <div
        className="workspace-media"
        style={{ "--workspace-aspect": "4 / 3" } as CSSProperties}
      >
        {file ? (
          <ZoomableThumb
            file={file}
            alt={alt}
            onOpen={onOpen}
            className="h-full w-full"
            imgClassName="h-full w-full object-contain"
            iconSize={20}
          />
        ) : (
          <ImageIcon
            size={22}
            strokeWidth={1.5}
            className="text-[var(--text-muted)] opacity-40"
          />
        )}
      </div>
    </div>
  );
}

export default function ImageProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const imageId = params.id;
  const router = useRouter();
  const { t, tf } = useT();

  const [proj, setProj] = useState<ImageProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ImageDraft | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [genError, setGenError] = useState<string | null>(null);
  const [genSubmitting, setGenSubmitting] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const {
    models: liveModels,
    loading: modelsLoading,
    load: loadModels,
  } = useGeminiImageModels();
  const [modelSaving, setModelSaving] = useState(false);

  const [preview, setPreview] = useState<FileInfo | null>(null);

  const fileOf = useCallback(
    (fileName: string, label: string): FileInfo =>
      imageFileInfo(`image-projects/${imageId}/${fileName}`, {
        name: label,
        version: proj?.updatedAt,
      }),
    [imageId, proj?.updatedAt],
  );

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const activeJobIdRef = useRef<string | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logBoxRef = useRef<HTMLPreElement>(null);

  const { providers } = useProviders();
  const gemini = providers?.find((p) => p.id === "gemini");
  const geminiConnected = gemini?.connected === true;

  const load = useCallback(async () => {
    try {
      const p = await getImageProject(imageId);
      setProj(p);
      setError(null);

      setDraft(
        (d) =>
          d ?? {
            prompt: p.prompt,
            kind: p.kind,
            aspect: p.aspect,
            overlay: p.overlay,
            model: p.model,
            styleId: p.styleId ?? null,
          }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [imageId]);

  const { resyncTick } = useEvents();
  useEffect(() => {
    load();
  }, [load, resyncTick]);

  useEffect(() => {
    let alive = true;
    (async () => {

      const seenId = activeJobIdRef.current;
      try {
        const jobs = await getJobs(50);
        const j = jobs.find(
          (x) =>
            x.type === "image-gen" &&
            x.projectId === imageId &&
            (x.status === "queued" || x.status === "running")
        );
        if (alive && j) {
          activeJobIdRef.current = j.id;
          setActiveJob({
            id: j.id,
            progress: j.progress,
            step: j.step,
            status: j.status,
          });
        } else if (alive && !lingerTimerRef.current && activeJobIdRef.current === seenId) {
          activeJobIdRef.current = null;
          setActiveJob(null);
        }
      } catch {

      }
    })();
    return () => {
      alive = false;
    };
  }, [imageId, resyncTick]);

  useEffect(
    () => () => {
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    },
    []
  );

  useJobEvents((job) => {
    if (job.type !== "image-gen" || job.projectId !== imageId) return;
    if (activeJobIdRef.current !== job.id) {

      activeJobIdRef.current = job.id;
      setLogLines([]);
    }
    if (lingerTimerRef.current) {
      clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
    setActiveJob({
      id: job.id,
      progress: job.progress,
      step: job.step,
      status: job.status,
    });
    if (["done", "failed", "canceled"].includes(job.status)) {
      load();

      lingerTimerRef.current = setTimeout(() => {
        lingerTimerRef.current = null;
        activeJobIdRef.current = null;
        setActiveJob(null);
        setLogLines([]);
      }, JOB_LINGER_MS);
    } else {
      setProj((p) => (p ? { ...p, status: "generating" } : p));
    }
  });

  useJobLogEvents((e) => {
    if (e.jobId !== activeJobIdRef.current) return;
    setLogLines((cur) => [...cur.slice(-(MAX_LOG_LINES - 1)), e.line]);
  });

  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines]);

  const jobRunning =
    activeJob !== null &&
    (activeJob.status === "queued" || activeJob.status === "running");
  const generating = proj?.status === "generating" || jobRunning;

  async function saveName(next: string) {
    setProj(await renameImageProject(imageId, next));
  }

  async function onSave() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const p = await updateImageProject(imageId, {
        prompt: draft.prompt,
        kind: draft.kind,
        aspect: draft.aspect,
        overlay: draft.overlay,
        model: draft.model,
        styleId: draft.styleId,
      });
      setProj(p);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runGenerate(step: ImageGenStep) {
    if (genSubmitting || generating) return;
    setGenSubmitting(true);
    setGenError(null);
    try {

      if (draft) await onSaveSilent();
      const job = await generateImage(imageId, step);

      activeJobIdRef.current = job.id;
      setLogLines([]);
      setActiveJob({
        id: job.id,
        progress: job.progress,
        step: job.step,
        status: job.status,
      });
      setProj((p) => (p ? { ...p, status: "generating" } : p));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenSubmitting(false);
    }
  }

  async function onSaveSilent() {
    if (!draft) return;
    const p = await updateImageProject(imageId, {
      prompt: draft.prompt,
      kind: draft.kind,
      aspect: draft.aspect,
      overlay: draft.overlay,
      model: draft.model,
      styleId: draft.styleId,
    });
    setProj(p);
  }

  async function onModelChange(next: string | null) {
    setDraft((d) => (d ? { ...d, model: next } : d));
    setModelSaving(true);
    setGenError(null);
    try {
      setProj(await updateImageProject(imageId, { model: next }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelSaving(false);
    }
  }

  async function onUploadBackground(file: File) {
    setUploadingBg(true);
    setGenError(null);
    try {
      setProj(await uploadImageBackground(imageId, file));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingBg(false);
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteImageProject(imageId);
      router.push("/images");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  const currentModel = draft?.model ?? proj?.model ?? null;
  const modelOptions = liveModels ?? gemini?.models ?? [];

  const modelChoices = useImageModelChoices(currentModel, modelOptions);

  const canGenerate = geminiConnected;
  const geminiTooltip = canGenerate ? undefined : t("imageDetail.gemini-tooltip");

  const aspectRatio = (proj?.aspect ?? "9:16").replace(":", " / ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <EditableTitle
            value={proj?.name ?? null}
            fallback={imageId}
            onSave={saveName}
            onError={setRenameError}
            editLabel={t("imageDetail.rename")}
            emptyError={t("imageDetail.name-required")}
            saveLabel={t("common.save")}
            cancelLabel={t("common.cancel")}
          />
        }
        subtitle={
          proj
            ? `${t(KIND_LABEL[proj.kind])} · ${tf("project.updated", { time: formatRelative(proj.updatedAt) })}`
            : undefined
        }
        actions={

          <>
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/images")}>
                <ArrowLeft size={15} strokeWidth={2} />
                {t("imageDetail.back")}
              </Button>

              <Button
                variant="secondary"
                disabled={!proj}
                title={t("imageDetail.clone-title")}
                onClick={() => setCloneOpen(true)}
              >
                <Copy size={15} strokeWidth={2} />
                {t("clone.action")}
              </Button>
              <Button onClick={onSave} disabled={saving || !draft}>
                <Save size={15} strokeWidth={2} />
                {saving ? t("common.saving") : t("imageDetail.save-changes")}
              </Button>
            </span>
            <span className="flex items-center border-l border-[var(--border)] pl-2">
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={15} strokeWidth={2} />
                {t("imageDetail.delete-project")}
              </Button>
            </span>
          </>
        }
      />

      {proj && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          <ImageStatusBadge status={proj.status} />
          <AspectChip aspect={proj.aspect} />
          <span className="text-meta">ID: {proj.id}</span>
        </div>
      )}

      {renameError && (
        <ErrorBanner message={t("imageDetail.rename-error")} detail={renameError} />
      )}
      {error && (
        <ErrorBanner message={t("imageDetail.load-error")} detail={error} />
      )}
      {saveError && (
        <ErrorBanner message={t("common.save-error")} detail={saveError} />
      )}
      {saved && <Banner tone="success" message={t("common.saved")} />}
      {proj?.status === "error" && proj.error && (
        <ErrorBanner message={t("imageDetail.last-gen-error")} detail={proj.error} />
      )}

      <Workspace>

        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <Card title={t("imageDetail.settings")}>
            {draft ? (
              <div className="flex flex-col gap-3">
                <p className="t-eyebrow">{t("imageDetail.content")}</p>

                <ImageProjectFields
                  value={draft}
                  onChange={(p) => {
                    setDraft((d) => (d ? { ...d, ...p } : d));
                    setSaved(false);
                  }}
                  disabled={saving}
                  idPrefix="image-edit"
                  showModel={false}
                  sectioned
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            )}
          </Card>
        </WorkspaceColumn>

        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          <Card title={t("imageDetail.generate-card")}>
            <div className="flex flex-col gap-3">
              {genError && (
                <Banner
                  tone="danger"
                  message={t("imageDetail.run-error")}
                  detail={genError}
                />
              )}

              <span title={geminiTooltip} className="block">
                <Button
                  className="w-full"
                  disabled={genSubmitting || generating || !canGenerate}
                  onClick={() => runGenerate("all")}
                >
                  <Zap size={15} strokeWidth={2} />
                  {t("imageDetail.generate-all")}
                </Button>
              </span>

              <Field
                label={t("imageDetail.bg-model")}
                htmlFor="image-quick-model"
                hint={
                  modelsLoading
                    ? t("images.loading-models")
                    : modelSaving
                      ? t("common.saving")
                      : modelChoices.hint
                }
              >
                <select
                  id="image-quick-model"
                  className="input"
                  value={currentModel ?? ""}
                  disabled={modelSaving}
                  onFocus={loadModels}
                  onChange={(e) => onModelChange(e.target.value || null)}
                >
                  <ImageModelOptions
                    current={currentModel}
                    geminiModels={modelOptions}
                    choices={modelChoices}
                  />
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <span title={geminiTooltip} className="min-w-0">
                  <Button
                    variant="secondary"
                    small
                    className="w-full"
                    disabled={genSubmitting || generating || !canGenerate}
                    onClick={() => runGenerate("background")}
                  >
                    <Wand2 size={14} strokeWidth={2} />
                    {t("imageDetail.gen-bg")}
                  </Button>
                </span>
                <span
                  className="min-w-0"
                  title={proj?.background ? undefined : t("imageDetail.need-bg")}
                >
                  <Button
                    variant="secondary"
                    small
                    className="w-full"
                    disabled={genSubmitting || generating || !proj?.background}
                    onClick={() => runGenerate("compose")}
                  >
                    <Layers size={14} strokeWidth={2} />
                    {t("imageDetail.compose")}
                  </Button>
                </span>
              </div>
              {!canGenerate && gemini && (
                <p className="text-meta text-[var(--text-muted)]">
                  {t("imageDetail.gemini-hint")}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <Button
                  variant="secondary"
                  small
                  disabled={uploadingBg || generating}
                  title={t("imageDetail.upload-bg-title")}
                  onClick={() => bgInputRef.current?.click()}
                >
                  <Upload size={14} strokeWidth={2} />
                  {uploadingBg
                    ? t("imageDetail.uploading-bg")
                    : t("imageDetail.upload-bg")}
                </Button>
              </div>

              <input
                ref={bgInputRef}
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadBackground(f);
                  e.target.value = "";
                }}
              />
            </div>
          </Card>
        </WorkspaceColumn>

        <WorkspaceColumn role="output" title={t("workspace.col.output")}>

          <WorkspaceBlock
            id="image-block-output"
            icon={ImageIcon}
            title={t("imageDetail.final-card")}
            summary={proj?.final ?? t("imageDetail.no-final")}
            actions={
              proj?.final ? (
                <>
                  <IconButton
                    label={t("common.zoom")}
                    onClick={() => setPreview(fileOf(proj.final!, "Final"))}
                  >
                    <Maximize2 size={15} strokeWidth={2} />
                  </IconButton>
                  <a
                    href={imageFileUrl(imageId, proj.final, proj.updatedAt)}
                    download
                    title={t("imageDetail.download")}
                    aria-label={t("imageDetail.download")}
                    className="icon-btn"
                  >
                    <Download size={15} strokeWidth={2} />
                  </a>
                </>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-3">
              {(activeJob || generating) && (
                <Panel
                  title={t("imageDetail.progress")}
                  actions={<JobBadge status={activeJob?.status ?? "running"} />}
                >
                  {activeJob ? (
                    <ProgressBar
                      progress={activeJob.progress}
                      step={activeJob.step || undefined}
                    />
                  ) : (
                    <div
                      className="progress-indeterminate"
                      aria-label={t("imageDetail.generating-aria")}
                    />
                  )}
                  {activeJob?.status === "failed" && (
                    <Banner
                      tone="danger"
                      message={t("imageDetail.gen-failed")}
                      detail={proj?.error ?? undefined}
                    />
                  )}
                </Panel>
              )}

              <div
                className="workspace-media"

                style={{ "--workspace-aspect": aspectRatio } as CSSProperties}
              >
                {proj?.final ? (

                  <ZoomableThumb
                    file={fileOf(proj.final, "Final")}
                    alt={tf("imageDetail.final-alt-name", { name: proj.name })}
                    onOpen={setPreview}
                    className="h-full w-full"
                    imgClassName="h-full w-full object-contain"
                    iconSize={24}
                  />
                ) : generating || activeJob ? (
                  <>
                    <span className="workspace-shimmer" aria-hidden="true" />
                    <div
                      className="relative px-4 text-center"
                      role="status"
                      aria-live="polite"
                    >
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("imageDetail.generating-aria")}
                      </p>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={ImageIcon}
                    description={t("imageDetail.no-final")}
                  />
                )}
              </div>
            </div>
          </WorkspaceBlock>

          <Card title={t("imageDetail.steps")}>
            <StepThumb
              label={t("imageDetail.step-bg")}
              file={
                proj?.background
                  ? fileOf(proj.background, t("imageDetail.step-bg"))
                  : null
              }
              alt={t("imageDetail.bg-alt")}
              onOpen={setPreview}
            />
          </Card>
        </WorkspaceColumn>
      </Workspace>

      <ShellRightPanel title={t("imageDetail.ai-panel")}>
        {activeJob || logLines.length > 0 ? (

          <Panel
            className="min-h-0 flex-1"
            title={tf("imageDetail.view-log", { n: logLines.length })}
            actions={
              activeJob ? <JobBadge status={activeJob.status} /> : undefined
            }
          >

            <pre
              ref={logBoxRef}
              className="min-h-32 min-w-0 flex-1 overflow-auto rounded-[var(--radius)] bg-[var(--surface)] p-2 font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {logLines.length > 0
                ? logLines.join("\n")
                : t("imageDetail.no-log")}
            </pre>
          </Panel>
        ) : (
          <Panel className="min-h-0 flex-1 items-center justify-center">
            <EmptyState
              icon={ScrollText}
              description={t("imageDetail.ai-panel-empty")}
            />
          </Panel>
        )}
      </ShellRightPanel>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("imageDetail.delete-title")}
        description={
          <>
            {t("imageDetail.delete-desc-1")}{" "}
            <span className="font-medium">{proj?.name ?? imageId}</span>? {t("project.delete-desc-2")}{" "}
            <code className="rounded bg-[var(--bg-subtle)] px-1 text-meta">
              image-projects/{imageId}
            </code>{" "}
            {t("project.delete-desc-3")}
          </>
        }
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />

      <CloneProjectModal
        source={cloneOpen ? { id: imageId, name: proj?.name ?? imageId } : null}
        clone={cloneImageProject}
        descriptionKey="clone.image-description"
        onClose={() => setCloneOpen(false)}
        onCloned={(p) => {
          setCloneOpen(false);
          router.push(`/images/${p.id}`);
        }}
      />

      <MediaPreviewModal file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
