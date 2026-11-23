import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import { ffprobeSafeArgs, isPlaylistFormat } from "../ffmpegSafe.js";
import { broadcast } from "../events.js";
import {
  AUTO_CUT_ASPECTS,
  AUTO_CUT_BACKGROUNDS,
  AUTO_CUT_LAYOUTS,
  AUTO_CUT_MODES,
  autoCutDirOf,
  briefOfAutoCut,
  readAutoCut,
  scanAutoCuts,
  writeAutoCut,
  type AutoCutAspect,
  type AutoCutBackground,
  type AutoCutLayout,
  type AutoCutMeta,
  type AutoCutMode,
  type AutoCutOutput,
  type AutoCutParams,
  type AutoCutSegment,
  type AutoCutSource,
} from "../autoCutMeta.js";
import { applyBriefPatch, defaultBrief, type Brief } from "../meta.js";
import { queue } from "../queue.js";
import { styleExists } from "../styles.js";
import {
  HttpError,
  execFileCaptureAll,
  fileKind,
  listFilesRecursive,
  nowIso,
  toKebabAscii,
  toRepoRel,
} from "../util.js";

const router = Router();

function toNumber(raw: unknown, what: string, code = "INVALID_PARAMS"): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (typeof raw === "boolean" || raw === null || raw === "" || !Number.isFinite(n)) {
    throw new HttpError(400, code, `${what} phải là số`);
  }
  return n;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function parseBool(raw: unknown, fallback: boolean, what: string): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") {
    throw new HttpError(400, "INVALID_BODY", `${what} phải là boolean`);
  }
  return raw;
}

function resolveInRepo(rel: string, what: string): string {
  const abs = path.resolve(repoRoot, rel);
  if (abs !== repoRoot && !abs.startsWith(path.resolve(repoRoot) + path.sep)) {
    throw new HttpError(400, "PATH_OUTSIDE_REPO", `${what} "${rel}" nằm ngoài repo`);
  }
  return abs;
}

function parseBriefPatch(raw: unknown, base: Brief): Brief {
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "INVALID_BRIEF", "brief phải là object");
  }
  const { styleId: _ignored, ...rest } = raw as Record<string, unknown>;
  return applyBriefPatch(base, rest);
}

function newAutoCutId(name: string): string {
  const base = toKebabAscii(name) || "auto-cut";
  let id = base;
  for (let n = 2; fs.existsSync(autoCutDirOf(id)); n++) id = `${base}-${n}`;
  return id;
}

function parseRate(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const [a, b] = v.split("/");
  const num = parseFloat(a);
  const den = b === undefined ? 1 : parseFloat(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const fps = num / den;
  return fps > 0 ? fps : null;
}

function maybeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

async function probeSource(abs: string, rel: string): Promise<Omit<AutoCutSource, "relPath">> {
  const r = await execFileCaptureAll(
    "ffprobe",
    ffprobeSafeArgs([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,avg_frame_rate,duration",
      "-show_entries",
      "stream_side_data=rotation",
      "-show_entries",
      "stream_tags=rotate",
      "-show_entries",
      "format=duration,format_name",
      "-of",
      "json",
      abs,
    ]),
    { timeoutMs: 30_000 },
  );
  if (r.timedOut) {
    throw new HttpError(400, "PROBE_FAILED", `ffprobe quá thời gian khi đọc "${rel}"`);
  }
  if (r.code !== 0) {
    throw new HttpError(
      400,
      "PROBE_FAILED",
      `ffprobe không đọc được "${rel}" (mã ${r.code}): ${r.stderr.trim().slice(0, 200)}`,
    );
  }

  let json: {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  try {
    json = JSON.parse(r.stdout) as typeof json;
  } catch {
    throw new HttpError(400, "PROBE_FAILED", `ffprobe trả JSON không đọc được cho "${rel}"`);
  }

  if (isPlaylistFormat(json.format?.format_name)) {
    throw new HttpError(400, "INVALID_SOURCE", `File "${rel}" là playlist (HLS/concat), không phải video`);
  }

  const stream = Array.isArray(json.streams) ? json.streams[0] : undefined;
  if (!stream) {
    throw new HttpError(400, "INVALID_SOURCE", `File "${rel}" không có stream video`);
  }

  const rawWidth = maybeNum(stream.width);
  const rawHeight = maybeNum(stream.height);
  if (!rawWidth || !rawHeight || rawWidth <= 0 || rawHeight <= 0) {
    throw new HttpError(400, "PROBE_FAILED", `Không đọc được kích thước khung của "${rel}"`);
  }

  const sideData = Array.isArray(stream.side_data_list)
    ? (stream.side_data_list as Array<Record<string, unknown>>)
    : [];
  let rawRotation: number | null = null;
  for (const sd of sideData) {
    const n = maybeNum(sd.rotation);
    if (n !== null) {
      rawRotation = n;
      break;
    }
  }
  if (rawRotation === null) {
    const tags = (stream.tags ?? {}) as Record<string, unknown>;
    rawRotation = maybeNum(tags.rotate);
  }

  const rotation = ((Math.round(rawRotation ?? 0) % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;

  const durationSec =
    maybeNum(json.format?.duration) ?? maybeNum(stream.duration) ?? 0;
  if (!(durationSec > 0)) {
    throw new HttpError(400, "PROBE_FAILED", `Không đọc được thời lượng của "${rel}"`);
  }

  const fps = parseRate(stream.r_frame_rate) ?? parseRate(stream.avg_frame_rate) ?? 30;

  return {
    width: swap ? rawHeight : rawWidth,
    height: swap ? rawWidth : rawHeight,
    fps: Math.round(fps * 1000) / 1000,
    durationSec: round2(durationSec),
    rotation,
  };
}

function parseMode(raw: unknown): AutoCutMode {
  if (!AUTO_CUT_MODES.includes(raw as AutoCutMode)) {
    throw new HttpError(
      400,
      "INVALID_MODE",
      `mode phải là một trong: ${AUTO_CUT_MODES.join(", ")}`,
    );
  }
  return raw as AutoCutMode;
}

function parseStyleId(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined) return fallback;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new HttpError(400, "INVALID_STYLE_ID", "output.styleId phải là string hoặc null");
  }
  const id = raw.trim();
  if (!id) return null;
  if (!styleExists(id)) {
    throw new HttpError(404, "STYLE_NOT_FOUND", `Không tìm thấy style "${id}"`);
  }
  return id;
}

function parseOutFps(raw: unknown, fallback: number | null): number | null {
  if (raw === undefined) return fallback;
  if (raw === null || raw === "") return null;
  const n = toNumber(raw, "output.fps", "INVALID_FPS");
  if (n <= 0 || n > 240) {
    throw new HttpError(400, "INVALID_FPS", "output.fps phải là số dương (<= 240) hoặc null");
  }
  return Math.round(n * 1000) / 1000;
}

function parseOutput(raw: unknown, fallback: AutoCutOutput): AutoCutOutput {
  if (raw === undefined) return fallback;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "INVALID_OUTPUT", "output phải là object");
  }
  const o = raw as Record<string, unknown>;

  let aspect = fallback.aspect;
  if (o.aspect !== undefined) {
    if (!AUTO_CUT_ASPECTS.includes(o.aspect as AutoCutAspect)) {
      throw new HttpError(
        400,
        "INVALID_ASPECT",
        `output.aspect phải là một trong: ${AUTO_CUT_ASPECTS.join(", ")}`,
      );
    }
    aspect = o.aspect as AutoCutAspect;
  }

  let layout = fallback.layout;
  if (o.layout !== undefined) {
    if (!AUTO_CUT_LAYOUTS.includes(o.layout as AutoCutLayout)) {
      throw new HttpError(
        400,
        "INVALID_LAYOUT",
        `output.layout phải là một trong: ${AUTO_CUT_LAYOUTS.join(", ")}`,
      );
    }
    layout = o.layout as AutoCutLayout;
  }

  let background = fallback.background;
  if (o.background !== undefined) {
    if (!AUTO_CUT_BACKGROUNDS.includes(o.background as AutoCutBackground)) {
      throw new HttpError(
        400,
        "INVALID_BACKGROUND",
        `output.background phải là một trong: ${AUTO_CUT_BACKGROUNDS.join(", ")}`,
      );
    }
    background = o.background as AutoCutBackground;
  }

  return {
    aspect,
    layout,
    background,
    styleId: parseStyleId(o.styleId, fallback.styleId),
    fps: parseOutFps(o.fps, fallback.fps),
  };
}

function parseParams(mode: AutoCutMode, raw: unknown, fallback: AutoCutParams): AutoCutParams {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    throw new HttpError(400, "INVALID_PARAMS", "params phải là object");
  }
  const o = (raw ?? {}) as Record<string, unknown>;

  const pick = (key: keyof AutoCutParams, def: number): number => {
    if (o[key] !== undefined) return toNumber(o[key], `params.${key}`);
    const old = fallback[key];
    return typeof old === "number" && Number.isFinite(old) ? old : def;
  };

  if (mode === "time") {

    const minutes = clamp(pick("minutes", 5), 0.25, 60);
    const overlapSec = clamp(pick("overlapSec", 0), 0, 60);
    return { minutes: round2(minutes), overlapSec: round2(overlapSec) };
  }

  const count = Math.round(clamp(pick("count", 5), 1, 20));
  const minSec = clamp(pick("minSec", 20), 1, 3600);
  const maxSec = clamp(pick("maxSec", 60), 1, 3600);
  if (maxSec <= minSec) {
    throw new HttpError(
      400,
      "INVALID_PARAMS",
      `params.maxSec (${maxSec}) phải lớn hơn params.minSec (${minSec})`,
    );
  }

  const out: AutoCutParams = { count, minSec: round2(minSec), maxSec: round2(maxSec) };
  if (mode === "prompt") {
    const rawRequest = o.request !== undefined ? o.request : fallback.request;
    if (typeof rawRequest !== "string" || !rawRequest.trim()) {
      throw new HttpError(
        400,
        "REQUEST_REQUIRED",
        'mode "prompt" cần params.request - mô tả đoạn bạn muốn AI tìm trong video',
      );
    }
    out.request = rawRequest.trim();
  }
  return out;
}

function parseTranscribe(mode: AutoCutMode, raw: unknown, fallback: boolean): boolean {
  if (mode !== "time") return true;
  return parseBool(raw, fallback, "transcribe");
}

function patchSegments(meta: AutoCutMeta, raw: unknown): AutoCutSegment[] {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "INVALID_SEGMENTS", "segments phải là mảng");
  }
  const maxEnd = Math.max(0, meta.source.durationSec);
  const byIndex = new Map<number, AutoCutSegment>();
  for (const s of meta.segments) byIndex.set(s.index, { ...s });
  const seen = new Set<number>();

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "INVALID_SEGMENTS", "Mỗi phần tử segments phải là object");
    }
    const o = item as Record<string, unknown>;
    const index = toNumber(o.index, "segments[].index", "INVALID_SEGMENTS");
    if (!Number.isInteger(index) || index < 0) {
      throw new HttpError(400, "INVALID_SEGMENTS", "segments[].index phải là số nguyên >= 0");
    }
    if (seen.has(index)) {
      throw new HttpError(400, "INVALID_SEGMENTS", `segments[].index bị trùng: ${index}`);
    }
    seen.add(index);

    const current = byIndex.get(index);
    if (!current && (o.start === undefined || o.end === undefined)) {
      throw new HttpError(
        400,
        "INVALID_SEGMENTS",
        `Đoạn index ${index} chưa có trong kế hoạch - thêm mới phải kèm cả start và end`,
      );
    }

    const start =
      o.start === undefined
        ? (current as AutoCutSegment).start
        : clamp(toNumber(o.start, "segments[].start", "INVALID_SEGMENTS"), 0, maxEnd);
    const end =
      o.end === undefined
        ? (current as AutoCutSegment).end
        : clamp(toNumber(o.end, "segments[].end", "INVALID_SEGMENTS"), 0, maxEnd);
    if (!(start < end)) {
      throw new HttpError(
        400,
        "INVALID_SEGMENTS",
        `Đoạn index ${index}: start (${start}) phải nhỏ hơn end (${end})`,
      );
    }

    if (o.title !== undefined && typeof o.title !== "string") {
      throw new HttpError(400, "INVALID_SEGMENTS", "segments[].title phải là string");
    }
    if (o.selected !== undefined && typeof o.selected !== "boolean") {
      throw new HttpError(400, "INVALID_SEGMENTS", "segments[].selected phải là boolean");
    }

    byIndex.set(index, {
      ...(current ?? { index, selected: true, title: `Đoạn ${index + 1}` }),
      index,
      start: round2(start),
      end: round2(end),
      title: o.title !== undefined ? (o.title as string).trim() : (current?.title ?? `Đoạn ${index + 1}`),
      selected: o.selected !== undefined ? (o.selected as boolean) : (current?.selected ?? true),
    });
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

router.get("/sources", (_req, res) => {
  const files = listFilesRecursive(paths.importsDir).filter((f) => f.kind === "video");
  res.json({ files });
});

router.get("/", (_req, res) => {
  res.json({ sessions: scanAutoCuts() });
});

router.get("/:id", (req, res) => {
  res.json({ session: readAutoCut(req.params.id) });
});

router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const sourceRel = typeof body.sourceRel === "string" ? body.sourceRel.trim() : "";
  if (!sourceRel) {
    throw new HttpError(400, "SOURCE_REQUIRED", "Thiếu sourceRel (video nguồn cần cắt)");
  }
  const sourceAbs = resolveInRepo(sourceRel, "sourceRel");
  if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
    throw new HttpError(404, "SOURCE_NOT_FOUND", `Không thấy video nguồn "${sourceRel}"`);
  }
  if (fileKind(sourceAbs) !== "video") {
    throw new HttpError(
      400,
      "INVALID_SOURCE",
      `"${sourceRel}" không phải video (mp4/mov/webm/mkv/avi/m4v)`,
    );
  }

  const mode = parseMode(body.mode);
  const defaultOutput: AutoCutOutput = {
    aspect: "9:16",
    layout: "auto",
    background: "gemini",
    styleId: null,
    fps: null,
  };
  const params = parseParams(mode, body.params, {});
  const output = parseOutput(body.output, defaultOutput);
  const transcribe = parseTranscribe(mode, body.transcribe, true);
  const autoEdit = parseBool(body.autoEdit, false, "autoEdit");

  const brief = parseBriefPatch(body.brief, defaultBrief());

  const source: AutoCutSource = {

    relPath: toRepoRel(sourceAbs),
    ...(await probeSource(sourceAbs, sourceRel)),
  };

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : path.basename(sourceAbs, path.extname(sourceAbs));

  const now = nowIso();
  const meta: AutoCutMeta = {
    id: newAutoCutId(name),
    name,
    status: "draft",
    source,
    mode,
    params,
    output,
    brief,
    transcribe,
    autoEdit,
    transcriptRel: null,
    segments: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  writeAutoCut(meta);
  res.status(201).json({ session: readAutoCut(meta.id) });
});

router.patch("/:id", (req, res) => {
  const meta = readAutoCut(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const touchesPlan =
    "params" in body || "output" in body || "transcribe" in body || "segments" in body;
  if (touchesPlan && (meta.status === "planning" || meta.status === "cutting")) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên cắt "${meta.id}" đang chạy (${meta.status}) - đợi xong rồi mới sửa được kế hoạch`,
    );
  }

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, "INVALID_NAME", "name phải là string không rỗng");
    }
    meta.name = body.name.trim();
  }
  meta.autoEdit = parseBool(body.autoEdit, meta.autoEdit, "autoEdit");

  if ("brief" in body) meta.brief = parseBriefPatch(body.brief, briefOfAutoCut(meta));

  const before = JSON.stringify([meta.params, meta.transcribe, planKeyOf(meta.output)]);
  if ("params" in body) meta.params = parseParams(meta.mode, body.params, meta.params);
  if ("output" in body) meta.output = parseOutput(body.output, meta.output);
  if ("transcribe" in body) {
    meta.transcribe = parseTranscribe(meta.mode, body.transcribe, meta.transcribe);
  }
  const after = JSON.stringify([meta.params, meta.transcribe, planKeyOf(meta.output)]);

  if (before !== after && meta.status !== "draft") {

    meta.status = "draft";
    meta.segments = [];
    meta.error = null;
  }

  if ("segments" in body) {
    if (meta.status !== "planned" && meta.status !== "draft") {
      throw new HttpError(
        409,
        "BUSY",
        `Chỉ sửa được danh sách đoạn khi phiên ở trạng thái draft hoặc planned (hiện tại: ${meta.status})`,
      );
    }
    meta.segments = patchSegments(meta, body.segments);

    if (meta.segments.length > 0 && meta.status === "draft") meta.status = "planned";
  }

  writeAutoCut(meta);
  res.json({ session: readAutoCut(meta.id) });
});

function planKeyOf(output: AutoCutOutput): unknown {
  return [output.aspect, output.layout, output.background, output.fps];
}

function assertNotBusy(meta: AutoCutMeta): void {
  if (db.hasActiveJobForProject(meta.id, "auto-cut")) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên cắt "${meta.id}" đang có job chạy/chờ trong hàng đợi`,
    );
  }
  if (meta.status === "planning" || meta.status === "cutting") {
    throw new HttpError(409, "BUSY", `Phiên cắt "${meta.id}" đang ${meta.status}`);
  }
}

function enqueueAutoCutJob(sessionId: string, step: "plan" | "cut"): db.JobApi {
  const job = db.createJob({
    id: `job_${nanoid()}`,
    projectId: sessionId,
    type: "auto-cut",
    sceneId: step,
  });
  const api = db.jobToApi(job);
  broadcast("job", api);
  queue.enqueue(job.id);
  return api;
}

router.post("/:id/plan", (req, res) => {
  const meta = readAutoCut(req.params.id);
  assertNotBusy(meta);
  res.status(202).json({ job: enqueueAutoCutJob(meta.id, "plan") });
});

router.post("/:id/cut", (req, res) => {
  const meta = readAutoCut(req.params.id);
  assertNotBusy(meta);

  const retryableFailed =
    meta.status === "failed" && meta.failedStep === "cut" && meta.segments.length > 0;
  if (meta.status !== "planned" && !retryableFailed) {
    throw new HttpError(
      409,
      "NOT_PLANNED",
      `Phiên cắt "${meta.id}" chưa có kế hoạch đã duyệt (status = ${meta.status}) - chạy bước plan trước`,
    );
  }
  if (!meta.segments.some((s) => s.selected)) {
    throw new HttpError(
      400,
      "NO_SEGMENT_SELECTED",
      "Chưa chọn đoạn nào để cắt - tích ít nhất một đoạn trong kế hoạch",
    );
  }
  res.status(202).json({ job: enqueueAutoCutJob(meta.id, "cut") });
});

router.delete("/:id", (req, res) => {

  if (req.query.force !== "true") {
    throw new HttpError(400, "FORCE_REQUIRED", "Xóa phiên cắt cần ?force=true");
  }
  const meta = readAutoCut(req.params.id);

  assertNotBusy(meta);
  fs.rmSync(autoCutDirOf(meta.id), { recursive: true, force: true });
  res.status(204).end();
});

export default router;
