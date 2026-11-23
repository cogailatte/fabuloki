import path from "node:path";
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, geminiApiKey, generateBackground } from "../gemini.js";
import type { ImageAspect, ImageKind, ImageTextPosition } from "../imageMeta.js";
import type { StyleDesign } from "../styles.js";
import type { VideoStyle } from "../videoStyles.js";
import { HttpError, ensureDir } from "../util.js";
import { coverFit } from "./postprocess.js";

export type ImageProviderId = "gemini-api";
export type ImageProviderChoice = ImageProviderId | "auto";

export function isImageProviderChoice(value: unknown): value is ImageProviderChoice {
  return value === "gemini-api" || value === "auto";
}

export const ASPECT_SIZE: Record<ImageAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export function nearestAspect(width: number, height: number): ImageAspect {
  const ratio = width / height;
  const options: Array<[ImageAspect, number]> = [
    ["9:16", 9 / 16],
    ["4:5", 4 / 5],
    ["1:1", 1],
    ["16:9", 16 / 9],
  ];
  let best = options[0];
  for (const opt of options) {
    if (Math.abs(opt[1] - ratio) < Math.abs(best[1] - ratio)) best = opt;
  }
  return best[0];
}

export interface GenerateImageInput {
  prompt: string;
  kind: ImageKind;

  aspect?: ImageAspect;

  width?: number;
  height?: number;
  design: StyleDesign;

  outFile: string;

  provider?: string | null;

  model?: string | null;

  usageProjectId?: string;
  allowText?: boolean;
  videoStyle?: VideoStyle | null;
  layout?: "poster" | "video";
  subjectPosition?: ImageTextPosition;

  onLog?: (line: string) => void;

  isCanceled?: () => boolean;
}

export interface GenerateImageResult {
  file: string;
  promptUsed: string;
  provider: ImageProviderId;
}

export function listImageProviders() {
  return {
    default: "auto",
    providers: [{
      id: "gemini-api",
      label: "Gemini API",
      configured: geminiApiKey() !== null,
      models: IMAGE_MODELS.map(model => model.id),
    }],
  };
}

export function resolveProviders(provider?: string | null, model?: string | null) {
  const allowed = !provider || isImageProviderChoice(provider);
  const configured = allowed && geminiApiKey() !== null;
  const chain: ImageProviderId[] = configured ? ["gemini-api"] : [];
  return { chain, geminiModel: model && !isImageProviderChoice(model) ? model : undefined };
}

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const { chain, geminiModel } = resolveProviders(input.provider, input.model);
  if (!chain.length) throw new HttpError(503, "NO_IMAGE_PROVIDER", "Thêm khóa Gemini API ở mục Kết nối hoặc tải ảnh nền của bạn lên.");
  if (input.isCanceled?.()) throw new Error("Job đã bị hủy");
  const target = input.width && input.height
    ? { width: Math.round(input.width), height: Math.round(input.height) }
    : ASPECT_SIZE[input.aspect ?? "9:16"];
  const aspect = input.aspect ?? nearestAspect(target.width, target.height);
  ensureDir(path.dirname(input.outFile));
  input.onLog?.("[image] gemini-api " + target.width + "x" + target.height);
  const { promptUsed } = await generateBackground({ ...input, aspect, model: geminiModel ?? DEFAULT_IMAGE_MODEL });
  try {
    await coverFit(input.outFile, input.outFile, target.width, target.height);
  } catch (error) {
    input.onLog?.("[image] giữ ảnh gốc: " + (error instanceof Error ? error.message : String(error)));
  }
  return { file: input.outFile, promptUsed, provider: "gemini-api" };
}
