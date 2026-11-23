import React from "react";

export interface ColorAdjust {

  preset?: string;

  brightness?: number;

  contrast?: number;

  saturation?: number;

  temperature?: number;

  tint?: number;

  hue?: number;

  vignette?: number;

  blur?: number;
  [key: string]: unknown;
}

export interface GradeAdjustLike {

  brightness: number;

  contrast: number;

  saturation: number;

  gamma: number;

  temperature: number;

  vibrance: number;
}

const GRADE_DEFAULT: GradeAdjustLike = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  temperature: 6500,
  vibrance: 0,
};

export function gradeAdjustCss(a: GradeAdjustLike): string | undefined {
  const f: string[] = [];

  if (a.brightness !== 0) f.push(`brightness(${(1 + a.brightness).toFixed(3)})`);
  if (a.contrast !== 1) f.push(`contrast(${a.contrast.toFixed(3)})`);

  const sat = a.saturation * (1 + a.vibrance * 0.6);
  if (sat !== 1) f.push(`saturate(${Math.max(0, sat).toFixed(3)})`);

  if (a.gamma !== 1) f.push(`brightness(${(1 + (a.gamma - 1) * 0.5).toFixed(3)})`);
  if (a.temperature !== 6500) {
    const k = (6500 - a.temperature) / 2500;
    if (k > 0) f.push(`sepia(${Math.min(0.45, k * 0.45).toFixed(3)})`);
    else f.push(`hue-rotate(${(Math.max(-1.2, k) * -10).toFixed(1)}deg)`);
  }
  return f.length ? f.join(" ") : undefined;
}

export const PRESET_APPROX: Record<string, Partial<GradeAdjustLike>> = {
  "tu-nhien": { contrast: 1.06, saturation: 1.12 },
  "tuoi-sang": { brightness: 0.03, contrast: 1.08, saturation: 1.22, vibrance: 0.15 },
  vivid: { contrast: 1.12, saturation: 1.3, vibrance: 0.25 },
  cinematic: { contrast: 1.08, saturation: 1.05, temperature: 6300 },
  "teal-orange": { contrast: 1.1, saturation: 1.15, temperature: 6100 },
  "film-vintage": { contrast: 0.9, saturation: 0.85, temperature: 6000 },
  "mau-phim": { brightness: 0.01, contrast: 0.97, saturation: 0.9 },
  "golden-hour": { brightness: 0.02, saturation: 1.1, temperature: 4800 },
  am: { saturation: 1.08, temperature: 5200 },
  lanh: { saturation: 1.05, temperature: 8200 },
  "dem-xanh": { brightness: -0.03, contrast: 1.1, saturation: 0.95, temperature: 9000 },
  moody: { brightness: -0.04, contrast: 1.18, saturation: 0.8, temperature: 6900 },
  pastel: { brightness: 0.05, contrast: 0.92, saturation: 0.85 },
  "den-trang": { contrast: 1.15, saturation: 0 },
};

const num = (v: unknown, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(min, v));
};

const fx = (v: number): string => String(Math.round(v * 1000) / 1000);

export function needsColorMatrix(adj: ColorAdjust | null | undefined): boolean {
  if (!adj) return false;
  return num(adj.temperature, -1, 1) !== 0 || num(adj.tint, -1, 1) !== 0;
}

export function colorMatrixValues(adj: ColorAdjust): string {
  const t = num(adj.temperature, -1, 1);
  const m = num(adj.tint, -1, 1);
  const r = 1 + 0.15 * t + 0.05 * m;
  const g = 1 - 0.12 * m;
  const b = 1 - 0.15 * t + 0.05 * m;
  return `${fx(r)} 0 0 0 0 0 ${fx(g)} 0 0 0 0 0 ${fx(b)} 0 0 0 0 0 1 0`;
}

export function colorFilterCss(
  adj: ColorAdjust | null | undefined,
  svgFilterId?: string,
): string | undefined {
  if (!adj) return undefined;
  const parts: string[] = [];
  if (typeof adj.preset === "string" && PRESET_APPROX[adj.preset]) {
    const preset = gradeAdjustCss({ ...GRADE_DEFAULT, ...PRESET_APPROX[adj.preset] });
    if (preset) parts.push(preset);
  }
  const brightness = num(adj.brightness, -1, 1);
  const contrast = num(adj.contrast, -1, 1);
  const saturation = num(adj.saturation, -1, 1);
  const hue = num(adj.hue, -180, 180);
  const blur = num(adj.blur, 0, 20);
  if (brightness !== 0) parts.push(`brightness(${fx(1 + brightness)})`);
  if (contrast !== 0) parts.push(`contrast(${fx(1 + contrast)})`);
  if (saturation !== 0) parts.push(`saturate(${fx(1 + saturation)})`);
  if (hue !== 0) parts.push(`hue-rotate(${fx(hue)}deg)`);
  if (svgFilterId && needsColorMatrix(adj)) parts.push(`url(#${svgFilterId})`);
  if (blur !== 0) parts.push(`blur(${fx(blur)}px)`);
  return parts.length ? parts.join(" ") : undefined;
}

export const vignetteAmount = (adj: ColorAdjust | null | undefined): number =>
  adj ? num(adj.vignette, 0, 1) : 0;

export const vignetteBackground = (amount: number): string =>
  `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${fx(
    Math.min(1, Math.max(0, amount)) * 0.85,
  )}) 100%)`;

export const safeFilterId = (raw: string): string =>
  `fabuloki-color-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;

export const ColorDefs: React.FC<{ id: string; adjust?: ColorAdjust | null }> = ({ id, adjust }) => {
  if (!adjust || !needsColorMatrix(adjust)) return null;
  return React.createElement(
    "svg",
    {
      width: 0,
      height: 0,
      "aria-hidden": true,
      style: { position: "absolute", width: 0, height: 0, overflow: "hidden" },
    },
    React.createElement(
      "defs",
      null,
      React.createElement(
        "filter",
        { id, colorInterpolationFilters: "sRGB" },
        React.createElement("feColorMatrix", { type: "matrix", values: colorMatrixValues(adjust) }),
      ),
    ),
  );
};
