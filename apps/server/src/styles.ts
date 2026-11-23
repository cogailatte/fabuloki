import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { ensureDir, nowIso } from "./util.js";

export interface StyleDesign {
  id: string;
  name: string;
  tags: string[];
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    accent: string;
  };
  fonts: { heading: string; body: string };

  fontFiles: { heading: string | null; body: string | null };

  effects: { gradient: boolean; liquidGlass: boolean };

  logoPath: string | null;
  tone: string;
  guidelines: string;
  createdAt: string;
  updatedAt: string;
}

export interface StylesFile {
  defaultId: string | null;
  styles: StyleDesign[];
}

export const COLOR_KEYS = ["primary", "secondary", "background", "text", "accent"] as const;
export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function normHexColor(hex: string): string {
  const v = hex.toLowerCase();
  if (v.length === 4) {
    return "#" + v.slice(1).split("").map((ch) => ch + ch).join("");
  }
  return v;
}

const stylesFilePath = () => path.join(paths.stylesDir, "styles.json");
const legacyFilePath = () => path.join(paths.brandDir, "design-system.json");

export function defaultStyle(): StyleDesign {
  const now = nowIso();
  return {
    id: "default",
    name: "Mặc định",
    tags: [],
    colors: {
      primary: "#ed3c47",
      secondary: "#ff7849",
      background: "#101113",
      text: "#ffffff",
      accent: "#37bdf8",
    },
    fonts: { heading: "Inter", body: "Inter" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "",
    guidelines: "",
    createdAt: now,
    updatedAt: now,
  };
}

export const LOGO_EXTS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp"]);
export const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

export function isStyleFileRel(rel: string, exts: ReadonlySet<string>): boolean {
  if (!/^assets\/[A-Za-z0-9._\/-]+$/.test(rel)) return false;
  if (rel.split("/").some((seg) => !seg || seg.startsWith("."))) return false;
  return exts.has(path.posix.extname(rel).toLowerCase());
}

export function normStyleTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)),
  ];
}

function normStyle(raw: unknown): StyleDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id.trim()) return null;
  const base = defaultStyle();
  base.id = s.id.trim();
  base.name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : base.id;
  base.tags = normStyleTags(s.tags);
  if (s.colors && typeof s.colors === "object" && !Array.isArray(s.colors)) {
    const c = s.colors as Record<string, unknown>;
    for (const key of COLOR_KEYS) {
      if (typeof c[key] === "string" && HEX_RE.test(c[key] as string)) {
        base.colors[key] = normHexColor(c[key] as string);
      }
    }
  }
  if (s.fonts && typeof s.fonts === "object" && !Array.isArray(s.fonts)) {
    const f = s.fonts as Record<string, unknown>;
    if (typeof f.heading === "string" && f.heading.trim()) base.fonts.heading = f.heading.trim();
    if (typeof f.body === "string" && f.body.trim()) base.fonts.body = f.body.trim();
  }
  if (s.fontFiles && typeof s.fontFiles === "object" && !Array.isArray(s.fontFiles)) {
    const ff = s.fontFiles as Record<string, unknown>;

    if (typeof ff.heading === "string" && isStyleFileRel(ff.heading, FONT_EXTS)) {
      base.fontFiles.heading = ff.heading;
    }
    if (typeof ff.body === "string" && isStyleFileRel(ff.body, FONT_EXTS)) {
      base.fontFiles.body = ff.body;
    }
  }
  if (s.effects && typeof s.effects === "object" && !Array.isArray(s.effects)) {
    const e = s.effects as Record<string, unknown>;
    if (typeof e.gradient === "boolean") base.effects.gradient = e.gradient;
    if (typeof e.liquidGlass === "boolean") base.effects.liquidGlass = e.liquidGlass;
  }
  if (typeof s.logoPath === "string" && isStyleFileRel(s.logoPath, LOGO_EXTS)) {
    base.logoPath = s.logoPath;
  }
  if (typeof s.tone === "string") base.tone = s.tone;
  if (typeof s.guidelines === "string") base.guidelines = s.guidelines;
  if (typeof s.createdAt === "string" && s.createdAt) base.createdAt = s.createdAt;
  if (typeof s.updatedAt === "string" && s.updatedAt) base.updatedAt = s.updatedAt;
  return base;
}

function migrateFromLegacy(): StylesFile | null {
  const legacy = legacyFilePath();
  if (!fs.existsSync(legacy)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(legacy, "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const style = normStyle({ ...d, id: "fabuloki", name: d.brandName }) ?? defaultStyle();
  style.tags = ["brand"];
  const now = nowIso();
  style.createdAt = now;
  style.updatedAt = now;
  const data: StylesFile = { defaultId: style.id, styles: [style] };
  writeStyles(data);
  return data;
}

export function readStyles(): StylesFile {
  const file = stylesFilePath();
  if (!fs.existsSync(file)) {
    const migrated = migrateFromLegacy();
    if (migrated) return migrated;
    return { defaultId: null, styles: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { defaultId: null, styles: [] };
    }
    const r = raw as Record<string, unknown>;
    const styles: StyleDesign[] = [];
    const seen = new Set<string>();
    if (Array.isArray(r.styles)) {
      for (const item of r.styles) {
        const s = normStyle(item);
        if (s && !seen.has(s.id)) {
          seen.add(s.id);
          styles.push(s);
        }
      }
    }
    let defaultId =
      typeof r.defaultId === "string" && styles.some((s) => s.id === r.defaultId)
        ? r.defaultId
        : null;
    if (!defaultId && styles.length > 0) defaultId = styles[0].id;
    return { defaultId, styles };
  } catch {
    return { defaultId: null, styles: [] };
  }
}

export function writeStyles(data: StylesFile): void {
  ensureDir(paths.stylesDir);
  fs.writeFileSync(stylesFilePath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function styleExists(id: string): boolean {
  return readStyles().styles.some((s) => s.id === id);
}

export function getStyle(id?: string | null): StyleDesign {
  const data = readStyles();
  if (id) {
    const found = data.styles.find((s) => s.id === id);
    if (found) return found;
  }
  if (data.defaultId) {
    const def = data.styles.find((s) => s.id === data.defaultId);
    if (def) return def;
  }
  if (data.styles.length > 0) return data.styles[0];
  return defaultStyle();
}
