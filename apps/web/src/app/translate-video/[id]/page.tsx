"use client";


import {
  AlertTriangle,
  ArrowLeft,
  Cloud,
  Cpu,
  FileVideo,
  Film,
  Languages,
  Layers,
  Loader2,
  Mic,
  Play,
  ScrollText,
  Square,
  Subtitles,
  Trash2,
  Type,
  Upload,
  Wand2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteTranslateVideo,
  dubPreviewTranslateVideo,
  DEFAULT_TRANSLATE_MODEL,
  DUB_ALL_SPEAKERS,
  DUB_ORIGINAL_VOLUME_MAX,
  getJob,
  getJobs,
  getSttProviders,
  getTranslateVideo,
  getTtsEngines,
  getTtsVoices,
  isTranslateVideoJob,
  mediaUrl,
  renderTranslateVideo,
  SUBTITLE_BLUR_MAX,
  SUBTITLE_BOTTOM_MAX,
  SUBTITLE_FONT_SIZE_MAX,
  SUBTITLE_FONT_SIZE_MIN,
  SUBTITLE_FONTS,
  TRANSLATE_DEFAULT_DUB,
  TRANSLATE_DEFAULT_SUBTITLE_STYLE,
  TRANSLATE_MODE_LABEL,
  TRANSLATE_MODELS,
  TRANSLATE_PROVIDER,
  TRANSLATE_SOURCE_LANGS,
  TRANSLATE_TARGET_LANGS,
  TRANSLATE_VIDEO_STATUS_LABEL,
  TRANSLATE_VIDEO_STATUS_TONE,
  TTS_ENGINES,
  transcribeTranslateVideo,
  translateTranslateVideo,
  updateTranslateVideo,
  uploadTranslateVideoSource,
  type DubInfo,
  type DubPreviewResult,
  type DubSettings,
  type Job,
  type SttCapability,
  type SttProvider,
  type SubtitleBackdrop,
  type SubtitleFontId,
  type SubtitleStyle,
  type TranslatedCue,
  type TranslateMode,
  type TranslateVideoMeta,
  type TtsEngine,
  type TtsEngineStatus,
  type TtsGender,
  type TtsVoice,
} from "@/lib/api";
import { useEvents, useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { CheckboxField, Field } from "@/components/Field";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";
import { OptionCard, OptionCardGroup } from "@/components/OptionCard";
import { Panel } from "@/components/Panel";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/Segmented";
import { StepperBar } from "@/components/PipelineTimeline";
import { ProgressBar } from "@/components/ProgressBar";
import { ShellRightPanel } from "@/components/Shell";
import {
  OutputBlock,
  useCollapseGroup,
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
  type WorkspaceStatus,
} from "@/components/Workspace";
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

const PATCH_DEBOUNCE_MS = 700;

const RUNNING_STATUS = ["transcribing", "translating", "rendering"];

const FONT_STACK: Record<SubtitleFontId, string> = {
  vietnamese: "'Be Vietnam Pro', 'Inter', 'Segoe UI', system-ui, sans-serif",
  sans: "'Inter', 'Segoe UI', Arial, system-ui, sans-serif",
  serif: "'Noto Serif', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Consolas', ui-monospace, monospace",
};

const TV_BLOCKS = ["source", "transcript", "translation", "result"] as const;
type BlockKey = (typeof TV_BLOCKS)[number];

const TV_KEEP_EXPANDED: readonly BlockKey[] = ["result"];

const STAGE_LABELS = [
  "tv.stage.source",
  "tv.stage.transcript",
  "tv.stage.translation",
  "tv.stage.subtitle",
  "tv.stage.result",
] as const;

const PREVIEW_FRAME_SEC = 2;

const ERROR_PREVIEW_MAX = 240;

function shortError(e: string | null | undefined): string | null {
  if (!e) return null;
  const s = e.replace(/\s+/g, " ").trim();
  return s.length > ERROR_PREVIEW_MAX ? `${s.slice(0, ERROR_PREVIEW_MAX)}…` : s;
}

interface Patch {
  name?: string;
  sourceLang?: string;
  targetLang?: string;
  dubLang?: string | null;
  mode?: TranslateMode;
  sttProvider?: SttProvider;
  cues?: TranslatedCue[];
  subtitleStyle?: SubtitleStyle;
  dub?: DubSettings;
}

function deriveTvStage(m: TranslateVideoMeta): {
  stage: number;
  active: boolean;
  complete: boolean;
} {
  if (m.status === "transcribing") return { stage: 2, active: true, complete: false };
  if (m.status === "translating") return { stage: 3, active: true, complete: false };
  if (m.status === "rendering") return { stage: 5, active: true, complete: false };
  if (m.status === "done") return { stage: 5, active: false, complete: true };
  if (m.cues.length > 0) {
    const translated = m.cues.some((c) => c.text.trim() !== "");
    return { stage: translated ? 4 : 3, active: false, complete: false };
  }
  if (m.transcriptFile) return { stage: 3, active: false, complete: false };
  return { stage: m.source.relPath ? 2 : 1, active: false, complete: false };
}

function JobLogBlock({ job, stepLabel }: { job: Job; stepLabel: string }) {
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
      className="min-h-0 flex-1"
      title={stepLabel}
      actions={
        <span className="shrink-0 text-meta text-[var(--text-muted)]">
          {job.status}
        </span>
      }
    >
      <ProgressBar progress={job.progress} step={job.step} />
      {error && <ErrorBanner message={t("tv.job-log-error")} detail={error} />}
      <pre
        ref={preRef}
        className="min-h-32 min-w-0 flex-1 overflow-auto rounded-[var(--radius)] bg-[var(--surface)] p-2 font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {log || t("tv.job-no-log")}
      </pre>
    </Panel>
  );
}

function ColorField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          className="input"
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Field>
  );
}


function alphaOf(color: string): number {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(",").map((x) => Number(x.trim()));
    return parts.length >= 4 && Number.isFinite(parts[3])
      ? Math.min(1, Math.max(0, parts[3]))
      : 1;
  }
  const hex8 = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (hex8) return parseInt(hex8[2], 16) / 255;
  return 1;
}

function withAlpha(color: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100;
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const [r, g, b] = rgba[1].split(",").map((x) => Number(x.trim()));
    return `rgba(${r || 0},${g || 0},${b || 0},${a})`;
  }
  const hex = color.match(/^#([0-9a-f]{6})/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

function OpacityField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const pct = Math.round(alphaOf(value) * 100);
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex h-9 items-center gap-2">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          disabled={disabled}
          className="slider min-w-0"
          onChange={(e) => onChange(withAlpha(value, Number(e.target.value) / 100))}
        />
        <span className="w-10 shrink-0 text-right text-meta tabular-nums text-[var(--text-muted)]">
          {pct}%
        </span>
      </div>
    </Field>
  );
}


const DUB_GENDERS: TtsGender[] = ["nam", "nu", "trung-tinh"];

const DUB_GENDER_LABEL_KEY: Record<TtsGender, string> = {
  nam: "ttv.voice.gender.male",
  nu: "ttv.voice.gender.female",
  "trung-tinh": "ttv.voice.gender.neutral",
};

const DUB_ENGINE_LABEL_KEY: Record<TtsEngine, string> = {
  voicestudio: "ttv.voice.engine.voicestudio",
  gemini: "ttv.voice.engine.gemini",
  vieneu: "ttv.voice.engine.vieneu",
};

const DUB_ENGINE_ICON: Record<TtsEngine, typeof Cloud> = {
  voicestudio: Cpu,
  gemini: Cloud,
  vieneu: Cpu,
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function DubSettingsCard({
  sessionId,
  dub,
  speakers,
  diarized,
  cueIndexOf,
  speakerF0,
  disabled,
  onChange,
}: {
  sessionId: string;
  dub: DubSettings;
  speakers: string[];
  diarized: boolean;
  cueIndexOf: (speaker: string) => number;
  speakerF0: Record<string, number>;
  disabled: boolean;
  onChange: (patch: Partial<DubSettings>, immediate?: boolean) => void;
}) {
  const { t, tf } = useT();
  const engine = dub.engine === "vieneu" ? "vieneu" : "gemini";

  const [engines, setEngines] = useState<TtsEngineStatus[] | null>(null);
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, DubPreviewResult>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);

  const voiceCache = useRef<Partial<Record<TtsEngine, TtsVoice[]>>>({});

  useEffect(() => {
    let alive = true;
    getTtsEngines()
      .then((list) => alive && setEngines(list))
      .catch((e) => {
        if (!alive) return;
        setEngines([]);
        setLoadError(errText(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const hit = voiceCache.current[engine];
    if (hit) {
      setVoices(hit);
      return;
    }
    setVoices(null);
    getTtsVoices(engine)
      .then((list) => {
        if (!alive) return;
        voiceCache.current[engine] = list;
        setVoices(list);
        setLoadError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setVoices([]);
        setLoadError(errText(e));
      });
    return () => {
      alive = false;
    };
  }, [engine]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioRef.current?.pause();
      audioRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(null);
  }

  async function preview(speaker: string) {
    if (disabled) return;
    if (playing === speaker) {
      stop();
      return;
    }
    stop();
    if (loadingKey) return;
    setLoadingKey(speaker);
    setPreviewError(null);
    try {
      const index = cueIndexOf(speaker);
      const voice = (dub.voices[speaker] ?? "").trim();
      const res = await dubPreviewTranslateVideo(sessionId, {
        index: index >= 0 ? index : 0,
        ...(voice ? { voice } : {}),
      });
      if (!mountedRef.current) return;
      setResults((prev) => ({ ...prev, [speaker]: res }));
      const url = URL.createObjectURL(res.audio);
      const audio = new Audio(url);
      audio.onended = () => stop();
      audio.onerror = () => {
        stop();
        setPreviewError(t("tv.dub.preview-failed"));
      };
      audioRef.current = audio;
      urlRef.current = url;
      setPlaying(speaker);
      await audio.play().catch(() => stop());
    } catch (e) {
      setPreviewError(errText(e));
    } finally {
      setLoadingKey(null);
    }
  }

  const list = voices ?? [];
  const rows = speakers.length > 0 ? speakers : [DUB_ALL_SPEAKERS];
  const noEngine = engines !== null && !engines.some((s) => s.available);

  return (
    <div className="flex flex-col gap-4">
      {loadError && (
        <ErrorBanner message={t("tv.dub.voices-error")} detail={loadError} />
      )}

      <Field label={t("tv.dub.engine")}>
        {engines === null ? (
          <p className="flex items-center gap-2 py-2 text-meta text-[var(--text-muted)]">
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            {t("ttv.voice.engine.checking")}
          </p>
        ) : (
          <OptionCardGroup
            label={t("tv.dub.engine")}
            className="grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"
          >
            {TTS_ENGINES.map((e) => {
              const st = engines.find((s) => s.engine === e) ?? null;
              const ok = st?.available === true;
              return (
                <OptionCard
                  key={e}
                  icon={DUB_ENGINE_ICON[e]}
                  selected={engine === e}
                  disabled={disabled || !ok}
                  onSelect={() => onChange({ engine: e, voices: {} })}
                  title={t(DUB_ENGINE_LABEL_KEY[e])}
                  description={t(`ttv.voice.engine.${e}-desc`)}
                  badge={
                    <Badge
                      dot={false}
                      tone={ok ? "success" : "danger"}
                      label={
                        ok
                          ? t("ttv.voice.engine.ready")
                          : t("ttv.voice.engine.unavailable")
                      }
                    />
                  }
                />
              );
            })}
          </OptionCardGroup>
        )}
      </Field>

      {(engines ?? [])
        .filter((st) => !st.available && st.detail)
        .map((st) => (
          <Banner
            key={st.engine}
            tone="danger"
            message={`${t(DUB_ENGINE_LABEL_KEY[st.engine])} · ${t(
              "ttv.voice.engine.unavailable"
            )}`}
            detail={st.detail}
          />
        ))}

      {noEngine && (
        <Banner tone="danger" message={t("ttv.voice.engine.none")} />
      )}

      <Panel
        title={
          <span className="inline-flex items-center gap-1">
            {t("tv.dub.voices")}
            <InfoHint
              titleKey="help.tv-dub-voices.title"
              bodyKey="help.tv-dub-voices.body"
            />
          </span>
        }
      >
        {!diarized && (
          <p className="text-meta text-[var(--text-muted)]">
            {t("tv.dub.not-diarized")}
          </p>
        )}

        {previewError && (
          <ErrorBanner message={t("tv.dub.preview-failed")} detail={previewError} />
        )}

        <ul className="flex flex-col">
          {rows.map((speaker) => {
            const chosen = dub.voices[speaker] ?? "";
            const missing =
              chosen !== "" && list.length > 0 && !list.some((v) => v.name === chosen);
            const res = results[speaker];
            const isLoading = loadingKey === speaker;
            const isPlaying = playing === speaker;
            const f0 = speakerF0[speaker] ?? 0;
            return (
              <li
                key={speaker || "__all__"}
                className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">
                    {speaker
                      ? tf("tv.dub.speaker", { name: speaker })
                      : t("tv.dub.all-speakers")}
                  </span>
                  {f0 > 0 && (
                    <span className="chip" title={t("tv.dub.f0-title")}>
                      {tf("tv.dub.f0", { f0: Math.round(f0) })}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <select
                    className="input"
                    value={chosen}
                    disabled={disabled}
                    aria-label={
                      speaker
                        ? tf("tv.dub.voice-aria", { name: speaker })
                        : t("tv.dub.all-speakers")
                    }
                    onChange={(ev) =>
                      onChange({
                        voices: { ...dub.voices, [speaker]: ev.target.value },
                      })
                    }
                  >
                    <option value="">{t("tv.dub.voice-auto")}</option>
                    {missing && <option value={chosen}>{chosen}</option>}
                    {DUB_GENDERS.map((g) => {
                      const items = list
                        .filter((v) => v.gender === g)
                        .sort((a, b) => a.title.localeCompare(b.title));
                      if (items.length === 0) return null;
                      return (
                        <optgroup key={g} label={t(DUB_GENDER_LABEL_KEY[g])}>
                          {items.map((v) => (
                            <option key={v.name} value={v.name}>
                              {v.title}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <Button
                    variant="secondary"
                    small
                    disabled={disabled || (loadingKey !== null && !isLoading)}
                    onClick={() => preview(speaker)}
                  >
                    {isLoading ? (
                      <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                    ) : isPlaying ? (
                      <Square size={14} strokeWidth={2} />
                    ) : (
                      <Play size={14} strokeWidth={2} />
                    )}
                    {isPlaying ? t("tv.dub.stop") : t("tv.dub.preview")}
                  </Button>
                </div>

                {res && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-meta text-[var(--text-muted)]">
                    <span className="chip">
                      {tf("tv.dub.tempo", { tempo: res.tempo.toFixed(2) })}
                    </span>
                    <span className="chip">
                      {tf("tv.dub.fit", {
                        final: res.finalSec.toFixed(2),
                        source: res.sourceSec.toFixed(2),
                      })}
                    </span>
                    {res.voice && <span className="chip">{res.voice}</span>}
                    {res.clipped && (
                      <span className="flex items-center gap-1 text-[var(--danger)]">
                        <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                        {t("tv.dub.clipped")}
                      </span>
                    )}
                    {res.overflowed && (
                      <span className="flex items-center gap-1 text-[var(--danger)]">
                        <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                        {t("tv.dub.overflowed")}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-meta text-[var(--text-muted)]">
          {t("tv.dub.preview-hint")}
        </p>
      </Panel>

      <div className="flex flex-col gap-3">
        <CheckboxField
          id="tv-dub-keep-original"
          label={t("tv.dub.keep-original")}
          checked={dub.keepOriginal}
          disabled={disabled}
          onChange={(next) => onChange({ keepOriginal: next })}
        />
        {dub.keepOriginal && (
          <Field
            label={tf("tv.dub.original-volume", {
              percent: Math.round(dub.originalVolume * 100),
            })}
            htmlFor="tv-dub-original-volume"
            hint={t("tv.dub.original-volume-hint")}
          >
            <input
              id="tv-dub-original-volume"
              type="range"
              className="slider"
              min={0}
              max={DUB_ORIGINAL_VOLUME_MAX}
              step={0.01}
              value={dub.originalVolume}
              disabled={disabled}
              onChange={(e) =>
                onChange({ originalVolume: Number(e.target.value) }, false)
              }
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function DubReport({ info }: { info: DubInfo }) {
  const { t, tf } = useT();
  return (
    <Panel title={t("tv.dub.report")}>
      <div className="flex flex-wrap items-center gap-2 text-meta text-[var(--text-muted)]">
        <span className="chip">{tf("tv.cue-count", { n: info.cues })}</span>
        <span className="chip">{tf("tv.dub.stretched", { n: info.stretched })}</span>
        <span className="chip">
          {tf("tv.dub.tempo-range", {
            min: info.minTempo.toFixed(2),
            max: info.maxTempo.toFixed(2),
          })}
        </span>
        <span className={info.clipped > 0 ? "chip text-[var(--danger)]" : "chip"}>
          {tf("tv.dub.clipped-count", { n: info.clipped })}
        </span>
        <span className={info.overflowed > 0 ? "chip text-[var(--danger)]" : "chip"}>
          {tf("tv.dub.overflowed-count", { n: info.overflowed })}
        </span>
      </div>
      <p className="text-meta text-[var(--text-muted)]">
        {info.overflowed > 0 ? t("tv.dub.report-overflow") : t("tv.dub.report-ok")}
      </p>
    </Panel>
  );
}

function ConfigSummary({
  icon: Icon,
  label,
  value,
  onEdit,
}: {
  icon: typeof Type;
  label: string;
  value: string;
  onEdit: () => void;
}) {
  const { t } = useT();
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          {label}
        </span>
      }
      actions={
        <Button variant="secondary" small onClick={onEdit}>
          {t("tv.configure")}
        </Button>
      }
    >
      <p className="min-w-0 text-meta text-[var(--text-muted)]">{value}</p>
    </Panel>
  );
}

export default function TranslateVideoDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const { resyncTick } = useEvents();

  const [session, setSession] = useState<TranslateVideoMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"transcribe" | "translate" | "render" | null>(
    null
  );

  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("vi");
  const [mode, setMode] = useState<TranslateMode>("subtitle");
  const [dubLang, setDubLang] = useState<string | null>(null);
  const [sttProvider, setSttProvider] = useState<SttProvider>("local");
  const [cues, setCues] = useState<TranslatedCue[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle | null>(null);
  const [dub, setDub] = useState<DubSettings | null>(null);

  const [translateModel, setTranslateModel] = useState(DEFAULT_TRANSLATE_MODEL);

  const [sttProviders, setSttProviders] = useState<SttCapability[] | null>(null);

  const pending = useRef<Patch>({});
  const inflight = useRef<Promise<string | null> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [job, setJob] = useState<Job | null>(null);
  const [jobPhase, setJobPhase] = useState<"transcribe" | "render" | null>(null);
  const currentJobId = useRef<string | null>(null);

  const group = useCollapseGroup({
    keys: TV_BLOCKS,
    finished: session?.status === "done",
    keepExpanded: TV_KEEP_EXPANDED,
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [subtitleModalOpen, setSubtitleModalOpen] = useState(false);
  const [dubModalOpen, setDubModalOpen] = useState(false);
  const [chainToDub, setChainToDub] = useState(false);

  const adopt = useCallback((s: TranslateVideoMeta) => {
    setSession(s);
    const p = pending.current;
    if (!p.sourceLang) setSourceLang(s.sourceLang || "auto");
    if (!p.targetLang) setTargetLang(s.targetLang || "vi");
    if (!p.mode) setMode(s.mode ?? "subtitle");
    if (!("dubLang" in p)) setDubLang(s.dubLang ?? null);
    if (!p.sttProvider) setSttProvider(s.sttProvider ?? "local");
    if (!p.cues) setCues(s.cues ?? []);
    if (!p.subtitleStyle) {
      setSubtitleStyle({
        ...TRANSLATE_DEFAULT_SUBTITLE_STYLE,
        ...(s.subtitleStyle ?? {}),
      });
    }
    if (!p.dub) {
      setDub({ ...TRANSLATE_DEFAULT_DUB, ...(s.dub ?? {}) });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await getTranslateVideo(sessionId));
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
    getSttProviders()
      .then((list) => alive && setSttProviders(list))
      .catch(() => alive && setSttProviders(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        const mine = list.filter((j) => isTranslateVideoJob(j, sessionId));
        if (!alive || mine.length === 0) return;
        setJob(mine[0]);
        currentJobId.current = mine[0].id;
      })
      .catch(() => {
      });
    return () => {
      alive = false;
    };
  }, [sessionId, resyncTick]);

  useJobEvents((j) => {
    if (!isTranslateVideoJob(j, sessionId) && j.id !== currentJobId.current) return;
    setJob(j);
    if (["done", "failed", "canceled"].includes(j.status)) load();
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
        const s = await updateTranslateVideo(sessionId, patch);
        setSession(s);
        if (
          ("sourceLang" in patch || "targetLang" in patch || "dubLang" in patch) &&
          !pending.current.cues
        ) {
          setCues(s.cues ?? []);
        }
        setSaveError(null);
        return null;
      } catch (e) {
        pending.current = { ...patch, ...pending.current };
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
        updateTranslateVideo(sessionId, patch).catch(() => {
        });
      }
    };
  }, [sessionId]);

  const queue = useCallback(
    (patch: Patch, immediate = false) => {
      pending.current = { ...pending.current, ...patch };
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (immediate) {
        flush();
      } else {
        flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
      }
    },
    [flush]
  );

  function patchSourceLang(v: string) {
    setSourceLang(v);
    queue({ sourceLang: v }, true);
  }

  function patchTargetLang(v: string) {
    setTargetLang(v);
    queue({ targetLang: v }, true);
  }

  function patchMode(v: TranslateMode) {
    setMode(v);
    queue({ mode: v }, true);
  }

  function patchDubLang(v: string | null) {
    setDubLang(v);
    queue({ dubLang: v }, true);
  }

  function chooseMode(v: TranslateMode) {
    patchMode(v);
    setChainToDub(v === "both");
    if (v === "dub") {
      setSubtitleModalOpen(false);
      setDubModalOpen(true);
    } else {
      setDubModalOpen(false);
      setSubtitleModalOpen(true);
    }
  }

  function closeSubtitleModal() {
    setSubtitleModalOpen(false);
    if (chainToDub) {
      setChainToDub(false);
      setDubModalOpen(true);
    }
  }

  function patchSttProvider(v: SttProvider) {
    setSttProvider(v);
    queue({ sttProvider: v }, true);
  }

  function patchDub(p: Partial<DubSettings>, immediate = true) {
    if (!dub) return;
    const next = { ...dub, ...p };
    setDub(next);
    queue({ dub: next }, immediate);
  }

  function patchStyle(p: Partial<SubtitleStyle>, immediate = false) {
    if (!subtitleStyle) return;
    const next = { ...subtitleStyle, ...p };
    setSubtitleStyle(next);
    queue({ subtitleStyle: next }, immediate);
  }

  function patchCueText(index: number, text: string) {
    const next = cues.map((c, i) => (i === index ? { ...c, text } : c));
    setCues(next);
    queue({ cues: next });
  }

  function patchCueDubText(index: number, dubText: string) {
    const next = cues.map((c, i) => (i === index ? { ...c, dubText } : c));
    setCues(next);
    queue({ cues: next });
  }


  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      adopt(await uploadTranslateVideoSource(sessionId, files[0]));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function run(step: "transcribe" | "translate" | "render") {
    if (busy) return;
    setBusy(step);
    setActionError(null);
    try {
      const saveErr = await flush();
      if (saveErr) {
        setActionError(saveErr);
        return;
      }
      if (step === "translate") {
        adopt(await translateTranslateVideo(sessionId, { model: translateModel }));
      } else {
        const { jobId } =
          step === "transcribe"
            ?
              await transcribeTranslateVideo(sessionId, { sttProvider })
            : await renderTranslateVideo(sessionId);
        currentJobId.current = jobId;
        setJobPhase(step === "transcribe" ? "transcribe" : "render");
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
      await deleteTranslateVideo(sessionId);
      router.push("/translate-video");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  function langLabel(code: string): string {
    const key = `tv.lang.${code}`;
    const label = t(key);
    return label === key ? code : label;
  }

  function sttName(id: string): string {
    const key = `tv.stt.${id}`;
    const label = t(key);
    if (label !== key) return label;
    return (sttProviders ?? []).find((p) => p.id === id)?.label ?? id;
  }

  function modelLabel(id: string): string {
    const hit = TRANSLATE_MODELS.find((m) => m.id === id);
    if (!hit) return id;
    const label = t(hit.labelKey);
    return label === hit.labelKey ? hit.id : `${hit.id} - ${label}`;
  }

  if (!session || !subtitleStyle || !dub) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("nav.translate-video")} />
        {loadError ? (
          <ErrorBanner message={t("tv.not-found")} detail={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </div>
    );
  }

  const running =
    RUNNING_STATUS.includes(session.status) ||
    busy === "translate" ||
    job?.status === "queued";
  const locked = running;
  const stage = deriveTvStage(session);
  const src = session.source;
  const hasSource = src.relPath !== null;
  const translatedCount = cues.filter((c) => c.text.trim() !== "").length;
  const canTranscribe = hasSource && !running;
  const canTranslate = cues.length > 0 && !running;
  const canRender = translatedCount > 0 && !running;
  const statusLabel = TRANSLATE_VIDEO_STATUS_LABEL[session.status]
    ? t(TRANSLATE_VIDEO_STATUS_LABEL[session.status])
    : String(session.status);
  const sourceUrl = src.relPath
    ? `${mediaUrl(src.relPath)}?v=${encodeURIComponent(session.updatedAt)}`
    : null;
  const outputUrl = session.outputFile
    ? `${mediaUrl(session.outputFile)}?v=${encodeURIComponent(session.updatedAt)}`
    : null;

  const wantsSubtitleMode = mode === "subtitle" || mode === "both";
  const wantsDubMode = mode === "dub" || mode === "both";
  const isDub = wantsDubMode;
  const effectiveDubLang = dubLang ?? targetLang;
  const twoLangs = wantsDubMode && effectiveDubLang !== targetLang;
  const dubTranslationMissing =
    twoLangs && cues.length > 0 && !cues.some((c) => c.dubText);
  const sttCap = (sttProviders ?? []).find((p) => p.id === sttProvider) ?? null;

  const speakers = (
    session.transcriptInfo?.diarized ? session.transcriptInfo.speakers : []
  ).filter((s) => cues.some((c) => (c.speaker ?? "") === s));

  const cueIndexOf = (speaker: string): number =>
    speaker ? cues.findIndex((c) => (c.speaker ?? "") === speaker) : 0;

  const phase =
    jobPhase ??
    (session.status === "rendering" || session.status === "done"
      ? "render"
      : "transcribe");


  const done = session.status === "done";

  const renderJob = job && phase === "render" ? job : null;

  const renderFailed = session.status === "failed" && phase === "render";

  const outputStatus: WorkspaceStatus =
    session.status === "rendering"
      ? "running"
      : renderFailed
        ? "failed"
        : session.outputFile
          ? "done"
          : "idle";

  const aspect =
    src.width && src.height ? `${src.width} / ${src.height}` : "16 / 9";


  const sourceSummary = hasSource
    ? [
        src.relPath?.split(/[\\/]/).pop(),
        src.width && src.height ? `${src.width}x${src.height}` : null,
        src.durationSec ? clock(src.durationSec) : null,
        src.fps ? `${src.fps}fps` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("tv.no-source-yet");
  const transcriptSummary = [
    sttName(session.transcriptInfo?.provider ?? sttProvider),
    cues.length > 0 ? tf("tv.cue-count", { n: cues.length }) : t("tv.no-transcript"),
    session.transcriptInfo?.diarized
      ? tf("tv.transcript-speakers", { n: session.transcriptInfo.speakers.length })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const translationSummary = `${langLabel(sourceLang)} → ${langLabel(targetLang)} · ${
    translatedCount > 0
      ? tf("tv.translated-count", { n: translatedCount })
      : t("tv.no-translation")
  } · ${TRANSLATE_PROVIDER} ${translateModel}`;
  const subtitleSummary = `${t(`tv.font.${subtitleStyle.fontFamily}`)} · ${
    subtitleStyle.fontSizePx
  }px · ${t(`tv.backdrop.${subtitleStyle.backdrop}`)}`;
  const resultSummary = session.outputFile ?? statusLabel;
  const dubSummary = [
    t(DUB_ENGINE_LABEL_KEY[dub.engine === "vieneu" ? "vieneu" : "gemini"]),
    speakers.length > 0
      ? tf("tv.dub.speaker-count", { n: speakers.length })
      : t("tv.dub.all-speakers"),
    dub.keepOriginal ? t("tv.dub.keep-original-short") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={session.name}
        subtitle={
          src.width && src.height
            ? `${src.width}x${src.height}${src.fps ? ` · ${src.fps}fps` : ""}`
            : undefined
        }
        center={
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <StepperBar
                steps={STAGE_LABELS}
                stage={stage.stage}
                active={stage.active}
                done={stage.complete}
                ariaLabel={tf("tv.stage-aria", {
                  stage: stage.stage,
                  label: t(STAGE_LABELS[stage.stage - 1]),
                })}
              />
            </div>
            <InfoHint titleKey="help.tv.title" bodyKey="help.tv.body" className="mt-px" />
          </div>
        }
        actions={
          <>
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/translate-video")}>
                <ArrowLeft size={15} strokeWidth={2} />
                {t("tv.back")}
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
        <div className="flex flex-wrap items-center gap-2 text-meta text-[var(--text-muted)]">
          <Badge
            tone={TRANSLATE_VIDEO_STATUS_TONE[session.status] ?? "muted"}
            label={statusLabel}
          />
          <span className="chip">
            {langLabel(sourceLang)} → {langLabel(targetLang)}
          </span>
          <span className="chip">
            {TRANSLATE_MODE_LABEL[mode] ? t(TRANSLATE_MODE_LABEL[mode]) : mode}
          </span>
          {src.durationSec ? (
            <span className="chip">{clock(src.durationSec)}</span>
          ) : null}
          {cues.length > 0 && (
            <span className="chip">{tf("tv.cue-count", { n: cues.length })}</span>
          )}
          {done && group.anyCollapsed && (
            <span className="min-w-0">{t("tv.section.done-collapsed")}</span>
          )}
          <span className="ml-auto">
            {t("common.updated")}: {formatDateTime(session.updatedAt)}
          </span>
        </div>
      </Card>

      {loadError && <ErrorBanner message={t("tv.load-error")} detail={loadError} />}
      {actionError && <ErrorBanner message={t("tv.action-error")} detail={actionError} />}
      {saveError && <ErrorBanner message={t("tv.save-error")} detail={saveError} />}
      {session.status === "failed" && (
        <ErrorBanner message={t("tv.failed")} detail={session.error ?? undefined} />
      )}

      <Workspace>
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <WorkspaceBlock
            id="tv-block-source"
            icon={FileVideo}
            collapsed={group.isCollapsed("source")}
            onToggle={() => group.toggle("source")}
            summary={sourceSummary}
            title={t("tv.card-source")}
            hint={{
              titleKey: "help.tv-source.title",
              bodyKey: "help.tv-source.body",
            }}
            actions={
              <Button
                variant="secondary"
                small
                disabled={locked || uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Upload size={14} strokeWidth={2} />
                )}
                {hasSource ? t("tv.replace-video") : t("tv.upload-video")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  upload(e.target.files);
                  e.target.value = "";
                }}
              />

              {uploadError && (
                <ErrorBanner message={t("tv.upload-error")} detail={uploadError} />
              )}

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!locked && !uploading) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (!locked && !uploading) upload(e.dataTransfer.files);
                }}
                className={`rounded-[var(--radius)] border border-dashed p-4 text-center transition-colors duration-150 ${
                  dragOver
                    ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                    : "border-[var(--border)] bg-[var(--bg-subtle)]"
                }`}
              >
                {uploading ? (
                  <p className="flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
                    <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                    {t("tv.uploading")}
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">{t("tv.drop-hint")}</p>
                )}
              </div>

              {sourceUrl ? (
                <>
                  <video
                    controls
                    src={sourceUrl}
                    className="max-h-[360px] w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    {src.width && src.height && (
                      <span className="chip">
                        {src.width}x{src.height}
                      </span>
                    )}
                    {src.durationSec !== null && (
                      <span className="chip">{clock(src.durationSec)}</span>
                    )}
                    {src.fps !== null && <span className="chip">{src.fps} fps</span>}
                    <span className="min-w-0 truncate text-meta text-[var(--text-muted)]">
                      {src.relPath}
                    </span>
                  </div>
                </>
              ) : (
                <EmptyState icon={FileVideo} description={t("tv.no-source-yet")} />
              )}

              <Field
                label={t("tv.source-lang")}
                htmlFor="tv-source-lang"
                hintKeys={{
                  titleKey: "help.tv-lang.title",
                  bodyKey: "help.tv-lang.body",
                }}
              >
                <select
                  id="tv-source-lang"
                  className="input"
                  value={sourceLang}
                  disabled={locked}
                  onChange={(e) => patchSourceLang(e.target.value)}
                >
                  {!TRANSLATE_SOURCE_LANGS.includes(
                    sourceLang as (typeof TRANSLATE_SOURCE_LANGS)[number]
                  ) && <option value={sourceLang}>{sourceLang}</option>}
                  {TRANSLATE_SOURCE_LANGS.map((code) => (
                    <option key={code} value={code}>
                      {langLabel(code)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </WorkspaceBlock>

          <WorkspaceBlock
            id="tv-block-transcript"
            icon={Subtitles}
            collapsed={group.isCollapsed("transcript")}
            onToggle={() => group.toggle("transcript")}
            summary={transcriptSummary}
            title={t("tv.card-transcript")}
            hint={{
              titleKey: "help.tv-transcript.title",
              bodyKey: "help.tv-transcript.body",
            }}
            actions={
              <Button
                small
                disabled={!canTranscribe || busy !== null}
                onClick={() => run("transcribe")}
              >
                {busy === "transcribe" ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Subtitles size={14} strokeWidth={2} />
                )}
                {cues.length > 0 ? t("tv.re-transcribe") : t("tv.transcribe")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <Field
                label={t("tv.stt-provider")}
                htmlFor="tv-stt-provider"
                hintKeys={{
                  titleKey: "help.tv-stt.title",
                  bodyKey: "help.tv-stt.body",
                }}
                error={
                  sttCap && !sttCap.available && sttCap.why ? sttCap.why : null
                }
                hint={
                  sttCap?.diarization
                    ? t("tv.stt.diarization-hint")
                    : t("tv.stt.no-diarization-hint")
                }
              >
                <select
                  id="tv-stt-provider"
                  className="input"
                  value={sttProvider}
                  disabled={locked}
                  onChange={(e) => patchSttProvider(e.target.value as SttProvider)}
                >
                  {sttProviders === null && (
                    <option value={sttProvider}>{sttName(sttProvider)}</option>
                  )}
                  {(sttProviders ?? []).map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {sttName(p.id)}
                      {p.diarization ? ` · ${t("tv.stt.diarization")}` : ""}
                      {p.available ? "" : ` · ${t("tv.stt.unavailable")}`}
                    </option>
                  ))}
                </select>
              </Field>

              {session.status === "transcribing" && (
                <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  {t("tv.transcribing-hint")}
                </p>
              )}

              {cues.length === 0 ? (
                <EmptyState
                  icon={Subtitles}
                  description={hasSource ? t("tv.no-transcript") : t("tv.no-source-yet")}
                />
              ) : null}

              {session.transcriptInfo && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    {sttName(session.transcriptInfo.provider)}
                  </span>
                  <span className="chip">{session.transcriptInfo.language}</span>
                  <span className="chip">
                    {session.transcriptInfo.diarized
                      ? tf("tv.transcript-speakers", {
                          n: session.transcriptInfo.speakers.length,
                        })
                      : t("tv.transcript-no-speakers")}
                  </span>
                </div>
              )}

              {session.transcriptFile && (
                <span className="chip w-fit">
                  {t("tv.transcript-file")}: {session.transcriptFile}
                </span>
              )}
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          <WorkspaceBlock
            id="tv-block-translation"
            icon={Languages}
            collapsed={group.isCollapsed("translation")}
            onToggle={() => group.toggle("translation")}
            summary={translationSummary}
            title={t("tv.card-translation")}
            hint={{
              titleKey: "help.tv-translation.title",
              bodyKey: "help.tv-translation.body",
            }}
            actions={
              <Button
                small
                disabled={!canTranslate || busy !== null}
                onClick={() => run("translate")}
              >
                {busy === "translate" ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Wand2 size={14} strokeWidth={2} />
                )}
                {translatedCount > 0 ? t("tv.re-translate") : t("tv.translate")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <Panel>
                <Field
                  label={t("tv.mode")}
                  hintKeys={{
                    titleKey: "help.tv-mode.title",
                    bodyKey: "help.tv-mode.body",
                  }}
                >
                  <Segmented
                    label={t("tv.mode")}
                    value={mode}
                    disabled={locked}
                    onChange={chooseMode}
                    options={(
                      [
                        ["subtitle", Subtitles],
                        ["dub", Mic],
                        ["both", Layers],
                      ] as const
                    ).map(([m, Icon]) => ({
                      value: m as TranslateMode,
                      label: (
                        <>
                          <Icon size={14} strokeWidth={2} aria-hidden="true" />
                          {t(TRANSLATE_MODE_LABEL[m as TranslateMode])}
                        </>
                      ),
                    }))}
                  />
                </Field>

                <Field
                  label={t("tv.model")}
                  htmlFor="tv-model"
                  hintKeys={{
                    titleKey: "help.tv-model.title",
                    bodyKey: "help.tv-model.body",
                  }}
                  hint={tf("tv.model-current", {
                    provider: TRANSLATE_PROVIDER,
                    model: translateModel,
                  })}
                >
                  <select
                    id="tv-model"
                    className="input"
                    value={translateModel}
                    disabled={locked}
                    onChange={(e) => setTranslateModel(e.target.value)}
                  >
                    {!TRANSLATE_MODELS.some((m) => m.id === translateModel) && (
                      <option value={translateModel}>{translateModel}</option>
                    )}
                    {TRANSLATE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {modelLabel(m.id)}
                      </option>
                    ))}
                  </select>
                </Field>
              </Panel>

              {wantsSubtitleMode && (
                <ConfigSummary
                  icon={Type}
                  label={t("tv.card-subtitle")}
                  value={`${langLabel(targetLang)} · ${subtitleSummary}`}
                  onEdit={() => setSubtitleModalOpen(true)}
                />
              )}
              {wantsDubMode && (
                <ConfigSummary
                  icon={Mic}
                  label={t("tv.card-dub")}
                  value={`${langLabel(effectiveDubLang)} · ${dubSummary}`}
                  onEdit={() => setDubModalOpen(true)}
                />
              )}

              {session.status === "translating" ? (
                <p className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  {t("tv.translating-hint")}
                </p>
              ) : cues.length === 0 ? (
                <EmptyState icon={Languages} description={t("tv.no-transcript")} />
              ) : (
                <>
                  {dubTranslationMissing && (
                    <Banner
                      tone="danger"
                      message={tf("tv.dub-needs-retranslate", {
                        lang: langLabel(effectiveDubLang),
                      })}
                    />
                  )}
                  <Panel>
                    <ul className="flex flex-col">
                      {cues.map((c, i) => {
                        const subtitleBox = (
                          <textarea
                            id={`tv-cue-${i}`}
                            className="input"
                            rows={2}
                            value={c.text}
                            disabled={locked}
                            aria-label={tf("tv.cue-aria", { n: i + 1 })}
                            onChange={(e) => patchCueText(i, e.target.value)}
                            onBlur={() => flush()}
                          />
                        );
                        return (
                          <li
                            key={i}
                            className="flex flex-col gap-2 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 last:pb-0"
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-[var(--text-muted)]">
                              <span className="font-mono">
                                {clock(c.start)} - {clock(c.end)}
                              </span>
                              {c.speaker && <span className="chip">{c.speaker}</span>}
                            </div>
                            {c.original && (
                              <p className="text-sm text-[var(--text-muted)] italic">
                                {c.original}
                              </p>
                            )}
                            {twoLangs ? (
                              <Field
                                label={tf("tv.cue-subtitle-of", {
                                  lang: langLabel(targetLang),
                                })}
                                htmlFor={`tv-cue-${i}`}
                              >
                                {subtitleBox}
                              </Field>
                            ) : (
                              subtitleBox
                            )}
                            {twoLangs && (
                              <Field
                                label={
                                  <span className="inline-flex items-center gap-1">
                                    <Mic size={13} strokeWidth={2} aria-hidden="true" />
                                    {tf("tv.cue-dub-of", {
                                      lang: langLabel(effectiveDubLang),
                                    })}
                                  </span>
                                }
                                htmlFor={`tv-cue-dub-${i}`}
                              >
                                <textarea
                                  id={`tv-cue-dub-${i}`}
                                  className="input"
                                  rows={2}
                                  value={c.dubText ?? ""}
                                  disabled={locked}
                                  placeholder={t("tv.cue-dub-missing")}
                                  aria-label={tf("tv.cue-dub-aria", { n: i + 1 })}
                                  onChange={(e) => patchCueDubText(i, e.target.value)}
                                  onBlur={() => flush()}
                                />
                              </Field>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </Panel>
                  <p className="text-meta text-[var(--text-muted)]">
                    {tf("tv.translated-count", { n: translatedCount })} /{" "}
                    {tf("tv.cue-count", { n: cues.length })} · {t("tv.cue-hint")}
                  </p>
                </>
              )}
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          <OutputBlock
            id="tv-block-result"
            status={outputStatus}
            videoUrl={outputUrl}
            progress={renderJob ? renderJob.progress : null}
            step={renderJob?.step}
            aspect={aspect}
            error={renderFailed ? shortError(session.error) : null}
            collapsed={group.isCollapsed("result")}
            onToggle={() => group.toggle("result")}
            summary={resultSummary}
            title={t("tv.card-result")}
            hint={{
              titleKey: "help.tv-result.title",
              bodyKey: "help.tv-result.body",
            }}
            actions={
              <Button
                disabled={!canRender || busy !== null}
                onClick={() => run("render")}
              >
                {busy === "render" ? (
                  <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                ) : isDub ? (
                  <Mic size={15} strokeWidth={2} />
                ) : (
                  <Film size={15} strokeWidth={2} />
                )}
                {isDub
                  ? session.outputFile
                    ? t("tv.dub-re-render")
                    : t("tv.dub-render")
                  : session.outputFile
                    ? t("tv.re-render")
                    : t("tv.render")}
              </Button>
            }
          >
            {session.status === "rendering" && (
              <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                {isDub ? t("tv.dub-rendering-hint") : t("tv.rendering-hint")}
              </p>
            )}

            {session.dubInfo && <DubReport info={session.dubInfo} />}

            {outputUrl ? (
              <span className="min-w-0 truncate text-meta text-[var(--text-muted)]">
                {session.outputFile}
              </span>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                {canRender
                  ? isDub
                    ? t("tv.dub-render-hint")
                    : t("tv.render-hint")
                  : cues.length === 0
                    ? t("tv.render-need-transcript")
                    : t("tv.render-need-translation")}
              </p>
            )}
          </OutputBlock>

        </WorkspaceColumn>
      </Workspace>

      <ShellRightPanel title={t("tv.ai-panel")}>
        {job ? (
          <JobLogBlock
            job={job}
            stepLabel={
              phase === "transcribe"
                ? t("tv.ai-panel.step-transcribe")
                : isDub
                  ? t("tv.ai-panel.step-dub")
                  : t("tv.ai-panel.step-subtitle")
            }
          />
        ) : (
          <Panel className="min-h-0 flex-1 items-center justify-center">
            <EmptyState icon={ScrollText} description={t("tv.ai-panel-empty")} />
          </Panel>
        )}
      </ShellRightPanel>

      <Modal
        wide
        title={t("tv.card-subtitle")}
        open={subtitleModalOpen}
        onClose={closeSubtitleModal}
        footer={
          <Button onClick={closeSubtitleModal}>{t("common.done")}</Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("tv.subtitle-lang")} htmlFor="tv-subtitle-lang">
            <select
              id="tv-subtitle-lang"
              className="input"
              value={targetLang}
              disabled={locked}
              onChange={(e) => patchTargetLang(e.target.value)}
            >
              {!TRANSLATE_TARGET_LANGS.includes(
                targetLang as (typeof TRANSLATE_TARGET_LANGS)[number]
              ) && <option value={targetLang}>{targetLang}</option>}
              {TRANSLATE_TARGET_LANGS.map((code) => (
                <option key={code} value={code}>
                  {langLabel(code)}
                </option>
              ))}
            </select>
          </Field>

          {isDub && (
            <Banner tone="muted" message={t("tv.subtitle-unused-in-dub")} />
          )}

          <Field
            label={t("tv.preview")}
            hint={sourceUrl ? t("tv.preview-hint") : t("tv.preview-hint-no-source")}
          >
            <div className="relative flex h-40 items-end justify-center overflow-hidden rounded-[var(--radius)] bg-[#1c1c20]">
              {sourceUrl ? (
                <video
                  key={sourceUrl}
                  src={`${sourceUrl}#t=${PREVIEW_FRAME_SEC}`}
                  muted
                  playsInline
                  preload="metadata"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "repeating-linear-gradient(135deg, #3a3f4b 0 14px, #191c22 14px 28px)",
                  }}
                />
              )}
              <div
                className="relative max-w-[86%] rounded-[var(--radius)] px-3 py-1 text-center leading-snug"
                style={{
                  marginBottom: `${Math.min(
                    Math.round(subtitleStyle.bottomPx / 8),
                    96
                  )}px`,
                  fontFamily:
                    FONT_STACK[subtitleStyle.fontFamily as SubtitleFontId] ??
                    FONT_STACK.sans,
                  fontSize: `${Math.max(
                    11,
                    Math.round(subtitleStyle.fontSizePx / 3)
                  )}px`,
                  color: subtitleStyle.color,
                  background:
                    subtitleStyle.backdrop === "none"
                      ? "transparent"
                      : subtitleStyle.backdropColor,
                  backdropFilter:
                    subtitleStyle.backdrop === "blur"
                      ? `blur(${(subtitleStyle.blurPx / 3).toFixed(1)}px)`
                      : undefined,
                  opacity: subtitleStyle.backdrop === "blur" ? 0.92 : 1,
                }}
              >
                {t("tv.preview-text")}
              </div>
            </div>
          </Field>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Field
              label={t("tv.font")}
              htmlFor="tv-font"
              hintKeys={{
                titleKey: "help.tv-font.title",
                bodyKey: "help.tv-font.body",
              }}
            >
              <select
                id="tv-font"
                className="input"
                value={subtitleStyle.fontFamily}
                disabled={locked}
                onChange={(e) => patchStyle({ fontFamily: e.target.value }, true)}
              >
                {!SUBTITLE_FONTS.includes(
                  subtitleStyle.fontFamily as SubtitleFontId
                ) && (
                  <option value={subtitleStyle.fontFamily}>
                    {subtitleStyle.fontFamily}
                  </option>
                )}
                {SUBTITLE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {t(`tv.font.${f}`)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("tv.font-size")} htmlFor="tv-font-size">
              <input
                id="tv-font-size"
                className="input"
                type="number"
                min={SUBTITLE_FONT_SIZE_MIN}
                max={SUBTITLE_FONT_SIZE_MAX}
                value={subtitleStyle.fontSizePx}
                disabled={locked}
                onChange={(e) =>
                  patchStyle({ fontSizePx: Number(e.target.value) }, true)
                }
              />
            </Field>

            <ColorField
              id="tv-color"
              label={t("tv.color")}
              value={subtitleStyle.color}
              disabled={locked}
              onChange={(v) => patchStyle({ color: v }, true)}
            />

            <Field label={t("tv.bottom")} htmlFor="tv-bottom">
              <input
                id="tv-bottom"
                className="input"
                type="number"
                min={0}
                max={SUBTITLE_BOTTOM_MAX}
                value={subtitleStyle.bottomPx}
                disabled={locked}
                onChange={(e) =>
                  patchStyle({ bottomPx: Number(e.target.value) }, true)
                }
              />
            </Field>
          </div>

          <Field label={t("tv.backdrop")}>
            <Segmented
              label={t("tv.backdrop")}
              value={subtitleStyle.backdrop as SubtitleBackdrop}
              disabled={locked}
              onChange={(b) => patchStyle({ backdrop: b }, true)}
              options={(["blur", "solid", "none"] as const).map((b) => ({
                value: b,
                label: t(`tv.backdrop.${b}`),
              }))}
            />
          </Field>

          {subtitleStyle.backdrop !== "none" && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              <ColorField
                id="tv-backdrop-color"
                label={t("tv.backdrop-color")}
                value={subtitleStyle.backdropColor}
                disabled={locked}
                onChange={(v) =>
                  patchStyle(
                    {
                      backdropColor: withAlpha(
                        v,
                        alphaOf(subtitleStyle.backdropColor)
                      ),
                    },
                    true
                  )
                }
              />
              <OpacityField
                id="tv-backdrop-opacity"
                label={t("tv.backdrop-opacity")}
                value={subtitleStyle.backdropColor}
                disabled={locked}
                onChange={(v) => patchStyle({ backdropColor: v }, true)}
              />
              {subtitleStyle.backdrop === "blur" && (
                <Field label={t("tv.blur")} htmlFor="tv-blur">
                  <input
                    id="tv-blur"
                    className="input"
                    type="number"
                    min={0}
                    max={SUBTITLE_BLUR_MAX}
                    value={subtitleStyle.blurPx}
                    disabled={locked}
                    onChange={(e) =>
                      patchStyle({ blurPx: Number(e.target.value) }, true)
                    }
                  />
                </Field>
              )}
            </div>
          )}

          <p className="text-meta text-[var(--text-muted)]">
            {locked ? t("tv.style-locked") : t("tv.style-autosave")}
          </p>
        </div>
      </Modal>

      <Modal
        wide
        title={t("tv.card-dub")}
        open={dubModalOpen}
        onClose={() => setDubModalOpen(false)}
        footer={
          <Button onClick={() => setDubModalOpen(false)}>{t("common.done")}</Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label={t("tv.dub-lang")}
            htmlFor="tv-dub-lang"
            hint={
              dubLang && dubLang !== targetLang ? t("tv.dub-lang-cost") : undefined
            }
          >
            <select
              id="tv-dub-lang"
              className="input"
              value={dubLang ?? ""}
              disabled={locked}
              onChange={(e) => patchDubLang(e.target.value || null)}
            >
              <option value="">
                {tf("tv.dub-lang-same", { lang: langLabel(targetLang) })}
              </option>
              {TRANSLATE_TARGET_LANGS.map((code) => (
                <option key={code} value={code}>
                  {langLabel(code)}
                </option>
              ))}
            </select>
          </Field>

          {cues.length === 0 ? (
            <EmptyState icon={Mic} description={t("tv.dub.need-cues")} />
          ) : (
            <DubSettingsCard
              sessionId={sessionId}
              dub={dub}
              speakers={speakers}
              diarized={session.transcriptInfo?.diarized === true}
              cueIndexOf={cueIndexOf}
              speakerF0={session.dubInfo?.speakerF0 ?? {}}
              disabled={locked}
              onChange={patchDub}
            />
          )}
        </div>
      </Modal>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("tv.delete-title")}
        description={<p>{t("tv.delete-desc")}</p>}
        items={[session.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />
    </div>
  );
}
