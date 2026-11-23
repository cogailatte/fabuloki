import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { isAgentBusy, runAgent } from "../agent.js";
import {
  briefPromptContextOf,
  scaffoldProjectFiles,
  uniqueProjectId,
} from "../childProject.js";
import { findEditEffect } from "../editEffects.js";
import { buildEditPrompt } from "../editPrompt.js";
import {
  GRADE_PRESETS,
  generateGradePreviews,
  isDefaultAdjust,
  normAdjust,
  renderGradeFrame,
} from "../color.js";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import {
  applyBriefPatch,
  briefOf,
  defaultBrief,
  listProjectAssets,
  normOutput,
  normTags,
  projectAssetsDirOf,
  projectDirOf,
  projectExists,
  projectSummaryOf,
  readMeta,
  removeAssetEntry,
  scanProjects,
  writeAssetEntry,
  writeMeta,
  type Brief,
  type FinishMode,
  type ProjectMeta,
} from "../meta.js";
import { parseModelEffort } from "./providers.js";
import { styleExists } from "../styles.js";
import {
  HttpError,
  ensureDir,
  isKebabCase,
  listFilesRecursive,
  nowIso,
  toKebabAscii,
} from "../util.js";

const router = Router();

router.get("/", (_req, res) => {
  const usage = db.tokensByProject();
  res.json(
    scanProjects().map((s) => ({
      ...s,
      tokensUsed: usage[s.id]?.tokens ?? 0,
      costUsd: usage[s.id]?.costUsd ?? 0,
    })),
  );
});

router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const width = Number(body.width);
  const height = Number(body.height);
  const fps = Number(body.fps);
  const tags = normTags(body.tags);

  if (!name) throw new HttpError(400, "INVALID_NAME", "Thiếu name");
  if (!id) {

    id = uniqueProjectId(name);
  }
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_ID", "id phải là kebab-case (vd: tiktok-paper-gpt5)");
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new HttpError(400, "INVALID_SIZE", "width/height phải là số nguyên dương");
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new HttpError(400, "INVALID_FPS", "fps phải là số dương");
  }

  const dir = projectDirOf(id);
  if (fs.existsSync(dir)) {
    throw new HttpError(409, "PROJECT_EXISTS", `Project "${id}" đã tồn tại`);
  }

  scaffoldProjectFiles(id, name, width, height);

  const meta: ProjectMeta = {
    id,
    name,
    width,
    height,
    fps,
    status: "draft",
    brief: defaultBrief(),
    scenes: [],
    audio: { voice: null, sfx: [] },
    output: null,
    tags,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeMeta(id, meta);

  res.status(201).json(projectSummaryOf(id));
});

router.get("/:id", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const dir = projectDirOf(id);

  const summary = projectSummaryOf(id);
  const usage = db.tokensByProject();
  res.json({
    ...meta,

    status: summary?.status ?? "draft",
    output: normOutput(meta.output),
    tags: normTags(meta.tags),
    tokensUsed: usage[id]?.tokens ?? 0,
    costUsd: usage[id]?.costUsd ?? 0,
    brief: briefOf(meta),

    thumbnail: fs.existsSync(path.join(dir, "thumbnail.png")) ? "thumbnail.png" : null,
    files: {
      renders: listFilesRecursive(path.join(dir, "renders")),
      assets: listProjectAssets(id),
    },
  });
});

const CLONE_SKIP = new Set([
  "renders",
  "cache",
  "verify",
  "node_modules",
  "props.resolved.json",

  "qc.json",

  ".history",
]);

function copyDirFiltered(src: string, dst: string): void {
  ensureDir(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (CLONE_SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirFiltered(s, d);

    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

router.post("/:id/clone", (req, res) => {
  const srcId = req.params.id;
  const srcMeta = readMeta(srcId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : `${srcMeta.name} (bản sao)`;

  const newId = uniqueProjectId(toKebabAscii(name) || `${srcId}-copy`);

  copyDirFiltered(projectDirOf(srcId), projectDirOf(newId));
  ensureDir(path.join(projectDirOf(newId), "renders"));

  const meta: ProjectMeta = {
    ...srcMeta,
    id: newId,
    name,
    status: "draft",
    output: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  delete (meta as Record<string, unknown>).outputInfo;
  writeMeta(newId, meta);

  res.status(201).json(projectSummaryOf(newId));
});

interface JunkItem {

  relPath: string;
  size: number;
}

function dirSizeOf(absDir: string): number {
  return listFilesRecursive(absDir).reduce((sum, f) => sum + f.size, 0);
}

function collectJunk(id: string): { items: JunkItem[]; totalBytes: number } {
  const dir = projectDirOf(id);
  const items: JunkItem[] = [];

  for (const name of ["renders", "verify", "cache"]) {
    const abs = path.join(dir, name);
    if (fs.existsSync(abs) && listFilesRecursive(abs).length > 0) {
      items.push({ relPath: `video-projects/${id}/${name}/`, size: dirSizeOf(abs) });
    }
  }

  const propsFile = path.join(dir, "props.resolved.json");
  if (fs.existsSync(propsFile)) {
    items.push({
      relPath: `video-projects/${id}/props.resolved.json`,
      size: fs.statSync(propsFile).size,
    });
  }

  const draft = path.join(paths.outputsDir, `${id}-draft.mp4`);
  if (fs.existsSync(draft)) {
    items.push({ relPath: `outputs/${id}-draft.mp4`, size: fs.statSync(draft).size });
  }

  for (const prefix of ["vid", "img"]) {
    const abs = path.join(paths.stagingDir, `${prefix}-${id}`);
    if (fs.existsSync(abs)) {
      items.push({
        relPath: `engines/remotion/public/staging/${prefix}-${id}/`,
        size: dirSizeOf(abs),
      });
    }
  }

  return { items, totalBytes: items.reduce((sum, i) => sum + i.size, 0) };
}

router.get("/:id/junk", (req, res) => {
  const id = req.params.id;
  readMeta(id);
  res.json(collectJunk(id));
});

router.post("/:id/junk/clean", (req, res) => {
  const id = req.params.id;
  readMeta(id);
  if (db.hasActiveJobForProject(id, "video")) {
    throw new HttpError(
      409,
      "JOB_RUNNING",
      "Project đang có job chạy/chờ trong hàng đợi - đợi xong rồi mới dọn file rác",
    );
  }
  const { items, totalBytes } = collectJunk(id);
  for (const item of items) {

    fs.rmSync(path.join(repoRoot, item.relPath), { recursive: true, force: true });
  }

  ensureDir(path.join(projectDirOf(id), "renders"));
  res.json({ freedBytes: totalBytes, deleted: items.length });
});

router.put("/:id/tags", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.tags)) {
    throw new HttpError(400, "INVALID_TAGS", "tags phải là mảng string");
  }
  meta.tags = normTags(body.tags);
  writeMeta(id, meta);
  res.json({ tags: meta.tags });
});

router.put("/:id/name", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new HttpError(400, "INVALID_NAME", "Tên project không được để trống");
  }
  if (name.length > 120) {
    throw new HttpError(400, "INVALID_NAME", "Tên project tối đa 120 ký tự");
  }
  meta.name = name;
  writeMeta(id, meta);
  res.json(projectSummaryOf(id));
});

router.put("/:id/brief", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const brief: Brief = applyBriefPatch(briefOf(meta), body, styleExists);
  meta.brief = brief;
  writeMeta(id, meta);
  res.json(brief);
});

router.put("/:id/assets/:file/description", (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const file = path.basename(req.params.file);
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.description !== "string") {
    throw new HttpError(400, "INVALID_DESCRIPTION", "description phải là string");
  }

  const found = listFilesRecursive(projectAssetsDirOf(id)).find(
    (f) => f.name === file && f.name !== "assets.json",
  );
  if (!found) {
    throw new HttpError(404, "ASSET_NOT_FOUND", `Không tìm thấy asset "${file}" trong project "${id}"`);
  }

  writeAssetEntry(id, file, { description: body.description });
  res.json({ ...found, description: body.description });
});

router.put("/:id/asset-effect", (req, res) => {
  const { id } = req.params;
  readMeta(id);
  const { relPath, effectId } = req.body ?? {};
  const asset = listProjectAssets(id).find((file) => file.relPath === relPath);
  if (!asset || (asset.kind !== "video" && asset.kind !== "image")) {
    throw new HttpError(404, "ASSET_NOT_FOUND", "Không tìm thấy video hoặc ảnh nguồn");
  }
  if (effectId !== null && effectId !== "none" &&
      (typeof effectId !== "string" || !findEditEffect(effectId))) {
    throw new HttpError(400, "INVALID_EDIT_EFFECT", "Hiệu ứng không có trong thư viện");
  }
  writeAssetEntry(id, asset.relPath, { editEffectId: effectId });
  res.json({ effectId });
});

router.delete("/:id/assets/:file", (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const file = path.basename(req.params.file);
  if (file === "assets.json") {
    throw new HttpError(400, "PROTECTED_FILE", "Không thể xóa assets.json");
  }

  const found = listFilesRecursive(projectAssetsDirOf(id)).find((f) => f.name === file);
  if (!found) {
    throw new HttpError(404, "ASSET_NOT_FOUND", `Không tìm thấy asset "${file}" trong project "${id}"`);
  }

  fs.rmSync(path.join(repoRoot, found.relPath), { force: true });
  removeAssetEntry(id, found.relPath);
  removeAssetEntry(id, file);
  res.status(204).end();
});

router.post("/:id/assets/:file/grade-preview", async (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const file = path.basename(req.params.file);
  const found = listFilesRecursive(projectAssetsDirOf(id)).find(
    (f) => f.name === file && f.kind === "video",
  );
  if (!found) {
    throw new HttpError(404, "ASSET_NOT_FOUND", `Không tìm thấy asset video "${file}"`);
  }
  const result = await generateGradePreviews(
    projectDirOf(id),
    `video-projects/${id}`,
    path.join(repoRoot, found.relPath),
    file,
  );
  if (result.previews.length === 0) {
    throw new HttpError(500, "PREVIEW_FAILED", "Không sinh được preview - kiểm tra ffmpeg");
  }
  res.json(result);
});

router.post("/:id/assets/:file/grade-frame", async (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const file = path.basename(req.params.file);
  const found = listFilesRecursive(projectAssetsDirOf(id)).find(
    (f) => f.name === file && f.kind === "video",
  );
  if (!found) {
    throw new HttpError(404, "ASSET_NOT_FOUND", `Không tìm thấy asset video "${file}"`);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const preset = typeof body.preset === "string" ? body.preset : null;
  if (preset && !GRADE_PRESETS.some((p) => p.id === preset)) {
    throw new HttpError(400, "INVALID_PRESET", "preset không hợp lệ");
  }
  const adjust = normAdjust(body.adjust);
  const result = await renderGradeFrame(
    projectDirOf(id),
    `video-projects/${id}`,
    path.join(repoRoot, found.relPath),
    file,
    preset,
    adjust,
  );
  res.json(result);
});

router.put("/:id/assets/:file/grade", (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const file = path.basename(req.params.file);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const preset = body.preset;
  if (preset !== null && typeof preset !== "string") {
    throw new HttpError(400, "INVALID_PRESET", "preset phải là string hoặc null");
  }
  if (typeof preset === "string" && !GRADE_PRESETS.some((p) => p.id === preset)) {
    throw new HttpError(
      400,
      "INVALID_PRESET",
      `preset phải là một trong: ${GRADE_PRESETS.map((p) => p.id).join(", ")}`,
    );
  }

  const exists = listFilesRecursive(projectAssetsDirOf(id)).some(
    (f) => f.name === file && f.name !== "assets.json",
  );
  if (!exists) {
    throw new HttpError(404, "ASSET_NOT_FOUND", `Không tìm thấy asset "${file}" trong project "${id}"`);
  }
  const adjust = normAdjust(body.adjust);

  writeAssetEntry(id, file, {
    colorGrade: preset,
    colorAdjust: isDefaultAdjust(adjust) ? null : (adjust as unknown as Record<string, number>),
  });
  res.json({ file, colorGrade: preset, colorAdjust: isDefaultAdjust(adjust) ? null : adjust });
});

export function openProjectEditSession(input: {
  id: string;
  meta: ProjectMeta;
  extraNotes?: string;
  model?: string | null;
  effort?: string | null;

  finishMode?: FinishMode;

  handoffInstruction?: string;
}): { sessionId: string; prompt: string; finishMode: FinishMode } {
  const { id, meta } = input;
  const ctx = briefPromptContextOf(id, meta);
  const finishMode = input.finishMode ?? ctx.brief.finishMode;
  const prompt = buildEditPrompt({
    id,
    meta,
    ...ctx,
    assets: listProjectAssets(id),
    extraNotes: input.extraNotes ?? "",
    finishMode,
    handoffInstruction: input.handoffInstruction,
  });
  const sessionId = `sess_${nanoid()}`;
  const name = meta.name || id;
  db.createChatSession(
    sessionId,
    input.handoffInstruction ? `Giao cho AI: ${name}` : `Edit: ${name}`,
    id,
    input.model ?? null,
    input.effort ?? null,
    finishMode,
  );
  return { sessionId, prompt, finishMode };
}

router.post("/:id/edit", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  if ("extraNotes" in body && typeof body.extraNotes !== "string") {
    throw new HttpError(400, "INVALID_EXTRA_NOTES", "extraNotes phải là string");
  }
  const extraNotes = typeof body.extraNotes === "string" ? body.extraNotes.trim() : "";
  const { model, effort } = parseModelEffort(body);

  const brief = briefOf(meta);
  if (brief.sourceKind === "request" && !brief.sourceText.trim()) {
    throw new HttpError(400, "SOURCE_TEXT_REQUIRED", "Nguồn \"Yêu cầu\" đang trống - ghi yêu cầu/nội dung video trước.");
  }
  if (brief.sourceKind !== "video" && brief.narrationMode === "file" && !brief.narrationFile) {
    throw new HttpError(400, "NARRATION_FILE_REQUIRED", "Đã chọn giọng thu sẵn nhưng chưa chọn file giọng ở cột Nguồn.");
  }
  if (brief.sourceKind === "article" && !brief.sourceUrl) {
    throw new HttpError(400, "SOURCE_URL_REQUIRED", "Nguồn \"Link bài viết\" chưa có link - dán link bài viết trước.");
  }

  if (db.listChatSessions(id).some((s) => isAgentBusy(s.sessionId))) {
    throw new HttpError(
      409,
      "SESSION_BUSY",
      "Phiên AI của project đang chạy - đợi xong (hoặc dừng nó) rồi mới mở phiên mới",
    );
  }

  const { sessionId, prompt } = openProjectEditSession({ id, meta, extraNotes, model, effort });

  res.status(202).json({ sessionId });
  void runAgent(sessionId, prompt);
});

router.delete("/:id", (req, res) => {
  const id = req.params.id;
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_ID", `Project id không hợp lệ: ${id}`);
  }
  if (req.query.force !== "true") {
    throw new HttpError(400, "FORCE_REQUIRED", "Xóa project cần ?force=true");
  }
  if (!projectExists(id) && !fs.existsSync(projectDirOf(id))) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${id}"`);
  }

  if (db.hasActiveJobForProject(id, "video")) {
    throw new HttpError(
      409,
      "JOB_RUNNING",
      "Project đang có job chạy/chờ trong hàng đợi - đợi xong hoặc hủy job rồi mới xóa",
    );
  }
  fs.rmSync(projectDirOf(id), { recursive: true, force: true });

  try {
    fs.rmSync(path.join(paths.outputsDir, `${id}-draft.mp4`), { force: true });
    fs.rmSync(path.join(paths.stagingDir, `vid-${id}`), { recursive: true, force: true });
  } catch {

  }
  res.status(204).end();
});

export default router;
