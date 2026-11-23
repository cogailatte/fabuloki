import fs from "node:fs";
import { spawn } from "node:child_process";
import { childEnv } from "../config.js";
import { ffmpegSafeArgs } from "../ffmpegSafe.js";
import { killTree } from "../util.js";

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function runBinary(file: string, args: string[], stdin: Buffer | null, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, env: childEnv() });
    const out: Buffer[] = [];
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      killTree(child);
      reject(new Error(`${file} quá ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => {
      if (stderr.length < 8000) stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr });
    });
    child.stdin.on("error", () => {

    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

export async function coverFit(input: string, output: string, width: number, height: number): Promise<void> {
  const tmp = `${output}.fit-${process.pid}-${Date.now()}.png`;
  const r = await runBinary(
    "ffmpeg",
    ffmpegSafeArgs([
      "-y",
      "-v",
      "error",
      "-i",
      input,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`,
      "-frames:v",
      "1",
      "-update",
      "1",
      tmp,
    ]),
    null,
    120_000,
  );
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`ffmpeg không cover-fit được ảnh: ${r.stderr.trim().slice(-300) || `mã ${r.code}`}`);
  }
  fs.renameSync(tmp, output);
}
