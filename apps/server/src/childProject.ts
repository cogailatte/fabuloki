import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "./config.js";
import * as db from "./db.js";
import { buildEditPrompt, type BriefPromptContext } from "./editPrompt.js";
import {
  briefOf,
  defaultBrief,
  listProjectAssets,
  normTags,
  projectAssetsDirOf,
  projectDirOf,
  projectSummaryOf,
  readAssetEntries,
  readMeta,
  writeAssetEntry,
  writeMeta,
  type Brief,
  type ProjectMeta,
  type ProjectSummary,
  type SceneMeta,
} from "./meta.js";
import { readProjectTranscript } from "./transcript.js";
import { getStyle, type StyleDesign } from "./styles.js";
import { RECOMMENDED_TAG, readLibrary } from "./routes/sfx.js";
import { readMusicLibrary } from "./routes/music.js";
import { HttpError, ensureDir, fileKind, nowIso, toKebabAscii, toRepoRel } from "./util.js";

export function uniqueProjectId(base: string): string {
  const root = toKebabAscii(base) || "project";
  let id = root;
  for (let n = 2; fs.existsSync(projectDirOf(id)); n++) id = `${root}-${n}`;
  return id;
}

export function scaffoldProjectFiles(
  id: string,
  name: string,
  width: number,
  height: number,
): void {
  const dir = projectDirOf(id);
  ensureDir(dir);
  ensureDir(path.join(dir, "compositions"));
  ensureDir(path.join(dir, "assets"));
  ensureDir(path.join(dir, "renders"));

  fs.writeFileSync(path.join(dir, "index.html"), scaffoldIndexHtml(id, name, width, height), "utf8");

  fs.writeFileSync(
    path.join(dir, "hyperframes.json"),
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
        paths: {
          blocks: "compositions",
          components: "compositions/components",
          assets: "assets",
        },
        media: { autoProxy: true },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export function scaffoldIndexHtml(
  id: string,
  name: string,
  width: number,
  height: number,
): string {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(name)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      :where(*) { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #101913;
        font-family: Inter, system-ui, sans-serif;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #101913;
      }
      .placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #f0f4e8;
      }
      .placeholder h1 { font-size: 64px; font-weight: 800; text-align: center; padding: 0 48px; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${escapeHtml(id)}"
      data-start="0"
      data-duration="5"
      data-width="${width}"
      data-height="${height}"
    >
      <div class="placeholder"><h1>${escapeHtml(name)}</h1></div>

    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: 5 }, 0);
      window.__timelines["${escapeHtml(id)}"] = tl;
    </script>
  </body>
</html>
`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bringFile(srcAbs: string, dstAbs: string): void {
  ensureDir(path.dirname(dstAbs));
  if (fs.existsSync(dstAbs)) return;
  if (fileKind(srcAbs) === "other") {
    fs.copyFileSync(srcAbs, dstAbs);
    return;
  }
  try {
    fs.linkSync(srcAbs, dstAbs);
  } catch {
    fs.copyFileSync(srcAbs, dstAbs);
  }
}

function resolveInside(baseDir: string, rel: string, what: string): string {
  const root = path.resolve(baseDir);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new HttpError(400, "PATH_OUTSIDE", `${what} "${rel}" nằm ngoài thư mục cho phép`);
  }
  return abs;
}

function copyDirDeep(srcDir: string, dstDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(dstDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyDirDeep(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

export interface CreateChildProjectInput {

  parentId: string | null;
  name: string;
  width: number;
  height: number;
  fps: number;

  brief: Partial<Brief>;
  scenes?: SceneMeta[];

  audio?: ProjectMeta["audio"];

  copyAssets?: string[];

  copyFiles?: { srcAbs: string; destRel: string }[];

  copyCompositions?: boolean;
}

export function createChildProject(input: CreateChildProjectInput): ProjectSummary {

  const parentMeta = input.parentId === null ? null : readMeta(input.parentId);

  const name = input.name.trim();
  if (!name) throw new HttpError(400, "INVALID_NAME", "Thiếu name cho project con");
  if (
    !Number.isInteger(input.width) ||
    input.width <= 0 ||
    !Number.isInteger(input.height) ||
    input.height <= 0
  ) {
    throw new HttpError(400, "INVALID_SIZE", "width/height phải là số nguyên dương");
  }
  if (!Number.isFinite(input.fps) || input.fps <= 0) {
    throw new HttpError(400, "INVALID_FPS", "fps phải là số dương");
  }

  const id = uniqueProjectId(name);
  scaffoldProjectFiles(id, name, input.width, input.height);

  const parentAssetsDir =
    input.parentId === null ? null : projectAssetsDirOf(input.parentId);
  const childAssetsDir = projectAssetsDirOf(id);
  const parentEntries = input.parentId === null ? {} : readAssetEntries(input.parentId);

  const carryEntry = (srcAbs: string, dstAbs: string): void => {
    const entry = parentEntries[path.basename(srcAbs)];
    if (entry) {
      writeAssetEntry(id, path.basename(dstAbs), {
        description: entry.description,
        colorGrade: entry.colorGrade ?? null,
        colorAdjust: entry.colorAdjust ?? null,
      });
    }
    const effectId = parentEntries[toRepoRel(srcAbs)]?.editEffectId;
    if (effectId !== undefined) {
      writeAssetEntry(id, toRepoRel(dstAbs), { editEffectId: effectId });
    }
  };

  if (parentAssetsDir !== null) {
    for (const rel of input.copyAssets ?? []) {
      const srcAbs = resolveInside(parentAssetsDir, rel, "Asset");
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) continue;
      const relClean = path.relative(parentAssetsDir, srcAbs);
      if (path.basename(relClean) === "assets.json") continue;
      const dstAbs = path.join(childAssetsDir, relClean);
      bringFile(srcAbs, dstAbs);
      carryEntry(srcAbs, dstAbs);
    }
  }

  for (const f of input.copyFiles ?? []) {
    const srcAbs = path.resolve(f.srcAbs);
    if (!srcAbs.startsWith(path.resolve(repoRoot) + path.sep)) {
      throw new HttpError(400, "PATH_OUTSIDE_REPO", `Đường dẫn "${f.srcAbs}" nằm ngoài repo`);
    }
    if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) continue;
    const dstAbs = resolveInside(childAssetsDir, f.destRel, "Đích asset");
    bringFile(srcAbs, dstAbs);
    carryEntry(srcAbs, dstAbs);
  }

  const transcript =
    input.parentId === null || parentAssetsDir === null
      ? null
      : readProjectTranscript(input.parentId);
  if (transcript && parentAssetsDir) {
    const srcAbs = path.join(repoRoot, transcript.relPath);
    if (fs.existsSync(srcAbs)) {

      const relFromAssets = path.relative(parentAssetsDir, srcAbs);
      const dstRel = relFromAssets.startsWith("..")
        ? path.basename(srcAbs)
        : relFromAssets;
      bringFile(srcAbs, path.join(childAssetsDir, dstRel));
    }
  }

  if (input.copyCompositions && input.parentId !== null) {
    copyDirDeep(path.join(projectDirOf(input.parentId), "compositions"), path.join(projectDirOf(id), "compositions"));
  }

  const brief: Brief = {
    ...defaultBrief(),
    ...(parentMeta ? briefOf(parentMeta) : {}),
  };
  for (const [k, v] of Object.entries(input.brief)) {
    if (v === undefined) continue;
    (brief as unknown as Record<string, unknown>)[k] = v;
  }

  const meta: ProjectMeta = {
    id,
    name,
    width: input.width,
    height: input.height,
    fps: input.fps,
    status: "draft",

    parentId: input.parentId,
    brief,
    scenes: (input.scenes ?? []).map((s) => ({ ...s })),
    audio: input.audio ? JSON.parse(JSON.stringify(input.audio)) : { voice: null, sfx: [] },
    output: null,
    tags: normTags(parentMeta?.tags),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeMeta(id, meta);

  const summary = projectSummaryOf(id);
  if (!summary) {
    throw new HttpError(500, "CHILD_CREATE_FAILED", `Không đọc lại được project con "${id}"`);
  }
  return summary;
}

export function sceneAssetPath(relInAssets: string): string {
  return `assets/${toPosix(relInAssets)}`;
}

export function syncBrandLogo(id: string, style: StyleDesign | null): string | null {
  const destDir = projectAssetsDirOf(id);
  const srcRel = style?.logoPath ?? null;
  const srcAbs = srcRel ? path.join(repoRoot, srcRel) : null;
  const hasLogo = Boolean(srcAbs && fs.existsSync(srcAbs));
  const ext = srcRel ? path.extname(srcRel).toLowerCase() || ".png" : "";
  const fileName = hasLogo ? `brand-logo${ext}` : "";

  if (fs.existsSync(destDir)) {
    for (const f of fs.readdirSync(destDir)) {
      if (/^brand-logo\./i.test(f) && f !== fileName) {
        try {
          fs.rmSync(path.join(destDir, f), { force: true });
          writeAssetEntry(id, f, { description: "" });
        } catch {

        }
      }
    }
  }
  if (!hasLogo || !srcAbs || !style) return null;

  ensureDir(destDir);
  const destAbs = path.join(destDir, fileName);
  try {
    fs.copyFileSync(srcAbs, destAbs);
  } catch {

    return fs.existsSync(destAbs) ? fileName : null;
  }

  writeAssetEntry(id, fileName, {
    description:
      `Logo thương hiệu "${style.name}" - BẮT BUỘC dùng đúng file ảnh này khi video cần logo. ` +
      "Không tự vẽ lại, không thay bằng chữ tên thương hiệu.",
  });
  return fileName;
}

export function briefPromptContextOf(id: string, meta: ProjectMeta): BriefPromptContext {
  const brief = briefOf(meta);
  const recommendedSfx =
    brief.sfxMode === "recommended"
      ? readLibrary().filter(
          (e) => e.tags.includes(RECOMMENDED_TAG) && fs.existsSync(path.join(paths.sfxDir, e.file)),
        )
      : [];

  const music =
    brief.musicMode === "auto"
      ? readMusicLibrary().filter((e) => fs.existsSync(path.join(paths.musicDir, e.file)))
      : [];

  const style = getStyle(brief.styleId);

  const brandLogoFile = syncBrandLogo(id, style);
  return { brief, style, brandLogoFile, recommendedSfx, music };
}

export function prepareEditSession(input: {
  id: string;
  meta: ProjectMeta;
  extraNotes?: string;
  model?: string | null;
  effort?: string | null;
}): { sessionId: string; prompt: string } {
  const { id, meta } = input;
  const ctx = briefPromptContextOf(id, meta);

  const prompt = buildEditPrompt({
    id,
    meta,
    ...ctx,
    assets: listProjectAssets(id),
    extraNotes: input.extraNotes ?? "",
  });

  const sessionId = `sess_${nanoid()}`;

  db.createChatSession(
    sessionId,
    `Edit: ${meta.name || id}`,
    id,
    input.model ?? null,
    input.effort ?? null,
    "final",
  );
  return { sessionId, prompt };
}
