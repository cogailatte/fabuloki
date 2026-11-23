import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { paths } from "../config.js";
import { probeLocalEngine, synthLocalPreviewWav } from "../ttsLocal.js";
import { previewTextFor } from "../ttsTypes.js";
import {
  createClonedVoice,
  getClonedVoice,
  listClonedVoices,
  patchClonedVoice,
  removeClonedVoice,
} from "../voiceStore.js";
import { HttpError, ensureDir, fileKind, isKebabCase } from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) => cb(null, `voice-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),

  limits: { fileSize: 200 * 1024 * 1024 },
});

function safeId(raw: string): string {
  const id = path.basename(String(raw ?? "").trim());
  if (!id || !isKebabCase(id)) {
    throw new HttpError(400, "INVALID_VOICE_ID", `id giọng không hợp lệ: "${String(raw).slice(0, 40)}"`);
  }
  return id;
}

function rmQuiet(file: string | undefined): void {
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {

  }
}

router.get("/", (_req, res) => {
  res.json(listClonedVoices());
});

router.post("/", upload.single("file"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) {
    throw new HttpError(400, "FILE_REQUIRED", "Thiếu file mẫu giọng (field `file`)");
  }
  try {

    const status = await probeLocalEngine();
    if (!status.canClone) {
      throw new HttpError(503, status.reason ?? "NO_VIENEU", status.detail);
    }

    const kind = fileKind(uploaded.originalname);
    if (kind !== "audio" && kind !== "video") {
      throw new HttpError(
        400,
        "INVALID_AUDIO",
        "File mẫu phải là audio (mp3/wav/ogg/m4a/aac/flac) hoặc video có tiếng nói",
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const entry = await createClonedVoice({
      name: body.name,
      gender: body.gender,
      note: body.note,
      srcAbs: uploaded.path,
    });
    res.status(201).json(entry);
  } finally {

    rmQuiet(uploaded.path);
  }
});

router.patch("/:id", (req, res) => {
  const id = safeId(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: { name?: unknown; gender?: unknown; note?: unknown } = {};
  if ("name" in body) patch.name = body.name;
  if ("gender" in body) patch.gender = body.gender;
  if ("note" in body) patch.note = body.note;
  res.json(patchClonedVoice(id, patch));
});

router.delete("/:id", (req, res) => {
  const id = safeId(req.params.id);
  removeClonedVoice(id);
  res.json({ id });
});

router.post("/:id/preview", async (req, res) => {
  const id = safeId(req.params.id);
  const voice = getClonedVoice(id);
  if (!voice) {
    throw new HttpError(404, "VOICE_NOT_FOUND", `Không tìm thấy giọng nhân bản "${id}"`);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;

  const text = previewTextFor(body.uiLang);

  const { wav, durationSec, model } = await synthLocalPreviewWav({ text, voice: id });

  res.setHeader("content-type", "audio/wav");
  res.setHeader("content-length", String(wav.length));

  res.setHeader("cache-control", "no-store");
  res.setHeader("x-tts-model", model);
  res.setHeader("x-tts-duration", durationSec.toFixed(2));
  res.send(wav);
});

export default router;
