import { z } from "zod";
import { posterDesignSchema } from "./posterManifest";

export const thumbnailAspectSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export type ThumbnailAspect = z.infer<typeof thumbnailAspectSchema>;

export const THUMBNAIL_DIMENSIONS: Record<
  ThumbnailAspect,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const thumbnailSchema = z.looseObject({
  aspect: thumbnailAspectSchema.default("9:16"),

  background: z.string().nullable().default(null),

  frame: z.string().nullable().default(null),

  title: z.string().default(""),

  design: posterDesignSchema.prefault({}),
});

export type ThumbnailDesign = z.infer<typeof posterDesignSchema>;
export type ThumbnailProps = z.infer<typeof thumbnailSchema>;
