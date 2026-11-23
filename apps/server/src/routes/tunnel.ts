import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv, paths, repoRoot, upsertEnvVar } from "../config.js";
import { Router } from "express";
import { HttpError, killTree } from "../util.js";
import { hasLiveUploadSessions } from "./uploadSession.js";

type TunnelMode = "named" | "quick";

let child: ChildProcess | null = null;
let mode: TunnelMode | null = null;

let quickUrl: string | null = null;

let autoStarted = false;

const lastLog: string[] = [];
const LOG_MAX = 20;

const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function pushLog(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    lastLog.push(s);
    if (lastLog.length > LOG_MAX) lastLog.splice(0, lastLog.length - LOG_MAX);

    if (mode === "quick" && !quickUrl) {
      const m = QUICK_URL_RE.exec(s);
      if (m) quickUrl = m[0];
    }
  }
}

const CLOUDFLARED_KNOWN_PATHS =
  process.platform === "win32"
    ? [
        path.join(paths.runtime.bin, "cloudflared.exe"),
        path.join(repoRoot, "start", "bin", "cloudflared.exe"),
        "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
        "C:\\Program Files\\cloudflared\\cloudflared.exe",
      ]
    : [
        path.join(paths.runtime.bin, "cloudflared"),
        path.join(repoRoot, "start", "bin", "cloudflared"),
        "/opt/homebrew/bin/cloudflared",
        "/usr/local/bin/cloudflared",
        "/usr/bin/cloudflared",
      ];

export function cloudflaredBin(): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    if (
      spawnSync(cmd, ["cloudflared"], { windowsHide: true, shell: true }).status === 0
    ) {
      return "cloudflared";
    }
  } catch {

  }
  for (const p of CLOUDFLARED_KNOWN_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {

    }
  }
  return null;
}

function cloudflaredInstalled(): boolean {
  return cloudflaredBin() !== null;
}

function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .trim()
    .toLowerCase();
}

function envDomain(): string | null {
  const d = normalizeDomain(process.env.TUNNEL_DOMAIN ?? "");
  return d || null;
}

export function quickTunnelHostname(): string | null {
  if (child && mode === "quick" && quickUrl) {
    try {
      return new URL(quickUrl).hostname;
    } catch {
      return null;
    }
  }
  return null;
}

function stopTunnelNow(): void {
  if (child) killTree(child);
  child = null;
  mode = null;
  quickUrl = null;
  autoStarted = false;
}

const WATCHDOG_EVERY_MS = 30_000;
const GRACE_MS = 2 * 60_000;
let idleSince: number | null = null;

const watchdog = setInterval(() => {
  if (!child || !autoStarted) {
    idleSince = null;
    return;
  }
  if (hasLiveUploadSessions()) {
    idleSince = null;
    return;
  }
  if (idleSince === null) {
    idleSince = Date.now();
    return;
  }
  if (Date.now() - idleSince >= GRACE_MS) {
    pushLog("[tunnel] không còn phiên upload nào - tự tắt tunnel đã bật cho QR");
    stopTunnelNow();
    idleSince = null;
  }
}, WATCHDOG_EVERY_MS);

watchdog.unref?.();

function statusPayload() {
  const domain = envDomain();
  return {
    installed: cloudflaredInstalled(),
    running: !!child,

    auto: !!child && autoStarted,
    mode: child ? mode : null,
    url: child
      ? mode === "named"
        ? domain
          ? `https://${domain}`
          : null
        : quickUrl
      : null,
    domain,
    lastLog: [...lastLog],
  };
}

const router = Router();

router.get("/", (_req, res) => {
  res.json(statusPayload());
});

router.put("/domain", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body.domain;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    throw new HttpError(400, "INVALID_DOMAIN", "domain phải là string hoặc null");
  }
  const domain = typeof raw === "string" ? normalizeDomain(raw) : "";
  if (domain && !HOSTNAME_RE.test(domain)) {
    throw new HttpError(
      400,
      "INVALID_DOMAIN",
      `"${domain}" không phải hostname hợp lệ - ví dụ đúng: upload.example.com`,
    );
  }
  upsertEnvVar("TUNNEL_DOMAIN", domain || null);
  if (domain) process.env.TUNNEL_DOMAIN = domain;
  else delete process.env.TUNNEL_DOMAIN;
  res.json(statusPayload());
});

router.post("/start", (req, res) => {
  if (!cloudflaredInstalled()) {
    throw new HttpError(
      409,
      "NOT_INSTALLED",
      `Chưa cài cloudflared. Cài bằng: ${
        process.platform === "darwin"
          ? "brew install cloudflared"
          : "winget install --id Cloudflare.cloudflared"
      } - hoặc tải tại https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`,
    );
  }
  if (child) {
    throw new HttpError(409, "ALREADY_RUNNING", "Tunnel đang chạy rồi - tắt trước nếu muốn khởi động lại.");
  }

  const webPort = Number(process.env.WEB_PORT || 6868);
  const localUrl = `http://localhost:${webPort}`;
  const domain = envDomain();
  let args: string[];
  if (domain) {

    const name = domain.split(".")[0];
    mode = "named";
    args = ["tunnel", "run", "--url", localUrl, name];
  } else {
    mode = "quick";
    args = ["tunnel", "--url", localUrl];
  }

  quickUrl = null;
  autoStarted = (req.body as Record<string, unknown> | undefined)?.auto === true;
  idleSince = null;
  lastLog.length = 0;
  pushLog(`$ cloudflared ${args.join(" ")}`);

  const proc = spawn(cloudflaredBin() ?? "cloudflared", args, {
    windowsHide: true,
    env: childEnv(),
  });
  child = proc;
  proc.stdout?.on("data", (c: Buffer) => pushLog(c.toString("utf8")));
  proc.stderr?.on("data", (c: Buffer) => pushLog(c.toString("utf8")));
  proc.on("error", (err) => {
    pushLog(`[tunnel] không chạy được cloudflared: ${err.message}`);
    if (child === proc) {
      child = null;
      mode = null;
      quickUrl = null;
      autoStarted = false;
    }
  });
  proc.on("close", (code) => {
    pushLog(`[tunnel] cloudflared đã thoát (mã ${code ?? "?"})`);
    if (child === proc) {
      child = null;
      mode = null;
      quickUrl = null;
      autoStarted = false;
    }
  });

  res.status(202).json({ mode, auto: autoStarted });
});

router.post("/stop", (req, res) => {
  const onlyAuto = (req.body as Record<string, unknown> | undefined)?.onlyAuto === true;
  if (onlyAuto && !autoStarted) {
    res.status(204).end();
    return;
  }
  stopTunnelNow();
  res.status(204).end();
});

export default router;
