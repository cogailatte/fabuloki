import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { childEnv, paths } from "./config.js";
import { ensureDir } from "./util.js";

const execFileAsync = promisify(execFile);

export interface RenderSettings {

  workers: number;

  browserGpu: boolean;

  gpuEncodeDraft: boolean;

  gpuEncodeFinal: boolean;

  fastCapture: boolean;

  remotionConcurrency: number;

  queueConcurrency: number;

  draftFps: number | null;

  qcGate: boolean;

  updateChannel: UpdateChannel;

  aiMaxAttempts: number;

  aiMaxTurns: number;
}

export type UpdateChannel = "stable" | "latest";

export const UPDATE_CHANNELS: UpdateChannel[] = ["stable", "latest"];

const cpuThreads = os.cpus().length;

export const recommendedWorkers = Math.min(cpuThreads, 8);

export const maxWorkers = Math.max(cpuThreads, 4);

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  workers: recommendedWorkers,
  browserGpu: true,
  gpuEncodeDraft: true,
  gpuEncodeFinal: false,
  fastCapture: false,
  remotionConcurrency: recommendedWorkers,
  queueConcurrency: 2,
  draftFps: null,
  qcGate: true,
  updateChannel: "stable",

  aiMaxAttempts: 4,

  aiMaxTurns: 300,
};

export const AI_ATTEMPT_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;
export const AI_TURN_OPTIONS = [50, 100, 150, 200, 300] as const;

const settingsFile = path.join(paths.dataDir, "render-settings.json");

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function normalizeSettings(raw: Record<string, unknown>): RenderSettings {
  const base = { ...DEFAULT_RENDER_SETTINGS };
  if (typeof raw.workers === "number") base.workers = clamp(Math.round(raw.workers), 0, maxWorkers);
  if (typeof raw.browserGpu === "boolean") base.browserGpu = raw.browserGpu;
  if (typeof raw.gpuEncodeDraft === "boolean") base.gpuEncodeDraft = raw.gpuEncodeDraft;
  if (typeof raw.gpuEncodeFinal === "boolean") base.gpuEncodeFinal = raw.gpuEncodeFinal;
  if (typeof raw.fastCapture === "boolean") base.fastCapture = raw.fastCapture;
  if (typeof raw.qcGate === "boolean") base.qcGate = raw.qcGate;
  if (UPDATE_CHANNELS.includes(raw.updateChannel as UpdateChannel)) {
    base.updateChannel = raw.updateChannel as UpdateChannel;
  }
  if (typeof raw.remotionConcurrency === "number") {
    base.remotionConcurrency = clamp(Math.round(raw.remotionConcurrency), 0, maxWorkers);
  }
  if (typeof raw.queueConcurrency === "number") {
    base.queueConcurrency = clamp(Math.round(raw.queueConcurrency), 1, 4);
  }
  if (raw.draftFps === null) base.draftFps = null;
  else if (typeof raw.draftFps === "number") base.draftFps = clamp(Math.round(raw.draftFps), 10, 60);

  if (typeof raw.aiMaxAttempts === "number") {
    base.aiMaxAttempts = clamp(Math.round(raw.aiMaxAttempts), 1, 12);
  }

  if (typeof raw.aiMaxTurns === "number") {
    base.aiMaxTurns = clamp(Math.round(raw.aiMaxTurns), 20, 300);
  }
  return base;
}

export function readRenderSettings(): RenderSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
    return normalizeSettings(raw);
  } catch {

    return { ...DEFAULT_RENDER_SETTINGS };
  }
}

export function writeRenderSettings(patch: Partial<RenderSettings>): RenderSettings {

  const next = normalizeSettings({ ...readRenderSettings(), ...patch });
  ensureDir(paths.dataDir);
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export interface HardwareInfo {
  platform: string;
  cores: number;
  ramGb: number;
  gpuName: string | null;

  nvenc: boolean;

  videotoolbox: boolean;

  cpuModel: string;

  cpuCores: number | null;

  cpuThreads: number;

  cpuMaxGhz: number | null;

  ramType: string | null;

  ramSpeedMhz: number | null;

  gpuVramGb: number | null;
}

let hardwareCache: HardwareInfo | null = null;

async function psCimJson(className: string, props: string[]): Promise<Record<string, unknown>[]> {
  const cmd =
    `Get-CimInstance ${className} | Select-Object ${props.join(",")} | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", cmd],

    { windowsHide: true, timeout: 10_000, env: childEnv() },
  );
  const parsed = JSON.parse(stdout.trim()) as unknown;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
}

const RAM_TYPE_BY_SMBIOS: Record<number, string> = {
  20: "DDR",
  21: "DDR2",
  24: "DDR3",
  26: "DDR4",
  34: "DDR5",
  35: "LPDDR5",
};

export async function detectHardware(): Promise<HardwareInfo> {
  if (hardwareCache) return hardwareCache;
  const cpus = os.cpus();
  const info: HardwareInfo = {
    platform: process.platform,
    cores: cpus.length,
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    gpuName: null,
    nvenc: false,
    videotoolbox: process.platform === "darwin",
    cpuModel: (cpus[0]?.model ?? "CPU").replace(/\((R|TM)\)/gi, "").replace(/\s+/g, " ").trim(),
    cpuCores: null,
    cpuThreads: cpus.length,
    cpuMaxGhz: null,
    ramType: null,
    ramSpeedMhz: null,
    gpuVramGb: null,
  };

  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 5000, env: childEnv() },
    );
    const first = stdout.trim().split("\n")[0]?.trim();
    if (first) {
      const [name, memMb] = first.split(",").map((s) => s.trim());
      if (name) {
        info.gpuName = name;
        info.nvenc = true;
      }
      const mb = Number(memMb);
      if (Number.isFinite(mb) && mb > 0) info.gpuVramGb = Math.round(mb / 1024);
    }
  } catch {

  }

  if (process.platform === "win32") {

    try {
      const rows = await psCimJson("Win32_Processor", ["NumberOfCores", "MaxClockSpeed"]);
      const cores = rows.reduce((acc, r) => acc + (Number(r.NumberOfCores) || 0), 0);
      if (cores > 0) info.cpuCores = cores;
      const mhz = Number(rows[0]?.MaxClockSpeed);
      if (Number.isFinite(mhz) && mhz > 0) info.cpuMaxGhz = Math.round(mhz / 100) / 10;
    } catch {

    }

    try {
      const rows = await psCimJson("Win32_PhysicalMemory", [
        "SMBIOSMemoryType",
        "Speed",
        "ConfiguredClockSpeed",
      ]);
      const smbios = Number(rows[0]?.SMBIOSMemoryType);
      if (RAM_TYPE_BY_SMBIOS[smbios]) info.ramType = RAM_TYPE_BY_SMBIOS[smbios];
      const speed = Number(rows[0]?.ConfiguredClockSpeed) || Number(rows[0]?.Speed);
      if (Number.isFinite(speed) && speed > 0) info.ramSpeedMhz = speed;
    } catch {

    }

    if (!info.gpuName) {
      try {
        const rows = await psCimJson("Win32_VideoController", ["Name"]);
        const name = typeof rows[0]?.Name === "string" ? (rows[0].Name as string).trim() : "";
        if (name) info.gpuName = name;
      } catch {

      }
    }
  }

  if (process.platform === "darwin") {

    try {
      const { stdout } = await execFileAsync("sysctl", ["-n", "hw.physicalcpu"], {
        timeout: 5000,
        env: childEnv(),
      });
      const n = Number(stdout.trim());
      if (Number.isFinite(n) && n > 0) info.cpuCores = n;
    } catch {

    }
    if (/apple/i.test(info.cpuModel)) info.ramType = "Unified Memory";
    if (!info.gpuName) info.gpuName = "Apple GPU (Metal)";
  }

  hardwareCache = info;
  return info;
}

export function hyperframesSpeedArgs(draft: boolean): string[] {
  const s = readRenderSettings();
  const parts: string[] = [];
  if (s.workers > 0) parts.push("-w", String(s.workers));
  if (s.browserGpu) parts.push("--browser-gpu");
  if (s.fastCapture) parts.push("--experimental-fast-capture");
  if (draft ? s.gpuEncodeDraft : s.gpuEncodeFinal) parts.push("--gpu");
  if (draft && s.draftFps) parts.push("-f", String(s.draftFps));
  return parts;
}

export function remotionConcurrencyArgs(): string[] {
  const c = readRenderSettings().remotionConcurrency;
  return c > 0 ? ["--concurrency", String(c)] : [];
}

export function remotionGlArgs(): string[] {
  if (!readRenderSettings().browserGpu) return [];
  return process.platform === "linux" ? ["--gl", "angle-egl"] : ["--gl", "angle"];
}

export function remotionSpeedArgs(): string[] {
  return [...remotionConcurrencyArgs(), ...remotionGlArgs()];
}

export function queueConcurrency(): number {
  return readRenderSettings().queueConcurrency;
}
