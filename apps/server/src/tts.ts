import { synthVoiceStudioWav } from "./voiceStudio.js";
import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { ffmpegSafeArgs, ffprobeSafeArgs } from "./ffmpegSafe.js";
import { geminiApiKey } from "./gemini.js";
import {
  TTS_CHUNK_MAX_CHARS,
  TTS_CHUNK_MIN_CHARS,
  TTS_CHUNK_SAFE_MIN_CHARS,
} from "./textToVideoMeta.js";
import { synthLocalChunkWav } from "./ttsLocal.js";
import type { TtsEngine, TtsGender, TtsVoice } from "./ttsTypes.js";
import { HttpError, ensureDir, execFileCaptureAll } from "./util.js";

export const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";

export interface TtsModel {
  id: string;
  label: string;
}

export type { TtsGender, TtsVoice } from "./ttsTypes.js";

export const TTS_LANGUAGES = [
  { code: "vi-VN", label: "Tiếng Việt (Việt Nam)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-IN", label: "English (India)" },
  { code: "ja-JP", label: "日本語 (Nhật)" },
  { code: "ko-KR", label: "한국어 (Hàn)" },
  { code: "cmn-CN", label: "中文 (Trung)" },
  { code: "th-TH", label: "ไทย (Thái)" },
  { code: "id-ID", label: "Bahasa Indonesia" },
  { code: "hi-IN", label: "हिन्दी (Ấn Độ)" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
  { code: "es-ES", label: "Español (España)" },
  { code: "es-US", label: "Español (US)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "it-IT", label: "Italiano" },
  { code: "nl-NL", label: "Nederlands" },
  { code: "pl-PL", label: "Polski" },
  { code: "ru-RU", label: "Русский" },
  { code: "tr-TR", label: "Türkçe" },
  { code: "ar-XA", label: "العربية" },
  { code: "fr-CA", label: "Français (Canada)" },
  { code: "bn-IN", label: "বাংলা" },
  { code: "gu-IN", label: "ગુજરાતી" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "mr-IN", label: "मराठी" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "te-IN", label: "తెలుగు" },
] as const;

export const DEFAULT_TTS_LANGUAGE = "vi-VN";

export const TTS_MODELS: TtsModel[] = [
  {
    id: "gemini-2.5-flash-preview-tts",
    label: "Flash TTS (khuyên dùng, rẻ nhất) - gemini-2.5-flash-preview-tts",
  },
  {
    id: "gemini-2.5-pro-preview-tts",
    label: "Pro TTS (đắt hơn 2,6 lần) - gemini-2.5-pro-preview-tts",
  },
  {
    id: "gemini-3.1-flash-tts-preview",
    label: "Flash TTS 3.1 (nhịp đọc đều hơn) - gemini-3.1-flash-tts-preview",
  },
];

const VOICE_CATALOG: Array<{
  name: string;
  style: string;
  gender: TtsGender;

  f0: number;
}> = [
  { name: "Zephyr", style: "trong trẻo, tươi sáng", gender: "nu", f0: 196 },
  { name: "Puck", style: "vui tươi, hào hứng", gender: "nam", f0: 115 },
  { name: "Charon", style: "truyền đạt, rành mạch", gender: "nam", f0: 126 },
  { name: "Kore", style: "chắc chắn, dứt khoát", gender: "nu", f0: 207 },
  { name: "Fenrir", style: "sôi nổi, dễ phấn khích", gender: "nam", f0: 128 },
  { name: "Leda", style: "trẻ trung", gender: "nu", f0: 206 },
  { name: "Orus", style: "chắc chắn, quả quyết", gender: "nam", f0: 130 },
  { name: "Aoede", style: "nhẹ nhàng, thoáng", gender: "nu", f0: 180 },
  { name: "Callirrhoe", style: "thư thái, dễ chịu", gender: "nu", f0: 203 },
  { name: "Autonoe", style: "tươi sáng", gender: "nu", f0: 183 },
  { name: "Enceladus", style: "nhiều hơi thở, thủ thỉ", gender: "nam", f0: 114 },
  { name: "Iapetus", style: "rõ ràng, sáng tiếng", gender: "nam", f0: 137 },
  { name: "Umbriel", style: "thư thái", gender: "nam", f0: 131 },
  { name: "Algieba", style: "mượt mà", gender: "nam", f0: 109 },
  { name: "Despina", style: "mượt mà, êm", gender: "nu", f0: 222 },
  { name: "Erinome", style: "rõ ràng", gender: "nu", f0: 214 },
  { name: "Algenib", style: "khàn, sạn", gender: "nam", f0: 126 },
  { name: "Rasalgethi", style: "truyền đạt, học thuật", gender: "nam", f0: 141 },
  { name: "Laomedeia", style: "hào hứng", gender: "nu", f0: 182 },
  { name: "Achernar", style: "dịu, nhỏ nhẹ", gender: "nu", f0: 219 },
  { name: "Alnilam", style: "chắc, đanh", gender: "nam", f0: 117 },
  { name: "Schedar", style: "đều đều, điềm tĩnh", gender: "nam", f0: 136 },
  { name: "Gacrux", style: "trầm, từng trải", gender: "nu", f0: 152 },
  { name: "Pulcherrima", style: "chủ động, đẩy tới", gender: "trung-tinh", f0: 131 },
  { name: "Achird", style: "thân thiện", gender: "nam", f0: 142 },
  { name: "Zubenelgenubi", style: "tự nhiên, đời thường", gender: "nam", f0: 141 },
  { name: "Vindemiatrix", style: "hiền hòa, êm ái", gender: "nu", f0: 191 },
  { name: "Sadachbia", style: "sống động", gender: "nam", f0: 125 },
  { name: "Sadaltager", style: "am hiểu, chững chạc", gender: "nam", f0: 125 },
  { name: "Sulafat", style: "ấm áp", gender: "nu", f0: 231 },
];

export const DEFAULT_TTS_VOICE = "Kore";

export const TTS_GAP_SEC = 0.25;

const OUT_SAMPLE_RATE = 48_000;

const MAX_ATTEMPTS = 4;

const SHORT_TEXT_ATTEMPTS = 7;

const RETRY_DELAY_MS = [1_500, 4_000, 9_000];

const EMPTY_RETRY_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function missingKeyError(): HttpError {
  return new HttpError(
    503,
    "NO_GEMINI_KEY",
    "Chưa có GEMINI_API_KEY nên không tổng hợp được giọng đọc. Thêm GEMINI_API_KEY vào file .env ở gốc repo (lấy key tại aistudio.google.com/apikey) rồi khởi động lại server.",
  );
}

let modelsCache: { at: number; list: TtsModel[] } | null = null;
const LIST_CACHE_MS = 60 * 60 * 1000;

export async function listTtsModels(): Promise<TtsModel[]> {
  const key = geminiApiKey();
  if (!key) return TTS_MODELS;
  if (modelsCache && Date.now() - modelsCache.at < LIST_CACHE_MS) return modelsCache.list;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": key },
    });
    if (!r.ok) return TTS_MODELS;
    const data = (await r.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const labels = new Map(TTS_MODELS.map((m) => [m.id, m.label]));
    const seen = new Set<string>();
    const list: TtsModel[] = [];
    for (const m of data.models ?? []) {
      const id = (m.name ?? "").replace(/^models\//, "");
      if (!id || seen.has(id) || !id.includes("tts")) continue;
      const methods = m.supportedGenerationMethods ?? [];
      if (methods.length > 0 && !methods.includes("generateContent")) continue;
      seen.add(id);
      list.push({ id, label: labels.get(id) ?? id });
    }
    if (list.length === 0) return TTS_MODELS;

    list.sort((a, b) => {
      if (a.id === DEFAULT_TTS_MODEL) return -1;
      if (b.id === DEFAULT_TTS_MODEL) return 1;
      return a.id.localeCompare(b.id);
    });
    modelsCache = { at: Date.now(), list };
    return list;
  } catch {
    return TTS_MODELS;
  }
}

let voicesCache: { at: number; list: TtsVoice[] } | null = null;

async function probeVoiceNames(key: string): Promise<string[]> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_TTS_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "x" }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "__PROBE__" } } },
        },
      }),
    },
  );
  const data = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  const msg = data?.error?.message ?? "";
  const listPart = msg.match(/Allowed voice names are:\s*(.+)$/i)?.[1] ?? "";
  return listPart
    .split(",")
    .map((s) => s.trim().replace(/[.\s]+$/, ""))
    .filter((s) => /^[a-z][a-z0-9-]{1,40}$/i.test(s));
}

export async function listVoices(): Promise<TtsVoice[]> {
  const labeled = (name: string, style?: string, gender?: TtsGender, f0?: number): TtsVoice => ({
    engine: "gemini",
    name,

    title: name,
    label: style ? `${name} - ${style}` : name,

    gender: gender ?? "trung-tinh",
    f0: f0 ?? 0,
    kind: "preset",

    region: null,

    timbreKey: style ? name.toLowerCase() : null,
    note: "",
  });
  const key = geminiApiKey();
  if (!key) return VOICE_CATALOG.map((v) => labeled(v.name, v.style, v.gender, v.f0));
  if (voicesCache && Date.now() - voicesCache.at < LIST_CACHE_MS) return voicesCache.list;

  let allowed: string[] = [];
  try {
    allowed = await probeVoiceNames(key);
  } catch {

  }
  if (allowed.length === 0) return VOICE_CATALOG.map((v) => labeled(v.name, v.style, v.gender, v.f0));

  const allowedLc = new Set(allowed.map((s) => s.toLowerCase()));
  const inCatalog = new Set(VOICE_CATALOG.map((v) => v.name.toLowerCase()));
  const list: TtsVoice[] = [];
  for (const v of VOICE_CATALOG) {
    if (allowedLc.has(v.name.toLowerCase())) list.push(labeled(v.name, v.style, v.gender, v.f0));
  }
  for (const name of allowed) {
    if (inCatalog.has(name.toLowerCase())) continue;

    list.push(labeled(name.charAt(0).toUpperCase() + name.slice(1)));
  }
  voicesCache = { at: Date.now(), list };
  return list;
}

function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  const re = /([.!?…]+["'”’)\]]?)\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    const end = m.index + m[1].length;
    const before = paragraph.slice(Math.max(0, m.index - 2), m.index);

    if (/(^|\s)[A-Za-zÀ-ỹ0-9]$/.test(before) && m[1].length === 1 && m[1] === ".") continue;
    const piece = paragraph.slice(last, end).trim();
    if (piece) out.push(piece);
    last = re.lastIndex;
  }
  const tail = paragraph.slice(last).trim();
  if (tail) out.push(tail);
  return out;
}

function hardSplit(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let buf = "";

  const parts = sentence.split(/(?<=[,;:])\s+/);
  const flush = (): void => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const part of parts) {
    if (part.length > max) {
      flush();

      let line = "";
      for (const word of part.split(/\s+/)) {

        const words =
          word.length > max ? (word.match(new RegExp(`.{1,${max}}`, "g")) ?? [word]) : [word];
        for (const w of words) {
          if (line && `${line} ${w}`.length > max) {
            out.push(line);
            line = w;
          } else {
            line = line ? `${line} ${w}` : w;
          }
        }
      }
      if (line) out.push(line);
      continue;
    }
    if (buf && `${buf} ${part}`.length > max) flush();
    buf = buf ? `${buf} ${part}` : part;
  }
  flush();
  return out;
}

export function chunkForTts(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const units: Array<{ text: string; paraEnd: boolean }> = [];
  for (const para of paragraphs) {
    const sentences = splitSentences(para).flatMap((s) => hardSplit(s, TTS_CHUNK_MAX_CHARS));
    sentences.forEach((s, i) => units.push({ text: s, paraEnd: i === sentences.length - 1 }));
  }

  const chunks: string[] = [];
  let buf = "";
  for (const u of units) {
    const merged = buf ? `${buf} ${u.text}` : u.text;
    if (merged.length > TTS_CHUNK_MAX_CHARS && buf) {
      chunks.push(buf);
      buf = u.text;
    } else {
      buf = merged;
    }

    if (buf.length >= TTS_CHUNK_MIN_CHARS && u.paraEnd) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);

  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (
      last.length < TTS_CHUNK_SAFE_MIN_CHARS &&
      `${prev} ${last}`.length <= TTS_CHUNK_MAX_CHARS + TTS_CHUNK_SAFE_MIN_CHARS
    ) {
      chunks.splice(chunks.length - 2, 2, `${prev} ${last}`);
    }
  }
  return chunks.filter((c) => c.trim().length > 0);
}

interface TtsResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function parsePcmMime(mime: string): { sampleRate: number; channels: number } {
  const rate = Number(mime.match(/rate=(\d+)/i)?.[1] ?? 0);
  const ch = Number(mime.match(/channels=(\d+)/i)?.[1] ?? 0);
  return {
    sampleRate: Number.isFinite(rate) && rate > 0 ? rate : 24_000,
    channels: Number.isFinite(ch) && ch > 0 ? ch : 1,
  };
}

function withStyle(text: string, style?: string): string {
  const s = (style ?? "").trim().replace(/[:：]\s*$/, "");
  return s ? `${s}: ${text}` : text;
}

function resolveModel(model?: string | null): string {
  return model && /^[a-z0-9][a-z0-9.-]{2,80}$/i.test(model) && model.includes("tts")
    ? model
    : DEFAULT_TTS_MODEL;
}

interface RawAudio {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  model: string;
}

async function callTtsOnce(input: {
  text: string;
  voice: string;

  language?: string;
  model: string;
  timeoutMs: number;
  isCanceled?: () => boolean;
}): Promise<{
  audio: RawAudio | null;
  note: string;
  retryable: boolean;

  kind: "ok" | "empty" | "http";
}> {
  const key = geminiApiKey();
  if (!key) throw missingKeyError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const cancelTimer = input.isCanceled
    ? setInterval(() => {
        if (input.isCanceled?.()) controller.abort();
      }, 1_000)
    : null;
  cancelTimer?.unref?.();

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } },

              ...(input.language ? { languageCode: input.language } : {}),
            },
          },
        }),
      },
    );
  } catch (err) {
    if (input.isCanceled?.()) throw new Error("Job đã bị hủy");
    const msg = err instanceof Error ? err.message : String(err);

    return { audio: null, note: `lỗi mạng: ${msg}`, retryable: true, kind: "http" };
  } finally {
    clearTimeout(timer);
    if (cancelTimer) clearInterval(cancelTimer);
  }

  if (!res.ok) {
    const raw = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
    let message = raw;
    try {
      message = (JSON.parse(raw) as TtsResponse).error?.message ?? raw;
    } catch {

    }
    if (res.status === 429 || res.status >= 500) {
      return { audio: null, note: `Gemini ${res.status}: ${message}`, retryable: true, kind: "http" };
    }
    if (res.status === 400 && /voice/i.test(message)) {
      throw new HttpError(
        400,
        "INVALID_VOICE",
        `Giọng "${input.voice}" không hợp lệ với model ${input.model}. Chọn lại giọng trong danh sách. Chi tiết: ${message}`,
      );
    }
    if (res.status === 403 || res.status === 401) {
      throw new HttpError(
        502,
        "GEMINI_AUTH",
        `GEMINI_API_KEY bị từ chối (${res.status}). Kiểm tra lại key trong .env - tạo key mới tại aistudio.google.com/apikey. Chi tiết: ${message}`,
      );
    }
    if (res.status === 404) {
      throw new HttpError(
        400,
        "TTS_MODEL_NOT_FOUND",
        `Model "${input.model}" không tồn tại hoặc không đọc được chữ. Chọn lại model TTS. Chi tiết: ${message}`,
      );
    }
    throw new HttpError(
      502,
      "GEMINI_TTS_FAILED",
      `Gemini TTS trả lỗi ${res.status}: ${message || res.statusText}`,
    );
  }

  const data = (await res.json().catch(() => null)) as TtsResponse | null;
  const cand = data?.candidates?.[0];
  const part = (cand?.content?.parts ?? []).find((p) => typeof p.inlineData?.data === "string");
  const b64 = part?.inlineData?.data;
  if (!b64) {

    const why =
      data?.promptFeedback?.blockReason ??
      cand?.finishReason ??
      (data ? "không rõ" : "phản hồi không phải JSON");
    return { audio: null, note: `không có audio (finishReason=${why})`, retryable: true, kind: "empty" };
  }

  const mime = part?.inlineData?.mimeType ?? "";
  if (mime && !/l16|pcm|linear/i.test(mime)) {
    throw new HttpError(
      502,
      "GEMINI_TTS_FORMAT",
      `Gemini trả định dạng audio lạ (${mime}) - code này chỉ xử lý PCM 16-bit. Báo lỗi để cập nhật server.`,
    );
  }
  const { sampleRate, channels } = parsePcmMime(mime);
  return {
    audio: { pcm: Buffer.from(b64, "base64"), sampleRate, channels, model: input.model },
    note: "",
    retryable: false,
    kind: "ok",
  };
}

function pcmSeconds(bytes: number, sampleRate: number, channels: number): number {
  return bytes / (sampleRate * channels * 2);
}

async function synthRaw(input: {
  text: string;
  voice: string;

  language?: string;
  model?: string | null;
  style?: string;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}): Promise<RawAudio> {
  const text = withStyle(input.text.trim(), input.style);
  if (!text) throw new HttpError(400, "TTS_EMPTY_TEXT", "Không có chữ nào để đọc");
  const model = resolveModel(input.model);
  const voice = (input.voice || DEFAULT_TTS_VOICE).trim();

  const timeoutMs = Math.min(300_000, 60_000 + text.length * 200);

  const sane = text.length / 14.9;
  const maxSec = sane * 3 + 20;

  const maxAttempts =
    text.length < TTS_CHUNK_SAFE_MIN_CHARS * 2 ? SHORT_TEXT_ATTEMPTS : MAX_ATTEMPTS;

  let lastNote = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.isCanceled?.()) throw new Error("Job đã bị hủy");
    const { audio, note, retryable, kind } = await callTtsOnce({
      text,
      voice,
      model,
      language: input.language,
      timeoutMs,
      isCanceled: input.isCanceled,
    });

    const backoff = kind === "http";
    if (audio) {
      const sec = pcmSeconds(audio.pcm.length, audio.sampleRate, audio.channels);
      if (sec < 0.3) {
        lastNote = `audio quá ngắn (${sec.toFixed(2)}s)`;
      } else if (sec > maxSec) {
        lastNote = `audio dài bất thường ${sec.toFixed(1)}s (hợp lý ~${sane.toFixed(1)}s) - nghi model lặp vô tận`;
      } else {
        if (attempt > 1) input.onLog?.(`[tts] lần ${attempt} đã có tiếng (${sec.toFixed(2)}s)`);
        return audio;
      }
    } else {
      lastNote = note;
      if (!retryable) break;
    }
    if (attempt < maxAttempts) {
      const wait = backoff
        ? RETRY_DELAY_MS[Math.min(attempt - 1, RETRY_DELAY_MS.length - 1)]
        : EMPTY_RETRY_DELAY_MS;
      input.onLog?.(`[tts] ${lastNote} - thử lại lần ${attempt + 1}/${maxAttempts} sau ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new HttpError(
    502,
    "GEMINI_TTS_NO_AUDIO",
    `Gemini không trả về giọng đọc sau ${maxAttempts} lần thử (${lastNote}). ` +
      (text.length < TTS_CHUNK_SAFE_MIN_CHARS * 2
        ? "Câu quá ngắn hay bị model bỏ qua - viết dài thêm vài chữ rồi thử lại."
        : "Thử rút ngắn đoạn hoặc đổi giọng/model rồi chạy lại."),
  );
}

export function pcmToWavBuffer(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * 2;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function synthChunk(input: {
  text: string;
  voice: string;

  language?: string;
  model?: string | null;
  style?: string;
  outPcmAbs: string;
  onLog?: (line: string) => void;
}): Promise<{ pcmAbs: string; bytes: number }> {
  const audio = await synthRaw(input);
  ensureDir(path.dirname(input.outPcmAbs));
  fs.writeFileSync(input.outPcmAbs, audio.pcm);
  return { pcmAbs: input.outPcmAbs, bytes: audio.pcm.length };
}

export async function applySpeedToWav(wav: Buffer, speed: number): Promise<Buffer> {
  if (Math.abs(speed - 1) < 0.001) return wav;
  ensureDir(paths.uploadTmpDir);
  const stem = path.join(paths.uploadTmpDir, `tts-speed-${process.pid}-${Date.now()}`);
  const srcAbs = `${stem}.in.wav`;
  const dstAbs = `${stem}.out.wav`;
  try {
    fs.writeFileSync(srcAbs, wav);
    await runFfmpeg(
      [
        "-i",
        srcAbs,
        "-filter:a",
        `atempo=${speed.toFixed(3)}`,
        "-ar",
        String(OUT_SAMPLE_RATE),
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        dstAbs,
      ],
      { timeoutMs: 60_000 },
    );
    return fs.readFileSync(dstAbs);
  } finally {
    fs.rmSync(srcAbs, { force: true });
    fs.rmSync(dstAbs, { force: true });
  }
}

export async function synthPreviewWav(input: {
  text: string;
  voice: string;

  language?: string;
  model?: string | null;
  style?: string;
}): Promise<{ wav: Buffer; durationSec: number; model: string }> {
  const audio = await synthRaw(input);
  return {
    wav: pcmToWavBuffer(audio.pcm, audio.sampleRate, audio.channels),
    durationSec: pcmSeconds(audio.pcm.length, audio.sampleRate, audio.channels),
    model: audio.model,
  };
}

const TRIM_FILTER =
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05," +
  "areverse," +
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05," +
  "areverse";

async function runFfmpeg(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; isCanceled?: () => boolean },
): Promise<void> {
  let r: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    r = await execFileCaptureAll("ffmpeg", ffmpegSafeArgs(["-hide_banner", "-nostats", "-y", ...args]), {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 120_000,
      isCanceled: opts.isCanceled,
    });
  } catch (err) {
    throw new HttpError(
      503,
      "NO_FFMPEG",
      `Không chạy được ffmpeg - cài FFmpeg và thêm vào PATH. Chi tiết: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (r.canceled) throw new Error("Job đã bị hủy");
  if (r.timedOut) throw new Error("ffmpeg chạy quá lâu khi ghép giọng đọc - đã hủy");
  if (r.code !== 0) {
    const tail = r.stderr.split(/\r?\n/).slice(-12).join("\n");
    throw new Error(`ffmpeg thất bại khi ghép giọng đọc (mã ${r.code}):\n${tail}`);
  }
}

const VOICE_DRIFT_TOLERANCE = 0.18;

const VOICE_DRIFT_TOLERANCE_CATALOG = 0.22;
const VOICE_DRIFT_RETRIES = 2;

export function medianF0OfWav(absFile: string): number {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(absFile);
  } catch {
    return 0;
  }

  let pos = 12;
  let dataOff = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "data") {
      dataOff = pos + 8;
      dataLen = Math.min(size, buf.length - dataOff);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (dataOff < 0 || dataLen < 4096) return 0;
  const sampleRate = buf.length > 28 ? buf.readUInt32LE(24) : 48_000;
  const n = Math.floor(dataLen / 2);
  const at = (i: number): number => buf.readInt16LE(dataOff + i * 2);

  const win = Math.floor(sampleRate * 0.04);
  const lagLo = Math.floor(sampleRate / 320);
  const lagHi = Math.floor(sampleRate / 70);
  if (win <= lagHi) return 0;

  const found: number[] = [];
  for (let start = 0; start + win < n; start += win) {

    let energy = 0;
    for (let i = 0; i < win; i += 4) energy += Math.abs(at(start + i));
    if (energy / (win / 4) < 500) continue;

    let bestLag = 0;
    let bestVal = 0;
    for (let lag = lagLo; lag < lagHi; lag++) {
      let sum = 0;

      for (let i = 0; i + lag < win; i += 4) sum += at(start + i) * at(start + i + lag);
      if (sum > bestVal) {
        bestVal = sum;
        bestLag = lag;
      }
    }
    if (bestLag > 0) found.push(sampleRate / bestLag);
  }
  if (found.length === 0) return 0;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}

async function probeSeconds(
  absFile: string,
  isCanceled?: () => boolean,
): Promise<number> {
  const r = await execFileCaptureAll(
    "ffprobe",
    ffprobeSafeArgs(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absFile]),
    { timeoutMs: 20_000, isCanceled },
  );
  if (r.canceled) throw new Error("Job đã bị hủy");
  const sec = parseFloat(r.stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new HttpError(
      503,
      "NO_FFPROBE",
      `Không đo được thời lượng file ${path.basename(absFile)} bằng ffprobe - cài FFmpeg và thêm vào PATH.`,
    );
  }
  return sec;
}

export async function synthScript(input: {
  chunks: string[];
  voice: string;

  engine?: TtsEngine;

  speed?: number;

  language?: string;
  model?: string | null;
  style?: string;
  workDir: string;
  outWavAbs: string;
  onProgress?: (done: number, total: number) => void;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}): Promise<{ wavAbs: string; durationSec: number; chunkDurations: number[] }> {
  const chunks = input.chunks.map((c) => c.trim()).filter(Boolean);
  if (chunks.length === 0) {
    throw new HttpError(400, "TTS_EMPTY_SCRIPT", "Kịch bản rỗng - chưa có gì để đọc");
  }
  ensureDir(input.workDir);
  ensureDir(path.dirname(input.outWavAbs));
  const total = chunks.length;
  const partNames: string[] = [];
  const chunkDurations: number[] = [];

  const renderChunk = async (i: number): Promise<void> => {
    if (input.isCanceled?.()) throw new Error("Job đã bị hủy");
    const idx = String(i + 1).padStart(3, "0");
    const pcmAbs = path.join(input.workDir, `chunk-${idx}.pcm`);
    const wavName = `part-${idx}.wav`;
    const wavAbs = path.join(input.workDir, wavName);

    if (input.engine === "vieneu" || input.engine === "voicestudio") {

      const rawWavAbs = path.join(input.workDir, `raw-${idx}.wav`);
      if (input.engine === "voicestudio") {
        const wav = await synthVoiceStudioWav({text: chunks[i], voice: input.voice, language: input.language, style: input.style});
        fs.writeFileSync(rawWavAbs, wav);
      } else await synthLocalChunkWav({
        text: chunks[i],
        voice: input.voice,
        outWavAbs: rawWavAbs,
        onLog: input.onLog,
        isCanceled: input.isCanceled,
      });
      await runFfmpeg(
        [
          "-i",
          rawWavAbs,
          "-af",
          TRIM_FILTER,
          "-ar",
          String(OUT_SAMPLE_RATE),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wavAbs,
        ],
        { timeoutMs: 120_000, isCanceled: input.isCanceled },
      );
      fs.rmSync(rawWavAbs, { force: true });
    } else {
      const audio = await synthRaw({
        text: chunks[i],
        voice: input.voice,
        model: input.model,
        style: input.style,
        language: input.language,
        onLog: input.onLog,
        isCanceled: input.isCanceled,
      });
      fs.writeFileSync(pcmAbs, audio.pcm);

      await runFfmpeg(
        [
          "-f",
          "s16le",
          "-ar",
          String(audio.sampleRate),
          "-ac",
          String(audio.channels),
          "-i",
          pcmAbs,
          "-af",
          TRIM_FILTER,
          "-ar",
          String(OUT_SAMPLE_RATE),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wavAbs,
        ],
        { timeoutMs: 120_000, isCanceled: input.isCanceled },
      );
    }
    partNames[i] = wavName;
    chunkDurations[i] = await probeSeconds(wavAbs, input.isCanceled);
    fs.rmSync(pcmAbs, { force: true });
  };

  for (let i = 0; i < total; i++) {
    input.onLog?.(`[tts] đoạn ${i + 1}/${total} (${chunks[i].length} ký tự)`);
    await renderChunk(i);
    input.onProgress?.(i + 1, total);
  }

  if (total >= 2) {
    const f0s = partNames.map((n) => medianF0OfWav(path.join(input.workDir, n)));
    const usable = f0s.filter((v) => v > 0).sort((a, b) => a - b);
    const m = usable.length >= 2 ? usable[Math.floor(usable.length / 2)] : 0;
    const uniform =
      m > 0 &&
      f0s.every((v) => v <= 0 || Math.abs(v - m) / m <= VOICE_DRIFT_TOLERANCE);
    let ref = 0;
    let tol = VOICE_DRIFT_TOLERANCE;
    if (m > 0 && !uniform) {
      const catalogF0 =
        input.engine !== "gemini" && input.engine !== undefined
          ? 0
          : VOICE_CATALOG.find(
              (v) => v.name.toLowerCase() === input.voice.toLowerCase(),
            )?.f0 ?? 0;
      if (catalogF0 > 0) {
        ref = catalogF0;

        tol = VOICE_DRIFT_TOLERANCE_CATALOG;
        input.onLog?.(
          `[tts] các đoạn lệch giọng nhau - chuẩn giọng "${input.voice}" ${ref.toFixed(0)} Hz (catalog)`,
        );
      } else if (usable.length >= 3) {
        ref = m;
        input.onLog?.(
          `[tts] các đoạn lệch giọng nhau - chuẩn giọng "${input.voice}" ${ref.toFixed(0)} Hz (trung vị lần chạy)`,
        );
      }
    }
    if (ref > 0) {
      const off = (v: number): number => (v > 0 ? Math.abs(v - ref) / ref : 0);
      for (let i = 0; i < total; i++) {
        if (off(f0s[i]) <= tol) continue;
        input.onLog?.(
          `[tts] đoạn ${i + 1} lệch giọng (F0 ${f0s[i].toFixed(0)} Hz so với chuẩn ${ref.toFixed(0)} Hz) - đọc lại`,
        );
        let best = f0s[i];
        const keepAbs = path.join(input.workDir, `keep-${i}.wav`);
        fs.copyFileSync(path.join(input.workDir, partNames[i]), keepAbs);
        for (let attempt = 1; attempt <= VOICE_DRIFT_RETRIES; attempt++) {
          await renderChunk(i);
          const got = medianF0OfWav(path.join(input.workDir, partNames[i]));
          if (off(got) < off(best)) {
            best = got;
            fs.copyFileSync(path.join(input.workDir, partNames[i]), keepAbs);
          }
          if (off(got) <= tol) break;
        }

        fs.copyFileSync(keepAbs, path.join(input.workDir, partNames[i]));
        fs.rmSync(keepAbs, { force: true });
        chunkDurations[i] = await probeSeconds(
          path.join(input.workDir, partNames[i]),
          input.isCanceled,
        );
        if (off(best) > tol) {
          input.onLog?.(
            `[tts] đoạn ${i + 1} vẫn lệch sau ${VOICE_DRIFT_RETRIES} lần - giữ bản gần nhất (F0 ${best.toFixed(0)} Hz)`,
          );
        }
      }
    }
  }

  if (partNames.length === 1) {
    fs.copyFileSync(path.join(input.workDir, partNames[0]), input.outWavAbs);
  } else {

    const gapName = "gap.wav";
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=${OUT_SAMPLE_RATE}:cl=mono`,
        "-t",
        String(TTS_GAP_SEC),
        "-c:a",
        "pcm_s16le",
        path.join(input.workDir, gapName),
      ],
      { timeoutMs: 30_000, isCanceled: input.isCanceled },
    );

    const listName = "concat.txt";
    const lines: string[] = [];
    partNames.forEach((n, i) => {
      if (i > 0) lines.push(`file '${gapName}'`);
      lines.push(`file '${n}'`);
    });
    fs.writeFileSync(path.join(input.workDir, listName), lines.join("\n") + "\n", "utf8");
    await runFfmpeg(
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listName,
        "-ar",
        String(OUT_SAMPLE_RATE),
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        input.outWavAbs,
      ],
      { cwd: input.workDir, timeoutMs: 300_000, isCanceled: input.isCanceled },
    );
  }

  const speed = input.speed ?? 1;
  if (Math.abs(speed - 1) > 0.001) {
    const spedAbs = path.join(input.workDir, "speed.wav");
    await runFfmpeg(
      [
        "-i",
        input.outWavAbs,

        "-filter:a",
        `atempo=${speed.toFixed(3)}`,
        "-ar",
        String(OUT_SAMPLE_RATE),
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        spedAbs,
      ],
      { timeoutMs: 300_000, isCanceled: input.isCanceled },
    );
    fs.rmSync(input.outWavAbs, { force: true });
    fs.renameSync(spedAbs, input.outWavAbs);

    for (let i = 0; i < chunkDurations.length; i++) chunkDurations[i] /= speed;
    input.onLog?.(`[tts] tăng tốc đọc x${speed}`);
  }

  const durationSec = await probeSeconds(input.outWavAbs, input.isCanceled);

  for (const n of partNames) fs.rmSync(path.join(input.workDir, n), { force: true });
  fs.rmSync(path.join(input.workDir, "gap.wav"), { force: true });
  fs.rmSync(path.join(input.workDir, "concat.txt"), { force: true });

  input.onLog?.(`[tts] xong ${total} đoạn - giọng đọc dài ${durationSec.toFixed(2)}s (đo bằng ffprobe)`);
  return { wavAbs: input.outWavAbs, durationSec, chunkDurations };
}
