import { spawn, type ChildProcess } from "node:child_process";

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

const MAX_STEP_CHARS = 160;

import * as db from "./db.js";
import { broadcast } from "./events.js";
import { childEnv } from "./config.js";
import { killTree, nowIso } from "./util.js";
import { queueConcurrency } from "./renderSettings.js";
import { runSceneRender } from "./jobs/sceneRender.js";
import { runAssemble } from "./jobs/assemble.js";
import { runImageGen } from "./jobs/imageGen.js";
import { runAutoCut } from "./jobs/autoCut.js";
import { runAutoTrim } from "./jobs/autoTrim.js";
import { runTextToVideo } from "./jobs/textToVideo.js";
import { runTranslateVideo } from "./jobs/translateVideo.js";

function maxConcurrent(): number {
  const env = Number(process.env.QUEUE_CONCURRENCY);
  if (Number.isFinite(env) && env >= 1) return Math.min(4, env);
  return queueConcurrency();
}

export interface JobCtx {
  job: db.JobRow;

  log(line: string): void;

  progress(progress: number | null, step: string): void;

  exec(
    file: string,
    args: string[],
    cwd: string,
    onLine?: (line: string) => void,
  ): Promise<void>;
  isCanceled(): boolean;
}

interface Current {
  jobId: string;

  busyKey: string;
  child: ChildProcess | null;
  canceled: boolean;

  flushLog?: () => void;
}

function busyKeyOf(j: db.JobRow): string {
  const ns =
    j.type === "image-gen"
      ? "img:"
      : j.type === "auto-cut"
        ? "cut:"
        : j.type === "text-to-video"
          ? "t2v:"
          : j.type === "translate-video"
            ? "tvd:"
            : "vid:";
  return ns + j.projectId;
}

function broadcastJob(jobId: string): void {
  const row = db.getJob(jobId);
  if (row) broadcast("job", db.jobToApi(row));
}

class RenderQueue {
  private pending: string[] = [];
  private running = new Map<string, Current>();

  private deps = new Map<string, string[]>();

  enqueue(jobId: string, dependsOn: string[] = []): void {
    if (dependsOn.length) this.deps.set(jobId, [...dependsOn]);
    this.pending.push(jobId);
    this.tick();
  }

  private unmetDependency(jobId: string): string | null {
    const deps = this.deps.get(jobId);
    this.deps.delete(jobId);
    for (const depId of deps ?? []) {
      const dep = db.getJob(depId);
      if (dep?.status === "done") continue;
      const what = dep
        ? `${dep.type}${dep.sceneId ? ` của scene "${dep.sceneId}"` : ""} (${depId})`
        : `job ${depId}`;
      return (
        `${what} xếp cùng lượt render đã ${dep?.status ?? "biến mất"} - không chạy tiếp để khỏi ` +
        "lắp bằng bản render cũ/bản draft. Xem log job đó, sửa lỗi rồi render lại."
      );
    }
    return null;
  }

  cancel(jobId: string): boolean {
    const idx = this.pending.indexOf(jobId);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      this.deps.delete(jobId);
      db.updateJob(jobId, { status: "canceled", step: "Đã hủy", finishedAt: nowIso() });
      db.appendJobLog(jobId, "[queue] Job bị hủy khi đang chờ.");
      broadcastJob(jobId);
      return true;
    }
    const cur = this.running.get(jobId);
    if (cur) {
      cur.canceled = true;
      db.updateJob(jobId, { status: "canceled", step: "Đã hủy", finishedAt: nowIso() });
      db.appendJobLog(jobId, "[queue] Job bị hủy - kill process tree.");
      if (cur.child) killTree(cur.child);
      broadcastJob(jobId);
      return true;
    }
    return false;
  }

  private tick(): void {
    while (this.running.size < maxConcurrent()) {
      const busyKeys = new Set([...this.running.values()].map((c) => c.busyKey));
      const idx = this.pending.findIndex((id) => {
        const j = db.getJob(id);
        if (!j || j.status !== "queued") return true;
        return !busyKeys.has(busyKeyOf(j));
      });
      if (idx < 0) break;
      const jobId = this.pending.splice(idx, 1)[0];
      const job = db.getJob(jobId);
      if (!job || job.status !== "queued") {
        this.deps.delete(jobId);
        continue;
      }
      void this.runJob(jobId, busyKeyOf(job));
    }
  }

  private async runJob(jobId: string, busyKey: string): Promise<void> {
    const current: Current = { jobId, busyKey, child: null, canceled: false };
    this.running.set(jobId, current);

    db.updateJob(jobId, { status: "running", startedAt: nowIso(), step: "Bắt đầu", progress: 0 });
    broadcastJob(jobId);

    const ctx = this.makeCtx(jobId, current);
    try {
      const fresh = db.getJob(jobId)!;
      ctx.job = fresh;
      const unmet = this.unmetDependency(jobId);
      if (unmet) throw new Error(unmet);
      if (fresh.type === "scene-draft" || fresh.type === "scene-final") {
        await runSceneRender(ctx);
      } else if (fresh.type === "image-gen") {
        await runImageGen(ctx);
      } else if (fresh.type === "text-to-video") {
        await runTextToVideo(ctx);
      } else if (fresh.type === "translate-video") {
        await runTranslateVideo(ctx);
      } else if (fresh.type === "auto-cut") {
        await runAutoCut(ctx);
      } else if (fresh.type === "auto-trim") {
        await runAutoTrim(ctx);
      } else {
        await runAssemble(ctx);
      }
      if (!current.canceled) {
        db.updateJob(jobId, {
          status: "done",
          progress: 100,
          step: "Hoàn thành",
          finishedAt: nowIso(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      current.flushLog?.();
      db.appendJobLog(jobId, `[error] ${message}`);
      if (!current.canceled) {
        db.updateJob(jobId, {
          status: "failed",
          step: message.slice(0, 200),
          finishedAt: nowIso(),
        });
      }
    } finally {
      current.flushLog?.();
      broadcastJob(jobId);
      this.running.delete(jobId);
      this.tick();
    }
  }

  private makeCtx(jobId: string, current: Current): JobCtx {
    let lastProgress = -1;
    let lastStep = "";

    let pendingLines: string[] = [];
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pendingLines.length) return;
      const lines = pendingLines;
      pendingLines = [];
      db.appendJobLog(jobId, lines.join("\n"));
    };
    current.flushLog = flush;
    const addLogLine = (line: string): void => {
      pendingLines.push(line);
      if (pendingLines.length >= 50) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, 1_000);
        flushTimer.unref?.();
      }
    };

    return {
      job: db.getJob(jobId)!,
      log: (line: string) => {
        const clean = stripAnsi(line);
        addLogLine(clean);
        broadcast("joblog", { jobId, line: clean });
      },
      progress: (progress: number | null, step: string) => {
        if (current.canceled) return;
        const p = progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)));

        const cleanStep = stripAnsi(step).slice(0, MAX_STEP_CHARS);
        const changed = (p !== null && p !== lastProgress) || cleanStep !== lastStep;
        if (!changed) return;
        if (p !== null) lastProgress = p;
        lastStep = cleanStep;
        db.updateJob(jobId, { ...(p !== null ? { progress: p } : {}), step: cleanStep });
        broadcastJob(jobId);
      },
      exec: (file: string, args: string[], cwd: string, onLine?: (line: string) => void) =>
        new Promise<void>((resolve, reject) => {
          if (current.canceled) {
            reject(new Error("Job đã bị hủy"));
            return;
          }
          const command = `${file} ${args.join(" ")}`;
          addLogLine(`[cmd] ${command}`);
          broadcast("joblog", { jobId, line: `[cmd] ${command}` });

          const child = spawn(file, args, {
            cwd,
            windowsHide: true,
            env: childEnv(),
          });
          current.child = child;

          const buffers: Record<"out" | "err", string> = { out: "", err: "" };
          const handleChunk = (which: "out" | "err", chunk: Buffer) => {
            buffers[which] += chunk.toString("utf8");

            const parts = buffers[which].split(/\r\n|\n|\r/);
            buffers[which] = parts.pop() ?? "";
            for (const raw of parts) {
              const line = raw.trimEnd();
              if (!line) continue;
              addLogLine(line);
              broadcast("joblog", { jobId, line });
              onLine?.(line);
            }
          };
          child.stdout?.on("data", (c: Buffer) => handleChunk("out", c));
          child.stderr?.on("data", (c: Buffer) => handleChunk("err", c));

          child.on("error", (err) => {
            current.child = null;
            reject(err);
          });
          child.on("close", (code) => {
            current.child = null;
            for (const which of ["out", "err"] as const) {
              const rest = buffers[which].trim();
              if (rest) {
                addLogLine(rest);
                broadcast("joblog", { jobId, line: rest });
                onLine?.(rest);
              }
            }
            if (current.canceled) reject(new Error("Job đã bị hủy"));
            else if (code === 0) resolve();
            else reject(new Error(`Lệnh thoát với mã ${code ?? "?"}`));
          });
        }),
      isCanceled: () => current.canceled,
    };
  }
}

export const queue = new RenderQueue();
