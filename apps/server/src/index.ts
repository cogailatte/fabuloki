import os from "node:os";
import { editEffects } from "./editEffects.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  SERVER_PORT,
  apiToken,
  ensureBaseDirs,
  isAllowedWebOrigin,
  repoRoot,
} from "./config.js";
import { autoResumeStartup } from "./agent.js";
import { scanAutoCuts, patchAutoCut } from "./autoCutMeta.js";
import { patchTranslateVideo, scanTranslateVideos } from "./translateVideoMeta.js";
import { scanImageProjects, writeImageMeta } from "./imageMeta.js";
import { failStaleRunningJobs, hasActiveJobForProject } from "./db.js";
import { addSseClient } from "./events.js";
import {
  HttpError,
  cookieAuthAllowed,
  cookieValue,
  isLocalRequest,
  secretEquals,
} from "./util.js";
import { isKnownUploadToken, isValidUploadToken } from "./routes/uploadSession.js";

import healthRouter from "./routes/health.js";
import overviewRouter from "./routes/overview.js";
import metricsRouter from "./routes/metrics.js";
import doctorRouter, { warmDoctorCache } from "./routes/doctor.js";
import projectsRouter from "./routes/projects.js";
import jobsRouter from "./routes/jobs.js";
import skillsRouter from "./routes/skills.js";
import sfxRouter from "./routes/sfx.js";
import musicRouter from "./routes/music.js";
import assetsRouter from "./routes/assets.js";
import chatRouter from "./routes/chat.js";
import promptsRouter from "./routes/prompts.js";
import usageRouter from "./routes/usage.js";
import providersRouter from "./routes/providers.js";
import stylesRouter from "./routes/stylesRoute.js";
import imagesRouter from "./routes/images.js";
import connectionsRouter from "./routes/connections.js";
import renderSettingsRouter from "./routes/renderSettingsRoute.js";
import illustrationsRouter from "./routes/illustrations.js";
import imageProvidersRouter from "./routes/imageProviders.js";
import generateImageRouter from "./routes/generateImage.js";
import generateTextRouter from "./routes/generateText.js";
import projectSourceRouter from "./routes/projectSource.js";
import narrationRouter from "./routes/narration.js";
import thumbnailsRouter from "./routes/thumbnails.js";
import publishRouter from "./routes/publish.js";
import qcRouter from "./routes/qc.js";
import clipsRouter from "./routes/clips.js";
import reviewRouter from "./routes/review.js";
import timelineRouter, { libraryRouter } from "./routes/timeline.js";
import autoCutRouter from "./routes/autoCut.js";
import autoTrimRouter from "./routes/autoTrim.js";
import textToVideoRouter from "./routes/textToVideo.js";
import translateVideoRouter from "./routes/translateVideo.js";
import ttsRouter from "./routes/tts.js";
import voicesRouter from "./routes/voices.js";
import videoStylesRouter from "./routes/videoStyles.js";
import brandLogosRouter from "./routes/brandLogos.js";

import revealRouter from "./routes/reveal.js";
import tunnelRouter, { quickTunnelHostname } from "./routes/tunnel.js";
import uploadSessionRouter from "./routes/uploadSession.js";
import { GRADE_PRESETS } from "./color.js";
import mediaRouter from "./routes/media.js";

ensureBaseDirs();

failStaleRunningJobs();

for (const m of scanAutoCuts()) {
  if (
    (m.status === "planning" || m.status === "cutting") &&
    !hasActiveJobForProject(m.id, "auto-cut")
  ) {
    patchAutoCut(m.id, {
      status: "failed",
      error: "Server khởi động lại giữa chừng - chạy lại bước này.",
      failedStep: m.status === "planning" ? "plan" : "cut",
    });
  }
}
for (const m of scanTranslateVideos()) {
  if (
    (m.status === "transcribing" || m.status === "rendering" || m.status === "translating") &&
    !hasActiveJobForProject(m.id, "translate-video")
  ) {
    patchTranslateVideo(m.id, {
      status:
        m.status === "rendering" && m.cues.length > 0
          ? "translated"
          : m.transcriptFile
            ? "transcribed"
            : "draft",
      error: `Bước "${m.status}" bị dừng giữa chừng vì server khởi động lại - chạy lại bước đó.`,
    });
  }
}

for (const m of scanImageProjects()) {
  if (m.status === "generating" && !hasActiveJobForProject(m.id, "image")) {
    writeImageMeta(m.id, {
      ...m,
      status: "error",
      error: "Server khởi động lại khi đang tạo ảnh - chạy lại bước này.",
    });
  }
}

const app = express();
app.disable("x-powered-by");

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && isAllowedWebOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fabuloki-token");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const UPLOAD_TOKEN_ROUTES: ReadonlyArray<{ method: string; re: RegExp }> = [
  { method: "GET", re: /^\/api\/projects\/([^/]+)$/ },
  { method: "POST", re: /^\/api\/assets$/ },
];

function allowedForUploadToken(req: Request, k: string): boolean {
  const p = req.path.replace(/(.)\/$/, "$1");
  return UPLOAD_TOKEN_ROUTES.some((r) => {
    if (r.method !== req.method) return false;

    const m = r.re.exec(p.toLowerCase());
    if (!m) return false;
    if (m[1] === undefined) return true;
    try {
      return isValidUploadToken(k, decodeURIComponent(p.slice(p.lastIndexOf("/") + 1)));
    } catch {
      return false;
    }
  });
}

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.path === "/api/health" || req.path.startsWith("/api/health/")) {
    next();
    return;
  }
  if (isLocalRequest(req)) {
    next();
    return;
  }
  const token = apiToken();
  const header = req.headers["x-fabuloki-token"];
  if (typeof header === "string" && secretEquals(header, token)) {
    next();
    return;
  }

  if (cookieAuthAllowed(req) && secretEquals(cookieValue(req, "fabuloki_token"), token)) {
    next();
    return;
  }
  if (secretEquals(queryString(req.query.t), token)) {
    next();
    return;
  }
  const k = queryString(req.query.k);
  if (k && isKnownUploadToken(k) && allowedForUploadToken(req, k)) {
    next();
    return;
  }
  res.status(401).json({
    error: { code: "UNAUTHORIZED", message: "Thiếu hoặc sai token truy cập" },
  });
});

app.use(express.json({ limit: "20mb" }));

app.post("/api/session", (req: Request, res: Response) => {
  const https = String(req.headers["x-forwarded-proto"] ?? "").includes("https");
  res.setHeader(
    "Set-Cookie",
    `fabuloki_token=${encodeURIComponent(apiToken())}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${https ? "; Secure" : ""}`,
  );
  res.status(204).end();
});

app.get("/api/events", addSseClient);

app.use("/api/health", healthRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/metrics", metricsRouter);

app.use("/api/doctor", doctorRouter);
app.use("/api/projects", projectsRouter);

app.use("/api/projects", thumbnailsRouter);

app.use("/api/projects", publishRouter);
app.use("/api/projects", qcRouter);
app.use("/api/projects", clipsRouter);
app.use("/api/projects", reviewRouter);
app.use("/api/projects", autoTrimRouter);

app.use("/api/projects", timelineRouter);

app.use("/api/library", libraryRouter);
app.use("/api/auto-cut", autoCutRouter);

app.use("/api/text-to-video", textToVideoRouter);

app.use("/api/translate-video", translateVideoRouter);
app.use("/api/tts", ttsRouter);
app.use("/api/voices", voicesRouter);
app.use("/api/video-styles", videoStylesRouter);
app.use("/api/brand-logos", brandLogosRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/sfx", sfxRouter);
app.use("/api/music", musicRouter);
app.use("/api/assets", assetsRouter);
app.get("/api/edit-effects", (_req, res) => res.json(editEffects));
app.use("/api/chat", chatRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/usage", usageRouter);
app.use("/api/providers", providersRouter);
app.use("/api/styles", stylesRouter);
app.use("/api/images", imagesRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/render-settings", renderSettingsRouter);
app.use("/api/illustrations", illustrationsRouter);

app.use("/api/image-providers", imageProvidersRouter);

app.use("/api/projects", generateImageRouter);

app.use("/api/projects", generateTextRouter);

app.use("/api/projects", projectSourceRouter);

app.use("/api/projects", narrationRouter);

app.use("/api/reveal", revealRouter);
app.use("/api/tunnel", tunnelRouter);
app.use("/api/upload-session", uploadSessionRouter);

app.get("/api/grade-presets", (_req: Request, res: Response) => {
  res.json(GRADE_PRESETS.map((p) => ({ id: p.id, label: p.label })));
});

app.get("/api/lan-info", (_req: Request, res: Response) => {
  const ips: string[] = [];

  const VIRTUAL_IF_RE = /wsl|vethernet|hyper-v|virtual|vmware|docker|loopback/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IF_RE.test(name)) continue;
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) ips.push(ni.address);
    }
  }
  const rank = (ip: string) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3;
  ips.sort((a, b) => rank(a) - rank(b));

  const rawTunnel = (process.env.TUNNEL_DOMAIN ?? "").trim();
  const tunnelDomain =
    quickTunnelHostname() ??
    (rawTunnel.replace(/^[a-z]+:\/\//i, "").replace(/[/?#].*$/, "").trim() || null);
  res.json({ ips, webPort: Number(process.env.WEB_PORT || 6868), tunnelDomain });
});
app.use("/media", mediaRouter);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy endpoint" } });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) {

    res
      .status(err.status)
      .json({ ...(err.extra ?? {}), error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Body JSON không hợp lệ" } });
    return;
  }

  if (err instanceof Error && err.name === "MulterError") {
    res.status(400).json({ error: { code: "UPLOAD_ERROR", message: err.message } });
    return;
  }

  console.error("[server] Unhandled error:", err);
  res
    .status(500)
    .json({ error: { code: "INTERNAL", message: "Lỗi máy chủ nội bộ" } });
});

const server = app.listen(SERVER_PORT, process.env.FABULOKI_HOST || "127.0.0.1", () => {
  console.log(`[server] Fabuloki backend chạy tại http://localhost:${SERVER_PORT}`);
  console.log(`[server] Repo root: ${repoRoot}`);

  warmDoctorCache();

  setTimeout(() => {
    void autoResumeStartup();
  }, 15_000);
});

server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;
