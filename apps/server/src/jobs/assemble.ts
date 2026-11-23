import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { updateJob } from "../db.js";
import type { JobCtx } from "../queue.js";
import {
  briefOf,
  projectDirOf,
  readMeta,
  writeMeta,
  type ProjectMeta,
  type SceneMeta,
} from "../meta.js";
import { syncBrandLogo } from "../childProject.js";
import { getStyle } from "../styles.js";
import {
  dropNullOptionalKeys,
  isRenderStale,
  probeMediaInfo,
  sceneDurationFrames,
  sceneRenderState,
} from "../timeline.js";
import { ensureDir, remotionCli } from "../util.js";
import { remotionSpeedArgs } from "../renderSettings.js";
import { parseProgressLine, shortenStep } from "./progress.js";

export async function runAssemble(ctx: JobCtx): Promise<void> {
  const { projectId, type } = ctx.job;
  const draft = type === "assemble-draft";
  const projectDir = projectDirOf(projectId);
  const meta = readMeta(projectId);

  ctx.progress(0, "Stage asset vào Remotion staging");

  const stagingId = `vid-${projectId}`;
  const stagingAbs = path.join(paths.stagingDir, stagingId);
  fs.rmSync(stagingAbs, { recursive: true, force: true });
  ensureDir(stagingAbs);

  const keyOf = (s: string): string => (process.platform === "win32" ? s.toLowerCase() : s);
  const staged = new Map<string, string>();

  const flatOwner = new Map<string, { rel: string; srcKey: string; publicRel: string }>();
  const stage = (relFromProject: string): string => {
    const srcAbs = path.join(projectDir, relFromProject);

    const resolved = path.resolve(srcAbs);
    if (!resolved.startsWith(path.resolve(projectDir) + path.sep)) {
      throw new Error(
        `Đường dẫn asset "${relFromProject}" nằm ngoài project ${projectId} - từ chối stage`,
      );
    }
    const srcKey = keyOf(resolved);
    const cached = staged.get(srcKey);
    if (cached) return cached;
    if (!fs.existsSync(srcAbs)) {
      throw new Error(`Thiếu asset "${relFromProject}" trong project ${projectId}`);
    }

    const flat = relFromProject.split(/[\\/]+/).join("__");
    const dstAbs = path.join(stagingAbs, flat);
    const publicRel = `staging/${stagingId}/${flat}`;

    const owner = flatOwner.get(keyOf(flat));
    if (owner) {
      if (owner.srcKey === srcKey) {
        staged.set(srcKey, owner.publicRel);
        return owner.publicRel;
      }
      throw new Error(
        `Xung đột tên khi stage: "${relFromProject}" và "${owner.rel}" ` +
          `cùng flatten về "${flat}" - đổi tên một trong hai file trong project ${projectId}`,
      );
    }
    if (fs.existsSync(dstAbs)) {

      throw new Error(
        `File staging "${flat}" đã tồn tại trước khi stage "${relFromProject}" - staging chưa sạch, chạy lại job`,
      );
    }
    try {
      fs.linkSync(srcAbs, dstAbs);
    } catch {
      fs.copyFileSync(srcAbs, dstAbs);
    }
    staged.set(srcKey, publicRel);
    flatOwner.set(keyOf(flat), { rel: relFromProject, srcKey, publicRel });
    ctx.log(`[stage] ${relFromProject} -> ${publicRel}`);
    return publicRel;
  };

  const props = JSON.parse(JSON.stringify(meta)) as ProjectMeta;

  dropNullOptionalKeys(props as unknown as Record<string, unknown>);

  for (const scene of props.scenes ?? []) {
    if (typeof scene.src === "string" && scene.src) {

      scene.render = stage(pickSceneRender(ctx, projectDir, scene, draft));
    } else if (
      (typeof scene.srcVideo === "string" && scene.srcVideo) ||
      (typeof scene.srcImage === "string" && scene.srcImage)
    ) {

      if (scene.render != null) {
        if (typeof scene.render === "string" && scene.render) {
          ctx.log(`[warn] Scene "${scene.id}" có cả render lẫn footage - bỏ field render thừa`);
        }
        delete scene.render;
      }
    } else if (typeof scene.render === "string" && scene.render) {

      if (!fs.existsSync(path.join(projectDir, scene.render))) {
        throw new Error(
          `Scene "${scene.id}": không thấy file render "${scene.render}" trong project ${projectId}`,
        );
      }
      scene.render = stage(scene.render);
    }
    if (typeof scene.srcVideo === "string" && scene.srcVideo) {
      scene.srcVideo = stage(scene.srcVideo);
    }

    if (typeof scene.srcImage === "string" && scene.srcImage) {
      scene.srcImage = stage(scene.srcImage);
    }
  }

  {

    const frameOf = (scene: SceneMeta): number | null =>
      sceneDurationFrames(scene as unknown as Record<string, unknown>, props.fps);
    const scenes = props.scenes ?? [];
    for (let i = 0; i < scenes.length; i++) {
      const overlap = scenes[i].transitionOverlap;
      if (typeof overlap !== "number" || overlap <= 0) continue;
      const cur = frameOf(scenes[i]);
      const next = i + 1 < scenes.length ? frameOf(scenes[i + 1]) : null;
      if (cur === null || next === null) continue;
      const limit = Math.max(0, Math.min(cur, next));
      if (overlap > limit) {
        ctx.log(
          `[warn] Scene "${scenes[i].id}": transitionOverlap ${overlap} vượt thời lượng scene liền kề - kẹp về ${limit}`,
        );
        scenes[i].transitionOverlap = limit;
      }
    }
  }

  const brief = briefOf(meta);
  const logoFile = syncBrandLogo(projectId, getStyle(brief.styleId));
  if (logoFile) {
    (props as ProjectMeta & { watermark?: unknown }).watermark = {
      file: stage(path.posix.join("assets", logoFile)),
      position: "top-left",
    };
    ctx.log(`[watermark] logo góc trên trái: assets/${logoFile}`);
  } else {

    (props as ProjectMeta & { watermark?: unknown }).watermark = null;
    ctx.log("[watermark] Style Design không có logo - video không đóng logo");
  }

  if (props.audio) {
    if (typeof props.audio.voice === "string" && props.audio.voice) {
      props.audio.voice = stage(props.audio.voice);
    }

    (props.audio.sfx ?? []).forEach((sfx, i) => {
      const label = `audio.sfx[${i}] (file "${typeof sfx.file === "string" ? sfx.file : "?"}")`;
      if (typeof sfx.atFrame !== "number" || !Number.isInteger(sfx.atFrame) || sfx.atFrame < 0) {
        throw new Error(
          `${label}: atFrame phải là số nguyên >= 0 (hiện tại: ${JSON.stringify(sfx.atFrame)}) - sửa meta.json rồi chạy lại`,
        );
      }
      if (
        sfx.volume !== undefined &&
        (typeof sfx.volume !== "number" || sfx.volume < 0 || sfx.volume > 1)
      ) {
        throw new Error(
          `${label}: volume phải nằm trong khoảng 0..1 (hiện tại: ${JSON.stringify(sfx.volume)})`,
        );
      }
      const mediaStart = sfx.mediaStart;
      if (
        mediaStart !== undefined &&
        (typeof mediaStart !== "number" || !Number.isFinite(mediaStart) || mediaStart < 0)
      ) {
        throw new Error(
          `${label}: mediaStart phải là số >= 0 (hiện tại: ${JSON.stringify(mediaStart)})`,
        );
      }
    });
    for (const sfx of props.audio.sfx ?? []) {
      if (typeof sfx.file !== "string" || !sfx.file) continue;

      const rel = sfx.file;
      sfx.file = stage(rel);
      if (typeof sfx.fadeOutSec === "number" && sfx.fadeOutSec > 0) {
        const info = await probeMediaInfo(path.join(projectDir, rel));
        if (info?.durationSec) sfx.mediaDurationSec = info.durationSec;
      }
    }

    const music = props.audio.music;
    if (music && typeof music.file === "string" && music.file) {
      music.file = stage(music.file);
    }
  }

  const layers = (props as ProjectMeta & { layers?: unknown }).layers;
  if (Array.isArray(layers)) {
    for (const layer of layers as Array<Record<string, unknown>>) {
      if (!layer || typeof layer !== "object") continue;
      if (typeof layer.src !== "string" || !layer.src) continue;
      const rel = layer.src;
      layer.src = stage(rel);
      const info = await probeMediaInfo(path.join(projectDir, rel));
      if (info?.width && info.height) layer.mediaAspect = info.width / info.height;
    }
  }

  const propsAbs = path.join(projectDir, "props.resolved.json");
  fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2) + "\n", "utf8");
  ctx.log(`[props] Đã ghi ${propsAbs}`);

  ensureDir(paths.outputsDir);
  const outName = draft ? `${projectId}-draft.mp4` : `${projectId}-v${nextVersion(projectId)}.mp4`;
  const outAbs = path.join(paths.outputsDir, outName);

  ctx.progress(0, "Remotion render Assemble");

  const args = [
    remotionCli(),
    "render",
    "Assemble",
    `--props=${propsAbs}`,
    `--output=${outAbs}`,
    ...remotionSpeedArgs(),
    ...(draft ? ["--crf", "28", "--x264-preset", "veryfast"] : []),
  ];
  await ctx.exec(process.execPath, args, paths.remotionDir, (line) => {
    const pct = parseProgressLine(line);
    if (pct !== null) ctx.progress(pct, shortenStep(line));
  });

  if (!fs.existsSync(outAbs)) {
    throw new Error(`Remotion render xong nhưng không thấy file ${outName}`);
  }

  const outputRel = `outputs/${outName}`;
  updateJob(ctx.job.id, { outputPath: outputRel });

  if (!draft) {
    const freshMeta = readMeta(projectId);
    freshMeta.status = "done";
    freshMeta.output = outputRel;
    writeMeta(projectId, freshMeta);
    ctx.log(`[meta] Cập nhật status=done, output=${outputRel}`);
  }
}

function pickSceneRender(ctx: JobCtx, projectDir: string, scene: SceneMeta, draft: boolean): string {
  const st = sceneRenderState(projectDir, scene as unknown as Record<string, unknown>);
  const want = draft
    ? { rel: st.draftRel, mtime: st.draftMtime }
    : { rel: st.finalRel, mtime: st.finalMtime };
  const alt = draft
    ? { rel: st.finalRel, mtime: st.finalMtime }
    : { rel: st.draftRel, mtime: st.draftMtime };
  const jobType = `scene-${draft ? "draft" : "final"}`;
  const staleError = (rel: string): Error =>
    new Error(
      `Scene "${scene.id}": bản render ${rel} CŨ HƠN composition ${String(scene.src)} ` +
        `(composition đã sửa sau lần render đó) - lắp vào là ra nội dung cũ. ` +
        `Chạy lại job ${jobType} cho scene này rồi lắp lại.`,
    );

  if (want.mtime !== null && !isRenderStale(want.mtime, st)) return want.rel;

  if (!draft && want.mtime !== null) throw staleError(want.rel);
  if (alt.mtime !== null && alt.rel !== want.rel) {
    if (isRenderStale(alt.mtime, st)) throw staleError(want.mtime !== null ? want.rel : alt.rel);
    ctx.log(
      want.mtime === null
        ? `[warn] Không thấy ${want.rel}, dùng tạm ${alt.rel}`
        : `[warn] ${want.rel} cũ hơn composition, dùng ${alt.rel} (mới hơn)`,
    );
    return alt.rel;
  }
  if (want.mtime !== null) throw staleError(want.rel);
  throw new Error(`Scene "${scene.id}" chưa được render (${want.rel}). Chạy job ${jobType} trước.`);
}

function nextVersion(projectId: string): number {
  let max = 0;
  if (fs.existsSync(paths.outputsDir)) {
    const re = new RegExp(`^${escapeRegExp(projectId)}-v(\\d+)\\.mp4$`, "i");
    for (const name of fs.readdirSync(paths.outputsDir)) {
      const m = re.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
