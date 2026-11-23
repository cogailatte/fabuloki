import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { TRIM_PROFILES, type TrimAggressiveness } from "../autoTrim.js";
import * as db from "../db.js";
import { broadcast } from "../events.js";
import {
  analyzeProjectTrim,
  resolveTrimSource,
  writeTrimRequest,
} from "../jobs/autoTrim.js";
import { AUTO_CUT_LEVELS, briefOf, projectDirOf, projectExists, readMeta } from "../meta.js";
import { queue } from "../queue.js";
import { HttpError, nowIso, toRepoRel } from "../util.js";

const router = Router();

function levelOf(body: Record<string, unknown>, projectId: string): TrimAggressiveness {
  if (!("level" in body) || body.level === undefined || body.level === null) {
    return briefOf(readMeta(projectId)).autoCutLevel;
  }
  if (!AUTO_CUT_LEVELS.includes(body.level as TrimAggressiveness)) {
    throw new HttpError(
      400,
      "INVALID_LEVEL",
      `level phải là một trong: ${AUTO_CUT_LEVELS.join(" | ")}`,
    );
  }
  return body.level as TrimAggressiveness;
}

function sourceOf(body: Record<string, unknown>): string | null {
  if (!("source" in body) || body.source === undefined || body.source === null) return null;
  if (typeof body.source !== "string") {
    throw new HttpError(400, "INVALID_SOURCE", "source phải là chuỗi đường dẫn");
  }
  return body.source.trim() || null;
}

function assertProject(id: string): void {
  if (!projectExists(id)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${id}"`);
  }
}

router.post("/:id/auto-trim/analyze", async (req, res) => {
  const id = req.params.id;
  assertProject(id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const level = levelOf(body, id);
  const sourceAbs = resolveTrimSource(id, sourceOf(body));

  const result = await Promise.race([
    analyzeProjectTrim({ projectId: id, sourceAbs, level }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new HttpError(504, "TRIM_ANALYZE_TIMEOUT", "Phân tích chạy quá 10 phút - đã dừng"),
          ),
        600_000,
      ).unref(),
    ),
  ]);
  res.json(result);
});

router.post("/:id/auto-trim/apply", (req, res) => {
  const id = req.params.id;
  assertProject(id);

  if (!briefOf(readMeta(id)).autoCut) {
    throw new HttpError(
      409,
      "AUTO_CUT_DISABLED",
      `Project "${id}" đang TẮT "Tự động cắt ngắn video" - không cắt footage của video này. ` +
        "Muốn cắt thì bật công tắc đó trong Kịch bản edit rồi chạy lại.",
    );
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const level = levelOf(body, id);

  const sourceAbs = resolveTrimSource(id, sourceOf(body));

  const cutCandidates: Array<{ start: number; end: number }> = [];
  if ("cutCandidates" in body && body.cutCandidates !== undefined && body.cutCandidates !== null) {
    if (!Array.isArray(body.cutCandidates)) {
      throw new HttpError(
        400,
        "INVALID_CANDIDATES",
        "cutCandidates phải là mảng { start, end } (giây) - các ứng viên mỡ thừa BẠN ĐÃ DUYỆT",
      );
    }
    for (const raw of body.cutCandidates) {
      const c = (raw ?? {}) as Record<string, unknown>;
      const start = typeof c.start === "number" ? c.start : NaN;
      const end = typeof c.end === "number" ? c.end : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new HttpError(
          400,
          "INVALID_CANDIDATES",
          `Khoảng cắt không hợp lệ: ${JSON.stringify(raw)} - cần { start, end } là số giây, end > start >= 0`,
        );
      }
      cutCandidates.push({ start, end });
    }
  }

  if (db.hasActiveJobForProject(id, "video")) {
    throw new HttpError(409, "BUSY", `Project "${id}" đang có job chạy/chờ trong hàng đợi`);
  }

  const jobId = `job_${nanoid()}`;

  const sourceRel = path
    .relative(projectDirOf(id), sourceAbs)
    .split(path.sep)
    .join("/");
  writeTrimRequest(id, {
    jobId,
    sourceRel,
    level,
    cutCandidates,
    createdAt: nowIso(),
  });

  const job = db.createJob({ id: jobId, projectId: id, type: "auto-trim", sceneId: level });
  const api = db.jobToApi(job);
  broadcast("job", api);
  queue.enqueue(job.id);
  res.status(202).json({
    job: api,
    level,
    profile: TRIM_PROFILES[level],
    source: toRepoRel(sourceAbs),
    approvedCandidates: cutCandidates.length,
  });
});

export default router;
