import { Router } from "express";
import * as db from "../db.js";
import { scanProjects } from "../meta.js";
import { getHealth } from "./health.js";

const router = Router();

router.get("/", async (_req, res) => {

  const running = db.getRunningJobs();
  const recentJobs = db.listJobs(5).map(db.jobToApi);

  const usage = db.tokensByProject();
  const recentProjects = scanProjects()
    .slice(0, 6)
    .map((s) => ({
      ...s,
      tokensUsed: usage[s.id]?.tokens ?? 0,
      costUsd: usage[s.id]?.costUsd ?? 0,
    }));
  const health = await getHealth();

  res.json({

    runningJob: running.length > 0 ? db.jobToApi(running[0]) : null,
    runningJobs: running.map(db.jobToApi),
    queuedCount: db.countQueuedJobs(),
    recentJobs,
    recentProjects,
    health,
  });
});

export default router;
