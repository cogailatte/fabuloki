import { Router } from "express";
import { listImageProviders } from "../imageProviders/index.js";

const router = Router();
router.get("/", (_req, res) => res.json(listImageProviders()));
export default router;
