import { voiceStudioStatus, listVoiceStudioVoices, previewVoiceStudio, synthVoiceStudioWav } from "../voiceStudio.js";
import { Router } from "express";
import { geminiApiKey } from "../gemini.js";
import {
  applySpeedToWav,
  DEFAULT_TTS_VOICE,
  listTtsModels,
  listVoices,
  synthPreviewWav,
  TTS_LANGUAGES,
} from "../tts.js";
import { listLocalVoices, probeLocalEngine, synthLocalPreviewWav } from "../ttsLocal.js";
import { normTtsSpeed } from "../textToVideoMeta.js";
import {
  isTtsEngine,
  previewTextFor,
  TTS_ENGINES,
  type TtsEngine,
  type TtsVoice,
} from "../ttsTypes.js";
import { HttpError } from "../util.js";

export { PREVIEW_TEXT } from "../ttsTypes.js";

const PREVIEW_MAX_CHARS = 300;

const PREVIEW_MIN_GAP_MS = 2_000;
const PREVIEW_WINDOW_MS = 10 * 60 * 1000;
const PREVIEW_MAX_PER_WINDOW = 30;
let previewLastAt = 0;
let previewHits: number[] = [];

function checkPreviewRate(): void {
  const now = Date.now();
  if (now - previewLastAt < PREVIEW_MIN_GAP_MS) {
    throw new HttpError(
      429,
      "PREVIEW_TOO_FAST",
      "Bấm chậm lại một chút - mỗi lần đọc thử cách nhau ít nhất 2 giây.",
    );
  }
  previewHits = previewHits.filter((t) => now - t < PREVIEW_WINDOW_MS);
  if (previewHits.length >= PREVIEW_MAX_PER_WINDOW) {
    throw new HttpError(
      429,
      "PREVIEW_QUOTA",
      `Đã đọc thử ${PREVIEW_MAX_PER_WINDOW} lần trong 10 phút - mỗi lần đọc thử đều tốn tiền API. Chờ vài phút rồi thử lại.`,
    );
  }
  previewLastAt = now;
  previewHits.push(now);
}

const router = Router();

router.get("/models", async (_req, res) => {
  res.json(await listTtsModels());
});

router.get("/engines", async (req, res) => {
  const local = await probeLocalEngine(req.query.refresh === "1");
  const hasKey = Boolean(geminiApiKey());
  const studio = await voiceStudioStatus();
  res.json(
    TTS_ENGINES.map((engine) =>
      engine === "voicestudio" ? studio : engine === "gemini"
        ? {
            engine,
            available: hasKey,

            canClone: false,
            reason: hasKey ? null : "NO_GEMINI_KEY",
            detail: hasKey ? "GEMINI_API_KEY đã có trong .env" : "",
          }
        : {
            engine,
            available: local.available,
            canClone: local.canClone,
            reason: local.reason,
            detail: local.detail,
          },
    ),
  );
});

router.get("/voices", async (req, res) => {
  const want = req.query.engine;
  if (want !== undefined && !isTtsEngine(want)) {
    throw new HttpError(
      400,
      "INVALID_ENGINE",
      `Engine không hợp lệ: "${String(want).slice(0, 40)}". Chỉ nhận ${TTS_ENGINES.join(", ")}.`,
    );
  }
  const engine = want as TtsEngine | undefined;

  const jobs: Array<Promise<TtsVoice[]>> = [];
  if (!engine || engine === "gemini") {
    jobs.push(listVoices().catch(() => [] as TtsVoice[]));
  }
  if (!engine || engine === "vieneu") {
    jobs.push(listLocalVoices().catch(() => [] as TtsVoice[]));
  }
  if (!engine || engine === "voicestudio") jobs.push(listVoiceStudioVoices().catch(() => []));
  const lists = await Promise.all(jobs);
  res.json(lists.flat());
});

router.get("/languages", (_req, res) => {
  res.json(TTS_LANGUAGES.map((l) => ({ ...l })));
});

router.post("/voicestudio/speech", async (req, res) => {
  const body = req.body ?? {};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" ? body.voice.trim() : "";
  if (!text || text.length > 4096) {
    throw new HttpError(400, "INVALID_SPEECH_TEXT", "Nhập nội dung từ 1 đến 4096 ký tự.");
  }
  if (!voice || voice.length > 80 || /[\\/\r\n\0]/.test(voice)) {
    throw new HttpError(400, "INVALID_VOICE", "Hãy chọn một giọng VoiceStudio.");
  }
  if (body.speed !== undefined && (typeof body.speed !== "number" || !Number.isFinite(body.speed) || body.speed < .5 || body.speed > 2)) {
    throw new HttpError(400, "INVALID_SPEED", "Tốc độ cần nằm trong khoảng 0.5–2.");
  }
  const generated = await synthVoiceStudioWav({text, voice, language: "vi"});
  const wav = await applySpeedToWav(generated, normTtsSpeed(body.speed));
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", String(wav.length));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'attachment; filename="voicestudio.wav"');
  res.send(wav);
});

router.post("/preview", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const engine: TtsEngine = isTtsEngine(body.engine) ? body.engine : "gemini";
  const voice = typeof body.voice === "string" ? body.voice.trim() : "";
  if (!voice) {
    throw new HttpError(400, "VOICE_REQUIRED", "Thiếu tên giọng cần nghe thử (voice)");
  }

  if (engine === "gemini") {
    if (!/^[a-z][a-z0-9-]{1,40}$/i.test(voice)) {
      throw new HttpError(400, "INVALID_VOICE", `Tên giọng không hợp lệ: "${voice.slice(0, 40)}"`);
    }
  } else if (voice.length > 80 || /[\\/\r\n\0]/.test(voice)) {
    throw new HttpError(400, "INVALID_VOICE", `Tên giọng không hợp lệ: "${voice.slice(0, 40)}"`);
  }
  if ("model" in body && body.model !== null && body.model !== undefined && typeof body.model !== "string") {
    throw new HttpError(400, "INVALID_MODEL", "model phải là string hoặc null");
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const style = typeof body.style === "string" ? body.style.trim() : "";
  const language =
    typeof body.language === "string" && body.language.trim() ? body.language.trim() : undefined;
  if (style.length > PREVIEW_MAX_CHARS) {
    throw new HttpError(
      400,
      "STYLE_TOO_LONG",
      `Chỉ dẫn cách đọc dài quá ${PREVIEW_MAX_CHARS} ký tự`,
    );
  }

  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (raw.length > PREVIEW_MAX_CHARS) {
    throw new HttpError(
      400,
      "PREVIEW_TEXT_TOO_LONG",
      `Câu đọc thử tối đa ${PREVIEW_MAX_CHARS} ký tự (đang ${raw.length}). Đọc thử chỉ để nghe chất giọng - cả bài thì chạy bước tổng hợp giọng đọc.`,
    );
  }
  const text = raw || previewTextFor(body.uiLang);

  if (engine === "gemini") checkPreviewRate();

  const synth =
    engine === "voicestudio"
      ? await previewVoiceStudio({text, voice, language, style})
      : engine === "vieneu"
      ? await synthLocalPreviewWav({ text, voice })
      : await synthPreviewWav({
          text,
          voice: voice || DEFAULT_TTS_VOICE,
          model,
          style,
          language,
        });

  const speed = normTtsSpeed(body.speed);
  const wav = await applySpeedToWav(synth.wav, speed);
  const durationSec = synth.durationSec / speed;
  const modelUsed = synth.model;

  res.setHeader("content-type", "audio/wav");
  res.setHeader("content-length", String(wav.length));

  res.setHeader("cache-control", "no-store");

  res.setHeader("x-tts-model", modelUsed);
  res.setHeader("x-tts-duration", durationSec.toFixed(2));
  res.send(wav);
});

export default router;
