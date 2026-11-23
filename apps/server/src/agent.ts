import { codexQuery, codexInfo } from "./codexAgent.js";
import fs from "node:fs";
import path from "node:path";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { hasClaudeAuth, paths, repoRoot } from "./config.js";
import { agentEnv, checkAgentToolUse } from "./agentPolicy.js";
import * as db from "./db.js";
import { broadcast } from "./events.js";
import { normOutput, readMeta } from "./meta.js";
import { isQcReportStale, readQcReport } from "./qc.js";
import { readRenderSettings } from "./renderSettings.js";
import { agentRunStarted, agentRunFinished, timelineVersion } from "./timeline.js";

const running = new Map<string, Query>();

interface AgentMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  message?: {
    content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }>;
  };
  result?: string;

  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

type AgentEventPayload = {
  sessionId: string;
  kind: "text" | "tool" | "result" | "error" | "done";
  text?: string;
  tool?: { name: string; input: unknown };
  error?: string;

  status?: db.ChatSessionStatus;
};

function emit(payload: AgentEventPayload): void {
  broadcast("agent", payload);
}

export function isAgentRunning(sessionId: string): boolean {
  return running.has(sessionId);
}

const interruptedSessions = new Set<string>();

const pendingResumes = new Map<string, NodeJS.Timeout>();

export function isAgentBusy(sessionId: string): boolean {
  return running.has(sessionId) || pendingResumes.has(sessionId);
}

export function cancelPendingResume(sessionId: string): boolean {
  const timer = pendingResumes.get(sessionId);
  if (!timer) return false;
  clearTimeout(timer);
  pendingResumes.delete(sessionId);
  db.finishChatRun(sessionId);

  const s = db.getChatSession(sessionId);
  if (s?.status === "running" && !running.has(sessionId)) {
    db.setChatSessionStatus(sessionId, "interrupted");
    emit({ sessionId, kind: "done", status: "interrupted" });
  }
  return true;
}

export async function interruptAgent(sessionId: string): Promise<boolean> {
  const q = running.get(sessionId);
  if (!q) {

    if (cancelPendingResume(sessionId)) {

      const s = db.getChatSession(sessionId);
      if (s && s.status !== "interrupted") {
        db.setChatSessionStatus(sessionId, "interrupted");
        emit({ sessionId, kind: "done", status: "interrupted" });
      }
      return true;
    }
    return false;
  }
  interruptedSessions.add(sessionId);
  try {
    await q.interrupt();
  } catch {

  }
  return true;
}

const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "TodoWrite",
  "Skill",
];

const RESUME_MESSAGE =
  "Tiếp tục công việc đang dở dang. Kiểm tra trạng thái hiện tại của project (meta.json, renders/, log job) rồi làm tiếp từ chỗ dừng - KHÔNG làm lại từ đầu.";

const MAX_RESUME_ATTEMPTS = 3;
const RESUME_DELAY_MS = 10_000;

function maxResumeAttemptsFor(session: Pick<db.ChatSessionRow, "goal">): number {
  return isBuildGoal(session.goal)
    ? readRenderSettings().aiMaxAttempts
    : MAX_RESUME_ATTEMPTS;
}

function isBuildGoal(goal: string | null | undefined): boolean {
  return goal === "final" || goal === "draft";
}

const chainStartVersion = new Map<string, { version: string | null; source: string | null }>();

const SOURCE_ENTRIES = ["index.html", "hyperframes.json", "compositions", "assets", "renders"];

const RENDER_VIDEO_RE = /\.(mp4|mov|webm|mkv)$/i;

const SOURCE_SCAN_LIMIT = 5000;

function projectSourceMark(projectId: string): string | null {
  const root = path.join(paths.videoProjectsDir, projectId);
  let count = 0;
  let size = 0;
  let maxMtime = 0;
  const visit = (abs: string, rendersOnly: boolean): void => {
    if (count >= SOURCE_SCAN_LIMIT) return;
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {

      if (!rendersOnly && st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      let names: string[];
      try {
        names = fs.readdirSync(abs).sort();
      } catch {
        return;
      }
      for (const name of names) visit(path.join(abs, name), rendersOnly);
      return;
    }
    if (!st.isFile() || (rendersOnly && !RENDER_VIDEO_RE.test(abs))) return;
    count += 1;
    size += st.size;
    if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
  };
  try {
    if (!fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  for (const entry of SOURCE_ENTRIES) visit(path.join(root, entry), entry === "renders");
  return `${count}:${size}:${Math.round(maxMtime)}`;
}

function computeProgressMark(projectId: string): string {
  const parts: string[] = [];
  try {
    parts.push(`jobsDone=${db.countDoneJobsForProject(projectId)}`);
  } catch {
    parts.push("jobsDone=?");
  }
  try {
    const rendersDir = path.join(paths.videoProjectsDir, projectId, "renders");
    let count = 0;
    let size = 0;
    let maxMtime = 0;
    for (const name of fs.readdirSync(rendersDir)) {
      const st = fs.statSync(path.join(rendersDir, name));
      if (!st.isFile()) continue;
      count += 1;
      size += st.size;
      if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
    }
    parts.push(`renders=${count}:${size}:${Math.round(maxMtime)}`);
  } catch {
    parts.push("renders=none");
  }
  try {
    const meta = readMeta(projectId);
    const out = normOutput(meta.output);
    const outAbs = out ? (path.isAbsolute(out) ? out : path.join(repoRoot, out)) : null;
    parts.push(
      outAbs && fs.existsSync(outAbs) ? `output=${fs.statSync(outAbs).size}` : "output=none",
    );
    parts.push(`metaStatus=${meta.status ?? ""}`);
  } catch {
    parts.push("output=?");
  }
  return parts.join("|");
}

function refreshResumeProgress(session: db.ChatSessionRow): number {
  if (!session.projectId) return session.resumeAttempts;
  let mark: string;
  try {
    mark = computeProgressMark(session.projectId);
  } catch {
    return session.resumeAttempts;
  }
  if (mark !== session.progressMark) {
    db.setProgressMark(session.sessionId, mark);
    db.resetResumeAttempts(session.sessionId);
    return 0;
  }
  return session.resumeAttempts;
}

function finalGateResumeMessage(sessionId: string): string | null {
  const session = db.getChatSession(sessionId);
  if (!session || session.goal !== "final" || !session.projectId) return null;
  try {
    const meta = readMeta(session.projectId);
    const out = normOutput(meta.output);
    const outAbs = out ? (path.isAbsolute(out) ? out : path.join(repoRoot, out)) : null;
    if (out && outAbs && fs.existsSync(outAbs) && meta.status === "done") return null;
  } catch {

    return null;
  }
  return (
    `Video final CHƯA tồn tại (outputs/${session.projectId}-vN.mp4). ` +
    "Nhiệm vụ chỉ hoàn thành khi render final xong và meta.json status=done + output trỏ file thật. " +
    "Kiểm tra trạng thái hiện tại rồi làm tiếp: render scene standard còn thiếu, assemble-final, " +
    "verify, cập nhật meta. " +
    "Nếu job render failed - đọc log job tìm nguyên nhân, sửa rồi chạy lại job, KHÔNG bỏ qua. " +
    "Nếu render đang chạy dở (job status running hoặc tiến trình render còn sống) - CHỜ nó chạy xong " +
    "rồi verify tiếp, KHÔNG chạy lại từ đầu."
  );
}

function isoAtOrAfter(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(ta)) return false;
  if (!Number.isFinite(tb)) return true;
  return ta >= tb;
}

function draftGateResumeMessage(sessionId: string): string | null {
  const session = db.getChatSession(sessionId);
  if (!session || session.goal !== "draft" || !session.projectId) return null;
  const projectId = session.projectId;
  let unchanged = false;
  try {
    const meta = readMeta(projectId);
    const start = chainStartVersion.get(sessionId);

    const source = start?.source != null ? projectSourceMark(projectId) : null;
    unchanged =
      typeof start?.version === "string" &&
      timelineVersion(meta) === start.version &&
      source !== null &&
      source === start.source;
  } catch {

    return null;
  }
  const since = unchanged ? session.createdAt : (session.runStartedAt ?? session.createdAt);

  const draftJob = db
    .listJobs(500, projectId)
    .find((j) => j.type === "assemble-draft" && j.status === "done");
  const hasFreshDraft = Boolean(
    draftJob && draftJob.outputPath && isoAtOrAfter(draftJob.finishedAt, since),
  );
  let qcOk = false;
  if (hasFreshDraft && draftJob?.outputPath) {
    const report = readQcReport(projectId);
    qcOk = Boolean(
      report &&
        path.resolve(repoRoot, report.file) === path.resolve(repoRoot, draftJob.outputPath) &&
        isoAtOrAfter(report.checkedAt, draftJob.finishedAt) &&
        !isQcReportStale(report),
    );
  }
  if (hasFreshDraft && qcOk) return null;

  if (!hasFreshDraft) {
    return (
      `Bản draft CHƯA có (outputs/${projectId}-draft.mp4 từ job assemble-draft của lượt này). ` +
      "Chế độ của project là DỪNG Ở DRAFT: nhiệm vụ chỉ hoàn thành khi job assemble-draft chạy xong " +
      `và đã QC bản draft đó (POST http://localhost:6869/api/projects/${projectId}/qc). ` +
      "Kiểm tra trạng thái hiện tại rồi làm tiếp: dựng/sửa phần còn thiếu, xếp draft qua " +
      `POST http://localhost:6869/api/projects/${projectId}/editor/render body {"quality":"draft"}, ` +
      "đợi job xong, verify frame, QC. KHÔNG render final. " +
      "Nếu job render failed - đọc log job tìm nguyên nhân, sửa rồi chạy lại, KHÔNG bỏ qua. " +
      "Nếu render đang chạy dở - CHỜ nó chạy xong rồi verify tiếp, KHÔNG chạy lại từ đầu."
    );
  }
  return (
    "Bản draft đã render nhưng CHƯA QC (hoặc QC cũ hơn bản draft). Gọi " +
    `POST http://localhost:6869/api/projects/${projectId}/qc (body {}), đọc report: check fail thì sửa ` +
    "đúng nguyên nhân, render draft lại rồi QC lại; soi ảnh safe-area. Xong thì báo cáo kết quả QC. " +
    "KHÔNG render final."
  );
}

export async function runAgent(
  sessionId: string,
  message: string,
  opts: { continueRun?: boolean } = {},
): Promise<void> {
  const chosenSession = db.getChatSession(sessionId);
  const useCodex = chosenSession?.model?.startsWith("gpt-") ?? false;
  if (useCodex ? !codexInfo().connected : !hasClaudeAuth()) {
    emit({
      sessionId,
      kind: "error",
      error:
        useCodex ? "Chưa đăng nhập Codex. Chạy codex login trên máy này rồi thử lại." : "Chưa có xác thực Claude. Cách 1 (khuyên dùng): đăng nhập Claude Code trên máy này (VSCode extension hoặc chạy `claude` trong terminal rồi /login) - hệ thống tự dùng gói subscription. Cách 2: điền ANTHROPIC_API_KEY vào file .env rồi khởi động lại server.",
    });

    emit({ sessionId, kind: "done", status: "error" });
    return;
  }

  if (running.has(sessionId)) {
    emit({
      sessionId,
      kind: "error",
      error: "Agent đang chạy trong phiên này - chờ xong hoặc bấm dừng (interrupt) trước.",
    });

    emit({ sessionId, kind: "done", status: "error" });
    return;
  }

  db.addChatMessage(sessionId, "user", "text", message);
  db.touchChatSession(sessionId);

  const session = db.getChatSession(sessionId);
  const storedSession = session?.sdkSessionId ?? null;
  const sdkSessionId = useCodex ? (storedSession?.startsWith("codex:") ? storedSession.slice(6) : null) : (storedSession?.startsWith("codex:") ? null : storedSession);

  if (!opts.continueRun) db.startChatRun(sessionId);

  let prompt = message;
  if (!sdkSessionId) {
    try {
      const claudeMd = fs.readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
      prompt = `<project-instructions source="CLAUDE.md">\n${claudeMd}\n</project-instructions>\n\n${message}`;
    } catch {

    }
  }

  const options: Record<string, unknown> = {
    cwd: repoRoot,
    permissionMode: "acceptEdits",
    allowedTools: ALLOWED_TOOLS,
    includePartialMessages: true,

    maxTurns: isBuildGoal(session?.goal) ? readRenderSettings().aiMaxTurns : 100,
    settingSources: ["project", "user"],
    systemPrompt: { type: "preset", preset: "claude_code" },

    disallowedTools: ["WebFetch", "WebSearch"],

    env: agentEnv(),

    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input: { hook_event_name?: string; tool_name?: string; tool_input?: unknown }) => {
              if (input.hook_event_name !== "PreToolUse" || !input.tool_name) return {};
              const toolInput =
                input.tool_input && typeof input.tool_input === "object"
                  ? (input.tool_input as Record<string, unknown>)
                  : {};
              const reason = checkAgentToolUse(input.tool_name, toolInput);
              if (!reason) return {};
              console.warn(`[agent-policy] chặn ${input.tool_name} (phiên ${sessionId}): ${reason}`);
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: reason,
                },
              };
            },
          ],
        },
      ],
    },
  };
  if (sdkSessionId) options.resume = sdkSessionId;

  if (session?.model) options.model = session.model;
  if (session?.effort) options.effort = session.effort;

  let q: Query;
  try {
    q = useCodex ? codexQuery(prompt, session!.model!, session?.effort || "medium", sdkSessionId) as unknown as Query : query({
      prompt,
      options: options as Parameters<typeof query>[0]["options"],
    });
  } catch (err) {
    db.finishChatRun(sessionId);

    db.setChatSessionStatus(sessionId, "error");
    emit({
      sessionId,
      kind: "error",
      error: `Không khởi động được agent: ${err instanceof Error ? err.message : String(err)}`,
    });

    emit({ sessionId, kind: "done", status: "error" });
    return;
  }

  running.set(sessionId, q);
  interruptedSessions.delete(sessionId);
  db.setChatSessionStatus(sessionId, "running");

  const snapshotProjectId = session?.projectId ?? null;
  const snapshotLabel = session?.title ?? null;
  const versionAtStart = snapshotProjectId
    ? agentRunStarted(snapshotProjectId, snapshotLabel)
    : null;

  if (!opts.continueRun) {
    chainStartVersion.set(sessionId, {
      version: versionAtStart,
      source: snapshotProjectId ? projectSourceMark(snapshotProjectId) : null,
    });
  }
  let textBuffer = "";
  let resultSaved = false;
  let hadError = false;

  try {
    for await (const raw of q) {
      const msg = raw as unknown as AgentMessage;

      if (msg.type === "system" && msg.subtype === "init") {

        if (typeof msg.session_id === "string" && msg.session_id) {
          db.setSdkSessionId(sessionId, msg.session_id);
        }
        continue;
      }

      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (
          ev?.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          typeof ev.delta.text === "string"
        ) {
          textBuffer += ev.delta.text;
          emit({ sessionId, kind: "text", text: ev.delta.text });
        }
        continue;
      }

      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "tool_use") {
              const tool = { name: String(block.name ?? "unknown"), input: block.input ?? {} };
              emit({ sessionId, kind: "tool", tool });
              db.addChatMessage(sessionId, "assistant", "tool", JSON.stringify(tool));
            }
          }
        }
        continue;
      }

      if (msg.type === "result") {

        try {
          const inTok =
            (msg.usage?.input_tokens ?? msg.input_tokens ?? 0) +
            (msg.usage?.cache_creation_input_tokens ?? 0) +
            (msg.usage?.cache_read_input_tokens ?? 0);
          const outTok = msg.usage?.output_tokens ?? msg.output_tokens ?? 0;
          const cost = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0;
          if (inTok > 0 || outTok > 0 || cost > 0) {
            db.addTokenUsage(sessionId, session?.projectId ?? null, inTok, outTok, cost);
          }
        } catch {

        }
        const finalText =
          typeof msg.result === "string" && msg.result.length > 0 ? msg.result : textBuffer;
        if (msg.subtype && msg.subtype !== "success") {
          hadError = true;
          emit({
            sessionId,
            kind: "error",
            error: `Agent kết thúc bất thường (${msg.subtype})`,
          });
        }
        if (finalText) {
          db.addChatMessage(sessionId, "assistant", "text", finalText);
          resultSaved = true;
        }
        emit({ sessionId, kind: "result", text: finalText });
      }
    }
  } catch (err) {
    hadError = true;

    if (textBuffer && !resultSaved) {
      db.addChatMessage(sessionId, "assistant", "text", textBuffer);
    }
    emit({
      sessionId,
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running.delete(sessionId);

    if (snapshotProjectId) agentRunFinished(snapshotProjectId, versionAtStart, snapshotLabel);

    const userInterrupted = interruptedSessions.has(sessionId);
    let status: db.ChatSessionStatus = userInterrupted
      ? "interrupted"
      : hadError
        ? "error"
        : "done";
    interruptedSessions.delete(sessionId);

    const gateMessage =
      status === "done"
        ? (finalGateResumeMessage(sessionId) ?? draftGateResumeMessage(sessionId))
        : null;
    if (gateMessage) {
      const s = db.getChatSession(sessionId);

      const attempts = s ? refreshResumeProgress(s) : 0;
      const cap = s ? maxResumeAttemptsFor(s) : MAX_RESUME_ATTEMPTS;
      const canRetry = s !== undefined && s.autoResume !== 0 && attempts < cap && hasClaudeAuth();
      if (canRetry) {
        db.setChatSessionStatus(sessionId, "running");
        db.bumpResumeAttempts(sessionId);

        const timer = setTimeout(() => {
          pendingResumes.delete(sessionId);

          const cur = db.getChatSession(sessionId);
          if (!cur || cur.status !== "running" || cur.autoResume === 0 || isAgentRunning(sessionId)) {
            return;
          }
          void runAgent(sessionId, gateMessage, { continueRun: true });
        }, RESUME_DELAY_MS);
        pendingResumes.set(sessionId, timer);
        return;
      }

      status = "error";
      const isDraftGoal = s?.goal === "draft";
      db.addChatMessage(
        sessionId,
        "assistant",
        "text",
        `Đã dừng sau ${cap} lượt tự chạy liên tiếp mà KHÔNG có tiến bộ - ` +
          (isDraftGoal ? "bản draft đã QC vẫn chưa có. " : "video final vẫn chưa render xong. ") +
          'Xem log job/render tìm nguyên nhân rồi bấm gửi "tiếp tục" để chạy tiếp.',
      );
      emit({
        sessionId,
        kind: "error",
        error: isDraftGoal
          ? "Bản draft đã QC chưa có - phiên edit chưa hoàn thành"
          : "Video final chưa tồn tại - phiên edit chưa hoàn thành",
      });
    }

    db.setChatSessionStatus(sessionId, status);

    const fresh = db.getChatSession(sessionId);

    const freshAttempts = fresh ? refreshResumeProgress(fresh) : 0;
    const shouldResume =
      status === "error" &&
      !userInterrupted &&
      fresh !== undefined &&
      fresh.autoResume !== 0 &&
      freshAttempts < maxResumeAttemptsFor(fresh) &&
      hasClaudeAuth();

    if (shouldResume) {
      db.bumpResumeAttempts(sessionId);

      const timer = setTimeout(() => {
        pendingResumes.delete(sessionId);

        const s = db.getChatSession(sessionId);
        if (!s || s.status !== "error" || s.autoResume === 0 || isAgentRunning(sessionId)) return;
        void runAgent(sessionId, RESUME_MESSAGE, { continueRun: true });
      }, RESUME_DELAY_MS);
      pendingResumes.set(sessionId, timer);
    } else {

      db.finishChatRun(sessionId);
    }

    emit({ sessionId, kind: "done", status });
  }
}

export async function autoResumeStartup(): Promise<void> {
  if (!hasClaudeAuth()) return;
  for (const id of db.startupInterruptedSessions) {
    const session = db.getChatSession(id);
    if (!session || session.status !== "interrupted" || session.autoResume === 0) continue;
    if (isAgentRunning(id)) continue;

    void runAgent(id, RESUME_MESSAGE);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
