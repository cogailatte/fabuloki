import { Router } from "express";
import { nanoid } from "nanoid";
import { projectExists } from "../meta.js";
import { HttpError } from "../util.js";

const SESSION_TTL_MS = 60 * 60 * 1000;

interface UploadSession {
  projectId: string;
  expiresAt: number;
}

const sessions = new Map<string, UploadSession>();

function prune(): void {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(token);
  }
}

export function isKnownUploadToken(token: string): boolean {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function hasLiveUploadSessions(): boolean {
  prune();
  return sessions.size > 0;
}

export function isValidUploadToken(token: string, projectId: string): boolean {
  if (!token || !projectId) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return s.projectId === projectId;
}

const router = Router();

router.post("/", (req, res) => {
  prune();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!projectId) throw new HttpError(400, "PROJECT_ID_REQUIRED", "Thiếu projectId");
  if (!projectExists(projectId)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${projectId}"`);
  }
  const token = `ut_${nanoid(24)}`;
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { projectId, expiresAt });
  res.status(201).json({ token, expiresAt: new Date(expiresAt).toISOString() });
});

router.delete("/:token", (req, res) => {
  prune();
  sessions.delete(req.params.token);
  res.status(204).end();
});

export default router;
