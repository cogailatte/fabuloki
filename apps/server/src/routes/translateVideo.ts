import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import {
  applyTempoToCue,
  autoAssignVoices,
  fitCue,
  gapAfter,
  synthDubCue,
  ttsLanguageFor,
  voiceForCue,
} from "../dub.js";
import { broadcast } from "../events.js";
import { geminiApiKey } from "../gemini.js";
import { cuesFromTranscript } from "../jobs/translateVideo.js";
import { queue } from "../queue.js";
import {
  getPrefs,
  prefBool,
  prefObject,
  prefString,
  rememberPrefs,
} from "../prefs.js";
import { probeVideo } from "../reframe.js";
import { STT_PROVIDERS, assertSttAvailable, isSttProvider, sttCapabilities } from "../stt.js";
import { translateCues } from "../translate.js";
import {
  SUBTITLE_FONTS,
  TRANSLATE_MODES,
  defaultBottomPx,
  defaultTranslateVideoMeta,
  dubDirOf,
  dubLangDiffers,
  effectiveDubLang,
  isDefaultBottomPx,
  isDubVoiceName,
  normCues,
  normDubSettings,
  normLang,
  normSubtitleStyle,
  patchTranslateVideo,
  readTranslateVideo,
  scanTranslateVideos,
  sourceAbsOf,
  transcriptPathOf,
  translateVideoDirOf,
  translateVideoExists,
  wantsDub,
  writeTranslateVideo,
  type TranslateMode,
  type TranslateVideoMeta,
  type TranslatedCue,
} from "../translateVideoMeta.js";
import { DEFAULT_TTS_VOICE, listVoices } from "../tts.js";
import { listLocalVoices, probeLocalEngine } from "../ttsLocal.js";
import type { TtsVoice } from "../ttsTypes.js";
import {
  HttpError,
  ensureDir,
  fileKind,
  isKebabCase,
  moveFile,
  toKebabAscii,
  toRepoRel,
} from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) =>
      cb(null, `tvd-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },

  defParamCharset: "utf8",
});

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

function mustRead(id: string): TranslateVideoMeta {
  if (!isKebabCase(id)) throw new HttpError(400, "INVALID_ID", "id không hợp lệ");
  if (!translateVideoExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên dịch "${id}"`);
  }
  return readTranslateVideo(id);
}

function uniqueId(name: string): string {
  const base = toKebabAscii(name) || "translate-video";
  let id = base;
  for (let n = 2; fs.existsSync(translateVideoDirOf(id)); n++) id = `${base}-${n}`;
  return id;
}

function assertNotBusy(meta: TranslateVideoMeta): void {
  if (db.hasActiveJobForProject(meta.id, "translate-video")) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên dịch "${meta.id}" đang có job chạy/chờ trong hàng đợi`,
    );
  }
  if (meta.status === "transcribing" || meta.status === "rendering" || meta.status === "translating") {
    throw new HttpError(409, "BUSY", `Phiên dịch "${meta.id}" đang ${meta.status}`);
  }
}

function mustSttProvider(raw: unknown): (typeof STT_PROVIDERS)[number] {
  if (!isSttProvider(raw)) {
    throw new HttpError(
      400,
      "INVALID_STT_PROVIDER",
      `sttProvider phải là một trong: ${STT_PROVIDERS.join(", ")}`,
    );
  }
  return raw;
}

function enqueueJob(sessionId: string, step: "transcribe" | "render"): db.JobApi {
  const job = db.createJob({
    id: `job_${nanoid()}`,

    projectId: sessionId,
    type: "translate-video",
    sceneId: step,
  });
  const api = db.jobToApi(job);
  broadcast("job", api);
  queue.enqueue(job.id);
  return api;
}

router.get("/fonts", (_req, res) => {
  res.json(SUBTITLE_FONTS);
});

router.get("/stt-providers", (_req, res) => {
  res.json(sttCapabilities());
});

router.get("/", (_req, res) => {
  res.json(scanTranslateVideos());
});

router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  let name = typeof body.name === "string" ? body.name.trim() : "";
  let autoNamed = false;
  if (!name) {
    name = "Video dịch";
    autoNamed = true;
  }

  const meta = defaultTranslateVideoMeta(uniqueId(name), name);
  meta.autoNamed = autoNamed;

  const pref = getPrefs("translate-video");
  meta.sourceLang = normLang(prefString(pref, "sourceLang"), meta.sourceLang);
  meta.targetLang = normLang(prefString(pref, "targetLang"), meta.targetLang);
  const prefDubLang = prefString(pref, "dubLang");
  meta.dubLang = prefDubLang ? normLang(prefDubLang, meta.targetLang) : null;
  if (TRANSLATE_MODES.includes(pref.mode as TranslateMode)) {
    meta.mode = pref.mode as TranslateMode;
  }
  if (isSttProvider(pref.sttProvider)) meta.sttProvider = pref.sttProvider;
  meta.subtitleStyle = normSubtitleStyle(prefObject(pref, "subtitleStyle"), meta.subtitleStyle);

  meta.dub = {
    ...normDubSettings(prefObject(pref, "dub"), meta.dub),
    voices: {},
  };

  if ("sourceLang" in body) meta.sourceLang = normLang(body.sourceLang, meta.sourceLang);
  if ("targetLang" in body) meta.targetLang = normLang(body.targetLang, meta.targetLang);
  if (TRANSLATE_MODES.includes(body.mode as TranslateMode)) meta.mode = body.mode as TranslateMode;
  if ("sttProvider" in body) meta.sttProvider = mustSttProvider(body.sttProvider);

  writeTranslateVideo(meta);
  res.status(201).json(readTranslateVideo(meta.id));
});

router.get("/:id", (req, res) => {
  res.json(mustRead(req.params.id));
});

router.patch("/:id", (req, res) => {
  const cur = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const touchesRun =
    "sourceLang" in body ||
    "targetLang" in body ||
    "dubLang" in body ||
    "mode" in body ||
    "sttProvider" in body ||
    "cues" in body ||
    "subtitleStyle" in body ||
    "dub" in body;
  if (touchesRun) assertNotBusy(cur);

  const patch: Partial<TranslateVideoMeta> = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, "INVALID_NAME", "name phải là string không rỗng");
    }
    patch.name = body.name.trim();

    patch.autoNamed = false;
  }

  if ("mode" in body) {
    if (!TRANSLATE_MODES.includes(body.mode as TranslateMode)) {
      throw new HttpError(
        400,
        "INVALID_MODE",
        `mode phải là một trong: ${TRANSLATE_MODES.join(", ")}`,
      );
    }
    patch.mode = body.mode as TranslateMode;
  }

  if ("sttProvider" in body) {
    patch.sttProvider = mustSttProvider(body.sttProvider);
  }

  if ("sourceLang" in body) {
    const next = normLang(body.sourceLang, cur.sourceLang);
    patch.sourceLang = next;
    if (next !== cur.sourceLang && cur.transcriptFile) {
      patch.transcriptFile = null;

      patch.transcriptInfo = null;
      patch.cues = [];
      patch.outputFile = null;
      patch.status = "draft";
      patch.error = null;
    }
  }

  if ("targetLang" in body) {
    const next = normLang(body.targetLang, cur.targetLang);
    patch.targetLang = next;
    if (next !== cur.targetLang && cur.cues.length > 0) {

      patch.cues = cur.cues.map(({ dubText: _drop, ...c }) => ({
        ...c,
        text: c.original ?? c.text,
      }));
      patch.outputFile = null;
      patch.status = cur.transcriptFile ? "transcribed" : "draft";
      patch.error = null;
    }
  }

  if ("dubLang" in body) {
    const raw = body.dubLang;
    const next =
      raw === null || raw === "" ? null : normLang(raw, cur.dubLang ?? cur.targetLang);
    patch.dubLang = next;
    const nextEffective = next ?? (patch.targetLang ?? cur.targetLang);
    if (nextEffective !== effectiveDubLang(cur) && cur.cues.length > 0) {
      const base = patch.cues ?? cur.cues;
      patch.cues = base.map(({ dubText: _drop, ...c }) => c);
      patch.outputFile = null;

      if (nextEffective !== (patch.targetLang ?? cur.targetLang)) {
        patch.status = cur.transcriptFile ? "transcribed" : "draft";
      }
      patch.error = null;
    }
  }

  if ("subtitleStyle" in body) {
    patch.subtitleStyle = normSubtitleStyle(body.subtitleStyle, cur.subtitleStyle);
  }

  if ("dub" in body) {
    patch.dub = normDubSettings(body.dub, cur.dub);

    patch.outputFile = null;
  }

  if ("cues" in body) {
    if (!Array.isArray(body.cues)) {
      throw new HttpError(400, "INVALID_CUES", "cues phải là mảng");
    }
    const cues = normCues(body.cues);
    if (cues.length === 0 && (body.cues as unknown[]).length > 0) {
      throw new HttpError(
        400,
        "INVALID_CUES",
        "Không cue nào hợp lệ - mỗi cue cần start < end (giây) và text không rỗng",
      );
    }
    patch.cues = cues;

    patch.outputFile = null;
  }

  if (patch.outputFile === null && (patch.status ?? cur.status) === "done") {
    const cues = patch.cues ?? cur.cues;
    const transcript = "transcriptFile" in patch ? patch.transcriptFile : cur.transcriptFile;
    patch.status = cues.length > 0 ? "translated" : transcript ? "transcribed" : "draft";
  }

  const saved = patchTranslateVideo(cur.id, patch);

  rememberPrefs("translate-video", {
    sourceLang: "sourceLang" in body ? saved.sourceLang : undefined,
    targetLang: "targetLang" in body ? saved.targetLang : undefined,
    dubLang: "dubLang" in body ? (saved.dubLang ?? "") : undefined,
    mode: "mode" in body ? saved.mode : undefined,
    sttProvider: "sttProvider" in body ? saved.sttProvider : undefined,
    subtitleStyle: "subtitleStyle" in body ? saved.subtitleStyle : undefined,

    dub: "dub" in body ? { ...saved.dub, voices: {} } : undefined,
  });

  res.json(saved);
});

router.delete("/:id", (req, res) => {
  const meta = mustRead(req.params.id);

  assertNotBusy(meta);
  fs.rmSync(translateVideoDirOf(meta.id), { recursive: true, force: true });

  fs.rmSync(path.join(paths.stagingDir, `tvd-${meta.id}`), { recursive: true, force: true });
  res.status(204).end();
});

router.post("/:id/source", upload.single("file"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

  try {

    const meta = mustRead(String(req.params.id));
    assertNotBusy(meta);

    const ext = path.extname(uploaded.originalname).toLowerCase();
    if (!VIDEO_EXT.has(ext)) {
      throw new HttpError(
        400,
        "INVALID_SOURCE",
        `"${uploaded.originalname}" không phải video (mp4/mov/webm/mkv/avi/m4v)`,
      );
    }

    const probe = await probeVideo(uploaded.path).catch((err: unknown) => {
      throw new HttpError(
        400,
        "PROBE_FAILED",
        `ffprobe không đọc được "${uploaded.originalname}" - file hỏng hoặc không phải video. ` +
          `Chi tiết: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    if (!(probe.durationSec > 0)) {
      throw new HttpError(400, "PROBE_FAILED", "ffprobe không đọc được thời lượng video");
    }

    const dir = translateVideoDirOf(meta.id);
    ensureDir(dir);

    for (const name of fs.readdirSync(dir)) {
      if (/^source\./i.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
    const destAbs = path.join(dir, `source${ext}`);
    moveFile(uploaded.path, destAbs);

    const patch: Partial<TranslateVideoMeta> = {
      source: {
        relPath: toRepoRel(destAbs),
        durationSec: Math.round(probe.durationSec * 100) / 100,
        width: probe.width,
        height: probe.height,
        fps: Math.round(probe.fps * 1000) / 1000,
      },

      transcriptFile: null,
      transcriptInfo: null,
      cues: [],
      dubInfo: null,
      outputFile: null,
      status: "draft",
      error: null,
    };

    if (isDefaultBottomPx(meta.subtitleStyle.bottomPx)) {
      patch.subtitleStyle = {
        ...meta.subtitleStyle,
        bottomPx: defaultBottomPx(probe.height >= probe.width),
      };
    }

    if (meta.autoNamed) {
      const stem = path.basename(uploaded.originalname, path.extname(uploaded.originalname)).trim();
      if (stem) {
        patch.name = stem.slice(0, 120);
        patch.autoNamed = false;
      }
    }

    fs.rmSync(transcriptPathOf(meta.id), { force: true });
    fs.rmSync(dubDirOf(meta.id), { recursive: true, force: true });

    res.json(patchTranslateVideo(meta.id, patch));
  } catch (err) {
    if (uploaded.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {

      }
    }
    throw err;
  }
});

router.post("/:id/transcribe", (req, res) => {
  const meta = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  sourceAbsOf(meta);
  assertNotBusy(meta);

  const provider = "sttProvider" in body ? mustSttProvider(body.sttProvider) : meta.sttProvider;
  assertSttAvailable(provider);

  if (provider !== meta.sttProvider) patchTranslateVideo(meta.id, { sttProvider: provider });

  res.status(202).json({ jobId: enqueueJob(meta.id, "transcribe").id });
});

router.post("/:id/translate", async (req, res) => {
  const meta = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  assertNotBusy(meta);

  const model =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;

  const input = sourceCuesOf(meta);
  if (input.length === 0) {
    throw new HttpError(
      400,
      "NO_TRANSCRIPT",
      "Chưa có lời gốc để dịch - chạy bước bóc lời trước.",
    );
  }

  patchTranslateVideo(meta.id, { status: "translating", error: null });
  try {
    const plain = input.map((c) => ({ start: c.start, end: c.end, text: c.text }));
    const twoLangs = wantsDub(meta.mode) && dubLangDiffers(meta);

    const result = await translateCues({
      cues: plain,
      sourceLang: meta.sourceLang,
      targetLang: meta.targetLang,
      mode: twoLangs || meta.mode === "subtitle" ? "subtitle" : "dub",
      model,
      usageTag: "translate-video",
      projectId: meta.id,
    });

    const cues = normCues(
      result.cues.map((c, i) => (input[i]?.speaker ? { ...c, speaker: input[i].speaker } : c)),
    );
    if (cues.length === 0) {
      throw new HttpError(
        502,
        "TRANSLATE_EMPTY",
        "AI không trả về câu dịch nào đọc được - thử lại, hoặc đổi model.",
      );
    }

    if (twoLangs) {
      const dubbed = normCues(
        (
          await translateCues({
            cues: plain,
            sourceLang: meta.sourceLang,
            targetLang: effectiveDubLang(meta),
            mode: "dub",
            model,
            usageTag: "translate-video",
            projectId: meta.id,
          })
        ).cues,
      );

      const byStart = new Map(dubbed.map((c) => [Math.round(c.start * 1000), c.text]));
      let matched = 0;
      for (const c of cues) {
        const hit = byStart.get(Math.round(c.start * 1000));
        if (hit) {
          c.dubText = hit;
          matched++;
        }
      }
      if (matched < cues.length) {

        console.warn(
          `[translate-video] ${meta.id}: ${cues.length - matched}/${cues.length} câu ` +
            `không khớp được bản dịch lồng tiếng theo mốc thời gian`,
        );
      }
    }
    res.json(
      patchTranslateVideo(meta.id, {
        cues,
        status: "translated",

        outputFile: null,
        error: null,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    patchTranslateVideo(meta.id, {
      status: meta.transcriptFile ? "transcribed" : "draft",
      error: message,
    });
    throw err;
  }
});

function sourceCuesOf(meta: TranslateVideoMeta): TranslatedCue[] {
  if (meta.transcriptFile) {
    const abs = path.join(repoRoot, meta.transcriptFile);
    const cues = cuesFromTranscript(abs);
    if (cues.length > 0) return cues;
  }
  return meta.cues.map((c) => ({ ...c, text: c.original ?? c.text }));
}

async function assertDubEngineReady(meta: TranslateVideoMeta): Promise<void> {
  if (meta.dub.engine === "gemini") {
    if (!geminiApiKey()) {
      throw new HttpError(
        503,
        "NO_GEMINI_KEY",
        "Chưa có GEMINI_API_KEY nên không lồng tiếng được. Thêm GEMINI_API_KEY vào .env " +
          '(lấy key tại aistudio.google.com/apikey), hoặc đổi engine lồng tiếng sang "vieneu" (chạy trên máy).',
      );
    }
    return;
  }
  const status = await probeLocalEngine();
  if (!status.available) {
    throw new HttpError(503, "LOCAL_TTS_UNAVAILABLE", status.detail);
  }
}

async function voiceCatalogOf(meta: TranslateVideoMeta): Promise<TtsVoice[]> {
  try {
    return meta.dub.engine === "vieneu" ? await listLocalVoices() : await listVoices();
  } catch {
    return [];
  }
}

router.post("/:id/dub-preview", async (req, res) => {
  const meta = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (meta.cues.length === 0) {
    throw new HttpError(400, "NO_CUES", "Chưa có câu nào để nghe thử - dịch trước đã.");
  }
  await assertDubEngineReady(meta);

  const rawIndex = typeof body.index === "number" ? Math.trunc(body.index) : 0;
  if (rawIndex < 0 || rawIndex >= meta.cues.length) {
    throw new HttpError(
      400,
      "INVALID_CUE_INDEX",
      `index phải trong khoảng 0..${meta.cues.length - 1}`,
    );
  }
  const cue = meta.cues[rawIndex];

  let voice = "";
  if ("voice" in body) {
    if (!isDubVoiceName(body.voice)) {
      throw new HttpError(400, "INVALID_VOICE", "voice không hợp lệ");
    }
    voice = (body.voice as string).trim();
  } else {
    const speakers = (meta.transcriptInfo?.diarized ? meta.transcriptInfo.speakers : []).filter(
      (s) => meta.cues.some((c) => (c.speaker ?? "") === s),
    );
    const assignments = autoAssignVoices(speakers, {
      engine: meta.dub.engine,
      voices: await voiceCatalogOf(meta),
      speakerF0: meta.dubInfo?.speakerF0 ?? {},
      locked: meta.dub.voices,
      defaultVoice: DEFAULT_TTS_VOICE,
    });
    voice = voiceForCue(assignments, cue.speaker).voice;
  }

  const language = meta.dub.language ?? ttsLanguageFor(effectiveDubLang(meta));
  const dubDir = dubDirOf(meta.id);
  const workDir = path.join(dubDir, "preview");
  const outAbs = path.join(dubDir, "preview.wav");
  ensureDir(dubDir);

  fs.rmSync(workDir, { recursive: true, force: true });

  try {
    const { naturalSec } = await synthDubCue({
      text: cue.dubText ?? cue.text,
      voice,
      engine: meta.dub.engine,
      model: meta.dub.model,
      language,
      workDir,
      outWavAbs: outAbs,
    });
    const durationSec = meta.source.durationSec ?? 0;
    const fit = fitCue(naturalSec, cue.end - cue.start, gapAfter(meta.cues, rawIndex, durationSec));
    const finalSec = await applyTempoToCue(outAbs, fit.tempo);
    const wav = fs.readFileSync(outAbs);

    res.setHeader("content-type", "audio/wav");
    res.setHeader("content-length", String(wav.length));

    res.setHeader("cache-control", "no-store");

    res.setHeader("x-dub-voice", encodeURIComponent(voice));
    res.setHeader("x-dub-natural", naturalSec.toFixed(2));
    res.setHeader("x-dub-final", finalSec.toFixed(2));
    res.setHeader("x-dub-source", (cue.end - cue.start).toFixed(2));
    res.setHeader("x-dub-tempo", fit.tempo.toFixed(3));
    res.setHeader("x-dub-clipped", fit.clipped ? "1" : "0");
    res.setHeader("x-dub-overflowed", fit.overflowed ? "1" : "0");
    res.send(wav);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

router.post("/:id/render", async (req, res) => {
  const meta = mustRead(req.params.id);
  sourceAbsOf(meta);
  assertNotBusy(meta);
  if (meta.cues.length === 0) {
    throw new HttpError(
      400,
      "NO_CUES",
      meta.mode === "dub"
        ? "Chưa có câu nào để lồng tiếng - chạy bước bóc lời và dịch trước."
        : "Chưa có câu phụ đề nào - chạy bước bóc lời và dịch trước.",
    );
  }
  if (fileKind(meta.source.relPath ?? "") !== "video") {
    throw new HttpError(400, "INVALID_SOURCE", "Nguồn của phiên không phải file video");
  }

  if (wantsDub(meta.mode) && dubLangDiffers(meta) && !meta.cues.some((c) => c.dubText)) {
    throw new HttpError(
      400,
      "NO_DUB_TRANSLATION",
      `Chưa có bản dịch tiếng "${effectiveDubLang(meta)}" để đọc - bấm Dịch lại ` +
        "để AI dịch thêm bản cho phần lồng tiếng.",
    );
  }
  if (wantsDub(meta.mode)) {
    await assertDubEngineReady(meta);

    assertNotBusy(mustRead(meta.id));
  }
  res.status(202).json({ jobId: enqueueJob(meta.id, "render").id });
});

export default router;
