import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeDurationSec } from "./transcribe.js";
import type { TtsVoice } from "./ttsTypes.js";

const origin = "http://127.0.0.1:3900";

async function request(route: string, init?: RequestInit, timeout = 5000) {
  let response: Response;
  try {
    response = await fetch(origin + route, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new Error("Không kết nối được VoiceStudio. Hãy mở VoiceStudio trên máy này (cổng 3900).");
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 700);
    throw new Error("VoiceStudio trả lỗi " + response.status + ": " + detail);
  }
  return response;
}

export async function listVoiceStudioVoices(): Promise<TtsVoice[]> {
  const response = await request("/v1/audio/voices");
  const data = await response.json() as {voices?: Array<{voice_id: string; name: string; type: string}>};
  return (data.voices ?? []).filter(voice => voice.type === "profile").map(voice => ({
    engine: "voicestudio",
    name: voice.voice_id,
    title: voice.name,
    label: voice.name,
    gender: "trung-tinh",
    f0: 0,
    kind: "cloned",
    region: null,
    timbreKey: null,
    note: "Giọng đã lưu trong VoiceStudio",
  }));
}

export async function voiceStudioStatus() {
  try {
    await request("/health");
    return {engine: "voicestudio", available: true, canClone: false, reason: null, detail: "Dùng giọng đã lưu trong VoiceStudio trên máy này."};
  } catch (error) {
    return {engine: "voicestudio", available: false, canClone: false, reason: "VOICESTUDIO_OFFLINE", detail: error instanceof Error ? error.message : String(error)};
  }
}

export async function synthVoiceStudioWav(input: {text: string; voice: string; language?: string; style?: string}): Promise<Buffer> {
  const voices = await listVoiceStudioVoices();
  if (!voices.some(voice => voice.name === input.voice)) {
    throw new Error("Giọng đã chọn không còn trong VoiceStudio. Mở lại bộ chọn giọng để chọn lại.");
  }
  const response = await request("/v1/audio/speech", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model: "tts-1", input: input.text, voice: input.voice, response_format: "wav",
      language: input.language?.split("-")[0] || "vi",
      ...(input.style ? {instructions: input.style} : {}),
    }),
  }, 10 * 60 * 1000);
  const wav = Buffer.from(await response.arrayBuffer());
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("VoiceStudio không trả về WAV hợp lệ.");
  }
  return wav;
}

export async function previewVoiceStudio(input: {text: string; voice: string; language?: string; style?: string}) {
  const wav = await synthVoiceStudioWav(input);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabuloki-voicestudio-"));
  try {
    const file = path.join(dir, "preview.wav");
    await fs.writeFile(file, wav);
    return {wav, durationSec: await probeDurationSec(file), model: "voicestudio-active"};
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
}
