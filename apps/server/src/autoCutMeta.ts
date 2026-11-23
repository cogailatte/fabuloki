import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { briefOf, defaultBrief, type Brief, type ProjectMeta } from "./meta.js";
import { HttpError, ensureDir, isKebabCase, nowIso } from "./util.js";

export type AutoCutMode = "time" | "ai" | "prompt";
export const AUTO_CUT_MODES: AutoCutMode[] = ["time", "ai", "prompt"];

export type AutoCutAspect = "keep" | "9:16" | "16:9" | "1:1" | "4:5";
export const AUTO_CUT_ASPECTS: AutoCutAspect[] = ["keep", "9:16", "16:9", "1:1", "4:5"];

export const ASPECT_SIZE: Record<Exclude<AutoCutAspect, "keep">, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export type AutoCutLayout = "auto" | "crop" | "fit";
export const AUTO_CUT_LAYOUTS: AutoCutLayout[] = ["auto", "crop", "fit"];

export type AutoCutBackground = "gemini" | "blur" | "style";
export const AUTO_CUT_BACKGROUNDS: AutoCutBackground[] = ["gemini", "blur", "style"];

export interface AutoCutSource {

  relPath: string;

  width: number;
  height: number;
  fps: number;
  durationSec: number;

  rotation: number;
}

export interface AutoCutOutput {
  aspect: AutoCutAspect;
  layout: AutoCutLayout;
  background: AutoCutBackground;

  styleId: string | null;

  fps: number | null;
}

export interface AutoCutParams {

  minutes?: number;

  overlapSec?: number;

  count?: number;

  minSec?: number;
  maxSec?: number;

  request?: string;
}

export interface AutoCutSegment {
  index: number;

  start: number;
  end: number;
  title: string;

  hook?: string;
  reason?: string;
  score?: number;

  selected: boolean;

  projectId?: string;

  appliedLayout?: Exclude<AutoCutLayout, "auto">;
}

export type AutoCutStatus =
  | "draft"
  | "planning"
  | "planned"
  | "cutting"
  | "done"
  | "failed";

export interface AutoCutMeta {
  id: string;
  name: string;
  status: AutoCutStatus;
  source: AutoCutSource;
  mode: AutoCutMode;
  params: AutoCutParams;
  output: AutoCutOutput;

  brief: Brief;

  transcribe: boolean;

  autoEdit: boolean;

  transcriptRel?: string | null;
  segments: AutoCutSegment[];

  error?: string | null;

  failedStep?: "plan" | "cut" | null;
  createdAt: string;
  updatedAt: string;
}

export function autoCutDirOf(id: string): string {
  return path.join(paths.autoCutDir, id);
}

export function autoCutMetaPathOf(id: string): string {
  return path.join(autoCutDirOf(id), "meta.json");
}

export function autoCutExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(autoCutMetaPathOf(id));
}

export function briefOfAutoCut(meta: AutoCutMeta): Brief {
  const raw = meta.brief as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultBrief();
  return briefOf({ brief: raw } as unknown as ProjectMeta);
}

export function readAutoCut(id: string): AutoCutMeta {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_AUTOCUT_ID", `Id phiên cắt không hợp lệ: ${id}`);
  }
  const file = autoCutMetaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "AUTOCUT_NOT_FOUND", `Không tìm thấy phiên cắt "${id}"`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AutoCutMeta;
  } catch {
    throw new HttpError(500, "AUTOCUT_META_INVALID", `meta.json của phiên cắt "${id}" hỏng`);
  }
}

export function writeAutoCut(meta: AutoCutMeta): void {
  meta.updatedAt = nowIso();
  ensureDir(autoCutDirOf(meta.id));
  fs.writeFileSync(
    autoCutMetaPathOf(meta.id),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8",
  );
}

export function patchAutoCut(id: string, patch: Partial<AutoCutMeta>): AutoCutMeta {
  const meta = readAutoCut(id);
  Object.assign(meta, patch);
  writeAutoCut(meta);
  return meta;
}

export function scanAutoCuts(): AutoCutMeta[] {
  if (!fs.existsSync(paths.autoCutDir)) return [];
  const out: AutoCutMeta[] = [];
  for (const entry of fs.readdirSync(paths.autoCutDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      out.push(
        JSON.parse(
          fs.readFileSync(autoCutMetaPathOf(entry.name), "utf8"),
        ) as AutoCutMeta,
      );
    } catch {

    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export function targetSizeOf(
  aspect: AutoCutAspect,
  source: { width: number; height: number },
): { width: number; height: number } {
  if (aspect === "keep") {

    return {
      width: Math.max(2, Math.round(source.width / 2) * 2),
      height: Math.max(2, Math.round(source.height / 2) * 2),
    };
  }
  return ASPECT_SIZE[aspect];
}

export function planByTime(
  durationSec: number,
  minutes: number,
  overlapSec: number,
): Array<{ start: number; end: number }> {
  const chunk = Math.max(1, minutes) * 60;
  const overlap = Math.max(0, Math.min(overlapSec, chunk - 1));
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < durationSec - 0.5) {
    const end = Math.min(start + chunk, durationSec);
    out.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
    if (end >= durationSec) break;
    start = end - overlap;
  }

  if (out.length >= 2) {
    const last = out[out.length - 1];
    if (last.end - last.start < chunk * 0.25) {
      out[out.length - 2].end = last.end;
      out.pop();
    }
  }
  return out;
}
