import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Router, type Request, type Response } from "express";
import { repoRoot } from "../config.js";
import { HttpError } from "../util.js";

const ALLOWED_TOP = new Set([
  "video-projects",
  "image-projects",
  "assets",
  "outputs",
  "imports",
]);

const router = Router();

router.post("/", (req: Request, res: Response) => {
  const relPath = (req.body as { relPath?: unknown } | undefined)?.relPath;
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new HttpError(
      400,
      "INVALID_RELPATH",
      "Thiếu relPath (chuỗi, đường dẫn tính từ repo root)",
    );
  }

  const abs = path.resolve(
    repoRoot,
    relPath.replace(/\\/g, "/").replace(/^\/+/, ""),
  );

  if (!abs.startsWith(repoRoot + path.sep)) {
    throw new HttpError(
      400,
      "INVALID_RELPATH",
      "relPath không hợp lệ (vượt ra ngoài repo)",
    );
  }

  const top = path.relative(repoRoot, abs).split(path.sep)[0];
  if (!ALLOWED_TOP.has(top)) {
    throw new HttpError(
      403,
      "FORBIDDEN_PATH",
      "Chỉ mở được file dưới video-projects/, image-projects/, assets/, outputs/, imports/",
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new HttpError(404, "FILE_NOT_FOUND", `Không tìm thấy file: ${relPath}`);
  }
  if (!stat.isFile()) {
    throw new HttpError(404, "FILE_NOT_FOUND", `Không phải file: ${relPath}`);
  }

  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {

    cmd = "explorer.exe";
    args = [`/select,"${abs}"`];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = ["-R", abs];
  } else {

    cmd = "xdg-open";
    args = [path.dirname(abs)];
  }
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: process.platform === "win32",
  });
  child.on("error", () => {

  });
  child.unref();

  res.status(204).end();
});

export default router;
