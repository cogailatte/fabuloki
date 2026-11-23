import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { repoRoot } from "../config.js";
import { HttpError, execFileCaptureAll } from "../util.js";

const DOCTOR_JS = path.join(repoRoot, "start", "doctor.mjs");

const CACHE_MS = 20_000;
const PROBE_TIMEOUT_MS = 90_000;

const FIX_TIMEOUT_MS = 15 * 60_000;

export type DoctorLevel = "required" | "optional" | "info";
export type DoctorStatus = "ok" | "missing";

export interface DoctorFix {

  auto: boolean;
  size?: string;
  cmd?: [string, string[]];
  kind?: string;
  manual?: string;

  command?: string;

  link?: string;
  url?: string;
}

export interface DoctorCheck {
  id: string;
  label: string;
  level: DoctorLevel;
  status: DoctorStatus;

  detail: string;

  note?: string | null;
  fix: DoctorFix | null;
}

export interface DoctorReport {
  platform: string;
  ok: boolean;
  missingRequired: string[];
  checks: DoctorCheck[];
}

let cached: { at: number; report: DoctorReport } | null = null;

let inflight: Promise<DoctorReport> | null = null;

async function probe(): Promise<DoctorReport> {
  if (!fs.existsSync(DOCTOR_JS)) {
    throw new HttpError(500, "DOCTOR_MISSING", "Không tìm thấy start/doctor.mjs");
  }
  const r = await execFileCaptureAll(process.execPath, [DOCTOR_JS, "--json"], {
    cwd: repoRoot,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (r.timedOut) {
    throw new HttpError(504, "DOCTOR_TIMEOUT", "Kiểm tra môi trường quá lâu");
  }
  try {
    return JSON.parse(r.stdout) as DoctorReport;
  } catch {
    throw new HttpError(
      500,
      "DOCTOR_BAD_OUTPUT",
      `Không đọc được kết quả kiểm tra: ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }
}

async function getReport(force: boolean): Promise<DoctorReport> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  if (inflight) return inflight;
  inflight = probe()
    .then((report) => {
      cached = { at: Date.now(), report };
      return report;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function warmDoctorCache(): void {
  void getReport(false).catch(() => {

  });
}

let fixing: string | null = null;

const router = Router();

router.get("/", async (req, res) => {
  const report = await getReport(req.query.refresh === "1");
  res.json(report);
});

router.post("/fix", async (req, res) => {
  const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
  if (!id) throw new HttpError(400, "MISSING_ID", "Thiếu id mục cần cài");

  const report = await getReport(false);
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new HttpError(404, "UNKNOWN_CHECK", `Không có mục "${id}"`);
  if (check.status === "ok") {

    res.json({ ok: true, installed: true, timedOut: false, log: [], report });
    return;
  }

  if (!check.fix?.auto) {
    throw new HttpError(
      400,
      "MANUAL_ONLY",
      `Mục "${id}" phải cài tay: ${check.fix?.manual ?? "-"}`,
    );
  }
  if (fixing) {
    throw new HttpError(409, "FIX_BUSY", `Đang cài "${fixing}" - đợi xong rồi thử lại`);
  }

  fixing = id;
  try {
    const r = await execFileCaptureAll(process.execPath, [DOCTOR_JS, "--fix-one", id], {
      cwd: repoRoot,
      timeoutMs: FIX_TIMEOUT_MS,
    });
    const log = `${r.stdout}\n${r.stderr}`
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-40);

    cached = null;
    const after = await getReport(true);
    const nowOk = after.checks.find((c) => c.id === id)?.status === "ok";
    res.json({
      ok: r.code === 0 && nowOk,
      installed: nowOk,
      timedOut: r.timedOut,
      log,
      report: after,
    });
  } finally {
    fixing = null;
  }
});

export default router;
