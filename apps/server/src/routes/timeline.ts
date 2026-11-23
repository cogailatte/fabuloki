import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { isAgentBusy, runAgent } from "../agent.js";
import { briefPromptContextOf, syncBrandLogo } from "../childProject.js";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import { EDITOR_CONTEXT_MARKER, buildEditorChatPrompt } from "../editPrompt.js";
import { assertVideoJobAllowed, enqueueJob } from "../jobRules.js";
import {
  briefOf,
  projectAssetsDirOf,
  projectDirOf,
  projectSummaryOf,
  readMeta,
  type ProjectMeta,
} from "../meta.js";
import { getStyle } from "../styles.js";
import {
  TIMELINE_KEYS,
  buildFcp7Xml,
  isValidRev,
  listRevisions,
  isRenderStale,
  mediaInfoMap,
  mediaVersionsOf,
  probeMediaInfo,
  readRevision,
  referencedMediaPaths,
  resolveProjectPath,
  sceneRenderState,
  sceneRendersOf,
  snapshotTimeline,
  timelineForClient,
  timelineVersion,
  validateTimelineForRender,
  validateTimelinePatch,
  writeTimelineKeys,
  type TimelineKey,
} from "../timeline.js";
import { parseModelEffort } from "./providers.js";
import { openProjectEditSession } from "./projects.js";
import { readMusicLibrary } from "./music.js";
import { readLibrary } from "./sfx.js";
import { HttpError, ensureDir, fileKind } from "../util.js";

const router = Router();
export const libraryRouter = Router();

const MAX_LABEL_LEN = 120;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function busySessionOf(id: string): string | null {
  return db.listChatSessions(id).find((s) => isAgentBusy(s.sessionId))?.sessionId ?? null;
}

function assertNotAgentBusy(id: string): void {
  const busy = busySessionOf(id);
  if (busy) {
    throw new HttpError(
      409,
      "AGENT_BUSY",
      "AI đang sửa project này - trình chỉnh sửa chỉ đọc cho tới khi phiên AI xong (hoặc bị dừng).",
      { sessionId: busy },
    );
  }
}

function assertBaseVersion(meta: ProjectMeta, baseVersion: string): void {
  const version = timelineVersion(meta);
  if (baseVersion !== version) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      "Timeline đã bị thay đổi ở nơi khác (AI hoặc tab khác) kể từ lần tải gần nhất.",
      { current: { version, timeline: timelineForClient(meta) } },
    );
  }
}

function parseBaseVersion(body: Obj): string {
  if (typeof body.baseVersion !== "string" || !body.baseVersion.trim()) {
    throw new HttpError(400, "INVALID_BASE_VERSION", "Thiếu baseVersion (version lấy từ GET timeline)");
  }
  return body.baseVersion.trim();
}

function previewWatermark(id: string, meta: ProjectMeta): { file: string; position: "top-left" } | null {
  const style = getStyle(briefOf(meta).styleId);
  const srcRel = style?.logoPath ?? null;
  if (!srcRel) return null;
  const srcAbs = path.join(repoRoot, srcRel);
  let srcSize: number;
  try {
    srcSize = fs.statSync(srcAbs).size;
  } catch {
    return null;
  }
  const fileName = `brand-logo${path.extname(srcRel).toLowerCase() || ".png"}`;
  let fresh = false;
  try {
    fresh = fs.statSync(path.join(projectAssetsDirOf(id), fileName)).size === srcSize;
  } catch {

  }
  let file: string | null = fresh ? fileName : null;
  if (!file) {
    try {
      file = syncBrandLogo(id, style);
    } catch {
      file = null;
    }
  }
  return file ? { file: path.posix.join("assets", file), position: "top-left" } : null;
}

router.get("/:id/timeline", async (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const dir = projectDirOf(id);
  const sceneRenders = sceneRendersOf(dir, meta);
  const watermark = previewWatermark(id, meta);
  const referenced = referencedMediaPaths(meta, sceneRenders);
  const media = await mediaInfoMap(dir, referenced);

  const mediaVersions = mediaVersionsOf(dir, watermark ? [...referenced, watermark.file] : referenced);
  const summary = projectSummaryOf(id);
  const busy = busySessionOf(id);
  res.json({
    version: timelineVersion(meta),
    timeline: timelineForClient(meta),
    project: {
      id,
      name: summary?.name ?? id,
      width: summary?.width ?? 0,
      height: summary?.height ?? 0,
      fps: summary?.fps ?? 0,
      status: summary?.status ?? "draft",
      updatedAt: summary?.updatedAt ?? null,
    },
    preview: { sceneRenders, watermark, media, mediaVersions },
    lock: {
      agentBusy: busy !== null,
      renderActive: db.hasActiveRenderJobForProject(id),
      sessionId: busy,
    },
  });
});

router.put("/:id/timeline", (req, res) => {
  const id = req.params.id;
  const body = (req.body ?? {}) as Obj;
  const baseVersion = parseBaseVersion(body);
  if (!isObj(body.timeline)) {
    throw new HttpError(400, "INVALID_TIMELINE", "timeline phải là object chứa các khóa cần thay", {
      issues: [{ path: "timeline", message: "phải là object" }],
    });
  }
  const patch = body.timeline;
  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
    throw new HttpError(400, "INVALID_LABEL", "label phải là chuỗi");
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, MAX_LABEL_LEN) || null : null;

  const meta = readMeta(id);
  assertNotAgentBusy(id);
  assertBaseVersion(meta, baseVersion);
  const issues = validateTimelinePatch(patch, projectDirOf(id));
  if (issues.length) {
    throw new HttpError(
      400,
      "INVALID_TIMELINE",
      `Timeline không hợp lệ (${issues.length} lỗi) - xem issues`,
      { issues },
    );
  }

  const keys = TIMELINE_KEYS.filter((k) => k in patch);
  if (!keys.length) {
    res.json({ version: timelineVersion(meta), timeline: timelineForClient(meta) });
    return;
  }

  try {
    snapshotTimeline(id, "editor", label, meta);
  } catch (err) {
    console.warn(`[timeline] Không chụp được lịch sử trước khi lưu ${id}:`, err);
  }
  const values: Partial<Record<TimelineKey, unknown>> = {};
  for (const k of keys) values[k] = patch[k];
  const next = writeTimelineKeys(id, values);
  res.json({ version: timelineVersion(next), timeline: timelineForClient(next) });
});

router.get("/:id/timeline/revisions", (req, res) => {
  const id = req.params.id;
  readMeta(id);
  res.json(listRevisions(id));
});

router.post("/:id/timeline/revisions/:rev/restore", (req, res) => {
  const id = req.params.id;
  const rev = req.params.rev;
  const body = (req.body ?? {}) as Obj;
  const baseVersion = parseBaseVersion(body);
  const meta = readMeta(id);
  if (!isValidRev(rev)) throw new HttpError(400, "INVALID_REV", `rev không hợp lệ: ${rev}`);
  const revision = readRevision(id, rev);
  if (!revision) throw new HttpError(404, "REVISION_NOT_FOUND", `Không tìm thấy bản lịch sử "${rev}"`);
  assertNotAgentBusy(id);
  assertBaseVersion(meta, baseVersion);

  try {
    snapshotTimeline(id, "restore", rev, meta);
  } catch (err) {
    console.warn(`[timeline] Không chụp được lịch sử trước khi khôi phục ${id}:`, err);
  }

  const next = writeTimelineKeys(id, revision.timeline);
  res.json({ version: timelineVersion(next), timeline: timelineForClient(next) });
});

router.get("/:id/timeline/export.xml", async (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const dir = projectDirOf(id);
  const fps = Number(meta.fps);
  const width = Number(meta.width);
  const height = Number(meta.height);
  if (!(fps > 0) || !(width > 0) || !(height > 0)) {
    throw new HttpError(409, "META_INVALID", "meta.json thiếu width/height/fps hợp lệ - không xuất được XML");
  }
  const sceneRenders = sceneRendersOf(dir, meta);
  const media = await mediaInfoMap(dir, referencedMediaPaths(meta, sceneRenders));
  const xml = buildFcp7Xml({
    id,
    name: typeof meta.name === "string" ? meta.name : id,
    fps,
    width: Math.round(width),
    height: Math.round(height),
    meta,
    projectDir: dir,
    sceneRenders,
    media,
  });
  res.setHeader("Content-Type", "application/xml; charset=utf-8");

  res.setHeader("Content-Disposition", `attachment; filename="${id}.xml"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(xml);
});

router.get("/:id/media-info", async (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const rel = typeof req.query.path === "string" ? req.query.path : "";
  if (!rel) throw new HttpError(400, "PATH_REQUIRED", "Thiếu query path (tương đối thư mục project)");
  const r = resolveProjectPath(projectDirOf(id), rel);
  if ("error" in r) throw new HttpError(400, "INVALID_PATH", `path "${rel}": ${r.error}`);
  const info = await probeMediaInfo(r.abs);
  if (!info) throw new HttpError(404, "MEDIA_NOT_FOUND", `Không tìm thấy file "${rel}" trong project`);
  res.json(info);
});

libraryRouter.get("/sfx", (_req, res) => {
  res.json(
    readLibrary()
      .filter((e) => fs.existsSync(path.join(paths.sfxDir, e.file)))
      .map((e) => ({
        file: e.file,
        durationMs: e.durationMs,
        description: e.description,
        tags: e.tags,
        available: true,
      })),
  );
});

libraryRouter.get("/music", (_req, res) => {
  res.json(
    readMusicLibrary()
      .filter((e) => fs.existsSync(path.join(paths.musicDir, e.file)))
      .map((e) => ({
        file: e.file,
        durationMs: e.durationMs,
        description: e.description,
        tags: e.tags,
        available: true,
      })),
  );
});

function sameFile(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

router.post("/:id/library-import", async (req, res) => {
  const id = req.params.id;
  readMeta(id);
  const body = (req.body ?? {}) as Obj;
  const kind = body.kind;
  if (kind !== "sfx" && kind !== "music") {
    throw new HttpError(400, "INVALID_KIND", 'kind phải là "sfx" hoặc "music"');
  }
  const file = typeof body.file === "string" ? body.file : "";

  if (!file || file !== path.basename(file) || /[\\/]/.test(file) || file.startsWith(".")) {
    throw new HttpError(400, "INVALID_FILE", "file phải là tên file trong thư viện (không kèm thư mục)");
  }
  if (fileKind(file) !== "audio") {
    throw new HttpError(400, "INVALID_FILE", "file phải là audio (mp3/wav/ogg/m4a/aac/flac)");
  }
  const libDir = kind === "sfx" ? paths.sfxDir : paths.musicDir;
  const listed = (kind === "sfx" ? readLibrary() : readMusicLibrary()).some((e) => e.file === file);
  const srcAbs = path.join(libDir, file);
  if (!listed || !fs.existsSync(srcAbs)) {
    throw new HttpError(
      404,
      "LIBRARY_FILE_NOT_FOUND",
      `Không có "${file}" trong thư viện ${kind === "sfx" ? "sound effect" : "nhạc nền"}`,
    );
  }

  const destDir = path.join(projectAssetsDirOf(id), kind);
  ensureDir(destDir);

  const ext = path.extname(file);
  const base = path.basename(file, ext);
  let name = file;
  let copied = false;
  for (let n = 2; ; n++) {
    const destAbs = path.join(destDir, name);
    if (!fs.existsSync(destAbs)) {
      fs.copyFileSync(srcAbs, destAbs);
      copied = true;
      break;
    }
    if (sameFile(srcAbs, destAbs)) break;
    name = `${base}-${n}${ext}`;
  }
  const relPath = path.posix.join("assets", kind, name);
  const info = await probeMediaInfo(path.join(destDir, name));
  res.status(201).json({ relPath, durationSec: info?.durationSec ?? null, copied });
});

router.post("/:id/editor/render", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Obj;
  const quality = body.quality;
  if (quality !== "draft" && quality !== "final") {
    throw new HttpError(400, "INVALID_QUALITY", 'quality phải là "draft" hoặc "final"');
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new HttpError(400, "INVALID_FORCE", "force phải là boolean");
  }
  const draft = quality === "draft";
  const dir = projectDirOf(id);

  const issues = validateTimelineForRender(meta, dir);
  if (issues.length) {
    throw new HttpError(
      400,
      "INVALID_TIMELINE",
      `Timeline chưa render được (${issues.length} lỗi) - xem issues`,
      { issues },
    );
  }
  assertVideoJobAllowed(id, draft ? "assemble-draft" : "assemble-final", {
    force: body.force === true,
  });

  const stale = (meta.scenes ?? []).filter((s) => {
    if (typeof s.src !== "string" || !s.src) return false;
    const st = sceneRenderState(dir, s as unknown as Record<string, unknown>);
    const fresh = (m: number | null): boolean => m !== null && !isRenderStale(m, st);
    if (draft) return !fresh(st.draftMtime) && !fresh(st.finalMtime);
    if (!fresh(st.finalMtime)) return true;
    return st.draftRel !== st.finalRel && st.draftMtime !== null && st.finalMtime! < st.draftMtime;
  });

  const jobs = stale.map((s) =>
    enqueueJob({ projectId: id, type: draft ? "scene-draft" : "scene-final", sceneId: s.id }),
  );

  jobs.push(
    enqueueJob({
      projectId: id,
      type: draft ? "assemble-draft" : "assemble-final",
      dependsOn: jobs.map((j) => j.id),
    }),
  );
  res.status(202).json({ jobs });
});

router.post("/:id/editor/chat", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Obj;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new HttpError(400, "MESSAGE_REQUIRED", "Thiếu message");
  const { model, effort } = parseModelEffort(body);

  let existing: db.ChatSessionRow | undefined;
  if (body.sessionId !== undefined && body.sessionId !== null && body.sessionId !== "") {
    if (typeof body.sessionId !== "string") {
      throw new HttpError(400, "INVALID_SESSION_ID", "sessionId phải là chuỗi");
    }
    existing = db.getChatSession(body.sessionId.trim());
    if (!existing) {
      throw new HttpError(404, "SESSION_NOT_FOUND", `Không tìm thấy phiên chat "${body.sessionId}"`);
    }
    if (existing.projectId !== id) {
      throw new HttpError(400, "SESSION_PROJECT_MISMATCH", "Phiên chat này không thuộc project đang mở");
    }

    if (existing.goal) {
      throw new HttpError(
        400,
        "SESSION_NOT_EDITOR",
        "Phiên này là phiên dựng video (goal final) - trình chỉnh sửa chỉ tiếp tục phiên chat thường của project",
      );
    }
  }

  if (db.listChatSessions(id).some((s) => isAgentBusy(s.sessionId))) {
    throw new HttpError(
      409,
      "SESSION_BUSY",
      "Phiên AI của project đang chạy - đợi xong (hoặc dừng nó) rồi mới gửi tiếp",
    );
  }

  let sessionId: string;
  if (existing) {
    sessionId = existing.sessionId;
    db.setChatSessionModelEffort(sessionId, model, effort);
  } else {
    sessionId = `sess_${nanoid()}`;

    db.createChatSession(
      sessionId,
      `Trình chỉnh sửa: ${message.slice(0, 60)}`,
      id,
      model ?? null,
      effort ?? null,
      null,
    );

    db.setChatAutoResume(sessionId, false);
  }

  const needsContext =
    !existing || !db.chatSessionHasUserMessageContaining(sessionId, EDITOR_CONTEXT_MARKER);
  const prompt = buildEditorChatPrompt({
    id,
    meta,
    message,
    context: needsContext ? briefPromptContextOf(id, meta) : null,
  });

  res.status(202).json({ sessionId });
  void runAgent(sessionId, prompt);
});

const MAX_HANDOFF_INSTRUCTION_LEN = 8000;

router.post("/:id/editor/handoff", (req, res) => {
  const id = req.params.id;
  const meta = readMeta(id);
  const body = (req.body ?? {}) as Obj;
  if (body.instruction !== undefined && typeof body.instruction !== "string") {
    throw new HttpError(400, "INVALID_INSTRUCTION", "instruction phải là chuỗi");
  }
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    throw new HttpError(400, "INSTRUCTION_REQUIRED", "Thiếu instruction - AI cần biết phải làm tiếp gì");
  }
  if (instruction.length > MAX_HANDOFF_INSTRUCTION_LEN) {
    throw new HttpError(
      400,
      "INSTRUCTION_TOO_LONG",
      `instruction tối đa ${MAX_HANDOFF_INSTRUCTION_LEN} ký tự`,
    );
  }
  const rawMode = body.finishMode;
  if (rawMode !== undefined && rawMode !== null && rawMode !== "draft" && rawMode !== "final") {
    throw new HttpError(400, "INVALID_FINISH_MODE", 'finishMode phải là "draft" hoặc "final"');
  }

  const finishMode = rawMode === "final" ? "final" : "draft";
  const { model, effort } = parseModelEffort(body);

  if (db.listChatSessions(id).some((s) => isAgentBusy(s.sessionId))) {
    throw new HttpError(
      409,
      "AGENT_BUSY",
      "Phiên AI của project đang chạy - đợi xong (hoặc dừng nó) rồi mới giao tiếp",
    );
  }

  const label = `Giao cho AI: ${instruction.slice(0, 60)}`;
  let beforeRev: string | null = null;
  try {
    const snap = snapshotTimeline(id, "ai-before", label, meta);
    if (snap) {
      beforeRev = snap.rev;
    } else {
      const newest = listRevisions(id)[0];
      if (newest && newest.version === timelineVersion(meta)) beforeRev = newest.rev;
    }
  } catch (err) {

    console.warn(`[handoff] Không chụp được ai-before cho ${id}:`, err);
  }

  const { sessionId, prompt } = openProjectEditSession({
    id,
    meta,
    model,
    effort,
    finishMode,
    handoffInstruction: instruction,
  });

  res.status(202).json({ sessionId, finishMode, beforeRev });
  void runAgent(sessionId, prompt);
});

export default router;
