import { Router } from "express";
import { readBrandLogos, resolveBrandLogo } from "../brandLogos.js";
import { HttpError } from "../util.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(readBrandLogos());
});

router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : "";
  if (!name.trim()) {
    throw new HttpError(
      400,
      "BRAND_NAME_REQUIRED",
      'Thiếu tên brand. Ví dụ: {"name":"OpenAI"}',
    );
  }
  const logo = await resolveBrandLogo(name);
  res.status(logo.added ? 201 : 200).json({
    ...logo,

    relPath: `assets/brand-logos/${logo.file}`,
  });
});

export default router;
