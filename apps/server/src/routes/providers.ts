import { codexInfo } from "../codexAgent.js";
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Router } from "express";
import { hasClaudeAuth, repoRoot } from "../config.js";
import { geminiApiKey } from "../gemini.js";
import { HttpError } from "../util.js";

export const CLAUDE_MODELS = [
  { id: "claude-fable-5-1", label: "Fable 5.1 (mạnh nhất)" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 (cân bằng)" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (nhanh)" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-opus-4-5", label: "Opus 4.5" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
  { id: "claude-opus-4-1", label: "Opus 4.1" },
  { id: "claude-opus-4-0", label: "Opus 4" },
  { id: "claude-sonnet-4-0", label: "Sonnet 4" },
  { id: "claude-3-haiku-20240307", label: "Haiku 3" },
];

export const CLAUDE_MODEL_IDS: string[] = CLAUDE_MODELS.map((m) => m.id);

export const EFFORT_LEVELS = ["low", "medium", "high"];

import { IMAGE_MODELS } from "../gemini.js";
export const GEMINI_MODELS: Array<{ id: string; label: string }> = IMAGE_MODELS.map((m) => ({
  id: m.id,
  label: m.label,
}));

let liveImageModelsCache: { at: number; list: Array<{ id: string; label: string }> } | null = null;

async function fetchLiveImageModels(): Promise<{
  source: "google" | "static";
  models: Array<{ id: string; label: string }>;
}> {
  const key = geminiApiKey();
  if (!key) return { source: "static", models: GEMINI_MODELS };
  if (liveImageModelsCache && Date.now() - liveImageModelsCache.at < 60 * 60 * 1000) {
    return { source: "google", models: liveImageModelsCache.list };
  }
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1/models?pageSize=1000",
      { headers: { "x-goog-api-key": key } },
    );
    if (!r.ok) return { source: "static", models: GEMINI_MODELS };
    const data = (await r.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const staticLabels = new Map<string, string>(IMAGE_MODELS.map((m) => [m.id, m.label]));
    const list = (data.models ?? [])
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter((id, i, arr) => id.includes("image") && arr.indexOf(id) === i)
      .filter((id) => {
        const raw = data.models?.find((m) => (m.name ?? "").endsWith(id));
        const methods = raw?.supportedGenerationMethods ?? [];
        return methods.length === 0 || methods.includes("generateContent");
      })
      .sort()

      .map((id) => ({
        id,
        label: staticLabels.get(id) ?? id,
      }));
    if (list.length > 0) {
      liveImageModelsCache = { at: Date.now(), list };
      return { source: "google", models: list };
    }
    return { source: "static", models: GEMINI_MODELS };
  } catch {
    return { source: "static", models: GEMINI_MODELS };
  }
}

let liveClaudeModelsCache: { at: number; list: Array<{ id: string; label: string }> } | null =
  null;
const CLAUDE_MODELS_CACHE_MS = 10 * 60 * 1000;

function baseModelId(id: string): string {
  return id.replace(/-\d{8}$/, "");
}

let sdkClaudeModelsCache: { at: number; list: Array<{ id: string; label: string }> } | null =
  null;
let sdkClaudeModelsInflight: Promise<Array<{ id: string; label: string }> | null> | null = null;
const SDK_MODELS_CACHE_MS = 6 * 60 * 60 * 1000;
const SDK_MODELS_TIMEOUT_MS = 45_000;

async function fetchSdkClaudeModels(): Promise<Array<{ id: string; label: string }> | null> {
  if (sdkClaudeModelsCache && Date.now() - sdkClaudeModelsCache.at < SDK_MODELS_CACHE_MS) {
    return sdkClaudeModelsCache.list;
  }
  if (sdkClaudeModelsInflight) return sdkClaudeModelsInflight;
  sdkClaudeModelsInflight = (async () => {
    const abortController = new AbortController();

    async function* idle(): AsyncGenerator<never> {
      await new Promise<void>((resolve) =>
        abortController.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }
    let q: ReturnType<typeof query> | null = null;
    let timer: NodeJS.Timeout | null = null;
    try {
      q = query({
        prompt: idle(),
        options: { cwd: repoRoot, abortController } as Parameters<typeof query>[0]["options"],
      });
      const found = await Promise.race([
        q.supportedModels(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), SDK_MODELS_TIMEOUT_MS);
        }),
      ]);
      const fresh: Array<{ id: string; label: string }> = [];
      for (const m of found) {
        const id = m.resolvedModel ? baseModelId(m.resolvedModel) : "";
        if (!/^claude-[a-z0-9][a-z0-9.-]*$/i.test(id) || fresh.some((f) => f.id === id)) continue;
        const known = CLAUDE_MODELS.find((s) => s.id === id);

        fresh.push({ id, label: known?.label ?? (m.description.split("·")[0].trim() || id) });
      }
      if (fresh.length === 0) return null;
      const list = [...fresh, ...CLAUDE_MODELS.filter((s) => !fresh.some((f) => f.id === s.id))];
      sdkClaudeModelsCache = { at: Date.now(), list };
      return list;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);

      try {
        q?.close();
      } catch {

      }
      abortController.abort();
      sdkClaudeModelsInflight = null;
    }
  })();
  return sdkClaudeModelsInflight;
}

async function fetchLiveClaudeModels(): Promise<{
  source: "anthropic" | "claude-code" | "static";
  models: Array<{ id: string; label: string }>;
}> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const viaSdk = await fetchSdkClaudeModels();
    return viaSdk ? { source: "claude-code", models: viaSdk } : { source: "static", models: CLAUDE_MODELS };
  }
  if (liveClaudeModelsCache && Date.now() - liveClaudeModelsCache.at < CLAUDE_MODELS_CACHE_MS) {
    return { source: "anthropic", models: liveClaudeModelsCache.list };
  }
  try {
    const list: Array<{ id: string; label: string }> = [];
    let afterId: string | null = null;

    for (let page = 0; page < 10; page++) {
      const url = new URL("https://api.anthropic.com/v1/models");
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);
      const r = await fetch(url, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      if (!r.ok) return { source: "static", models: CLAUDE_MODELS };
      const data = (await r.json()) as {
        data?: Array<{ id?: string; display_name?: string }>;
        has_more?: boolean;
        last_id?: string | null;
      };
      for (const m of data.data ?? []) {
        if (m.id) list.push({ id: m.id, label: m.display_name || m.id });
      }
      if (!data.has_more || !data.last_id) break;
      afterId = data.last_id;
    }
    if (list.length > 0) {
      liveClaudeModelsCache = { at: Date.now(), list };
      return { source: "anthropic", models: list };
    }
    return { source: "static", models: CLAUDE_MODELS };
  } catch {
    return { source: "static", models: CLAUDE_MODELS };
  }
}

function isValidClaudeModel(id: string): boolean {
  if (CLAUDE_MODEL_IDS.includes(id)) return true;
  if (liveClaudeModelsCache?.list.some((m) => m.id === id)) return true;
  if (sdkClaudeModelsCache?.list.some((m) => m.id === id)) return true;
  return /^claude-[a-z0-9][a-z0-9.-]*$/i.test(id);
}

export function parseModelEffort(body: Record<string, unknown>): {
  model?: string;
  effort?: string;
} {
  const out: { model?: string; effort?: string } = {};
  if ("model" in body && body.model !== undefined && body.model !== null && body.model !== "") {
    if (typeof body.model !== "string" || !(isValidClaudeModel(body.model) || codexInfo().models.some(m => m.id === body.model))) {
      throw new HttpError(
        400,
        "INVALID_MODEL",
        `model phải là một trong: ${CLAUDE_MODEL_IDS.join(", ")}`,
      );
    }
    out.model = body.model;
  }
  if ("effort" in body && body.effort !== undefined && body.effort !== null && body.effort !== "") {
    if (typeof body.effort !== "string" || !EFFORT_LEVELS.includes(body.effort)) {
      throw new HttpError(
        400,
        "INVALID_EFFORT",
        `effort phải là một trong: ${EFFORT_LEVELS.join(", ")}`,
      );
    }
    out.effort = body.effort;
  }
  return out;
}

interface Provider {
  id: "claude" | "gemini" | "openai";
  label: string;
  connected: boolean;
  source: "oauth" | "api-key" | null;
  note?: string;
  roles: Array<"edit" | "chat" | "image">;
  models: Array<{ id: string; label: string }>;
}

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function claudeSource(): "oauth" | "api-key" | null {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir(), ".claude");
  if (fs.existsSync(path.join(configDir, ".credentials.json"))) return "oauth";
  if (hasClaudeAuth()) return "api-key";
  return null;
}

function hasAntigravityInstall(): boolean {
  const home = homeDir();
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    home && path.join(home, ".gemini"),
    home && path.join(home, ".antigravity"),
    localAppData && path.join(localAppData, "Programs", "Antigravity"),
  ].filter((p): p is string => Boolean(p));
  return candidates.some((p) => fs.existsSync(p));
}

const router = Router();

router.get("/", (_req, res) => {
  const claude: Provider = {
    id: "claude",
    label: "Claude (Anthropic)",
    connected: hasClaudeAuth(),
    source: claudeSource(),
    roles: ["edit", "chat"],

    models: sdkClaudeModelsCache?.list ?? CLAUDE_MODELS,
  };

  const gKey = geminiApiKey();
  const gemini: Provider = {
    id: "gemini",
    label: "Gemini (Google)",
    connected: Boolean(gKey),
    source: gKey ? "api-key" : null,
    roles: ["image"],
    models: GEMINI_MODELS,
  };
  if (!gKey && hasAntigravityInstall()) {
    gemini.note =
      "Đã phát hiện Antigravity/gemini-cli - auth IDE không dùng được cho API tạo ảnh, cần GEMINI_API_KEY trong .env";
  }

  const codex = codexInfo();
  const openai: Provider = { id: "openai", label: "GPT (Codex)", connected: codex.connected, source: codex.connected ? "oauth" : null, roles: ["edit", "chat"], models: codex.models };
  res.json({ providers: [claude, openai, gemini] });
});

router.get("/gemini/image-models", async (_req, res) => {
  res.json(await fetchLiveImageModels());
});

router.get("/claude/models", async (_req, res) => {
  res.json(await fetchLiveClaudeModels());
});

export default router;
