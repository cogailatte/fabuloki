import { Router } from "express";
import * as db from "../db.js";
import { priceFor } from "../pricing.js";

const router = Router();

router.get("/summary", (_req, res) => {
  res.json({ byProject: db.tokensByProject(), total: db.usageTotals() });
});

router.get("/timeline", (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const scope: db.UsageScope =
    req.query.scope === "video" || req.query.scope === "image" ? req.query.scope : "all";
  res.json(db.usageTimeline(days, scope));
});

router.get("/by-model", (req, res) => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.max(1, raw)) : undefined;
  const rows = db.usageByModel(days).map((r) => {
    const price = priceFor(r.model, r.provider);
    if (!price) return { ...r, price: null, costInUsd: null, costOutUsd: null };

    const weightIn = (r.tokensIn / 1e6) * price.inPerM;
    const weightOut = (r.tokensOut / 1e6) * price.outPerM;
    const weight = weightIn + weightOut;

    const costInUsd = weight > 0 ? (r.costUsd * weightIn) / weight : r.costUsd;
    return { ...r, price, costInUsd, costOutUsd: r.costUsd - costInUsd };
  });
  res.json(rows);
});

export default router;
