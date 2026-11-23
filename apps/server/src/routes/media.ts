import path from "node:path";
import express, { Router } from "express";
import { paths } from "../config.js";

const router = Router();

const whitelist: Record<string, string> = {
  "video-projects": paths.videoProjectsDir,
  "image-projects": paths.imageProjectsDir,

  "translate-video": paths.translateVideoDir,
  assets: paths.assetsDir,
  outputs: paths.outputsDir,
  imports: paths.importsDir,

  "remotion-fonts": paths.remotionFontsDir,
};

const FORCE_DOWNLOAD_EXT = new Set([
  ".html",
  ".htm",
  ".shtml",
  ".xhtml",
  ".xht",
  ".xml",
  ".xsl",
  ".xslt",
  ".svgz",
]);

const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

for (const [prefix, dir] of Object.entries(whitelist)) {
  router.use(
    `/${prefix}`,
    express.static(dir, {
      dotfiles: "deny",
      index: false,
      fallthrough: true,
      setHeaders: (res, filePath) => {

        res.setHeader("X-Content-Type-Options", "nosniff");
        const ext = path.extname(filePath).toLowerCase();
        if (FORCE_DOWNLOAD_EXT.has(ext)) {

          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Disposition", "attachment");
        }

        if (ext !== ".pdf") res.setHeader("Content-Security-Policy", SANDBOX_CSP);
      },
    }),
  );
}

router.use((_req, res) => {
  res.status(404).json({ error: { code: "MEDIA_NOT_FOUND", message: "Không tìm thấy file" } });
});

export default router;
