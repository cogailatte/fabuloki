import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const host = process.env.FABULOKI_HOST || "127.0.0.1";
const webPort = process.env.WEB_PORT || "6868";
const serverPort = process.env.SERVER_PORT || "6869";
const defaultBrowser = process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "";
const browser = process.env.FABULOKI_BROWSER_PATH || (existsSync(defaultBrowser) ? defaultBrowser : "");
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const env = { ...process.env, FABULOKI_HOST: host, WEB_PORT: webPort, SERVER_PORT: serverPort, NEXT_TELEMETRY_DISABLED: "1" };
if (browser) {
  env.FABULOKI_BROWSER_PATH = browser;
  env.HYPERFRAMES_BROWSER_PATH ||= browser;
}
if (!existsSync(path.join(root, "apps/server/dist/index.js")) || !existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
  console.error("Chưa có bản build. Chạy npm run build trước.");
  process.exit(1);
}

const children = [
  spawn(process.execPath, ["apps/server/dist/index.js"], { cwd: root, env, stdio: "inherit", windowsHide: true }),
  spawn(process.execPath, [requireWeb.resolve("next/dist/bin/next"), "start", "apps/web", "-p", webPort, "-H", host],
    { cwd: root, env, stdio: "inherit", windowsHide: true }),
];
let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", error => { console.error(error.message); process.exitCode = 1; stop(); });
  child.on("exit", code => { if (code) process.exitCode = code; stop(); });
}

if (process.argv.includes("--open") && browser) {
  const url = `http://127.0.0.1:${webPort}`;
  let opened = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      const health = await response.json();
      if (response.ok && health.ok === true && typeof health.checks?.hyperframes === "boolean") {
        const window = spawn(browser, [url], { stdio: "ignore", windowsHide: false });
        window.on("error", () => console.error(`Mở Fabuloki tại ${url}`));
        window.unref();
        opened = true;
        break;
      }
    } catch {}
    await delay(1000);
  }
  if (!opened && !stopping) {
    console.error(`Chưa mở được Fabuloki tại ${url}.`);
    process.exitCode = 1;
    stop();
  }
}
