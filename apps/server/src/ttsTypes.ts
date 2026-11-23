

export type TtsEngine = "gemini" | "vieneu" | "voicestudio";

export const TTS_ENGINES: TtsEngine[] = ["voicestudio", "gemini", "vieneu"];

export const DEFAULT_TTS_ENGINE: TtsEngine = "gemini";

export function isTtsEngine(v: unknown): v is TtsEngine {
  return v === "gemini" || v === "vieneu" || v === "voicestudio";
}

export type TtsGender = "nam" | "nu" | "trung-tinh";

export type TtsRegion = "bac" | "trung" | "nam";

export type TtsVoiceKind = "preset" | "cloned";

export interface TtsVoice {

  engine: TtsEngine;

  name: string;

  title: string;

  label: string;
  gender: TtsGender;

  f0: number;
  kind: TtsVoiceKind;

  region: TtsRegion | null;

  timbreKey: string | null;

  note: string;
}

export interface ClonedVoice {
  id: string;
  name: string;
  gender: TtsGender;
  note: string;

  refFile: string;

  refDurationSec: number;
  createdAt: string;
  updatedAt: string;
}

export const CLONE_REF_MIN_SEC = 3;
export const CLONE_REF_IDEAL_MAX_SEC = 8;
export const CLONE_REF_MAX_SEC = 30;

export const PREVIEW_TEXT: Record<"vi" | "en", string> = {

  vi: "Đây là hệ Edit video AI by noi ti chấm vn",
  en: "This is an AI video editing system by noti dot vn",
};

export function previewTextFor(lang: unknown): string {
  return lang === "en" ? PREVIEW_TEXT.en : PREVIEW_TEXT.vi;
}
