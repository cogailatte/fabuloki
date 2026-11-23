import { Router } from "express";
import {
  DEFAULT_RENDER_SETTINGS,
  detectHardware,
  maxWorkers,
  readRenderSettings,
  recommendedWorkers,
  UPDATE_CHANNELS,
  writeRenderSettings,
  type RenderSettings,
  type UpdateChannel,
} from "../renderSettings.js";
import { HttpError } from "../util.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.json({
    settings: readRenderSettings(),
    defaults: DEFAULT_RENDER_SETTINGS,
    hardware: await detectHardware(),

    recommended: {
      workers: recommendedWorkers,
      concurrency: recommendedWorkers,
      maxWorkers,
    },
  });
});

type SettingKind = "number" | "boolean" | "nullableNumber" | "updateChannel";

const SETTING_KINDS: Record<keyof RenderSettings, SettingKind> = {
  workers: "number",
  browserGpu: "boolean",
  gpuEncodeDraft: "boolean",
  gpuEncodeFinal: "boolean",
  fastCapture: "boolean",
  remotionConcurrency: "number",
  queueConcurrency: "number",
  draftFps: "nullableNumber",
  qcGate: "boolean",
  updateChannel: "updateChannel",
  aiMaxAttempts: "number",
  aiMaxTurns: "number",
};

const KIND_LABEL: Record<SettingKind, string> = {
  number: "phải là số",
  boolean: "phải là boolean",
  nullableNumber: "phải là số hoặc null",
  updateChannel: `phải là một trong ${UPDATE_CHANNELS.join(", ")}`,
};

function isValid(kind: SettingKind, v: unknown): boolean {
  switch (kind) {
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "nullableNumber":
      return v === null || (typeof v === "number" && Number.isFinite(v));
    case "updateChannel":
      return UPDATE_CHANNELS.includes(v as UpdateChannel);
  }
}

router.put("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<RenderSettings> = {};

  for (const [key, kind] of Object.entries(SETTING_KINDS) as Array<
    [keyof RenderSettings, SettingKind]
  >) {
    if (!(key in body)) continue;
    if (!isValid(kind, body[key])) {
      throw new HttpError(400, "INVALID_SETTING", `${key} ${KIND_LABEL[kind]}`);
    }
    (patch as Record<string, unknown>)[key] = body[key];
  }

  res.json({ settings: writeRenderSettings(patch) });
});

export default router;
