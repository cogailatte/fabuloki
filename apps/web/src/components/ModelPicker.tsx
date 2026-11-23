"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Field } from "@/components/Field";
import { InfoHint } from "@/components/InfoHint";
import { Panel } from "@/components/Panel";
import {
  getClaudeModels,
  getProviders,
  type AgentEffort,
  type Provider,
  type ProviderModel,
} from "@/lib/api";
import { useT } from "@/lib/i18n";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_EFFORT: AgentEffort = "medium";

export const EFFORT_OPTIONS: {
  value: AgentEffort;
  label: string;
  hint: string;
}[] = [

  { value: "low", label: "effort.low", hint: "effort.low-hint" },
  { value: "medium", label: "effort.medium", hint: "effort.medium-hint" },
  { value: "high", label: "effort.high", hint: "effort.high-hint" },
];

const FALLBACK_MODELS = [{ id: DEFAULT_MODEL, label: "Claude Sonnet 5.5" }];

const GEMINI_TOOLTIP = "model.gemini-tooltip";

let providersCache: Provider[] | null = null;
let providersPromise: Promise<Provider[]> | null = null;

export function refreshProviders(): void {
  providersCache = null;
  providersPromise = null;
}

export function useProviders(): {
  providers: Provider[] | null;
  error: string | null;
} {
  const [providers, setProviders] = useState<Provider[] | null>(providersCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providersCache) return;
    let alive = true;
    if (!providersPromise) {
      providersPromise = getProviders().then((r) => {
        providersCache = r.providers;
        return r.providers;
      });
    }
    providersPromise
      .then((list) => {
        if (alive) setProviders(list);
      })
      .catch((e) => {

        providersPromise = null;
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { providers, error };
}

export function useClaudeModels() {
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const { models } = await getClaudeModels();
      setModels(models);
    } catch {

      startedRef.current = false;
    }
  }, []);

  return { models, load };
}

interface PickerProps {
  model: string;
  effort: AgentEffort;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: AgentEffort) => void;
  disabled?: boolean;
}

function claudeModels(claude: Provider | undefined) {
  return claude && claude.models.length > 0 ? claude.models : FALLBACK_MODELS;
}

export function AiModelBlock({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled = false,
}: PickerProps) {
  const { t } = useT();
  const { providers } = useProviders();
  const providerId = model.startsWith("gpt-") ? "openai" : "claude";
  const claude = providers?.find(p => p.id === providerId);
  const gemini = providers?.find(p => p.id === "gemini");
  const { models: liveModels, load: loadClaudeModels } = useClaudeModels();
  const models = providerId === "openai" ? (claude?.models ?? []) : (liveModels ?? claudeModels(claude));

  const modelMissing = model !== "" && !models.some((m) => m.id === model);

  return (
    <Panel
      title={t("model.performer")}
      actions={

        claude && (
          <span className="flex items-center gap-2">
            <span className="text-meta font-medium">{providerId === "openai" ? "GPT · Codex" : "Claude"}</span>
            {claude.connected ? (
              <Badge
                tone="success"
                label={
                  claude.source === "api-key"
                    ? t("model.connected-api-key")
                    : t("model.connected-subscription")
                }
              />
            ) : (
              <Badge tone="danger" label={t("model.not-connected")} />
            )}
          </span>
        )
      }
    >
      {claude && !claude.connected && (
        <p className="flex items-start gap-2 text-sm font-medium text-[var(--danger)]">
          <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
          {providerId === "openai" ? "Đăng nhập bằng codex login trên máy chạy Fabuloki." : t("model.claude-warning")}
        </p>
      )}
      <Field label="Nhà cung cấp AI" htmlFor="ai-provider">
        <select id="ai-provider" className="input" value={providerId} disabled={disabled}
          onChange={event => {
            const provider = providers?.find(p => p.id === event.target.value);
            onModelChange(provider?.models[0]?.id || DEFAULT_MODEL);
          }}>
          <option value="claude">Claude</option>
          <option value="openai" disabled={!providers?.find(p => p.id === "openai")?.models.length}>GPT · Codex</option>
        </select>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("model.model")} htmlFor="ai-model">
          <select
            id="ai-model"
            className="input"
            value={model}
            disabled={disabled}
            onFocus={providerId === "claude" ? loadClaudeModels : undefined}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {modelMissing && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("model.effort")} htmlFor="ai-effort">
          <select
            id="ai-effort"
            className="input"
            value={effort}
            disabled={disabled}
            onChange={(e) => onEffortChange(e.target.value as AgentEffort)}
          >
            {EFFORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)} - {t(o.hint)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {providerId === "claude" && <Banner
        tone="info"
        message={
          <>
            {t("model.cost-tip")}{" "}
            <InfoHint
              titleKey="help.model-cost.title"
              bodyKey="help.model-cost.body"
              className="align-middle"
            />
          </>
        }
      />}
      {gemini && (
        <p
          className="flex items-center gap-2 text-meta text-[var(--text-muted)]"
          title={t(GEMINI_TOOLTIP)}
        >
          <Info size={14} strokeWidth={2} className="shrink-0" />
          {gemini.connected
            ? t("model.gemini-connected")
            : t("model.gemini-not-connected")}
        </p>
      )}
    </Panel>
  );
}

export function AiModelInlineRow({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled = false,
}: PickerProps) {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const gemini = providers?.find((p) => p.id === "gemini");
  const { models: liveModels, load: loadClaudeModels } = useClaudeModels();

  const models = liveModels ?? claudeModels(claude);

  const modelMissing = model !== "" && !models.some((m) => m.id === model);

  return (
    <div className="flex flex-wrap items-center gap-2">

      <select
        className="input w-auto"
        aria-label={t("model.aria-model")}
        value={model}
        disabled={disabled}
        onFocus={loadClaudeModels}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {modelMissing && <option value={model}>{model}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className="input w-auto"
        aria-label={t("model.aria-effort")}
        value={effort}
        disabled={disabled}
        onChange={(e) => onEffortChange(e.target.value as AgentEffort)}
      >
        {EFFORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
      {claude && !claude.connected && (
        <span
          className="inline-flex items-center gap-1 text-meta font-medium text-[var(--danger)]"
          title={t("model.claude-warning-short")}
        >
          <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
          {t("model.claude-not-connected")}
        </span>
      )}
      {gemini && (
        <span
          className="inline-flex items-center gap-1 text-meta text-[var(--text-muted)]"
          title={t(GEMINI_TOOLTIP)}
        >
          <Info size={13} strokeWidth={2} className="shrink-0" />
          {t("model.gemini-images-only")}
        </span>
      )}
    </div>
  );
}
