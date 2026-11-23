import { z } from "zod";

export const posterAspectSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export type PosterAspect = z.infer<typeof posterAspectSchema>;

export const POSTER_DIMENSIONS: Record<PosterAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const posterStatSchema = z.looseObject({
  label: z.string().default(""),
  value: z.string().default(""),
});

export const posterColorsSchema = z.looseObject({
  primary: z.string().default("#3b82f6"),
  secondary: z.string().default("#1e293b"),
  background: z.string().default("#0b1220"),
  text: z.string().default("#f8fafc"),
  accent: z.string().default("#22d3ee"),
});

export const posterFontsSchema = z.looseObject({

  heading: z.string().default("Inter"),
  body: z.string().default("Inter"),
});

export const posterFontFilesSchema = z.looseObject({

  heading: z.string().nullable().default(null),
  body: z.string().nullable().default(null),
});

export const posterEffectsSchema = z.looseObject({
  gradient: z.boolean().default(true),
  liquidGlass: z.boolean().default(true),
});

export const posterDesignSchema = z.looseObject({
  colors: posterColorsSchema.prefault({}),
  fonts: posterFontsSchema.prefault({}),
  fontFiles: posterFontFilesSchema.prefault({}),
  effects: posterEffectsSchema.prefault({}),

  logoFile: z.string().nullable().default(null),
  brandName: z.string().default(""),
});

export const posterTextPositionSchema = z.enum([
  "auto",
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);
export type PosterTextPosition = z.infer<typeof posterTextPositionSchema>;

export const posterOverlaySchema = z.looseObject({
  title: z.string().default(""),
  subtitle: z.string().default(""),
  stats: z.array(posterStatSchema).default([]),
  cta: z.string().default(""),
  showLogo: z.boolean().default(true),
  position: posterTextPositionSchema.default("auto"),
});

export const posterSchema = z.looseObject({
  aspect: posterAspectSchema.default("1:1"),

  background: z.string().nullable().default(null),
  design: posterDesignSchema.prefault({}),
  overlay: posterOverlaySchema.prefault({}),
});

export type PosterStat = z.infer<typeof posterStatSchema>;
export type PosterFontFiles = z.infer<typeof posterFontFilesSchema>;
export type PosterDesign = z.infer<typeof posterDesignSchema>;
export type PosterOverlay = z.infer<typeof posterOverlaySchema>;
export type PosterProps = z.infer<typeof posterSchema>;
