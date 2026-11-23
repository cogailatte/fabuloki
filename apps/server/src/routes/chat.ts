import { Router } from "express";
import { nanoid } from "nanoid";
import { cancelPendingResume, interruptAgent, runAgent } from "../agent.js";
import * as db from "../db.js";
import { parseModelEffort } from "./providers.js";
import { HttpError } from "../util.js";

const router = Router();

function sessionToApi<T extends { autoResume: number }>(row: T): Omit<T, "autoResume"> & {
  autoResume: boolean;
} {
  return { ...row, autoResume: row.autoResume !== 0 };
}

router.get("/sessions", (req, res) => {
  const projectId =
    typeof req.query.projectId === "string" && req.query.projectId.trim()
      ? req.query.projectId.trim()
      : undefined;
  res.json(db.listChatSessions(projectId).map(sessionToApi));
});

router.get("/:sessionId/messages", (req, res) => {
  const sessionId = req.params.sessionId;
  if (!db.getChatSession(sessionId)) {
    throw new HttpError(404, "SESSION_NOT_FOUND", `Không tìm thấy phiên chat "${sessionId}"`);
  }
  res.json(db.listChatMessages(sessionId));
});

router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new HttpError(400, "MESSAGE_REQUIRED", "Thiếu message");
  const { model, effort } = parseModelEffort(body);

  let sessionId: string;
  if (typeof body.sessionId === "string" && body.sessionId.trim()) {
    sessionId = body.sessionId.trim();
    if (!db.getChatSession(sessionId)) {
      throw new HttpError(404, "SESSION_NOT_FOUND", `Không tìm thấy phiên chat "${sessionId}"`);
    }

    db.setChatSessionModelEffort(sessionId, model, effort);
  } else {
    sessionId = `sess_${nanoid()}`;
    const projectId =
      typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

    db.createChatSession(sessionId, message.slice(0, 60), projectId, model ?? null, effort ?? null);
  }

  res.status(202).json({ sessionId });
  void runAgent(sessionId, message);
});

router.put("/:sessionId/auto-resume", (req, res) => {
  const sessionId = req.params.sessionId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.enabled !== "boolean") {
    throw new HttpError(400, "INVALID_ENABLED", "enabled phải là boolean");
  }
  if (!db.getChatSession(sessionId)) {
    throw new HttpError(404, "SESSION_NOT_FOUND", `Không tìm thấy phiên chat "${sessionId}"`);
  }
  db.setChatAutoResume(sessionId, body.enabled);

  if (!body.enabled) cancelPendingResume(sessionId);
  res.status(204).end();
});

router.post("/:sessionId/interrupt", async (req, res) => {
  const sessionId = req.params.sessionId;
  if (!db.getChatSession(sessionId)) {
    throw new HttpError(404, "SESSION_NOT_FOUND", `Không tìm thấy phiên chat "${sessionId}"`);
  }
  await interruptAgent(sessionId);
  res.status(204).end();
});

export default router;
