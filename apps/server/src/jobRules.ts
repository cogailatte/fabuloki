import path from "node:path";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "./config.js";
import * as db from "./db.js";
import { broadcast } from "./events.js";
import { briefOf, readMeta } from "./meta.js";
import { isQcReportStale, readQcReport } from "./qc.js";
import { queue } from "./queue.js";
import { readRenderSettings } from "./renderSettings.js";
import { HttpError } from "./util.js";

export function assertVideoJobAllowed(
  projectId: string,
  type: db.JobType,
  opts: { force?: boolean } = {},
): void {

  if (type === "auto-trim" && !briefOf(readMeta(projectId)).autoCut) {
    throw new HttpError(
      409,
      "AUTO_CUT_DISABLED",
      `Project "${projectId}" đang TẮT "Tự động cắt ngắn video" - không cắt footage của video này.`,
    );
  }

  if (type.endsWith("-final") && !db.hasDoneAssembleDraft(projectId, readMeta(projectId).createdAt)) {
    throw new HttpError(
      409,
      "DRAFT_REQUIRED",
      `Project "${projectId}" chưa có assemble-draft thành công - draft luôn trước final.`,
    );
  }

  if (type === "assemble-final" && opts.force !== true && readRenderSettings().qcGate) {
    const howTo =
      `Chạy POST /api/projects/${projectId}/qc để đo lại, ` +
      `hoặc gửi { "force": true } để bỏ qua, ` +
      `hoặc tắt cổng QC trong tab Tăng tốc.`;
    const report = readQcReport(projectId);
    if (!report) {
      throw new HttpError(
        409,
        "QC_REQUIRED",
        `Project "${projectId}" chưa qua QC tự động. ${howTo}`,
      );
    }

    const draftAbs = path.join(paths.outputsDir, `${projectId}-draft.mp4`);
    if (path.resolve(repoRoot, report.file) !== path.resolve(draftAbs)) {
      throw new HttpError(
        409,
        "QC_REQUIRED",
        `Kết quả QC của project "${projectId}" đo trên "${report.file}", không phải bản draft ` +
          `outputs/${projectId}-draft.mp4. ${howTo}`,
      );
    }
    if (isQcReportStale(report)) {
      throw new HttpError(
        409,
        "QC_REQUIRED",
        `Kết quả QC của project "${projectId}" đã cũ - file "${report.file}" thay đổi sau lần đo. ${howTo}`,
      );
    }
    if (report.status === "fail") {
      const failed = report.checks.filter((c) => c.status === "fail").map((c) => c.id);
      throw new HttpError(
        409,
        "QC_FAILED",
        `QC tự động của project "${projectId}" FAIL ở: ${failed.join(", ") || "(không rõ check)"}. ` +
          `Sửa lỗi rồi ${howTo}`,
      );
    }
  }
}

export function enqueueJob(input: {
  projectId: string;
  type: db.JobType;
  sceneId?: string | null;
  dependsOn?: string[];
}): db.JobApi {
  const job = db.createJob({
    id: `job_${nanoid()}`,
    projectId: input.projectId,
    type: input.type,
    sceneId: input.sceneId ?? null,
  });
  const api = db.jobToApi(job);
  broadcast("job", api);
  queue.enqueue(job.id, input.dependsOn);
  return api;
}
