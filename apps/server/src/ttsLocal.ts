import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { childEnv, paths, venvPython } from "./config.js";
import type { ClonedVoice, TtsRegion, TtsVoice } from "./ttsTypes.js";
import { clonedRefAbs, getClonedVoice, listClonedVoices } from "./voiceStore.js";
import { HttpError, ensureDir, execFileCaptureAll, killTree } from "./util.js";

const PROBE_CACHE_MS = 20_000;

const PROBE_TIMEOUT_MS = 120_000;

const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

const MODEL_LOAD_BUDGET_MS = 10 * 60 * 1000;

const SYNTH_BASE_MS = 60_000;
const SYNTH_MS_PER_CHAR = 400;
const SYNTH_MAX_MS = 20 * 60 * 1000;

const REGISTER_TIMEOUT_MS = 180_000;

export const LOCAL_TTS_MODEL = "vieneu-v3turbo";

const WORKER_SCRIPT = path.join(paths.serverDir, "python", "vieneu_worker.py");

export interface LocalEngineStatus {

  available: boolean;

  canClone: boolean;

  reason: "NO_PYTHON" | "NO_VIENEU" | "NO_TORCH" | "LOAD_FAILED" | null;

  detail: string;
}

const PROBE_PY = [
  "import json,sys",
  'out={"vieneu":False,"clone":False,"version":"","err":"","cloneErr":""}',
  "try:",
  "    import vieneu",
  '    out["vieneu"]=True',
  "    import importlib.metadata as m",
  '    out["version"]=m.version("vieneu")',
  "except Exception as e:",
  '    out["err"]=str(e)[:300]',
  "try:",
  "    import torch, torchaudio, soundfile",
  '    out["clone"]=True',
  "except Exception as e:",
  '    out["cloneErr"]=str(e)[:300]',

  'sys.stdout.write("VIENEU_PROBE "+json.dumps(out))',
].join("\n");

interface ProbeData {
  vieneu: boolean;
  clone: boolean;
  version: string;
  err: string;
  cloneErr: string;
}

let cachedPython: string | null = null;
let probeCache: { at: number; status: LocalEngineStatus } | null = null;

let loadFailure: { message: string; at: number } | null = null;
const LOAD_FAILURE_TTL_MS = 2 * 60 * 1000;

function activeLoadFailure(): string | null {
  if (loadFailure && Date.now() - loadFailure.at > LOAD_FAILURE_TTL_MS) loadFailure = null;
  return loadFailure?.message ?? null;
}

function tail(text: string, lines = 8): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-lines)
    .join("\n");
}

async function runProbe(exe: string): Promise<ProbeData | null> {
  let r: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    r = await execFileCaptureAll(exe, ["-c", PROBE_PY], { timeoutMs: PROBE_TIMEOUT_MS });
  } catch {
    return null;
  }
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("VIENEU_PROBE "));
  if (!line) {

    return {
      vieneu: false,
      clone: false,
      version: "",
      err: r.timedOut ? "quá thời gian khi dò" : tail(r.stderr, 4) || `thoát mã ${r.code}`,
      cloneErr: "",
    };
  }
  try {
    const raw = JSON.parse(line.slice("VIENEU_PROBE ".length)) as Partial<ProbeData>;
    return {
      vieneu: raw.vieneu === true,
      clone: raw.clone === true,
      version: typeof raw.version === "string" ? raw.version : "",
      err: typeof raw.err === "string" ? raw.err : "",
      cloneErr: typeof raw.cloneErr === "string" ? raw.cloneErr : "",
    };
  } catch {
    return { vieneu: false, clone: false, version: "", err: "kết quả dò không phải JSON", cloneErr: "" };
  }
}

const INSTALL_HINT =
  "Cài Python 3.10+ rồi chạy `pip install vieneu` (giọng đọc offline, khoảng 30MB). " +
  "Muốn nhân bản giọng thì cài thêm `pip install torch torchaudio` (2-3GB). " +
  "Máy có nhiều bản Python thì trỏ biến môi trường PYTHON_BIN vào bản đã cài.";

export async function probeLocalEngine(force = false): Promise<LocalEngineStatus> {
  if (force) {
    probeCache = null;
    cachedPython = null;
    loadFailure = null;
  }

  if (probeCache?.status.reason === "LOAD_FAILED" && !activeLoadFailure()) probeCache = null;
  if (probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) return probeCache.status;

  const candidates = [
    process.env.PYTHON_BIN,
    venvPython(),
    process.env.PYTHON,
    "python",
    "py",
    "python3",
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0);

  let anyPython = false;
  let best: { exe: string; data: ProbeData } | null = null;
  let firstErr = "";
  for (const exe of candidates) {
    const data = await runProbe(exe);
    if (!data) continue;
    anyPython = true;
    if (!firstErr) firstErr = data.err;
    if (data.vieneu) {
      best = { exe, data };
      break;
    }
  }

  let status: LocalEngineStatus;
  if (!anyPython) {
    status = {
      available: false,
      canClone: false,
      reason: "NO_PYTHON",
      detail: `Không tìm thấy Python trên máy. ${INSTALL_HINT}`,
    };
  } else if (!best) {
    status = {
      available: false,
      canClone: false,
      reason: "NO_VIENEU",
      detail: `Python có nhưng chưa cài gói vieneu. ${INSTALL_HINT}${firstErr ? `\nChi tiết: ${firstErr}` : ""}`,
    };
  } else {
    cachedPython = best.exe;
    const v = best.data.version ? ` ${best.data.version}` : "";
    status = best.data.clone
      ? {
          available: true,
          canClone: true,
          reason: null,
          detail: `VieNeu-TTS${v} sẵn sàng (${best.exe}) - đọc offline và nhân bản giọng đều dùng được.`,
        }
      : {
          available: true,
          canClone: false,
          reason: "NO_TORCH",
          detail:
            `VieNeu-TTS${v} đọc được offline nhưng CHƯA nhân bản được giọng: thiếu torch. ` +
            "Chạy `pip install torch torchaudio` (2-3GB) rồi kiểm tra lại." +
            (best.data.cloneErr ? `\nChi tiết: ${best.data.cloneErr}` : ""),
        };
  }

  const failure = activeLoadFailure();
  if (status.available && failure) {
    status = {
      available: false,
      canClone: false,
      reason: "LOAD_FAILED",
      detail: `Không nạp được model VieNeu: ${failure}`,
    };
  }

  probeCache = { at: Date.now(), status };
  return status;
}

async function requirePython(): Promise<string> {
  const status = await probeLocalEngine();
  if (!status.available || !cachedPython) {
    throw new HttpError(503, status.reason ?? "NO_VIENEU", status.detail);
  }
  return cachedPython;
}

interface WorkerRes {
  id: number;
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

interface PendingReq {
  resolve: (r: WorkerRes) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  cancelTimer: NodeJS.Timeout | null;
}

let worker: ChildProcess | null = null;
let stdoutBuf = "";
let stderrTail: string[] = [];
let nextReqId = 1;
const pending = new Map<number, PendingReq>();

const registeredInWorker = new Set<string>();

function registrationKey(v: ClonedVoice): string {
  return `${v.id}@${v.createdAt}`;
}

let workerHasModel = false;
let idleTimer: NodeJS.Timeout | null = null;

let activeLog: ((line: string) => void) | null = null;

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size > 0) return;
    stopWorker("hết 10 phút không dùng");
  }, IDLE_SHUTDOWN_MS);
  idleTimer.unref?.();
}

function stopWorker(why: string): void {
  const child = worker;
  worker = null;
  workerHasModel = false;
  registeredInWorker.clear();
  stdoutBuf = "";
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (child) {
    console.log(`[vieneu] tắt worker (${why})`);
    killTree(child);
  }
}

function failPending(err: Error): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    if (p.cancelTimer) clearInterval(p.cancelTimer);
    pending.delete(id);
    p.reject(err);
  }
}

function handleLine(line: string): void {
  const text = line.trim();
  if (!text) return;
  let msg: WorkerRes;
  try {
    msg = JSON.parse(text) as WorkerRes;
  } catch {

    console.warn(`[vieneu] bỏ qua dòng stdout không phải JSON: ${text.slice(0, 200)}`);
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  clearTimeout(p.timer);
  if (p.cancelTimer) clearInterval(p.cancelTimer);
  pending.delete(msg.id);
  p.resolve(msg);
}

function startWorker(python: string): ChildProcess {
  if (!fs.existsSync(WORKER_SCRIPT)) {
    throw new HttpError(
      500,
      "VIENEU_WORKER_MISSING",
      `Thiếu file worker ${WORKER_SCRIPT} - bản cài đặt bị lỗi, tải lại repo.`,
    );
  }

  const child = spawn(python, [WORKER_SCRIPT], { windowsHide: true, env: childEnv() });
  worker = child;
  stdoutBuf = "";
  stderrTail = [];
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {

    if (worker !== child) return;
    stdoutBuf += chunk;

    let nl = stdoutBuf.indexOf("\n");
    while (nl >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      handleLine(line);
      nl = stdoutBuf.indexOf("\n");
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      stderrTail.push(t);
      if (stderrTail.length > 40) stderrTail.shift();
      activeLog?.(t);
    }
  });

  child.on("error", (err) => {
    if (worker !== child) return;
    stopWorker(`không chạy được: ${err.message}`);
    failPending(new Error(`Không chạy được worker VieNeu: ${err.message}`));
  });
  child.on("close", (code) => {
    if (worker !== child) return;
    const why = tail(stderrTail.join("\n"), 6);
    stopWorker(`tiến trình thoát mã ${code}`);
    failPending(
      new Error(
        `Worker VieNeu đã thoát (mã ${code}) khi đang xử lý yêu cầu.` + (why ? `\n${why}` : ""),
      ),
    );
  });
  return child;
}

function ensureWorker(python: string): ChildProcess {
  if (worker && !worker.killed && worker.exitCode === null) return worker;
  return startWorker(python);
}

interface SendOpts {
  timeoutMs: number;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}

function sendCommand(payload: Record<string, unknown>, opts: SendOpts, python: string): Promise<WorkerRes> {
  return new Promise<WorkerRes>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = ensureWorker(python);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const id = nextReqId++;
    const timer = setTimeout(() => {
      pending.delete(id);

      if (cancelTimer) clearInterval(cancelTimer);

      stopWorker("yêu cầu quá thời gian");
      reject(
        new Error(
          `VieNeu không trả lời sau ${Math.round(opts.timeoutMs / 1000)}s - đã tắt tiến trình. ` +
            "Máy quá yếu hoặc lần đầu đang tải model, thử lại sau.",
        ),
      );
    }, opts.timeoutMs);
    const cancelTimer = opts.isCanceled
      ? setInterval(() => {
          if (!opts.isCanceled?.() || !pending.has(id)) return;
          pending.delete(id);
          clearTimeout(timer);
          clearInterval(cancelTimer as NodeJS.Timeout);
          stopWorker("job bị hủy");
          reject(new Error("Job đã bị hủy"));
        }, 1_000)
      : null;
    cancelTimer?.unref?.();
    pending.set(id, { resolve, reject, timer, cancelTimer });
    child.stdin?.write(`${JSON.stringify({ ...payload, id })}\n`, (err) => {
      if (!err) return;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
      reject(new Error(`Không gửi được lệnh cho worker VieNeu: ${err.message}`));
    });
  });
}

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function toError(res: WorkerRes): Error {
  const code = typeof res.code === "string" ? res.code : "VIENEU_FAILED";
  const message = typeof res.message === "string" ? res.message : "không rõ nguyên nhân";
  if (code === "NO_TORCH") {
    return new HttpError(
      503,
      "NO_TORCH",
      "Máy chưa cài torch nên không nhân bản được giọng. Chạy `pip install torch torchaudio` (2-3GB) rồi thử lại.",
    );
  }
  if (code === "VOICE_NOT_FOUND") {
    return new HttpError(400, "VOICE_NOT_FOUND", `VieNeu không có giọng này: ${message}`);
  }
  if (code === "REF_NOT_FOUND") {
    return new HttpError(404, "CLONE_REF_MISSING", `Không đọc được file mẫu của giọng: ${message}`);
  }
  if (code === "NO_VIENEU" || code === "LOAD_FAILED") {
    loadFailure = { message, at: Date.now() };
    probeCache = null;
    return new HttpError(503, "LOAD_FAILED", `Không nạp được model VieNeu: ${message}`);
  }
  return new Error(`VieNeu lỗi (${code}): ${message}`);
}

async function call(payload: Record<string, unknown>, opts: SendOpts): Promise<WorkerRes> {
  const python = await requirePython();
  return enqueue(async () => {
    activeLog = opts.onLog ?? null;
    try {
      const res = await sendCommand(payload, opts, python);
      if (!res.ok) throw toError(res);
      workerHasModel = true;
      loadFailure = null;
      return res;
    } finally {
      activeLog = null;
      resetIdleTimer();
    }
  });
}

function loadBudget(): number {
  return workerHasModel ? 0 : MODEL_LOAD_BUDGET_MS;
}

function synthTimeout(text: string): number {
  return loadBudget() + Math.min(SYNTH_MAX_MS, SYNTH_BASE_MS + text.length * SYNTH_MS_PER_CHAR);
}

interface PresetRow {
  name: string;
  gender: string;
  region: string;
  style: string;
}

let presetCache: TtsVoice[] | null = null;

const GENDER_WORD: Record<string, string> = { nam: "nam", nu: "nữ" };
const REGION_WORD: Record<string, string> = { bac: "miền Bắc", trung: "miền Trung", nam: "miền Nam" };
const STYLE_WORD: Record<string, string> = {
  "tin-tuc": "phong cách tin tức",
  "tu-nhien": "phong cách tự nhiên",
  "ke-chuyen": "phong cách kể chuyện",
};

function presetToVoice(row: PresetRow): TtsVoice {
  const gender = row.gender === "nu" ? "nu" : "nam";
  const region = (["bac", "trung", "nam"].includes(row.region) ? row.region : null) as TtsRegion | null;
  const parts = [GENDER_WORD[gender], region ? REGION_WORD[region] : "", STYLE_WORD[row.style] ?? ""].filter(
    Boolean,
  );
  return {
    engine: "vieneu",

    name: row.name,
    title: row.name,
    label: `${row.name} - ${parts.join(", ")}`,
    gender,

    f0: 0,
    kind: "preset",
    region,
    timbreKey: row.style,
    note: "",
  };
}

async function fetchPresets(): Promise<TtsVoice[]> {
  const res = await call({ cmd: "voices" }, { timeoutMs: loadBudget() + 120_000 });
  const raw = Array.isArray(res.voices) ? (res.voices as unknown[]) : [];
  const rows: PresetRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    rows.push({
      name: r.name,
      gender: typeof r.gender === "string" ? r.gender : "",
      region: typeof r.region === "string" ? r.region : "",
      style: typeof r.style === "string" ? r.style : "",
    });
  }
  return rows.map(presetToVoice);
}

function clonedToVoice(v: ClonedVoice): TtsVoice {
  return {
    engine: "vieneu",

    name: v.id,
    title: v.name,
    label: `${v.name} - giọng nhân bản`,
    gender: v.gender,
    f0: 0,
    kind: "cloned",
    region: null,
    timbreKey: "cloned",
    note: v.note,
  };
}

export async function listLocalVoices(): Promise<TtsVoice[]> {
  const status = await probeLocalEngine();
  if (!status.available) return [];

  if (!presetCache) {
    try {
      presetCache = await fetchPresets();
    } catch (err) {

      console.warn(
        `[vieneu] không lấy được danh sách giọng dựng sẵn: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const cloned = listClonedVoices().map(clonedToVoice);
  const clonedIds = new Set(cloned.map((v) => v.name));

  const presets = (presetCache ?? []).filter((p) => !clonedIds.has(p.name));
  return [...presets, ...cloned];
}

async function ensureRegistered(voice: string, opts: { onLog?: (l: string) => void }): Promise<boolean> {
  const rec = getClonedVoice(voice);
  if (!rec) return false;
  if (registeredInWorker.has(registrationKey(rec))) return true;

  const status = await probeLocalEngine();
  if (!status.canClone) {
    throw new HttpError(503, "NO_TORCH", status.detail);
  }
  const refAbs = clonedRefAbs(rec);
  if (!fs.existsSync(refAbs)) {
    throw new HttpError(
      404,
      "CLONE_REF_MISSING",
      `Mất file mẫu của giọng "${rec.name}" (${refAbs}). Xóa giọng này rồi nhân bản lại.`,
    );
  }
  opts.onLog?.(`[vieneu] nạp giọng nhân bản "${rec.name}" vào tiến trình (~3s)`);
  await call(
    { cmd: "register", voice: rec.id, ref: refAbs },
    { timeoutMs: loadBudget() + REGISTER_TIMEOUT_MS, onLog: opts.onLog },
  );
  registeredInWorker.add(registrationKey(rec));
  return true;
}

async function synthToFile(input: {
  text: string;
  voice: string;
  outWavAbs: string;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}): Promise<number> {
  const text = input.text.trim();
  if (!text) throw new HttpError(400, "TTS_EMPTY_TEXT", "Không có chữ nào để đọc");
  const voice = input.voice.trim();
  if (!voice) throw new HttpError(400, "VOICE_REQUIRED", "Thiếu tên giọng");

  ensureDir(path.dirname(input.outWavAbs));
  const isCloned = await ensureRegistered(voice, { onLog: input.onLog });
  const send = (): Promise<WorkerRes> =>
    call(
      { cmd: "synth", text, voice, out: input.outWavAbs },
      { timeoutMs: synthTimeout(text), onLog: input.onLog, isCanceled: input.isCanceled },
    );

  let res: WorkerRes;
  try {
    res = await send();
  } catch (err) {

    const lost = err instanceof HttpError && err.code === "VOICE_NOT_FOUND";
    if (!isCloned || !lost) throw err;
    const rec = getClonedVoice(voice);
    if (rec) registeredInWorker.delete(registrationKey(rec));
    await ensureRegistered(voice, { onLog: input.onLog });
    res = await send();
  }

  const duration = typeof res.durationSec === "number" ? res.durationSec : 0;
  if (!fs.existsSync(input.outWavAbs) || duration <= 0) {
    throw new Error(`VieNeu báo xong nhưng không có file đọc được: ${input.outWavAbs}`);
  }
  return duration;
}

export async function synthLocalPreviewWav(input: {
  text: string;
  voice: string;
}): Promise<{ wav: Buffer; durationSec: number; model: string }> {
  const dir = path.join(paths.dataDir, "tts-preview");
  ensureDir(dir);
  const outAbs = path.join(dir, `preview-${process.pid}-${Date.now()}.wav`);
  try {
    const durationSec = await synthToFile({ ...input, outWavAbs: outAbs });
    return { wav: fs.readFileSync(outAbs), durationSec, model: LOCAL_TTS_MODEL };
  } finally {
    try {
      fs.rmSync(outAbs, { force: true });
    } catch {

    }
  }
}

export async function synthLocalChunkWav(input: {
  text: string;
  voice: string;
  outWavAbs: string;
  onLog?: (l: string) => void;
  isCanceled?: () => boolean;
}): Promise<{ wavAbs: string; durationSec: number }> {
  const durationSec = await synthToFile(input);
  return { wavAbs: input.outWavAbs, durationSec };
}

export function shutdownLocalTts(): void {
  failPending(new Error("Server đang tắt - đã dừng VieNeu"));
  stopWorker("server tắt");
}
