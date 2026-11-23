import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { apiToken, hasClaudeAuth, repoRoot } from "../config.js";
import { execFileCapture, hyperframesCli, isLocalRequest } from "../util.js";

export interface HealthChecks {
  ffmpeg: boolean;
  node: string;

  claudeAuth: boolean;
  hyperframes: boolean;
}

export interface HealthResult {
  ok: true;
  checks: HealthChecks;

  apiToken?: string;
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileCapture("ffmpeg", ["-version"], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function checkHyperframes(): Promise<boolean> {

  if (fs.existsSync(path.join(repoRoot, "node_modules", "hyperframes"))) return true;
  try {
    await execFileCapture(process.execPath, [hyperframesCli(), "--version"], {
      cwd: repoRoot,
      timeoutMs: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getHealth(): Promise<HealthResult> {
  const [ffmpeg, hyperframes] = await Promise.all([checkFfmpeg(), checkHyperframes()]);
  return {
    ok: true,
    checks: {
      ffmpeg,
      node: process.version,
      claudeAuth: hasClaudeAuth(),
      hyperframes,
    },
  };
}

const router = Router();

router.get("/", async (req, res) => {
  const health = await getHealth();
  if (isLocalRequest(req)) health.apiToken = apiToken();
  res.json(health);
});

export default router;
