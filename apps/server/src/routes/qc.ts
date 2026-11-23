import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { paths, repoRoot } from "../config.js";
import { normOutput, projectDirOf, projectExists, readMeta } from "../meta.js";
import {
  isQcReportStale,
  readQcReport,
  runQc,
  writeQcReport,
  type QcReport,
} from "../qc.js";
import { HttpError } from "../util.js";

const router = Router();

function newestRenderMp4(projectId: string): string | null {
  const dir = path.join(projectDirOf(projectId), "renders");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: { abs: string; mtime: number } | null = null;
  for (const e of entries) {
    if (!e.isFile() || path.extname(e.name).toLowerCase() !== ".mp4") continue;
    const abs = path.join(dir, e.name);
    try {
      const m = fs.statSync(abs).mtimeMs;
      if (!best || m > best.mtime) best = { abs, mtime: m };
    } catch {

    }
  }
  return best ? best.abs : null;
}

function resolveInRepo(rel: string): string {
  const abs = path.resolve(repoRoot, rel);
  if (abs !== repoRoot && !abs.startsWith(path.resolve(repoRoot) + path.sep)) {
    throw new HttpError(400, "PATH_OUTSIDE_REPO", `Đường dẫn "${rel}" nằm ngoài repo`);
  }
  return abs;
}

function pickDefaultFile(projectId: string): string | null {
  const draft = path.join(paths.outputsDir, `${projectId}-draft.mp4`);
  if (fs.existsSync(draft)) return draft;
  const render = newestRenderMp4(projectId);
  if (render) return render;
  const output = normOutput(readMeta(projectId).output);
  if (output) {
    const abs = path.resolve(repoRoot, output);
    if (abs.startsWith(path.resolve(repoRoot) + path.sep) && fs.existsSync(abs)) return abs;
  }
  return null;
}

router.post("/:id/qc", async (req, res) => {
  const id = req.params.id;
  if (!projectExists(id)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${id}"`);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;

  if ("file" in body && body.file !== undefined && typeof body.file !== "string") {
    throw new HttpError(400, "INVALID_FILE", "file phải là chuỗi đường dẫn tính từ repo root");
  }
  if ("platform" in body && body.platform !== undefined && typeof body.platform !== "string") {
    throw new HttpError(400, "INVALID_PLATFORM", "platform phải là chuỗi");
  }
  const platform = typeof body.platform === "string" ? body.platform.trim() : "";

  let fileAbs: string | null;
  const rel = typeof body.file === "string" ? body.file.trim() : "";
  if (rel) {
    fileAbs = resolveInRepo(rel);
    if (!fs.existsSync(fileAbs)) {
      throw new HttpError(404, "FILE_NOT_FOUND", `Không thấy file "${rel}"`);
    }
  } else {
    fileAbs = pickDefaultFile(id);
  }
  if (!fileAbs) {
    throw new HttpError(400, "NO_VIDEO", "Chưa có video để QC - render draft trước");
  }

  const report = await Promise.race([
    runQc({ projectId: id, fileAbs, platform }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new HttpError(504, "QC_TIMEOUT", "QC chạy quá 10 phút - đã dừng")),
        600_000,
      ).unref(),
    ),
  ]);
  writeQcReport(id, report);
  res.json({ report });
});

router.get("/:id/qc", (req, res) => {
  const id = req.params.id;
  if (!projectExists(id)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${id}"`);
  }
  const report: QcReport | null = readQcReport(id);
  if (!report) {
    res.json({ report: null });
    return;
  }
  const stale = isQcReportStale(report);
  res.json(stale ? { report, stale: true } : { report });
});

export default router;
