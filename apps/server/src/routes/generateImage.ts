import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { isAgentBusy } from "../agent.js";
import * as db from "../db.js";
import { activeVideoStyleId, briefOf, projectDirOf, projectExists, readMeta, writeAssetEntry } from "../meta.js";
import { getStyle } from "../styles.js";
import { getVideoStyle } from "../videoStyles.js";
import { HttpError, ensureDir, toKebabAscii } from "../util.js";
import {
  generateImage,
  isImageProviderChoice,
  resolveProviders,
  type ImageProviderId,
} from "../imageProviders/index.js";

interface ImageTask {
  id: string;
  projectId: string;
  status: "running" | "done" | "failed";
  relPath?: string;
  provider?: ImageProviderId;
  error?: { code: string; message: string };
  startedAt: number;
  finishedAt?: number;
}

const tasks = new Map<string, ImageTask>();

const TASK_TTL_MS = 60 * 60 * 1000;

const MAX_RUNNING_PER_PROJECT = 3;

function pruneTasks(): void {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (t.finishedAt && now - t.finishedAt > TASK_TTL_MS) tasks.delete(id);
  }
}

function assertNotAgentBusy(id: string): void {
  const busy = db.listChatSessions(id).find((s) => isAgentBusy(s.sessionId))?.sessionId;
  if (busy) {
    throw new HttpError(
      409,
      "AGENT_BUSY",
      "AI đang sửa project này - chờ phiên AI xong (hoặc dừng nó) rồi tạo ảnh.",
      { sessionId: busy },
    );
  }
}

const router = Router();

router.post("/:id/generate-image", (req, res) => {
  const id = req.params.id;
  if (!projectExists(id)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy video project "${id}"`);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new HttpError(400, "PROMPT_REQUIRED", "Thiếu mô tả ảnh (prompt)");
  if (prompt.length > 4000) throw new HttpError(400, "PROMPT_TOO_LONG", "Mô tả ảnh tối đa 4000 ký tự");
  const purpose = body.purpose ?? "filler";
  if (purpose !== "filler" && purpose !== "layer") {
    throw new HttpError(400, "INVALID_PURPOSE", 'purpose phải là "filler" hoặc "layer"');
  }
  if (body.provider !== undefined && body.provider !== null && !isImageProviderChoice(body.provider)) {
    throw new HttpError(
      400,
      "INVALID_PROVIDER",
      'provider phải là một trong: "auto", "gemini-api"',
    );
  }
  if (body.allowText !== undefined && typeof body.allowText !== "boolean") {
    throw new HttpError(400, "INVALID_ALLOW_TEXT", "allowText phải là boolean");
  }
  assertNotAgentBusy(id);

  pruneTasks();
  const runningHere = [...tasks.values()].filter((t) => t.projectId === id && t.status === "running").length;
  if (runningHere >= MAX_RUNNING_PER_PROJECT) {
    throw new HttpError(
      429,
      "TOO_MANY_TASKS",
      `Đang tạo ${runningHere} ảnh cho project này - chờ bớt rồi tạo tiếp.`,
    );
  }

  const provider = (body.provider as string | undefined) ?? "auto";
  const { chain } = resolveProviders(provider, null);
  if (chain.length === 0) {
    throw new HttpError(
      503,
      "NO_IMAGE_PROVIDER",
      "Thêm khóa Gemini API ở mục Kết nối.",
    );
  }
  const meta = readMeta(id);
  const brief = briefOf(meta);
  const dir = path.join(projectDirOf(id), "assets", "generated");
  ensureDir(dir);
  const base = toKebabAscii(prompt.slice(0, 40)).replace(/-+$/, "") || (purpose === "layer" ? "layer" : "canh-tram");

  let fileName = "";
  for (let n = 1; ; n++) {
    fileName = n === 1 ? `${base}.png` : `${base}-${n}.png`;
    try {
      fs.closeSync(fs.openSync(path.join(dir, fileName), "wx"));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  const outFile = path.join(dir, fileName);

  const task: ImageTask = { id: nanoid(12), projectId: id, status: "running", startedAt: Date.now() };
  tasks.set(task.id, task);

  void (async () => {
    try {
      const result = await generateImage({
        prompt,
        kind: "concept",
        width: meta.width,
        height: meta.height,
        design: getStyle(brief.styleId || null),
        outFile,
        provider,
        usageProjectId: id,
        allowText: body.allowText === true,
        videoStyle: getVideoStyle(activeVideoStyleId(brief)),

        layout: "video",
        subjectPosition: brief.illustrationPosition ?? "auto",
      });
      writeAssetEntry(id, fileName, {
        description: `${purpose === "layer" ? "Layer ảnh AI" : "Cảnh trám AI"}: ${prompt}`.slice(0, 500),
      });
      task.status = "done";
      task.relPath = `assets/generated/${fileName}`;
      task.provider = result.provider;
    } catch (err) {
      fs.rmSync(outFile, { force: true });
      task.status = "failed";
      task.error = {
        code: err instanceof HttpError ? err.code : "GENERATE_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
      console.warn(`[generate-image] ${id}: ${task.error.code} - ${task.error.message}`);
    } finally {
      task.finishedAt = Date.now();
    }
  })();

  res.status(202).json({ taskId: task.id });
});

router.get("/:id/generate-image/:taskId", (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task || task.projectId !== req.params.id) {
    throw new HttpError(
      404,
      "TASK_NOT_FOUND",
      "Không tìm thấy tác vụ tạo ảnh (đã quá 1 giờ, hoặc server vừa khởi động lại) - tạo lại.",
    );
  }
  const end = task.finishedAt ?? Date.now();
  res.json({
    status: task.status,
    ...(task.relPath ? { relPath: task.relPath } : {}),
    ...(task.provider ? { provider: task.provider } : {}),
    ...(task.error ? { error: task.error } : {}),
    elapsedSec: Math.round((end - task.startedAt) / 100) / 10,
  });
});

export default router;
