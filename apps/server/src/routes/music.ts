import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { paths } from "../config.js";
import {
  HttpError,
  ensureDir,
  ffprobeDurationMs,
  fileKind,
  moveFile,
  sanitizeFileName,
} from "../util.js";

const router = Router();

export interface MusicEntry {
  file: string;

  tags: string[];
  durationMs: number | null;
  description: string;
}

const libraryPath = () => path.join(paths.musicDir, "library.json");

export function readMusicLibrary(): MusicEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryPath(), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        file: typeof e.file === "string" ? e.file : "",
        tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
        durationMs: typeof e.durationMs === "number" ? e.durationMs : null,
        description: typeof e.description === "string" ? e.description : "",
      }))
      .filter((e) => e.file);
  } catch {
    return [];
  }
}

function writeMusicLibrary(entries: MusicEntry[]): void {
  ensureDir(paths.musicDir);
  fs.writeFileSync(libraryPath(), JSON.stringify(entries, null, 2) + "\n", "utf8");
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) => cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },

  defParamCharset: "utf8",
});

router.get("/", (_req, res) => {
  const entries = readMusicLibrary().filter((e) =>
    fs.existsSync(path.join(paths.musicDir, e.file)),
  );
  res.json(entries);
});

router.post("/", upload.single("file"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file audio (field `file`)");

  try {
    const safeName = sanitizeFileName(uploaded.originalname);
    if (fileKind(safeName) !== "audio") {
      throw new HttpError(400, "INVALID_AUDIO", "File phải là audio (mp3/wav/ogg/m4a/aac/flac)");
    }

    ensureDir(paths.musicDir);
    let finalName = safeName;
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    for (let n = 2; fs.existsSync(path.join(paths.musicDir, finalName)); n++) {
      finalName = `${base}-${n}${ext}`;
    }

    const destAbs = path.join(paths.musicDir, finalName);
    moveFile(uploaded.path, destAbs);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const tags =
      typeof body.tags === "string"
        ? body.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    const description = typeof body.description === "string" ? body.description : "";
    const durationMs = await ffprobeDurationMs(destAbs);

    const entry: MusicEntry = { file: finalName, tags, durationMs, description };
    const entries = readMusicLibrary().filter((e) => e.file !== finalName);
    entries.push(entry);
    writeMusicLibrary(entries);

    res.status(201).json(entry);
  } catch (err) {

    if (uploaded?.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {

      }
    }
    throw err;
  }
});

router.patch("/:file", (req, res) => {
  const file = path.basename(req.params.file);
  const entries = readMusicLibrary();
  const entry = entries.find((e) => e.file === file);
  if (!entry) throw new HttpError(404, "MUSIC_NOT_FOUND", `Không tìm thấy bài nhạc "${file}"`);

  const body = (req.body ?? {}) as Record<string, unknown>;

  if ("description" in body) {
    if (typeof body.description !== "string") {
      throw new HttpError(400, "INVALID_DESCRIPTION", "description phải là string");
    }
    entry.description = body.description;
  }

  if ("tags" in body) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string")) {
      throw new HttpError(400, "INVALID_TAGS", "tags phải là mảng string");
    }

    entry.tags = (body.tags as string[]).map((t) => t.trim()).filter(Boolean);
  }

  entry.tags = [...new Set(entry.tags)];
  writeMusicLibrary(entries);
  res.json(entry);
});

router.delete("/:file", (req, res) => {
  const file = path.basename(req.params.file);

  if (fileKind(file) !== "audio") {
    throw new HttpError(404, "MUSIC_NOT_FOUND", `Không tìm thấy bài nhạc "${file}"`);
  }
  const abs = path.join(paths.musicDir, file);
  const entries = readMusicLibrary();
  const exists = entries.some((e) => e.file === file) || fs.existsSync(abs);
  if (!exists) throw new HttpError(404, "MUSIC_NOT_FOUND", `Không tìm thấy bài nhạc "${file}"`);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  writeMusicLibrary(entries.filter((e) => e.file !== file));
  res.status(204).end();
});

export default router;
