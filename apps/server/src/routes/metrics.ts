import os from "node:os";
import { Router } from "express";
import { execFileCaptureAll } from "../util.js";

export interface MetricsCpu {

  percent: number;

  threads: number;
  model: string;
}

export interface MetricsGpu {

  available: boolean;
  name: string | null;

  percent: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
}

const CACHE_MS = 1_500;

const GPU_MISS_TTL_MS = 5 * 60_000;

interface CpuSample {
  at: number;
  idle: number;
  total: number;
}

function cpuSample(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { at: Date.now(), idle, total };
}

let lastCpu: CpuSample | null = null;

async function cpuPercent(): Promise<number> {
  if (!lastCpu) {
    lastCpu = cpuSample();
    await new Promise((r) => setTimeout(r, 200));
  }
  const now = cpuSample();
  const dIdle = now.idle - lastCpu.idle;
  const dTotal = now.total - lastCpu.total;
  lastCpu = now;
  if (dTotal <= 0) return 0;
  const busy = 1 - dIdle / dTotal;
  return Math.max(0, Math.min(100, Math.round(busy * 100)));
}

let gpuMissUntil = 0;

async function gpuStats(): Promise<MetricsGpu> {
  const none: MetricsGpu = {
    available: false,
    name: null,
    percent: null,
    vramUsedMb: null,
    vramTotalMb: null,
  };
  if (Date.now() < gpuMissUntil) return none;
  try {
    const r = await execFileCaptureAll(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.used,memory.total,name",
        "--format=csv,noheader,nounits",
      ],
      { timeoutMs: 5_000 },
    );
    if (r.code !== 0 || r.timedOut) {
      gpuMissUntil = Date.now() + GPU_MISS_TTL_MS;
      return none;
    }

    const line = r.stdout.trim().split("\n")[0]?.trim();
    if (!line) {
      gpuMissUntil = Date.now() + GPU_MISS_TTL_MS;
      return none;
    }
    const [util, used, total, ...nameParts] = line.split(",").map((s) => s.trim());
    const num = (v: string): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      available: true,
      name: nameParts.join(",").trim() || null,
      percent: num(util),
      vramUsedMb: num(used),
      vramTotalMb: num(total),
    };
  } catch {

    gpuMissUntil = Date.now() + GPU_MISS_TTL_MS;
    return none;
  }
}

let cached: { at: number; payload: { cpu: MetricsCpu; gpu: MetricsGpu } } | null = null;

const router = Router();

router.get("/", async (_req, res) => {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    res.json(cached.payload);
    return;
  }
  const [percent, gpu] = await Promise.all([cpuPercent(), gpuStats()]);
  const cpus = os.cpus();
  const payload = {
    cpu: {
      percent,
      threads: cpus.length,
      model: (cpus[0]?.model ?? "").replace(/\((R|TM)\)/g, "").replace(/\s+/g, " ").trim(),
    },
    gpu,
  };
  cached = { at: Date.now(), payload };
  res.json(payload);
});

export default router;
