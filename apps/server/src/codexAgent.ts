import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { agentEnv } from "./agentPolicy.js";
import { repoRoot } from "./config.js";

export function codexBinary(): string {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  return fs.existsSync(bundled) ? bundled : "codex";
}

export function codexInfo() {
  const status = spawnSync(codexBinary(), ["login", "status"], { encoding: "utf8", timeout: 4000 });
  let models: Array<{ id: string; label: string }> = [];
  try {
    const home = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex");
    const cache = JSON.parse(fs.readFileSync(path.join(home, "models_cache.json"), "utf8"));
    models = cache.models.filter((m: {slug?: string}) => /^gpt-[a-z0-9.-]+$/.test(m.slug || ""))
      .map((m: {slug: string; display_name?: string}) => ({ id: m.slug, label: m.display_name || m.slug }));
  } catch {   }
  return { connected: status.status === 0, models };
}

export function codexQuery(prompt: string, model: string, effort: string, resume?: string | null) {
  const args = ["exec"];
  if (resume) args.push("resume");
  args.push("--json", "--model", model, "-c", 'model_reasoning_effort="' + effort + '"');
  if (!resume) args.push("--sandbox", "workspace-write", "-C", repoRoot);
  args.push("-c", 'approval_policy="on-request"', "-c", 'sandbox_mode="workspace-write"');
  if (resume) args.push(resume);
  args.push("-");
  const env = agentEnv();
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const child = spawn(codexBinary(), args, { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  let failure: Error | null = null;
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
  const completed = new Promise<number | null>(resolve => {
    child.on("error", error => { failure = error; resolve(null); });
    child.on("close", code => resolve(code));
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  return {
    async interrupt() { child.kill("SIGTERM"); },
    async *[Symbol.asyncIterator]() {
      const lines = createInterface({ input: child.stdout });
      let text = "";
      let succeeded = false;
      for await (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === "thread.started") {
          yield { type: "system", subtype: "init", session_id: "codex:" + event.thread_id };
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          text += event.item.text + "\n";
          yield { type: "stream_event", event: {type: "content_block_delta", delta: {type: "text_delta", text: event.item.text + "\n"}} };
        }
        if (event.type === "item.started" && event.item?.type === "command_execution") {
          yield { type: "assistant", message: {content: [{type: "tool_use", name: "Codex command", input: {command: event.item.command}}]} };
        }
        if (event.type === "turn.completed") {
          succeeded = true;
          yield { type: "result", subtype: "success", result: text, usage: event.usage };
        }
        if (event.type === "turn.failed" || event.type === "error") {
          failure = new Error(event.error?.message || event.message || "Codex thất bại");
        }
      }
      const code = await completed;
      if (failure) throw failure;
      if (code !== 0 || !succeeded) throw new Error(stderr || "Codex kết thúc trước khi hoàn tất lượt dựng.");
    }
  };
}
