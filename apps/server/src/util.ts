import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { Request } from "express";
import { WEB_ORIGINS, apiToken, childEnv, repoRoot } from "./config.js";
import { ffprobeSafeArgs } from "./ffmpegSafe.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
];

export function isLocalRequest(req: Request): boolean {
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const addr = req.ip || req.socket.remoteAddress || "";
  if (!LOOPBACK.has(addr)) return false;
  const host = (req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!LOOPBACK_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !WEB_ORIGINS.includes(origin)) return false;
  return req.headers["sec-fetch-site"] !== "cross-site";
}

export function cookieAuthAllowed(req: Request): boolean {
  return req.method === "GET" || req.method === "HEAD";
}

export function secretEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function cookieValue(req: Request, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return "";
}

export function hasMasterToken(req: Request): boolean {
  const token = apiToken();
  if (!token) return false;
  const header = req.headers["x-fabuloki-token"];
  if (typeof header === "string" && secretEquals(header, token)) return true;
  if (cookieAuthAllowed(req) && secretEquals(cookieValue(req, "fabuloki_token"), token)) return true;
  const t = req.query?.t;
  return typeof t === "string" && secretEquals(t, token);
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export function isKebabCase(s: string): boolean {
  return KEBAB_RE.test(s) && !WINDOWS_RESERVED_RE.test(s);
}

export function toKebabAscii(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizeFileName(original: string): string {
  const ext = path.extname(original).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const base = toKebabAscii(path.basename(original, path.extname(original)));
  return `${base || "file"}${ext}`;
}

export type FileKind = "video" | "audio" | "image" | "other";

export interface FileInfo {
  name: string;
  relPath: string;
  size: number;
  mtime: string;
  kind: FileKind;
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

export function fileKind(name: string): FileKind {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (IMAGE_EXT.has(ext)) return "image";
  return "other";
}

export function toRepoRel(absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

export function fileInfoOf(absPath: string): FileInfo {
  const st = fs.statSync(absPath);
  return {
    name: path.basename(absPath),
    relPath: toRepoRel(absPath),
    size: st.size,
    mtime: st.mtime.toISOString(),
    kind: fileKind(absPath),
  };
}

export function listFilesRecursive(absDir: string): FileInfo[] {
  if (!fs.existsSync(absDir)) return [];
  const out: FileInfo[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(fileInfoOf(abs));
    }
  };
  walk(absDir);
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return out;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function moveFile(src: string, dst: string): void {
  ensureDir(path.dirname(dst));
  try {
    fs.renameSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
    fs.unlinkSync(src);
  }
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
    });
  } else {

    if (child.exitCode !== null || child.signalCode !== null) return;

    const pids = [...descendantPids(child.pid), child.pid];
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {

      }
    }
  }
}

function descendantPids(root: number): number[] {
  let table: string;
  try {
    table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const children = new Map<number, number[]>();
  for (const line of table.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || !ppid) continue;
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  const out: number[] = [];
  const walk = (pid: number): void => {
    for (const c of children.get(pid) ?? []) {
      walk(c);
      out.push(c);
    }
  };
  walk(root);
  return out;
}

export function execFileCapture(
  file: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const command = `${file} ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd ?? repoRoot,
      windowsHide: true,

      env: childEnv(),
    });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;

      killTree(child);
      reject(new Error(`Lệnh quá thời gian: ${command}`));
    }, opts.timeoutMs ?? 10_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", () => {

    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Lệnh thoát mã ${code}: ${command}`));
    });
  });
}

export function execFileCaptureAll(
  file: string,
  args: string[],
  opts: {
    cwd?: string;
    timeoutMs?: number;

    isCanceled?: () => boolean;
  } = {},
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  canceled: boolean;
}> {
  const command = `${file} ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd ?? repoRoot,
      windowsHide: true,

      env: childEnv(),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let canceled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killTree(child);
    }, opts.timeoutMs ?? 120_000);

    const cancelTimer = opts.isCanceled
      ? setInterval(() => {
          if (settled || !opts.isCanceled?.()) return;
          canceled = true;
          killTree(child);
        }, 1_000)
      : null;
    cancelTimer?.unref?.();
    const clearAll = (): void => {
      clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
    };
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearAll();
      reject(new Error(`Không chạy được lệnh (${command}): ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearAll();
      resolve({ code, stdout, stderr, timedOut, canceled });
    });
  });
}

export function cliJsPath(pkg: string, binName: string): string {
  const pkgJson = path.join(repoRoot, "node_modules", ...pkg.split("/"), "package.json");
  if (!fs.existsSync(pkgJson)) {
    throw new Error(`Chưa cài package "${pkg}" - chạy npm install ở repo root`);
  }
  const raw = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const rel = typeof raw.bin === "string" ? raw.bin : raw.bin?.[binName];
  if (!rel) throw new Error(`Package "${pkg}" không khai báo bin "${binName}"`);
  return path.join(path.dirname(pkgJson), rel);
}

export function hyperframesCli(): string {
  return cliJsPath("hyperframes", "hyperframes");
}

export function remotionCli(): string {
  return cliJsPath("@remotion/cli", "remotion");
}

export const CUT_FADE_SEC = 0.03;

export function audioCutFade(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return "";

  const d = Math.min(CUT_FADE_SEC, durationSec / 2);

  if (d < 0.005) return "";
  const outStart = durationSec - d;
  return `afade=t=in:st=0:d=${d.toFixed(3)},afade=t=out:st=${outStart.toFixed(3)}:d=${d.toFixed(3)}`;
}

export async function ffprobeDurationMs(absFile: string): Promise<number | null> {
  try {
    const out = await execFileCapture(
      "ffprobe",
      ffprobeSafeArgs(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absFile]),
      { timeoutMs: 15_000 },
    );
    const sec = parseFloat(out.trim());
    if (!Number.isFinite(sec)) return null;
    return Math.round(sec * 1000);
  } catch {
    return null;
  }
}
