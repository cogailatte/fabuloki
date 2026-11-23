"use client";

import { AlertTriangle, Loader2, Plus, ScrollText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AUTO_CUT_LEVELS,
  getPrompts,
  getSkills,
  type Brief,
  type MusicMode,
  type PromptTemplate,
  type SfxMode,
  type SkillMeta,
  type TrimAggressiveness,
} from "@/lib/api";
import { CheckboxField, Field, SwitchField } from "@/components/Field";
import { Panel } from "@/components/Panel";
import { Segmented } from "@/components/Segmented";
import { TagInput } from "@/components/TagInput";
import {
  ImageModelOptions,
  TextPositionPicker,
  useGeminiImageModels,
  useImageModelChoices,
} from "@/components/ImageProjectForm";
import { useProviders } from "@/components/ModelPicker";
import { StyleSelect } from "@/components/StyleSelect";
import { VideoStyleSelect } from "@/components/VideoStyleSelect";
import { useT } from "@/lib/i18n";

const LINK_BTN =
  "inline-flex w-fit items-center gap-1 text-sm font-medium text-[var(--primary)] hover:underline disabled:opacity-50";

const SUBFIELDS = "flex flex-col gap-3 pl-4";

export const DEFAULT_BRIEF: Brief = {
  scriptFormat: null,
  sourceKind: "video",
  sourceUrl: "",
  sourceText: "",
  narrationMode: "none",

  narrationVoice: { engine: "gemini", model: null, name: "Kore", style: "", language: "vi-VN", speed: 1 },
  narrationFile: "",
  sourceDescription: "",

  autoCut: true,
  autoCutLevel: "default",
  subtitles: true,
  highlightEnabled: true,
  highlightKeywords: [],
  keyLayoutEnabled: true,
  mainKey: "",
  relatedKeys: [],
  skill: null,
  sfxMode: "recommended",
  musicMode: "auto",
  notes: "",
  autoIllustrations: false,
  illustrationModel: null,
  illustrationText: false,
  illustrationPosition: "auto",
  illustrationsPerMinute: null,
  styleId: null,
  videoStyleEnabled: false,
  videoStyleId: null,
};

export const SFX_MODE_LABEL: Record<SfxMode, string> = {
  recommended: "brief.sfx.recommended",
  library: "brief.sfx.library",
  none: "brief.sfx.none",
};

export const MUSIC_MODE_LABEL: Record<MusicMode, string> = {
  auto: "brief.music.auto",
  none: "brief.music.none",
};

export const AUTO_CUT_LEVEL_LABEL: Record<TrimAggressiveness, string> = {
  natural: "brief.autocut-level-natural",
  default: "brief.autocut-level-default",
  tight: "brief.autocut-level-tight",
};

const AUTO_CUT_LEVEL_HINT: Record<TrimAggressiveness, string> = {
  natural: "brief.autocut-level-natural-hint",
  default: "brief.autocut-level-default-hint",
  tight: "brief.autocut-level-tight-hint",
};

export function BriefFields({
  value,
  onChange,
  show,
  disabled = false,
}: {
  value: Brief;

  onChange: (patch: Partial<Brief>) => void;

  show?: { styleId?: boolean; sourceDescription?: boolean; videoStyle?: boolean; skill?: boolean };

  disabled?: boolean;
}) {
  const { t, tf } = useT();
  const showStyle = show?.styleId ?? true;
  const showSource = show?.sourceDescription ?? true;

  const [showKeywords, setShowKeywords] = useState(false);

  const [keyManual, setKeyManual] = useState(
    () => value.mainKey.trim() !== "" || value.relatedKeys.length > 0
  );
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);

  const { providers } = useProviders();
  const gemini = providers?.find((p) => p.id === "gemini");

  const geminiConnected = providers ? (gemini?.connected ?? false) : true;
  const {
    models: liveIllustrationModels,
    loading: illustrationModelsLoading,
    load: loadIllustrationModels,
  } = useGeminiImageModels();

  const illustrationModelOptions = liveIllustrationModels ?? gemini?.models ?? [];

  const illustrationChoices = useImageModelChoices(
    value.illustrationModel,
    illustrationModelOptions
  );

  useEffect(() => {
    getSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
    getPrompts()
      .then(setPrompts)
      .catch(() => setPrompts([]));
  }, []);

  useEffect(() => {
    if (value.mainKey.trim() !== "" || value.relatedKeys.length > 0) {
      setKeyManual(true);
    }
  }, [value.mainKey, value.relatedKeys]);

  function set<K extends keyof Brief>(key: K, v: Brief[K]) {
    onChange({ [key]: v } as Partial<Brief>);
  }

  function applyPrompt(id: string) {
    const p = prompts.find((x) => x.id === id);
    if (!p) return;
    if (value.notes.trim() && value.notes !== p.content) {
      const ok = window.confirm(
        tf("brief.apply-prompt-confirm", { name: p.name })
      );
      if (!ok) return;
    }
    set("notes", p.content);
  }

  const keywordsOpen = showKeywords || value.highlightKeywords.length > 0;

  return (
    <fieldset
      disabled={disabled}
      className={`flex flex-col gap-4 ${disabled ? "opacity-60" : ""}`}
    >

      {showSource && (
        <Field
          label={t("brief.source-label")}
          htmlFor="brief-source"
          hint={t("brief.source-hint")}
        >
          <textarea
            id="brief-source"
            className="input"
            rows={3}
            value={value.sourceDescription}
            onChange={(e) => set("sourceDescription", e.target.value)}
            placeholder={t("brief.source-placeholder")}
          />
        </Field>
      )}

      <Field
        label={t("brief.notes-label")}
        htmlFor="brief-notes"
        hint={t("brief.notes-hint")}
      >
        <div className="mb-2 flex items-center gap-2">
          <select
            className="input flex-1"
            value=""
            onChange={(e) => applyPrompt(e.target.value)}
            aria-label={t("brief.use-prompt-aria")}
          >
            <option value="" disabled>
              {prompts.length > 0
                ? t("brief.use-prompt")
                : t("brief.no-prompts")}
            </option>
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Link href="/prompts" className={`${LINK_BTN} shrink-0`}>
            <ScrollText size={14} strokeWidth={2} />
            {t("brief.manage-prompts")}
          </Link>
        </div>
        <textarea
          id="brief-notes"
          className="input"
          rows={6}
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={t("brief.notes-placeholder")}
        />
      </Field>

      <Panel className="gap-4">
        <SwitchField
          id="brief-autocut"
          checked={value.autoCut}
          onChange={(v) => set("autoCut", v)}
          label={t("brief.autocut-label")}
          hint={t("brief.autocut-hint")}
        />

        {value.autoCut && (
          <div className={SUBFIELDS}>
            <Field label={t("brief.autocut-level")}>
              <div
                className="flex flex-col gap-2"
                role="radiogroup"
                aria-label={t("brief.autocut-level")}
              >
                {AUTO_CUT_LEVELS.map((level) => (
                  <label
                    key={level}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="brief-autocut-level"
                      className="mt-0.5 accent-[var(--primary)]"
                      checked={value.autoCutLevel === level}
                      onChange={() => set("autoCutLevel", level)}
                    />
                    <span>
                      {t(AUTO_CUT_LEVEL_LABEL[level])}
                      {level === "default" && (
                        <span className="ml-1 text-meta font-normal text-[var(--text-muted)]">
                          {t("brief.autocut-level-recommended")}
                        </span>
                      )}
                      <span className="block text-meta font-normal text-[var(--text-muted)]">
                        {t(AUTO_CUT_LEVEL_HINT[level])}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}
        <SwitchField
          id="brief-subtitles"
          checked={value.subtitles}
          onChange={(v) => set("subtitles", v)}
          label={t("brief.subtitles-label")}
          hint={t("brief.subtitles-hint")}
        />
        <SwitchField
          id="brief-highlight"
          checked={value.highlightEnabled}
          onChange={(v) => set("highlightEnabled", v)}
          label={t("brief.highlight")}
          hint={t("brief.highlight-hint")}
        />

        {value.highlightEnabled && (
          <div className={SUBFIELDS}>
            {!keywordsOpen ? (
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => setShowKeywords(true)}
              >
                <Plus size={14} strokeWidth={2} />
                {t("brief.add-keywords")}
              </button>
            ) : (
              <Field label={t("brief.keywords-label")} htmlFor="brief-keyword">
                <TagInput
                  id="brief-keyword"
                  tags={value.highlightKeywords}
                  onChange={(tags) => set("highlightKeywords", tags)}
                  placeholder={t("brief.keyword-placeholder")}
                />
              </Field>
            )}
          </div>
        )}
        <SwitchField
          id="brief-key-layout"
          checked={value.keyLayoutEnabled}
          onChange={(v) => set("keyLayoutEnabled", v)}
          label={t("brief.key-layout-label")}
          hint={t("brief.key-layout-hint")}
        />

        {value.keyLayoutEnabled && (
          <div className={SUBFIELDS}>
            <Segmented
              className="self-start"
              label={t("brief.key-mode-aria")}
              value={keyManual ? "manual" : "auto"}
              options={[
                { value: "auto", label: t("brief.key-auto") },
                { value: "manual", label: t("brief.key-manual") },
              ]}
              onChange={(next) => {
                const manual = next === "manual";
                setKeyManual(manual);
                if (!manual) {

                  onChange({ mainKey: "", relatedKeys: [] });
                }
              }}
            />
            {!keyManual ? (
              <p className="text-meta text-[var(--text-muted)]">
                {t("brief.key-auto-desc")}
              </p>
            ) : (
              <>
                <Field
                  label={t("brief.main-key")}
                  htmlFor="brief-main-key"
                  hint={t("brief.main-key-hint")}
                >
                  <input
                    id="brief-main-key"
                    className="input"
                    value={value.mainKey}
                    onChange={(e) => set("mainKey", e.target.value)}
                    placeholder={t("brief.main-key-placeholder")}
                  />
                </Field>
                <Field
                  label={t("brief.related-keys")}
                  htmlFor="brief-related-keys"
                  hint={t("brief.related-keys-hint")}
                >
                  <TagInput
                    id="brief-related-keys"
                    tags={value.relatedKeys}
                    onChange={(tags) => set("relatedKeys", tags)}
                    placeholder={t("brief.related-keys-placeholder")}
                  />
                </Field>
              </>
            )}
          </div>
        )}
        <SwitchField
          id="brief-illustrations"
          checked={value.autoIllustrations}
          onChange={(v) => set("autoIllustrations", v)}
          label={t("brief.illustrations-label")}
          hint={t("brief.illustrations-hint")}
        />

        {value.autoIllustrations && (
          <div className={SUBFIELDS}>
            <Field
              label={t("brief.illustration-model")}
              htmlFor="brief-illustration-model"
              hint={
                illustrationModelsLoading ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                    {t("images.loading-models")}
                  </span>
                ) : (
                  illustrationChoices.hint
                )
              }
            >
              <select
                id="brief-illustration-model"
                className="input"
                value={value.illustrationModel ?? ""}
                onFocus={loadIllustrationModels}
                onChange={(e) =>
                  set("illustrationModel", e.target.value || null)
                }
              >
                <ImageModelOptions
                  current={value.illustrationModel}
                  geminiModels={illustrationModelOptions}
                  choices={illustrationChoices}
                />
              </select>
            </Field>

            <Field
              label={t("brief.illustration-density")}
              htmlFor="brief-illustration-density"
              hint={t("brief.illustration-density-hint")}
            >
              <div className="flex items-center gap-2">
                <input
                  id="brief-illustration-density"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  className="input w-24"

                  value={value.illustrationsPerMinute ?? ""}
                  placeholder={t("brief.illustration-density-auto-short")}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) {
                      set("illustrationsPerMinute", null);
                      return;
                    }
                    const n = Math.round(Number(raw));
                    if (Number.isFinite(n)) {
                      set("illustrationsPerMinute", Math.min(20, Math.max(1, n)));
                    }
                  }}
                />
                <span className="text-sm text-[var(--text-muted)]">
                  {t("brief.illustration-density-unit")}
                </span>
              </div>
            </Field>

            <Field
              label={t("brief.illustration-position")}
              hint={
                value.illustrationPosition === "auto"
                  ? t("brief.illustration-position-auto-hint")
                  : t("brief.illustration-position-hint")
              }
            >
              <TextPositionPicker
                value={value.illustrationPosition}
                onChange={(pos) => set("illustrationPosition", pos)}
              />
            </Field>
            <CheckboxField
              id="brief-illustration-text"
              checked={value.illustrationText}
              onChange={(v) => set("illustrationText", v)}
              label={t("brief.illustration-text")}
              hint={t("brief.illustration-text-hint")}
            />

            {!geminiConnected && (
              <p className="flex items-start gap-2 text-sm font-medium text-[var(--danger)]">
                <AlertTriangle
                  size={14}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0"
                />
                {t("brief.gemini-warning")}
              </p>
            )}
          </div>
        )}
      </Panel>

      {showStyle && (
        <Field
          label={value.skill === "quizzy-edit" ? "Nhận diện thương hiệu · màu, font và logo" : "Style Design"}
          htmlFor="brief-style"
          hint={value.skill === "quizzy-edit" ? "Màu và font chữ theo nhận diện đang chọn. Quizzy quyết định nhịp dựng, bố cục và chuyển động." : t("brief.style-hint")}
        >
          <StyleSelect
            id="brief-style"
            value={value.styleId}
            onChange={(v) => set("styleId", v)}
          />
        </Field>
      )}

      {show?.videoStyle !== false && (
      <Panel className="gap-4">
        <SwitchField
          id="brief-video-style"
          checked={value.videoStyleEnabled}
          onChange={(v) => set("videoStyleEnabled", v)}
          label={t("vstyle.label")}
          hint={
            value.videoStyleEnabled ? t("vstyle.hint") : t("vstyle.off-hint")
          }
        />
        {value.videoStyleEnabled && (
          <div className={SUBFIELDS}>
            <VideoStyleSelect
              value={value.videoStyleId}
              onChange={(v) => set("videoStyleId", v)}
            />
          </div>
        )}
      </Panel>
      )}

      {show?.skill !== false && (
      <Field
        label={t("brief.skill-label")}
        htmlFor="brief-skill"
        hint={t("brief.skill-hint")}
      >
        <select
          id="brief-skill"
          className="input"
          value={value.skill ?? ""}
          onChange={(e) => set("skill", e.target.value || null)}
        >
          <option value="">{t("brief.ai-pick-skill")}</option>

          {value.skill !== null && !skills.some((s) => s.name === value.skill) && (
            <option value={value.skill}>{value.skill}</option>
          )}
          {skills.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.description
                ? ` - ${s.description.length > 60 ? `${s.description.slice(0, 60)}…` : s.description}`
                : ""}
            </option>
          ))}
        </select>
      </Field>
      )}

      <Field label="Sound effect" hint={t("brief.sfx-hint")}>
        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-label="Sound effect"
        >
          {(Object.keys(SFX_MODE_LABEL) as SfxMode[]).map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="brief-sfx-mode"
                className="accent-[var(--primary)]"
                checked={value.sfxMode === mode}
                onChange={() => set("sfxMode", mode)}
              />
              {t(SFX_MODE_LABEL[mode])}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t("brief.music-label")} hint={t("brief.music-hint")}>
        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-label={t("brief.music-label")}
        >
          {(Object.keys(MUSIC_MODE_LABEL) as MusicMode[]).map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="brief-music-mode"
                className="accent-[var(--primary)]"
                checked={value.musicMode === mode}
                onChange={() => set("musicMode", mode)}
              />
              {t(MUSIC_MODE_LABEL[mode])}
            </label>
          ))}
        </div>
      </Field>
    </fieldset>
  );
}
