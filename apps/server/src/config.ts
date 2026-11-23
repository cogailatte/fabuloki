import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { nanoid } from "nanoid";

function findRepoRoot(): string {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      if (fs.existsSync(path.join(dir, "CLAUDE.md"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    "Không tìm thấy repo root (file CLAUDE.md). Hãy chạy server bên trong repo Edit-Video-AI.",
  );
}

export const repoRoot = findRepoRoot();

dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

export const SERVER_PORT = Number(process.env.SERVER_PORT || 6869);

const ENV_FILE = path.join(repoRoot, ".env");

export function upsertEnvVar(name: string, value: string | null): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Tên biến .env không hợp lệ: ${name}`);
  }
  if (value !== null && /[\r\n]/.test(value)) {
    throw new Error("Giá trị .env không được chứa ký tự xuống dòng");
  }
  let lines: string[] = [];
  if (fs.existsSync(ENV_FILE)) {
    lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  }
  const re = new RegExp(`^\\s*#?\\s*${name}\\s*=`);
  const filtered = lines.filter((l) => !re.test(l));

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") filtered.pop();
  if (value !== null) filtered.push(`${name}=${value}`);
  fs.writeFileSync(ENV_FILE, filtered.join("\n") + "\n", "utf8");
}

let cachedApiToken: string | null = null;

export function apiToken(): string {
  if (cachedApiToken) return cachedApiToken;
  const fromEnv = (process.env.FABULOKI_API_TOKEN ?? "").trim();
  if (fromEnv) {
    cachedApiToken = fromEnv;
    return cachedApiToken;
  }
  const generated = nanoid(32);
  try {
    upsertEnvVar("FABULOKI_API_TOKEN", generated);
  } catch (err) {

    console.warn(
      `[config] Không ghi được FABULOKI_API_TOKEN vào .env: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  process.env.FABULOKI_API_TOKEN = generated;
  cachedApiToken = generated;
  return generated;
}

export function hasClaudeAuth(): boolean {
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_AUTH_TOKEN
  ) {
    return true;
  }
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude");
  if (fs.existsSync(path.join(configDir, ".credentials.json"))) return true;

  return darwinKeychainHasClaudeCreds();
}

let keychainCache: { at: number; ok: boolean } | null = null;
function darwinKeychainHasClaudeCreds(): boolean {
  if (process.platform !== "darwin") return false;
  if (keychainCache && Date.now() - keychainCache.at < 60_000) return keychainCache.ok;
  let ok = false;
  try {
    execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], {
      stdio: "ignore",
      timeout: 3000,
    });
    ok = true;
  } catch {

  }
  keychainCache = { at: Date.now(), ok };
  return ok;
}

export const WEB_ORIGINS = [
  `http://localhost:${process.env.WEB_PORT || "6868"}`,
  `http://127.0.0.1:${process.env.WEB_PORT || "6868"}`,
  "http://localhost:6868",
  "http://127.0.0.1:6868",
];

const LAN_WEB_ORIGIN_RE =
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+):6868$/;

export function isAllowedWebOrigin(origin: string): boolean {
  return WEB_ORIGINS.includes(origin) || LAN_WEB_ORIGIN_RE.test(origin);
}

const serverDir = path.join(repoRoot, "apps", "server");

const RUNTIME_ROOT = (() => {
  const dir = (process.env.FABULOKI_RUNTIME_DIR ?? "").trim();
  return dir ? path.resolve(repoRoot, dir) : path.join(repoRoot, ".runtime");
})();

export const paths = {
  serverDir,
  dataDir: path.join(serverDir, "data"),

  uploadTmpDir: path.join(serverDir, "data", "tmp-uploads"),
  videoProjectsDir: path.join(repoRoot, "video-projects"),

  imageProjectsDir: path.join(repoRoot, "image-projects"),

  autoCutDir: path.join(repoRoot, "auto-cut"),

  textToVideoDir: path.join(repoRoot, "text-to-video"),

  translateVideoDir: path.join(repoRoot, "translate-video"),
  assetsDir: path.join(repoRoot, "assets"),

  brandDir: path.join(repoRoot, "assets", "brand"),

  stylesDir: path.join(repoRoot, "assets", "styles"),

  stylesFilesDir: path.join(repoRoot, "assets", "styles", "files"),
  sfxDir: path.join(repoRoot, "assets", "sound-effects"),

  voicesDir: path.join(repoRoot, "assets", "voices"),

  musicDir: path.join(repoRoot, "assets", "music"),
  outputsDir: path.join(repoRoot, "outputs"),
  importsDir: path.join(repoRoot, "imports"),
  skillsDir: path.join(repoRoot, ".claude", "skills"),
  remotionDir: path.join(repoRoot, "engines", "remotion"),

  stagingDir: path.join(repoRoot, "engines", "remotion", "public", "staging"),

  remotionFontsDir: path.join(repoRoot, "engines", "remotion", "public", "fonts"),

  runtime: {
    root: RUNTIME_ROOT,

    tmp: path.join(RUNTIME_ROOT, "tmp"),

    models: path.join(RUNTIME_ROOT, "models"),

    venv: path.join(RUNTIME_ROOT, "venv"),

    bin: path.join(RUNTIME_ROOT, "bin"),

    pipCache: path.join(RUNTIME_ROOT, "pip-cache"),
  },
} as const;

export function venvPython(): string | null {
  const exe =
    process.platform === "win32"
      ? path.join(paths.runtime.venv, "Scripts", "python.exe")
      : path.join(paths.runtime.venv, "bin", "python");
  return fs.existsSync(exe) ? exe : null;
}

let cudaDirsCache: string[] | null = null;
function cudaDllDirs(): string[] {
  if (cudaDirsCache) return cudaDirsCache;
  const out: string[] = [];
  try {

    if (process.platform === "win32") {
      const nvidiaDir = path.join(paths.runtime.venv, "Lib", "site-packages", "nvidia");
      for (const entry of fs.readdirSync(nvidiaDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const bin = path.join(nvidiaDir, entry.name, "bin");
        if (fs.existsSync(bin)) out.push(bin);
      }
    }
  } catch {

  }
  cudaDirsCache = out;
  return out;
}

export function childEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {

  const pathKey =
    Object.keys(process.env).find((k) => k.toLowerCase() === "path") ??
    (process.platform === "win32" ? "Path" : "PATH");
  const currentPath = process.env[pathKey] ?? "";
  const prefix = [paths.runtime.bin, ...cudaDllDirs()].join(path.delimiter);
  const mergedPath = currentPath ? `${prefix}${path.delimiter}${currentPath}` : prefix;
  return {
    ...process.env,
    [pathKey]: mergedPath,
    TEMP: paths.runtime.tmp,
    TMP: paths.runtime.tmp,
    TMPDIR: paths.runtime.tmp,
    HF_HOME: paths.runtime.models,
    HUGGINGFACE_HUB_CACHE: paths.runtime.models,
    PIP_CACHE_DIR: paths.runtime.pipCache,
    ...extra,
  };
}

export function ensureBaseDirs(): void {
  const dirs = [
    paths.dataDir,
    paths.uploadTmpDir,
    paths.videoProjectsDir,
    paths.imageProjectsDir,
    paths.stylesDir,
    paths.stylesFilesDir,
    paths.sfxDir,
    paths.voicesDir,
    paths.musicDir,
    paths.outputsDir,
    paths.importsDir,
    paths.autoCutDir,
    paths.textToVideoDir,
    paths.translateVideoDir,

    paths.runtime.tmp,
    paths.runtime.models,
    paths.runtime.bin,
    paths.runtime.pipCache,

  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}
