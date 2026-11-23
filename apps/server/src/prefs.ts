import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { ensureDir } from "./util.js";

export type PrefScope =
  | "translate-video"
  | "image"
  | "text-to-video"
  | "auto-cut"
  | "video-project";

type PrefBag = Record<string, unknown>;

const prefsFile = (): string => path.join(paths.dataDir, "prefs.json");

function readAll(): Record<string, PrefBag> {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as Record<string, PrefBag>;
  } catch {

    return {};
  }
}

export function getPrefs(scope: PrefScope): PrefBag {
  const bag = readAll()[scope];
  return bag && typeof bag === "object" && !Array.isArray(bag) ? bag : {};
}

export function rememberPrefs(scope: PrefScope, values: PrefBag): void {
  const clean: PrefBag = {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return;
  try {
    const all = readAll();
    all[scope] = { ...(all[scope] ?? {}), ...clean };
    ensureDir(paths.dataDir);
    fs.writeFileSync(prefsFile(), JSON.stringify(all, null, 2) + "\n", "utf8");
  } catch {

  }
}

export function prefString(bag: PrefBag, key: string): string | undefined {
  const v = bag[key];
  return typeof v === "string" && v ? v : undefined;
}

export function prefBool(bag: PrefBag, key: string): boolean | undefined {
  return typeof bag[key] === "boolean" ? (bag[key] as boolean) : undefined;
}

export function prefObject(bag: PrefBag, key: string): unknown {
  const v = bag[key];
  return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}
