import fs from "node:fs";
import path from "node:path";
import type { StyleDesign } from "./styles.js";
import { addTokenUsage } from "./db.js";
import type { ImageAspect, ImageKind, ImageTextPosition } from "./imageMeta.js";
import type { VideoStyle } from "./videoStyles.js";
import { ensureDir } from "./util.js";

export const IMAGE_MODELS = [
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2 (khuyên dùng) - gemini-3.1-flash-image" },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite (rẻ, nhanh) - gemini-3.1-flash-lite-image" },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro (cao cấp, 4K) - gemini-3-pro-image" },
] as const;

export const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";

function geminiEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
}

export function geminiApiKey(): string | null {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || null;
}

const KIND_PHRASES: Record<ImageKind, string> = {
  background: "clean background scene",
  "3d": "3D illustration render",
  character: "character illustration",
  texture: "liquid glass texture",
  product: "product concept shot",
  concept: "advertising concept",
};

const NEGATIVE_SPACE: Record<ImageAspect, string> = {
  "9:16":
    "Compose ONE unified scene filling the ENTIRE frame. Main subject in the upper two thirds; toward the lower third, gradually reduce detail and contrast (soft atmospheric falloff) so a headline can sit there - but atmosphere, lighting and background texture must continue through that area. Never leave an empty band, never split the image into zones.",
  "4:5":
    "Compose ONE unified scene filling the ENTIRE frame; gradually reduce detail toward the lower third with soft atmospheric falloff - background atmosphere must continue through it. No empty band, no split.",
  "16:9":
    "Compose ONE unified scene filling the ENTIRE frame. Main subject slightly RIGHT of center; visual elements, lighting and atmosphere must FLOW ACROSS the whole frame including the left side - on the left third only gradually reduce detail and contrast (soft falloff, darker, fewer elements) so a headline can sit there. STRICTLY FORBIDDEN: an empty left half, a hard vertical split, or two visually separate zones.",
  "1:1":
    "Compose ONE unified scene filling the ENTIRE frame; gradually reduce detail toward the center-bottom with soft falloff - atmosphere continues through it. No empty zones, no split.",
};

const NEGATIVE_SPACE_VIDEO: Record<ImageAspect, string> = {
  "9:16":
    "Compose ONE unified scene filling the ENTIRE frame. Main subject VERTICALLY CENTERED, contained within the middle 55% of the frame: the TOP ~15% and BOTTOM ~20% of the image will be covered by overlay cards and captions, so keep both of those bands as low-detail atmospheric continuation (soft falloff, fewer elements, lower contrast) - lighting, atmosphere and background texture must still flow through them. Never place the subject or any important detail near the top or bottom edge, never leave an empty band, never split the image into zones.",
  "16:9":
    "Compose ONE unified scene filling the ENTIRE frame. Main subject CENTERED, contained within the middle 60% of the frame height: the TOP ~12% and BOTTOM ~18% will be covered by overlay cards and captions, so keep those horizontal bands as low-detail atmospheric continuation (soft falloff, fewer elements, lower contrast) with lighting and texture flowing through. Never place important detail near the top or bottom edge, never leave an empty band, never split the image into zones.",
  "4:5":
    "Compose ONE unified scene filling the ENTIRE frame. Main subject vertically centered; keep the top and bottom ~15% as low-detail atmospheric continuation (soft falloff) for overlay text - atmosphere must flow through. No empty band, no split.",
  "1:1":
    "Compose ONE unified scene filling the ENTIRE frame. Main subject centered; keep the top and bottom edges low-detail with soft atmospheric falloff for overlay text - atmosphere continues through. No empty zones, no split.",
};

function videoSubjectGuidance(position: Exclude<ImageTextPosition, "auto">): string {
  const [vert, horiz] = position.split("-") as [
    "top" | "middle" | "bottom",
    "left" | "center" | "right",
  ];
  const vertPhrase =
    vert === "top" ? "upper third" : vert === "bottom" ? "lower third" : "vertical center";
  const horizPhrase =
    horiz === "left" ? "left side" : horiz === "right" ? "right side" : "horizontal center";
  const parts = [
    `Compose ONE unified scene filling the ENTIRE frame. Main subject placed in the ${vertPhrase} of the frame, toward the ${horizPhrase}.`,
    "The rest of the frame is continuous atmosphere with soft falloff (fewer elements, lower contrast) - lighting and background texture must flow across the whole frame.",
  ];

  if (vert !== "bottom") {
    parts.push("Keep the BOTTOM ~18% of the image low-detail - captions will overlay there.");
  }
  if (vert !== "top") {
    parts.push("Keep the TOP ~12% of the image low-detail - overlay cards may sit there.");
  }
  parts.push("Never leave an empty band, never split the image into zones.");
  return parts.join(" ");
}

export function buildImagePrompt(input: {
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  design: StyleDesign;

  allowText?: boolean;

  videoStyle?: VideoStyle | null;

  layout?: "poster" | "video";

  subjectPosition?: ImageTextPosition;
}): string {
  const { design } = input;
  const c = design.colors;
  const allowText = input.allowText === true;

  const wantsLogos = /\b(logo|icon|biểu tượng)\b/i.test(input.prompt);

  const parts: string[] = [

    allowText
      ? "Text in the image IS allowed and should reinforce the message: short Vietnamese phrase(s) (3–6 words max), spelled EXACTLY as provided in the prompt, large clean typography matching the brand style, correct Vietnamese diacritics, no lorem ipsum, no gibberish, no extra unrelated text."
      : "Create a BACKGROUND IMAGE ONLY - it must contain ZERO typography: no text, no words, no letters, no numbers, no captions, no headlines anywhere. The headline will be added later by a design tool.",
    `A ${KIND_PHRASES[input.kind]} for the brand "${design.name}".`,
  ];
  if (input.prompt.trim()) parts.push(input.prompt.trim());

  const loosePalette = input.videoStyle?.palette === "loose";
  parts.push(
    loosePalette
      ? `Brand colours appear only as accents where they fit naturally: primary ${c.primary}, secondary ${c.secondary}, accent ${c.accent}. The artistic style's own traditional palette leads.`
      : `Use the brand color palette: primary ${c.primary}, secondary ${c.secondary}, dark background ${c.background}, accent ${c.accent}.`,
  );
  if (!loosePalette) {
    parts.push(
      "STRICT BRAND COMPLIANCE: this style guide is mandatory - stay within the palette above (plus its neutral tints/shades); do not introduce a different color scheme even if the scene description implies one.",
    );
  }

  if (!input.videoStyle) {
    if (design.tone.trim()) parts.push(`Brand tone and mood: ${design.tone.trim()}.`);

    if (design.effects.liquidGlass) {
      parts.push(
        "Liquid glass aesthetic: translucent glassy 3D elements, soft refractions, subtle glow.",
      );
    }
    if (design.effects.gradient) {
      parts.push("Smooth color gradients blending the brand palette across lighting and surfaces.");
    }
  }

  if (input.videoStyle) {
    parts.push(input.videoStyle.art, `Avoid: ${input.videoStyle.avoid}.`);
  } else {
    parts.push("High quality, professional advertising background, cohesive lighting, cinematic depth.");
  }
  const subjectPos = input.subjectPosition ?? "auto";
  parts.push(
    input.layout === "video"
      ? subjectPos === "auto"
        ? NEGATIVE_SPACE_VIDEO[input.aspect]
        : videoSubjectGuidance(subjectPos)
      : NEGATIVE_SPACE[input.aspect],
  );

  const hasRealLogo = Boolean(design.logoPath);
  if (hasRealLogo) {
    parts.push(
      `Do NOT draw, invent, recreate or approximate any logo, wordmark, monogram, emblem or brand name for "${design.name}" anywhere in this image - not large, not small, not blurred, not on a wall, sign, plaque, screen, product, badge or reflection. Where a logo would naturally appear, render that surface as CLEAN AND COMPLETELY EMPTY (a blank wall, a blank plaque, a blank screen). The real logo is composited afterwards from an actual file by the design tool.`,
    );
  } else if (wantsLogos) {
    parts.push(
      "Decorative brand logos/icons requested above are allowed, but keep them small, fully inside the frame with generous margins, away from the reserved clean text area, and never cropped at the edges.",
    );
  } else {
    parts.push(
      "No logos, no icons, no UI elements, no buttons, no charts - pure scenic/abstract background.",
    );
  }
  parts.push("Nothing cropped or cut off at the edges.");
  if (!allowText) {

    parts.push(
      "FINAL RULE (most important): the image must contain absolutely NO text of any kind.",
    );
  }
  if (hasRealLogo) {

    parts.push(
      `FINAL RULE: absolutely no "${design.name}" logo, monogram or brand mark may be drawn - leave those surfaces blank.`,
    );
  }
  return parts.join(" ");
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export async function generateBackground(input: {
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  design: StyleDesign;

  outFile: string;

  usageProjectId?: string;

  model?: string;

  allowText?: boolean;

  videoStyle?: VideoStyle | null;

  layout?: "poster" | "video";

  subjectPosition?: ImageTextPosition;
}): Promise<{ file: string; promptUsed: string }> {
  const key = geminiApiKey();
  if (!key) {
    throw new Error(
      "Chưa có GEMINI_API_KEY. Thêm GEMINI_API_KEY vào .env - lấy tại aistudio.google.com/apikey; hoặc tự upload nền rồi chạy bước Hoàn thiện.",
    );
  }

  const model =
    input.model && /^[a-z0-9][a-z0-9.-]{2,80}$/i.test(input.model) && input.model.includes("image")
      ? input.model
      : DEFAULT_IMAGE_MODEL;
  const promptUsed = buildImagePrompt(input);
  const body = {
    contents: [{ parts: [{ text: promptUsed }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: input.aspect, imageSize: "1K" },
    },
  };

  let res: Response;
  try {
    res = await fetch(geminiEndpoint(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Không gọi được Gemini API (lỗi mạng): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const errBody = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`Gemini API trả lỗi ${res.status}: ${errBody || res.statusText}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const geminiParts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = geminiParts.find((p) => typeof p.inlineData?.data === "string" && p.inlineData.data);
  if (!imagePart?.inlineData?.data) {
    const text = geminiParts
      .map((p) => p.text)
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);
    throw new Error(
      `Gemini không trả về ảnh${text ? ` - phản hồi: ${text}` : ""}. Thử sửa prompt rồi chạy lại.`,
    );
  }

  ensureDir(path.dirname(input.outFile));
  fs.writeFileSync(input.outFile, Buffer.from(imagePart.inlineData.data, "base64"));

  try {
    const inTok = data.usageMetadata?.promptTokenCount ?? 0;
    const outTok = data.usageMetadata?.candidatesTokenCount ?? 0;
    if (inTok > 0 || outTok > 0) {
      addTokenUsage(
        `img_${input.usageProjectId ?? "unknown"}`,
        input.usageProjectId ?? null,
        inTok,
        outTok,
        (outTok * 60) / 1_000_000,
        "gemini",
      );
    }
  } catch {

  }

  return { file: input.outFile, promptUsed };
}
