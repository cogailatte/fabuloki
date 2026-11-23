import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ASPECT_SIZE, generateImage, isImageProviderChoice } from "../imageProviders/index.js";
import { activeVideoStyleId, briefOf, projectExists, readMeta, writeAssetEntry } from "../meta.js";
import { getStyle, styleExists } from "../styles.js";
import { getVideoStyle } from "../videoStyles.js";
import { paths } from "../config.js";
import { HttpError, ensureDir, toKebabAscii } from "../util.js";
import { IMAGE_TEXT_POSITIONS, type ImageAspect, type ImageTextPosition } from "../imageMeta.js";

const ASPECTS: ImageAspect[] = ["9:16", "16:9", "1:1", "4:5"];

const router = Router();

router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!projectId || !projectExists(projectId)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy video project "${projectId}"`);
  }

  const brief = briefOf(readMeta(projectId));
  if (!brief.autoIllustrations) {
    throw new HttpError(
      409,
      "ILLUSTRATIONS_DISABLED",
      `Project "${projectId}" đang TẮT "Ảnh minh họa AI" - không sinh ảnh cho video này. ` +
        "Dựng hình bằng scene HyperFrames và asset có sẵn; muốn dùng ảnh AI thì bật công tắc " +
        "đó trong Kịch bản edit rồi chạy lại.",
    );
  }
  if (!prompt) {
    throw new HttpError(400, "PROMPT_REQUIRED", "Thiếu prompt mô tả nội dung ảnh minh họa");
  }

  const meta = readMeta(projectId);
  const aspect = ASPECTS.includes(body.aspect as ImageAspect) ? (body.aspect as ImageAspect) : undefined;
  const size = aspect ? ASPECT_SIZE[aspect] : { width: meta.width, height: meta.height };
  if (body.provider !== undefined && body.provider !== null && !isImageProviderChoice(body.provider)) {
    throw new HttpError(
      400,
      "INVALID_PROVIDER",
      'provider phải là một trong: "auto", "gemini-api"',
    );
  }
  const provider = typeof body.provider === "string" ? body.provider : undefined;

  const model =
    typeof body.model === "string" && body.model ? body.model : (brief.illustrationModel ?? undefined);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if ("styleId" in body && body.styleId !== null && typeof body.styleId !== "string") {
    throw new HttpError(400, "INVALID_STYLE_ID", "styleId phải là string hoặc null");
  }
  const styleId = typeof body.styleId === "string" ? body.styleId.trim() : "";
  if (styleId && !styleExists(styleId)) {
    throw new HttpError(404, "STYLE_NOT_FOUND", `Không tìm thấy style "${styleId}"`);
  }
  if ("allowText" in body && typeof body.allowText !== "boolean") {
    throw new HttpError(400, "INVALID_ALLOW_TEXT", "allowText phải là boolean");
  }
  if (
    "position" in body &&
    !IMAGE_TEXT_POSITIONS.includes(body.position as ImageTextPosition)
  ) {
    throw new HttpError(
      400,
      "INVALID_POSITION",
      `position phải là một trong: ${IMAGE_TEXT_POSITIONS.join(" | ")}`,
    );
  }

  const base =
    toKebabAscii(typeof body.name === "string" ? body.name : prompt.slice(0, 40)) || "minh-hoa";
  const dir = path.join(paths.videoProjectsDir, projectId, "assets", "illustrations");
  ensureDir(dir);

  let fileName = "";
  for (let n = 1; ; n++) {
    fileName = n === 1 ? `${base}.png` : `${base}-${n}.png`;
    try {
      fs.closeSync(fs.openSync(path.join(dir, fileName), "wx"));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  const outFile = path.join(dir, fileName);

  const design = getStyle(styleId || brief.styleId || null);

  const allowText = typeof body.allowText === "boolean" ? body.allowText : brief.illustrationText;

  const videoStyle = getVideoStyle(activeVideoStyleId(brief));
  let promptUsed: string;
  let usedProvider: string;
  try {
    ({ promptUsed, provider: usedProvider } = await generateImage({
      prompt,
      kind: "concept",
      aspect,
      width: size.width,
      height: size.height,
      design,
      outFile,
      usageProjectId: projectId,
      provider,
      model,
      allowText,
      videoStyle,

      layout: "video",

      subjectPosition:
        (body.position as ImageTextPosition | undefined) ??
        brief.illustrationPosition ??
        "auto",
    }));
  } catch (err) {

    fs.rmSync(outFile, { force: true });
    throw err;
  }

  if (description) {
    writeAssetEntry(projectId, fileName, { description });
  }

  res.status(201).json({
    file: fileName,
    relPath: `video-projects/${projectId}/assets/illustrations/${fileName}`,
    promptUsed,
    provider: usedProvider,
  });
});

export default router;
