import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { HttpError, ensureDir, isKebabCase, nowIso, toKebabAscii } from "./util.js";

export const IMAGE_KINDS = [
  "background",
  "3d",
  "character",
  "texture",
  "product",
  "concept",
] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const IMAGE_ASPECTS = ["9:16", "16:9", "1:1", "4:5"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

export type ImageStatus = "draft" | "generating" | "done" | "error";

export const IMAGE_GEN_STEPS = ["all", "background", "compose"] as const;
export type ImageGenStep = (typeof IMAGE_GEN_STEPS)[number];

export interface ImageStat {
  label: string;
  value: string;
}

export const IMAGE_TEXT_POSITIONS = [
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
] as const;

export type ImageTextPosition = (typeof IMAGE_TEXT_POSITIONS)[number];

export interface ImageOverlay {
  title: string;
  subtitle: string;
  stats: ImageStat[];
  cta: string;
  showLogo: boolean;

  position: ImageTextPosition;
}

export interface ImageProject {
  id: string;
  name: string;
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  status: ImageStatus;

  model: string | null;

  styleId: string | null;
  overlay: ImageOverlay;

  background: string | null;

  final: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function imageDirOf(id: string): string {
  return path.join(paths.imageProjectsDir, id);
}

export function imageMetaPathOf(id: string): string {
  return path.join(imageDirOf(id), "meta.json");
}

export function imageProjectExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(imageMetaPathOf(id));
}

export function defaultOverlay(): ImageOverlay {
  return { title: "", subtitle: "", stats: [], cta: "", showLogo: true, position: "auto" };
}

export function normOverlay(raw: unknown, base: ImageOverlay = defaultOverlay()): ImageOverlay {
  const out: ImageOverlay = { ...base, stats: [...base.stats] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.title === "string") out.title = o.title;
  if (typeof o.subtitle === "string") out.subtitle = o.subtitle;
  if (typeof o.cta === "string") out.cta = o.cta;
  if (typeof o.showLogo === "boolean") out.showLogo = o.showLogo;

  if (IMAGE_TEXT_POSITIONS.includes(o.position as ImageTextPosition)) {
    out.position = o.position as ImageTextPosition;
  }
  if (Array.isArray(o.stats)) {
    out.stats = o.stats
      .filter(
        (s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s),
      )
      .map((s) => ({
        label: typeof s.label === "string" ? s.label : "",
        value: typeof s.value === "string" ? s.value : String(s.value ?? ""),
      }));
  }
  return out;
}

function plainFileName(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  if (v !== path.basename(v) || /[\\/:\0]/.test(v) || v.startsWith(".")) return null;
  return v;
}

function normStatus(s: unknown): ImageStatus {
  return s === "generating" || s === "done" || s === "error" ? s : "draft";
}

function normImageMeta(id: string, raw: unknown, mtimeIso: string): ImageProject {
  const m = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    id,
    name: typeof m.name === "string" && m.name ? m.name : id,
    prompt: typeof m.prompt === "string" ? m.prompt : "",
    kind: IMAGE_KINDS.includes(m.kind as ImageKind) ? (m.kind as ImageKind) : "background",
    aspect: IMAGE_ASPECTS.includes(m.aspect as ImageAspect) ? (m.aspect as ImageAspect) : "9:16",
    status: normStatus(m.status),
    model: typeof m.model === "string" && m.model ? m.model : null,
    styleId: typeof m.styleId === "string" && m.styleId ? m.styleId : null,
    overlay: normOverlay(m.overlay),
    background: plainFileName(m.background),
    final: plainFileName(m.final),
    error: typeof m.error === "string" && m.error ? m.error : null,
    createdAt: typeof m.createdAt === "string" && m.createdAt ? m.createdAt : mtimeIso,
    updatedAt: typeof m.updatedAt === "string" && m.updatedAt ? m.updatedAt : mtimeIso,
  };
}

export function readImageMeta(id: string): ImageProject {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_IMAGE_ID", `Image project id không hợp lệ: ${id}`);
  }
  const file = imageMetaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "IMAGE_NOT_FOUND", `Không tìm thấy image project "${id}"`);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return normImageMeta(id, raw, fs.statSync(file).mtime.toISOString());
  } catch {
    throw new HttpError(
      500,
      "META_INVALID",
      `meta.json của image project "${id}" không phải JSON hợp lệ`,
    );
  }
}

export function writeImageMeta(id: string, meta: ImageProject): void {
  meta.updatedAt = nowIso();
  ensureDir(imageDirOf(id));
  fs.writeFileSync(imageMetaPathOf(id), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

export function newImageProjectId(name: string): string {
  const base = toKebabAscii(name) || "image";
  let id = base;
  for (let n = 2; fs.existsSync(imageDirOf(id)); n++) id = `${base}-${n}`;
  return id;
}

export function scanImageProjects(): ImageProject[] {
  if (!fs.existsSync(paths.imageProjectsDir)) return [];
  const out: ImageProject[] = [];
  for (const entry of fs.readdirSync(paths.imageProjectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = imageMetaPathOf(entry.name);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      out.push(normImageMeta(entry.name, raw, fs.statSync(file).mtime.toISOString()));
    } catch {

    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}
