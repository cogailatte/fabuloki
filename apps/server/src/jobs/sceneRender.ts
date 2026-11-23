import fs from "node:fs";
import path from "node:path";
import { updateJob } from "../db.js";
import type { JobCtx } from "../queue.js";
import { projectDirOf, readMeta, type SceneMeta } from "../meta.js";
import { ensureDir, hyperframesCli } from "../util.js";
import { hyperframesSpeedArgs } from "../renderSettings.js";
import { parseProgressLine } from "./progress.js";

export async function runSceneRender(ctx: JobCtx): Promise<void> {
  const { projectId, type, sceneId } = ctx.job;
  const draft = type === "scene-draft";
  const projectDir = projectDirOf(projectId);
  const meta = readMeta(projectId);

  let scenes: SceneMeta[] = (meta.scenes ?? []).filter(
    (s): s is SceneMeta => typeof s.src === "string" && s.src.length > 0,
  );
  if (sceneId) {
    scenes = scenes.filter((s) => s.id === sceneId);
    if (!scenes.length) {
      throw new Error(`Không tìm thấy scene "${sceneId}" có \`src\` trong meta.json`);
    }
  }
  if (!scenes.length) {
    throw new Error("meta.json không có scene nào có `src` để render");
  }

  ensureDir(path.join(projectDir, "renders"));

  const total = scenes.length;
  let lastOutputRel = "";

  for (let i = 0; i < total; i++) {
    const scene = scenes[i];
    if (ctx.isCanceled()) return;

    const finalRel =
      typeof scene.render === "string" && scene.render ? scene.render : `renders/${scene.id}.mp4`;
    const outRel = draft ? finalRel.replace(/\.mp4$/i, ".draft.mp4") : finalRel;

    const insideProject = (rel: string): boolean =>
      path.resolve(projectDir, rel).startsWith(path.resolve(projectDir) + path.sep);
    if (
      String(scene.src).startsWith("-") ||
      !insideProject(String(scene.src)) ||
      !insideProject(outRel) ||
      !insideProject(path.join("renders", ".tmp", `${ctx.job.id}-${scene.id}.mp4`))
    ) {
      throw new Error(`Scene "${scene.id}": src/render phải là đường dẫn nằm trong project`);
    }
    ensureDir(path.dirname(path.join(projectDir, outRel)));

    const tmpRel = path.posix.join("renders", ".tmp", `${ctx.job.id}-${scene.id}.mp4`);
    const tmpAbs = path.join(projectDir, tmpRel);
    ensureDir(path.dirname(tmpAbs));
    const quality = draft ? "draft" : "standard";
    const label = `Scene ${scene.id} (${i + 1}/${total})`;
    ctx.progress(Math.floor((i / total) * 100), label);
    ctx.log(`[scene] ${label} - quality ${quality}`);

    const args = [
      hyperframesCli(),
      "render",
      "-c",
      String(scene.src),
      "--quality",
      quality,
      ...hyperframesSpeedArgs(draft),
      "--output",
      tmpRel,
    ];
    const outAbs = path.join(projectDir, outRel);
    try {
      await ctx.exec(process.execPath, args, projectDir, (line) => {
        const pct = parseProgressLine(line);
        if (pct !== null) {

          ctx.progress(Math.floor(((i + pct / 100) / total) * 100), label);
        }
      });
      if (ctx.isCanceled()) return;
      if (!fs.existsSync(tmpAbs) || fs.statSync(tmpAbs).size === 0) {
        throw new Error(`Render xong nhưng không thấy file ${outRel} - kiểm tra log hyperframes`);
      }

      try {
        fs.renameSync(tmpAbs, outAbs);
      } catch {
        fs.copyFileSync(tmpAbs, outAbs);
      }
    } finally {
      fs.rmSync(tmpAbs, { force: true });
    }
    lastOutputRel = `video-projects/${projectId}/${outRel}`;
  }

  updateJob(ctx.job.id, { outputPath: lastOutputRel });
}
