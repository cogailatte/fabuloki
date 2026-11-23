import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const BRAND_HEADING_FAMILY = "BrandHeading";
export const BRAND_BODY_FAMILY = "BrandBody";

type FontFormat = "woff2" | "woff" | "opentype" | "truetype";

const formatFromExtension = (file: string): FontFormat | null => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "woff2":
      return "woff2";
    case "woff":
      return "woff";
    case "otf":
      return "opentype";
    case "ttf":
      return "truetype";
    default:
      return null;
  }
};

const WEIGHT_NAMES: Record<string, string> = {
  thin: "100",
  hairline: "100",
  extralight: "200",
  ultralight: "200",
  light: "300",
  regular: "400",
  normal: "400",
  medium: "500",
  semibold: "600",
  demibold: "600",
  extrabold: "800",
  ultrabold: "800",
  bold: "700",
  black: "900",
  heavy: "900",
};

const weightFromFilename = (file: string): string | undefined => {
  const base = (file.split("/").pop() ?? file).toLowerCase().replace(/\.[a-z0-9]+$/, "");

  const numeric = base.match(/(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/);
  if (numeric) return numeric[1];

  const names = Object.keys(WEIGHT_NAMES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (base.includes(name)) return WEIGHT_NAMES[name];
  }
  return undefined;
};

const requested = new Set<string>();

export const ensureBrandFont = (family: string, file: string | null | undefined): boolean => {
  if (!file || file.trim() === "") return false;
  const format = formatFromExtension(file);
  if (!format) {

    console.warn(`[Poster] Bỏ qua font brand "${file}": đuôi file không hỗ trợ (cần woff2/woff/otf/ttf).`);
    return false;
  }
  const key = `${family}::${file}`;
  if (!requested.has(key)) {
    requested.add(key);

    void loadFont({
      family,
      url: staticFile(file),
      format,
      weight: weightFromFilename(file),
    });
  }
  return true;
};
