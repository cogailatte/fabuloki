import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths } from "../config.js";
import { broadcast } from "../events.js";
import { listProjectAssets, projectDirOf, projectExists } from "../meta.js";
import { isKnownUploadToken, isValidUploadToken } from "./uploadSession.js";
import {
  HttpError,
  ensureDir,
  fileInfoOf,
  hasMasterToken,
  isLocalRequest,
  listFilesRecursive,
  moveFile,
  sanitizeFileName,
} from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) => cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },

  defParamCharset: "utf8",
});

function qs(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const ALLOWED_UPLOAD_EXT = new Set([

  ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v",

  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac",

  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif",

  ".ttf", ".otf", ".woff", ".woff2",

  ".json", ".srt", ".vtt", ".txt", ".md", ".csv",
]);

interface UploadTracker {

  done(projectId: string | undefined, file: string): void;

  fail(projectId?: string): void;
}

const uploadTrackers = new WeakMap<Request, UploadTracker>();

const UPLOAD_THROTTLE_MS = 400;

const HEAD_SNIFF_LIMIT = 65536;

const UPLOAD_STALL_MS = 45_000;

function uploadProgress(req: Request, res: Response, next: NextFunction): void {
  const id = `up_${nanoid(10)}`;
  const total = Number(req.headers["content-length"]) || 0;
  let received = 0;
  let projectId: string | undefined;
  let head = "";
  let settled = false;
  let lastSent = 0;

  let stallTimer: NodeJS.Timeout | null = null;
  const clearStall = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      if (settled || req.complete) return;
      uploadTrackers.get(req)?.fail();
      req.destroy(new Error("Upload stall: 45s không nhận thêm dữ liệu"));
    }, UPLOAD_STALL_MS);
  };
  armStall();

  uploadTrackers.set(req, {
    done(finalProjectId, file) {
      if (settled) return;
      settled = true;
      clearStall();
      broadcast("upload", {
        id,
        projectId: finalProjectId ?? projectId,
        file,
        received: total,
        total,
        done: true,
      });
    },
    fail(finalProjectId) {
      if (settled) return;
      settled = true;
      clearStall();
      broadcast("upload", {
        id,
        projectId: finalProjectId ?? projectId,
        done: true,
        error: true,
      });
    },
  });

  req.on("data", (chunk: Buffer) => {
    armStall();
    received += chunk.length;
    if (!projectId && head.length < HEAD_SNIFF_LIMIT) {
      head += chunk.toString("latin1", 0, Math.min(chunk.length, HEAD_SNIFF_LIMIT));
      const m = /name="projectId"\r\n\r\n([^\r]*)\r\n/.exec(head);
      if (m?.[1]) projectId = m[1];
    }
    const now = Date.now();
    if (now - lastSent >= UPLOAD_THROTTLE_MS) {
      lastSent = now;
      broadcast("upload", { id, projectId, received, total, done: false });
    }
  });

  req.on("close", () => {
    clearStall();
    if (!settled && !req.complete) uploadTrackers.get(req)?.fail();
  });

  res.on("finish", () => {
    if (!settled && res.statusCode >= 400) uploadTrackers.get(req)?.fail();
  });

  next();
}

function resolveScopeDir(scope: string, projectId: string, forUpload: boolean): string {
  switch (scope) {
    case "imports":
      return paths.importsDir;
    case "outputs":
      if (forUpload) {
        throw new HttpError(400, "INVALID_SCOPE", "Không upload trực tiếp vào outputs");
      }
      return paths.outputsDir;
    case "project": {
      if (!projectId) throw new HttpError(400, "PROJECT_ID_REQUIRED", "Thiếu projectId");
      if (!projectExists(projectId)) {
        throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${projectId}"`);
      }
      return path.join(projectDirOf(projectId), "assets");
    }
    default:
      throw new HttpError(400, "INVALID_SCOPE", "scope phải là imports | outputs | project");
  }
}

router.get("/", (req, res) => {
  const scope = qs(req.query.scope);
  const projectId = qs(req.query.projectId);
  const dir = resolveScopeDir(scope, projectId, false);
  if (scope === "project") {

    res.json(listProjectAssets(projectId));
    return;
  }
  res.json(listFilesRecursive(dir));
});

router.post("/", uploadProgress, upload.single("file"), (req, res) => {
  const uploaded = req.file;
  if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = qs(body.projectId) || undefined;
  try {
    const scope = qs(body.scope);
    const dir = resolveScopeDir(scope, projectId ?? "", true);

    if (!isLocalRequest(req) && !hasMasterToken(req)) {
      const token = qs(body.token) || qs(req.query.k);

      const ok =
        scope === "project"
          ? isValidUploadToken(token, projectId ?? "")
          : isKnownUploadToken(token);
      if (!ok) {
        throw new HttpError(
          403,
          "UPLOAD_TOKEN_INVALID",
          "Link upload đã hết hạn - mở lại mã QR trên máy tính."
        );
      }
    }

    ensureDir(dir);
    const safeName = sanitizeFileName(uploaded.originalname);
    const ext = path.extname(safeName).toLowerCase();
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      throw new HttpError(
        400,
        "FILE_TYPE_NOT_ALLOWED",
        `Không hỗ trợ định dạng "${ext || "(không có đuôi)"}" - chỉ nhận video, audio, ảnh, font, srt/vtt/txt/md/json.`
      );
    }
    let finalName = safeName;
    const base = path.basename(safeName, ext);

    const reserved = (name: string): boolean => scope === "project" && name === "assets.json";
    for (let n = 2; reserved(finalName) || fs.existsSync(path.join(dir, finalName)); n++) {
      finalName = `${base}-${n}${ext}`;
    }

    const destAbs = path.join(dir, finalName);
    moveFile(uploaded.path, destAbs);
    uploadTrackers.get(req)?.done(projectId, finalName);
    res.status(201).json(fileInfoOf(destAbs));
  } catch (err) {
    uploadTrackers.get(req)?.fail(projectId);
    if (uploaded?.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {

      }
    }
    throw err;
  }
});

export default router;
