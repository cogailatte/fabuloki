"use client";

import {
  AlertTriangle,
  Cloud,
  Cpu,
  Gauge,
  Globe,
  Loader2,
  Play,
  Search,
  Square,
  Timer,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTtsEngines,
  getTtsLanguages,
  getTtsModels,
  getTtsVoices,
  previewTtsVoice,
  TTS_ENGINES,
  type TextToVideoVoice,
  type TtsEngine,
  type TtsEngineStatus,
  type TtsGender,
  type TtsLanguage,
  type TtsModel,
  type TtsRegion,
  type TtsVoice,
  type TtsVoiceKind,
} from "@/lib/api";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { OptionCard, OptionCardGroup } from "@/components/OptionCard";
import { Panel } from "@/components/Panel";
import { Segmented, type SegmentedOption } from "@/components/Segmented";
import { useT } from "@/lib/i18n";

const SPEEDS = [0.9, 1, 1.1, 1.2, 1.3, 1.5] as const;

const GENDERS: TtsGender[] = ["nam", "nu", "trung-tinh"];

const GENDER_LABEL_KEY: Record<TtsGender, string> = {
  nam: "ttv.voice.gender.male",
  nu: "ttv.voice.gender.female",
  "trung-tinh": "ttv.voice.gender.neutral",
};

const REGIONS: TtsRegion[] = ["bac", "trung", "nam"];

const REGION_LABEL_KEY: Record<TtsRegion, string> = {
  bac: "ttv.voice.region.bac",
  trung: "ttv.voice.region.trung",
  nam: "ttv.voice.region.nam",
};

const KINDS: TtsVoiceKind[] = ["cloned", "preset"];

const KIND_LABEL_KEY: Record<TtsVoiceKind, string> = {
  preset: "ttv.voice.kind.preset",
  cloned: "ttv.voice.kind.cloned",
};

const ENGINE_LABEL_KEY: Record<TtsEngine, string> = {
  voicestudio: "ttv.voice.engine.voicestudio",
  gemini: "ttv.voice.engine.gemini",
  vieneu: "ttv.voice.engine.vieneu",
};

const ENGINE_DESC_KEY: Record<TtsEngine, string> = {
  voicestudio: "ttv.voice.engine.voicestudio-desc",
  gemini: "ttv.voice.engine.gemini-desc",
  vieneu: "ttv.voice.engine.vieneu-desc",
};

const ENGINE_ICON: Record<TtsEngine, typeof Cloud> = {
  voicestudio: Cpu,
  gemini: Cloud,
  vieneu: Cpu,
};

const ENGINE_REASONS = [
  "NO_GEMINI_KEY",
  "NO_PYTHON",
  "NO_VIENEU",
  "NO_TORCH",
  "LOAD_FAILED",
] as const;

function reasonKey(reason: string): string {
  return (ENGINE_REASONS as readonly string[]).includes(reason)
    ? `ttv.voice.engine.why.${reason}`
    : "ttv.voice.engine.why.unknown";
}

const PITCH_BANDS: Record<"nam" | "nu", { low: number; high: number }> = {
  nam: { low: 120, high: 135 },
  nu: { low: 185, high: 215 },
};

function qualifierKey(v: TtsVoice): string {
  if (v.gender === "trung-tinh") return "ttv.voice.q.neutral";
  const band = PITCH_BANDS[v.gender];

  const suffix =
    v.f0 <= 0 ? "" : v.f0 < band.low ? "-low" : v.f0 >= band.high ? "-high" : "";
  return v.gender === "nam"
    ? `ttv.voice.q.male${suffix}`
    : `ttv.voice.q.female${suffix}`;
}

function timbre(v: TtsVoice): string {
  for (const prefix of [v.title, v.name]) {
    if (!prefix || !v.label.startsWith(prefix)) continue;
    const rest = v.label.slice(prefix.length).replace(/^\s*[-–—:]\s*/, "");
    if (rest) return rest;
  }
  return v.label;
}

function describe(v: TtsVoice, t: (key: string) => string): string {
  if (v.timbreKey) {
    const key = `ttv.timbre.${v.timbreKey}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return timbre(v);
}

function pickDefaultVoice(list: TtsVoice[]): TtsVoice | null {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title));
  return sorted.find((v) => v.kind === "preset") ?? sorted[0];
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function VoicePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: TextToVideoVoice;

  onChange: (patch: Partial<TextToVideoVoice>) => void;
  disabled?: boolean;
}) {
  const { t, tf, lang } = useT();

  const engine: TtsEngine = value.engine === "vieneu" || value.engine === "voicestudio" ? value.engine : "gemini";
  const isGemini = engine === "gemini";

  const [engines, setEngines] = useState<TtsEngineStatus[] | null>(null);
  const [models, setModels] = useState<TtsModel[] | null>(null);
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [languages, setLanguages] = useState<TtsLanguage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<TtsEngine | null>(null);

  const [query, setQuery] = useState("");

  const [genderFilter, setGenderFilter] = useState<TtsGender | null>(null);
  const [regionFilter, setRegionFilter] = useState<TtsRegion | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const mountedRef = useRef(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const voiceCache = useRef<Partial<Record<TtsEngine, TtsVoice[]>>>({});

  const loadVoices = useCallback(async (e: TtsEngine): Promise<TtsVoice[]> => {
    const hit = voiceCache.current[e];
    if (hit) return hit;
    const list = await getTtsVoices(e);
    voiceCache.current[e] = list;
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    getTtsEngines()
      .then((list) => {
        if (!alive) return;
        setEngines(list);
      })
      .catch((e) => {
        if (!alive) return;

        setEngines([]);
        setLoadError(errText(e));
      });

    getTtsModels()
      .then((m) => alive && setModels(m))
      .catch(() => alive && setModels([]));
    getTtsLanguages()
      .then((l) => alive && setLanguages(l))
      .catch(() => alive && setLanguages([]));
    return () => {
      alive = false;
    };
  }, []);

  const status = engines?.find((s) => s.engine === engine) ?? null;
  const engineReady = status?.available === true;
  const noEngine = engines !== null && !engines.some((s) => s.available);

  useEffect(() => {
    if (engines === null) return;
    if (!engineReady) {

      setVoices([]);
      return;
    }
    let alive = true;
    setVoices(null);
    loadVoices(engine)
      .then((list) => {
        if (!alive) return;
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
  }, [engine, engines, engineReady, loadVoices]);

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(null);
  }

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

  async function switchEngine(next: TtsEngine) {
    if (disabled || next === engine || switching !== null) return;
    stop();
    setSwitching(next);
    setPreviewError(null);
    setQuery("");
    setGenderFilter(null);
    setRegionFilter(null);
    try {
      const list = await loadVoices(next);
      onChange({ engine: next, name: pickDefaultVoice(list)?.name ?? "" });
    } catch (e) {

      setLoadError(errText(e));
      onChange({ engine: next, name: "" });
    } finally {
      setSwitching(null);
    }
  }

  async function togglePreview(name: string) {
    if (disabled) return;
    if (playing === name) {
      stop();
      return;
    }
    stop();
    if (loadingVoice) return;
    setLoadingVoice(name);
    setPreviewError(null);
    try {

      const blob = await previewTtsVoice(
        isGemini
          ? {
              voice: name,
              engine,
              model: value.model,
              style: value.style,
              language: value.language,
              speed: value.speed,
              uiLang: lang,
            }
          : { voice: name, engine, speed: value.speed, uiLang: lang, language: value.language, style: value.style }
      );

      if (!mountedRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => stop();
      audio.onerror = () => {
        stop();
        setPreviewError(tf("ttv.voice.preview-error", { name }));
      };
      audioRef.current = audio;
      urlRef.current = url;
      setPlaying(name);
      await audio.play().catch(() => stop());
    } catch (e) {
      setPreviewError(errText(e));
    } finally {
      setLoadingVoice(null);
    }
  }

  const list = voices ?? [];
  const q = query.trim().toLowerCase();

  const searched = q
    ? list.filter((v) =>
        [v.title, v.name, describe(v, t), v.note]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : list;

  const showRegion = engine === "vieneu";
  const matchRegion = (v: TtsVoice) =>
    !showRegion || !regionFilter || v.region === regionFilter;
  const matchGender = (v: TtsVoice) => !genderFilter || v.gender === genderFilter;

  const counts: Record<TtsGender, number> = { nam: 0, nu: 0, "trung-tinh": 0 };
  let genderTotal = 0;
  for (const v of searched) {
    if (!matchRegion(v)) continue;
    counts[v.gender] += 1;
    genderTotal += 1;
  }

  const regionCounts: Record<TtsRegion, number> = { bac: 0, trung: 0, nam: 0 };
  let regionTotal = 0;
  for (const v of searched) {
    if (!matchGender(v)) continue;
    if (v.region) regionCounts[v.region] += 1;
    regionTotal += 1;
  }

  const filtered = searched.filter((v) => matchGender(v) && matchRegion(v));

  const byTitle = (a: TtsVoice, b: TtsVoice) => a.title.localeCompare(b.title);
  const groupList: {
    key: string;
    label: string;
    neutralNote: boolean;
    items: TtsVoice[];
  }[] = (
    isGemini
      ? GENDERS.map((g) => ({
          key: g,
          label: t(GENDER_LABEL_KEY[g]),

          neutralNote: g === "trung-tinh",
          items: filtered.filter((v) => v.gender === g).sort(byTitle),
        }))
      : KINDS.map((k) => ({
          key: k,
          label: t(KIND_LABEL_KEY[k]),
          neutralNote: false,
          items: filtered.filter((v) => v.kind === k).sort(byTitle),
        }))
  ).filter((g) => g.items.length > 0);

  const selected = list.find((v) => v.name === value.name) ?? null;

  const selectedMissing =
    value.name !== "" && list.length > 0 && !list.some((v) => v.name === value.name);
  const modelMissing =
    value.model !== null &&
    models !== null &&
    !models.some((m) => m.id === value.model);
  const languageMissing =
    value.language !== "" &&
    languages !== null &&
    languages.length > 0 &&
    !languages.some((l) => l.code === value.language);

  const clonedEmpty =
    showRegion &&
    engineReady &&
    voices !== null &&
    !list.some((v) => v.kind === "cloned");

  const countLabel = (label: string, n: number) => (
    <>
      {label}
      <span className="ml-1 tabular-nums opacity-70">{n}</span>
    </>
  );

  const genderOptions: SegmentedOption<string>[] = (
    [null, ...GENDERS] as (TtsGender | null)[]
  )
    .filter((g) => !g || counts[g] > 0 || genderFilter === g)
    .map((g) => ({
      value: g ?? "all",
      label: countLabel(
        g ? t(GENDER_LABEL_KEY[g]) : t("ttv.voice.filter.all"),
        g ? counts[g] : genderTotal
      ),
    }));

  const regionOptions: SegmentedOption<string>[] = (
    [null, ...REGIONS] as (TtsRegion | null)[]
  )
    .filter((r) => !r || regionCounts[r] > 0 || regionFilter === r)
    .map((r) => ({
      value: r ?? "all",
      label: countLabel(
        r ? t(REGION_LABEL_KEY[r]) : t("ttv.voice.region.all"),
        r ? regionCounts[r] : regionTotal
      ),
    }));

  const speedOptions: SegmentedOption<string>[] = SPEEDS.map((s) => ({
    value: String(s),
    label: s === 1 ? t("ttv.voice.speed-normal") : `x${s}`,
  }));

  return (
    <div className="flex flex-col gap-4">

      {loadError && (
        <div className="flex flex-col gap-2">
          <ErrorBanner message={t("ttv.voice.load-error")} detail={loadError} />
          {isGemini && (
            <p className="text-meta text-[var(--text-muted)]">
              {t("ttv.voice.gemini-hint")}
            </p>
          )}
        </div>
      )}

      <Field label={t("ttv.voice.engine")}>
        {engines === null ? (
          <p className="flex items-center gap-2 py-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            {t("ttv.voice.engine.checking")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">

            <OptionCardGroup
              label={t("ttv.voice.engine")}
              className="grid-cols-1"
            >
              {TTS_ENGINES.map((e) => {
                const st = engines.find((s) => s.engine === e) ?? null;
                const ok = st?.available === true;
                const busy = switching === e;
                return (
                  <OptionCard
                    key={e}
                    selected={engine === e}

                    disabled={disabled || !ok || switching !== null}
                    onSelect={() => switchEngine(e)}
                    icon={busy ? Loader2 : ENGINE_ICON[e]}

                    className={busy ? "[&_svg]:animate-spin" : ""}
                    title={t(ENGINE_LABEL_KEY[e])}
                    description={
                      <>
                        {t(ENGINE_DESC_KEY[e])}
                        {ok && st?.canClone && (
                          <span className="font-medium text-[var(--success)]">
                            {" · "}
                            {t("ttv.voice.engine.clone-ready")}
                          </span>
                        )}
                      </>
                    }
                    badge={
                      <Badge
                        tone={ok ? "success" : "danger"}
                        dot={false}
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

            {engines.map((st) =>
              st.reason ? (
                <Banner
                  key={st.engine}
                  tone="danger"
                  message={`${t(ENGINE_LABEL_KEY[st.engine])}: ${t(reasonKey(st.reason))}`}
                  detail={st.detail ?? null}
                />
              ) : null
            )}
            {noEngine && (
              <Banner tone="danger" message={t("ttv.voice.engine.none")} />
            )}
          </div>
        )}
      </Field>

      <Panel>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 text-meta text-[var(--text-muted)]">
            {t("ttv.voice.selected")}
          </span>
          {value.name ? (
            <>

              <span className="min-w-0 truncate text-sm font-semibold text-[var(--primary)]">
                {selected?.title || value.name}
              </span>
              {selected && (
                <span
                  className="min-w-0 truncate text-meta text-[var(--text-muted)]"
                  title={
                    selected.f0 > 0
                      ? tf("ttv.voice.f0-title", { f0: selected.f0 })
                      : undefined
                  }
                >
                  · {t(qualifierKey(selected))} · {describe(selected, t)}
                </span>
              )}
              {isGemini && (
                <span className="ml-auto min-w-0 max-w-full truncate text-meta text-[var(--text-muted)]">
                  {value.style.trim() || t("ttv.voice.style-default")}
                </span>
              )}
            </>
          ) : (
            <span className="min-w-0 text-sm text-[var(--text-muted)]">
              {t("ttv.voice.none-selected")}
            </span>
          )}
        </div>
      </Panel>

      {isGemini && (
        <Field
          label={t("ttv.voice.model")}
          htmlFor="ttv-tts-model"
          hintKeys={{
            titleKey: "help.ttv-voice-model.title",
            bodyKey: "help.ttv-voice-model.body",
          }}
        >
          <select
            id="ttv-tts-model"
            className="input"
            value={value.model ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ model: e.target.value || null })}
          >
            <option value="">{t("ttv.voice.model-default")}</option>
            {modelMissing && <option value={value.model!}>{value.model}</option>}
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {isGemini && (
        <Field
          label={t("ttv.voice.language")}
          htmlFor="ttv-tts-language"
          hintKeys={{
            titleKey: "help.ttv-voice-language.title",
            bodyKey: "help.ttv-voice-language.body",
          }}
          hint={
            <span className="flex items-start gap-2">
              <Globe
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              {t("ttv.voice.language-hint")}
            </span>
          }
        >
          <select
            id="ttv-tts-language"
            className="input"
            value={value.language}
            disabled={disabled}
            onChange={(e) => onChange({ language: e.target.value })}
          >
            {languageMissing && (
              <option value={value.language}>{value.language}</option>
            )}
            {(languages ?? []).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field
        label={t("ttv.voice.voice")}
        hintKeys={{
          titleKey: "help.ttv-voice.title",
          bodyKey: "help.ttv-voice.body",
        }}
        hint={

          <span className="flex items-start gap-2">
            {isGemini ? (
              <Volume2
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
            ) : (
              <Timer
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
            )}
            {isGemini ? t("ttv.voice.preview-cost") : t("voices.first-run-slow")}
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          <Segmented
            className="self-start"
            label={t("ttv.voice.filter-aria")}
            disabled={disabled}
            value={genderFilter ?? "all"}
            options={genderOptions}
            onChange={(v) =>
              setGenderFilter(v === "all" ? null : (v as TtsGender))
            }
          />

          {showRegion && (
            <Segmented
              className="self-start"
              label={t("ttv.voice.region")}
              disabled={disabled}
              value={regionFilter ?? "all"}
              options={regionOptions}
              onChange={(v) =>
                setRegionFilter(v === "all" ? null : (v as TtsRegion))
              }
            />
          )}

          <div className="relative">
            <Search
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              className="input pl-8"
              value={query}
              disabled={disabled}
              aria-label={t("ttv.voice.search")}
              placeholder={t("ttv.voice.search")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {clonedEmpty && (
            <Banner
              tone="muted"
              message={t("ttv.voice.cloned-empty")}
              actions={
                <Link
                  href="/voices"
                  className="text-sm font-medium text-[var(--primary)] hover:underline"
                >
                  {t("ttv.voice.manage")}
                </Link>
              }
            />
          )}

          {previewError && (
            <ErrorBanner
              message={t("ttv.voice.preview-failed")}
              detail={previewError}
            />
          )}

          {voices === null ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              {t("common.loading")}
            </p>
          ) : groupList.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              {list.length === 0 ? t("ttv.voice.none") : t("ttv.voice.no-match")}
            </p>
          ) : (
            <Panel className="max-h-[320px] overflow-y-auto">
              {selectedMissing && (
                <p className="flex items-start gap-2 text-meta text-[var(--text-muted)]">
                  <AlertTriangle
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--danger)]"
                  />
                  {tf("ttv.voice.missing", { name: value.name })}
                </p>
              )}
              <div
                role="radiogroup"
                aria-label={t("ttv.voice.voice")}
                className="flex flex-col gap-3"
              >
                {groupList.map((group) => (
                  <div key={group.key} className="flex flex-col gap-1">
                    <p className="t-eyebrow">
                      {group.label}
                      <span className="ml-1 tabular-nums opacity-70">
                        {group.items.length}
                      </span>
                    </p>

                    {group.neutralNote && (
                      <p className="flex items-start gap-2 text-meta text-[var(--text-muted)]">
                        <AlertTriangle
                          size={14}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-[var(--danger)]"
                        />
                        {t("ttv.voice.neutral-note")}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                      {group.items.map((v) => {
                        const active = value.name === v.name;
                        const isLoading = loadingVoice === v.name;
                        const isPlaying = playing === v.name;
                        return (

                          <div
                            key={`${v.engine}:${v.name}`}
                            className={`option-card min-w-0 flex-row items-center gap-2 p-2 ${
                              active
                                ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                                : ""
                            }`}
                          >
                            <button
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={disabled}
                              onClick={() => onChange({ name: v.name })}
                              className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className={`min-w-0 truncate text-sm font-semibold ${
                                    active
                                      ? "text-[var(--primary)]"
                                      : "text-[var(--text)]"
                                  }`}
                                >
                                  {v.title}
                                </span>

                                {v.kind === "cloned" && (
                                  <Badge
                                    tone="muted"
                                    dot={false}
                                    className="shrink-0"
                                    label={t("ttv.voice.kind.cloned")}
                                  />
                                )}
                              </span>

                              <span
                                className="block text-meta text-[var(--text-muted)]"
                                title={
                                  v.f0 > 0
                                    ? tf("ttv.voice.f0-title", { f0: v.f0 })
                                    : undefined
                                }
                              >
                                {t(qualifierKey(v))} · {describe(v, t)}
                              </span>

                              {v.note && (
                                <span className="block truncate text-meta text-[var(--text-muted)] opacity-80">
                                  {v.note}
                                </span>
                              )}
                            </button>
                            <IconButton
                              size="sm"
                              label={
                                isPlaying
                                  ? tf("ttv.voice.stop-aria", { name: v.title })
                                  : tf("ttv.voice.preview-aria", {
                                      name: v.title,
                                    })
                              }
                              disabled={
                                disabled || (loadingVoice !== null && !isLoading)
                              }
                              onClick={() => togglePreview(v.name)}
                              className={
                                isPlaying
                                  ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                                  : ""
                              }
                            >
                              {isLoading ? (
                                <Loader2
                                  size={14}
                                  strokeWidth={2}
                                  className="animate-spin"
                                />
                              ) : isPlaying ? (
                                <Square size={14} strokeWidth={2} />
                              ) : (
                                <Play size={14} strokeWidth={2} />
                              )}
                            </IconButton>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </Field>

      <Field
        label={t("ttv.voice.speed")}
        hint={

          <span className="flex items-start gap-2">
            <Gauge
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            />
            <span>
              {t("ttv.voice.speed-hint")}
              {Math.abs(value.speed - 1) > 0.001 && (
                <> {t("ttv.voice.speed-preview-note")}</>
              )}
            </span>
          </span>
        }
      >
        <Segmented
          className="self-start tabular-nums"
          label={t("ttv.voice.speed")}
          disabled={disabled}
          value={String(SPEEDS.find((s) => Math.abs(value.speed - s) < 0.001) ?? "")}
          options={speedOptions}
          onChange={(v) => onChange({ speed: Number(v) })}
        />
      </Field>

      {isGemini && (
        <Field
          label={t("ttv.voice.style")}
          htmlFor="ttv-voice-style"
          hintKeys={{
            titleKey: "help.ttv-voice-style.title",
            bodyKey: "help.ttv-voice-style.body",
          }}
          hint={
            <span className="flex items-start gap-2 text-[var(--danger)]">
              <AlertTriangle
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              {t("ttv.voice.style-warning")}
            </span>
          }
        >
          <input
            id="ttv-voice-style"
            className="input"
            value={value.style}
            disabled={disabled}
            placeholder={t("ttv.voice.style-placeholder")}
            onChange={(e) => onChange({ style: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
