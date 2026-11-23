import fs from "node:fs";
import path from "node:path";
import { paths, repoRoot } from "../config.js";
import { updateJob } from "../db.js";
import { generateImage } from "../imageProviders/index.js";
import {
  IMAGE_GEN_STEPS,
  imageDirOf,
  readImageMeta,
  writeImageMeta,
  type ImageGenStep,
} from "../imageMeta.js";
import type { JobCtx } from "../queue.js";
import { remotionGlArgs } from "../renderSettings.js";
import { getStyle } from "../styles.js";
import { ensureDir, remotionCli } from "../util.js";
import { parseProgressLine, shortenStep } from "./progress.js";

export async function runImageGen(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const rawStep = ctx.job.sceneId ?? "all";
  const step: ImageGenStep = IMAGE_GEN_STEPS.includes(rawStep as ImageGenStep)
    ? (rawStep as ImageGenStep)
    : "all";

  const meta = readImageMeta(id);
  meta.status = "generating";
  meta.error = null;
  writeImageMeta(id, meta);

  try {
    if (step === "all" || step === "background") await stepBackground(ctx, id);
    if (step === "all" || step === "compose") await stepCompose(ctx, id);

    const done = readImageMeta(id);

    done.status = step === "background" ? "draft" : "done";
    done.error = null;
    writeImageMeta(id, done);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const failed = readImageMeta(id);
      failed.status = "error";
      failed.error = message;
      writeImageMeta(id, failed);
    } catch {

    }
    throw err;
  }
}

async function orCanceled<T>(p: Promise<T>, ctx: JobCtx): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const canceled = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (ctx.isCanceled()) reject(new Error("Job đã bị hủy"));
    }, 500);
  });
  try {
    return await Promise.race([p, canceled]);
  } finally {
    clearInterval(timer);
  }
}

async function stepBackground(ctx: JobCtx, id: string): Promise<void> {
  const meta = readImageMeta(id);
  const design = getStyle(meta.styleId);

  ctx.progress(5, "AI tạo ảnh nền");
  ctx.log(
    `[image] kind=${meta.kind} aspect=${meta.aspect} model=${meta.model ?? "(mặc định)"}`,
  );

  const bgAbs = path.join(imageDirOf(id), "background.png");
  const tmpAbs = path.join(imageDirOf(id), `background.${ctx.job.id}.tmp.png`);
  const generation = generateImage({
    prompt: meta.prompt,
    kind: meta.kind,
    aspect: meta.aspect,
    design,
    outFile: tmpAbs,
    usageProjectId: id,
    model: meta.model ?? undefined,

    onLog: (l) => ctx.log(l),
    isCanceled: () => ctx.isCanceled(),
  });
  let result: Awaited<typeof generation>;
  try {
    result = await orCanceled(generation, ctx);
  } catch (err) {

    void generation
      .catch(() => undefined)
      .finally(() => fs.rmSync(tmpAbs, { force: true }));
    throw err;
  }
  if (ctx.isCanceled()) {
    fs.rmSync(tmpAbs, { force: true });
    throw new Error("Job đã bị hủy");
  }
  fs.renameSync(tmpAbs, bgAbs);
  ctx.log(`[image] provider=${result.provider} prompt: ${result.promptUsed}`);

  const fresh = readImageMeta(id);
  fresh.background = "background.png";
  writeImageMeta(id, fresh);
  ctx.progress(40, "Đã có ảnh nền");
}

async function stepCompose(ctx: JobCtx, id: string): Promise<void> {
  const meta = readImageMeta(id);
  const design = getStyle(meta.styleId);

  ctx.progress(45, "Stage asset cho Remotion");
  const stagingId = `img-${id}`;
  const stagingAbs = path.join(paths.stagingDir, stagingId);
  fs.rmSync(stagingAbs, { recursive: true, force: true });
  ensureDir(stagingAbs);

  const stage = (srcAbs: string, prefix: string): string => {

    const resolved = path.resolve(srcAbs);
    if (!resolved.startsWith(path.resolve(repoRoot) + path.sep)) {
      throw new Error(`Đường dẫn "${srcAbs}" nằm ngoài repo - từ chối stage`);
    }
    const name = prefix + path.basename(srcAbs);
    const dstAbs = path.join(stagingAbs, name);
    try {
      fs.linkSync(srcAbs, dstAbs);
    } catch {
      fs.copyFileSync(srcAbs, dstAbs);
    }
    const publicRel = `staging/${stagingId}/${name}`;
    ctx.log(`[stage] ${srcAbs} -> ${publicRel}`);
    return publicRel;
  };

  let background: string | null = null;
  if (meta.background) {
    const bgAbs = path.join(imageDirOf(id), meta.background);
    if (fs.existsSync(bgAbs)) background = stage(bgAbs, "bg-");
    else ctx.log(`[warn] Không thấy nền ${meta.background} - dùng nền gradient từ design`);
  }

  let logoFile: string | null = null;
  if (design.logoPath) {
    const logoAbs = path.join(repoRoot, design.logoPath);
    if (fs.existsSync(logoAbs)) logoFile = stage(logoAbs, "logo-");
    else ctx.log(`[warn] Không thấy logo ${design.logoPath} - bỏ qua logo`);
  }

  const stageFont = (rel: string | null, prefix: string): string | null => {
    if (!rel) return null;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      ctx.log(`[warn] Không thấy font ${rel} - dùng font fallback hệ thống`);
      return null;
    }
    return stage(abs, prefix);
  };
  const fontFiles = {
    heading: stageFont(design.fontFiles.heading, "font-h-"),
    body: stageFont(design.fontFiles.body, "font-b-"),
  };

  const props = {
    aspect: meta.aspect,
    background,
    design: {
      colors: design.colors,
      fonts: design.fonts,
      fontFiles,
      logoFile,
      effects: design.effects,

      brandName: design.name,
    },
    overlay: meta.overlay,
  };
  const propsAbs = path.join(imageDirOf(id), "props.json");
  fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2) + "\n", "utf8");
  ctx.log(`[props] Đã ghi ${propsAbs}`);

  const outAbs = path.join(imageDirOf(id), "final.png");
  ctx.progress(50, "Remotion render Poster");
  const args = [
    remotionCli(),
    "still",
    "Poster",
    `--props=${propsAbs}`,
    `--output=${outAbs}`,
    ...remotionGlArgs(),
  ];
  await ctx.exec(process.execPath, args, paths.remotionDir, (line) => {
    const pct = parseProgressLine(line);
    if (pct !== null) ctx.progress(50 + pct / 2, shortenStep(line));
  });

  if (!fs.existsSync(outAbs)) {
    throw new Error("Remotion still xong nhưng không thấy file final.png");
  }

  const fresh = readImageMeta(id);
  fresh.final = "final.png";
  writeImageMeta(id, fresh);
  updateJob(ctx.job.id, { outputPath: `image-projects/${id}/final.png` });
}
