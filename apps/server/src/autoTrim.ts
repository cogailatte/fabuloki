import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { ffmpegSafeArgs, ffprobeSafeArgs } from "./ffmpegSafe.js";
import { HttpError, audioCutFade, ensureDir, execFileCaptureAll } from "./util.js";

export type TrimAggressiveness = "natural" | "default" | "tight";

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface WordSpan {
  start: number;
  end: number;
}

export interface TrimProfile {

  minSilenceSec: number;

  padSec: number;

  maxResidualSec: number;

  maxResidualRatio: number;
}

export interface TrimAnalysis {
  durationSec: number;
  noiseFloorDb: number;
  thresholdDb: number;
  profile: TrimProfile;
  silences: SilenceRange[];
  keepRanges: Array<[number, number]>;
  removedSec: number;

  thresholdNote?: string;

  sweep?: Array<{ db: number; count: number; ratio: number; midpointRate: number }>;

  wordGuard?: { droppedSec: number; droppedRanges: number };
}

export interface TrimVerification {
  residual: SilenceRange[];
  totalSilenceSec: number;
  ratio: number;
  longest: number;
  pass: boolean;
  reason?: string;
}

export const TRIM_PROFILES: Record<TrimAggressiveness, TrimProfile> = {
  natural: { minSilenceSec: 0.9, padSec: 0.18, maxResidualSec: 0.8, maxResidualRatio: 0.06 },
  default: { minSilenceSec: 0.45, padSec: 0.12, maxResidualSec: 0.5, maxResidualRatio: 0.03 },
  tight: { minSilenceSec: 0.3, padSec: 0.08, maxResidualSec: 0.35, maxResidualRatio: 0.02 },
};

const DEFAULT_AGGRESSIVENESS: TrimAggressiveness = "default";

const CANDIDATE_DB = [-45, -40, -35, -30, -26, -22, -20] as const;

const WORD_MIDPOINT_MAX_RATE = 0.15;

const SANE_RATIO_LO = 0.02;
const SANE_RATIO_HI = 0.35;

const SWEEP_MIN_DUR = 0.2;

const EDGE_KEEP_SEC = 0.2;

export const MIN_PIECE_SEC = 0.03;

const EDGE_EPS = 0.05;

async function runFfmpeg(
  args: string[],
  opts: { timeoutMs?: number; isCanceled?: () => boolean; allowNonZero?: boolean },
): Promise<string> {
  let r: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    r = await execFileCaptureAll("ffmpeg", ffmpegSafeArgs(["-hide_banner", "-nostats", "-y", ...args]), {
      timeoutMs: opts.timeoutMs ?? 120_000,
      isCanceled: opts.isCanceled,
    });
  } catch (err) {
    throw new HttpError(
      503,
      "NO_FFMPEG",
      `Không chạy được ffmpeg - cài FFmpeg và thêm vào PATH. Chi tiết: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (r.canceled) throw new Error("Job đã bị hủy");
  if (r.timedOut) throw new Error("ffmpeg chạy quá lâu khi cắt khoảng lặng - đã hủy");
  if (r.code !== 0 && !opts.allowNonZero) {
    const tail = r.stderr.split(/\r?\n/).slice(-12).join("\n");
    throw new Error(`ffmpeg thất bại (mã ${r.code}):\n${tail}`);
  }
  return r.stderr;
}

async function runFfprobe(args: string[], isCanceled?: () => boolean): Promise<string> {
  let r: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    r = await execFileCaptureAll("ffprobe", ffprobeSafeArgs(["-v", "error", ...args]), {
      timeoutMs: 30_000,
      isCanceled,
    });
  } catch (err) {
    throw new HttpError(
      503,
      "NO_FFPROBE",
      `Không chạy được ffprobe - cài FFmpeg và thêm vào PATH. Chi tiết: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (r.canceled) throw new Error("Job đã bị hủy");
  if (r.timedOut) throw new Error("ffprobe chạy quá lâu - đã hủy");
  return r.stdout;
}

async function probeSeconds(fileAbs: string, isCanceled?: () => boolean): Promise<number> {
  const out = await runFfprobe(
    ["-show_entries", "format=duration", "-of", "csv=p=0", fileAbs],
    isCanceled,
  );
  const sec = parseFloat(out.trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new HttpError(
      503,
      "TRIM_NO_DURATION",
      `Không đo được thời lượng của ${path.basename(fileAbs)} bằng ffprobe.`,
    );
  }
  return sec;
}

async function probeStreams(
  fileAbs: string,
  isCanceled?: () => boolean,
): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  const out = await runFfprobe(
    ["-show_entries", "stream=codec_type", "-of", "csv=p=0", fileAbs],
    isCanceled,
  );
  const kinds = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { hasVideo: kinds.includes("video"), hasAudio: kinds.includes("audio") };
}

async function extractProbeWav(
  fileAbs: string,
  outWavAbs: string,
  isCanceled?: () => boolean,
): Promise<void> {
  await runFfmpeg(
    ["-i", fileAbs, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outWavAbs],
    { timeoutMs: 600_000, isCanceled },
  );
}

function parseSilences(stderr: string, durationSec: number): SilenceRange[] {
  const out: SilenceRange[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) {
      open = Math.max(0, parseFloat(s[1]));
      continue;
    }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) {
      const end = Math.min(durationSec, parseFloat(e[1]));
      if (end > open) out.push({ start: open, end, duration: end - open });
      open = null;
    }
  }

  if (open !== null && durationSec > open) {
    out.push({ start: open, end: durationSec, duration: durationSec - open });
  }
  return out;
}

async function detectSilences(
  wavAbs: string,
  db: number,
  minDur: number,
  durationSec: number,
  isCanceled?: () => boolean,
): Promise<SilenceRange[]> {
  const stderr = await runFfmpeg(
    ["-i", wavAbs, "-af", `silencedetect=n=${db}dB:d=${minDur}`, "-f", "null", "-"],
    { timeoutMs: 300_000, isCanceled, allowNonZero: true },
  );
  return parseSilences(stderr, durationSec);
}

function wordGapRanges(words: WordSpan[], durationSec: number): SilenceRange[] {
  const spans = words
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w) => ({
      start: Math.max(0, w.start),
      end: Math.min(durationSec, w.end),
      duration: 0,
    }))
    .filter((w) => w.end > w.start);
  const merged = mergeRanges(spans as SilenceRange[]);
  const gaps: SilenceRange[] = [];
  let cursor = 0;
  for (const w of merged) {
    if (w.start - cursor > 1e-6) {
      gaps.push({ start: cursor, end: w.start, duration: w.start - cursor });
    }
    cursor = Math.max(cursor, w.end);
  }
  if (durationSec - cursor > 1e-6) {
    gaps.push({ start: cursor, end: durationSec, duration: durationSec - cursor });
  }
  return gaps;
}

function intersectRanges(a: SilenceRange[], b: SilenceRange[]): SilenceRange[] {
  const out: SilenceRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i].start, b[j].start);
    const hi = Math.min(a[i].end, b[j].end);
    if (hi - lo > 1e-6) out.push({ start: lo, end: hi, duration: hi - lo });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

const totalSec = (ranges: SilenceRange[]): number => ranges.reduce((s, r) => s + r.duration, 0);

function midpointHitRate(words: WordSpan[], silences: SilenceRange[]): number {
  if (words.length === 0 || silences.length === 0) return 0;
  const sorted = [...silences].sort((x, y) => x.start - y.start);
  let hit = 0;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;

    if (sorted.some((s) => mid >= s.start && mid <= s.end)) hit++;
  }
  return hit / words.length;
}

interface SweepEntry {
  db: number;
  count: number;
  ratio: number;

  ranges: SilenceRange[];

  guarded: SilenceRange[];
  midpointRate: number;
}

function pickThreshold(
  sweep: SweepEntry[],
  hasWords: boolean,
): { db: number; ranges: SilenceRange[]; note: string } {
  if (hasWords) {

    for (const s of [...sweep].reverse()) {
      if (s.midpointRate > WORD_MIDPOINT_MAX_RATE) continue;
      return {
        db: s.db,
        ranges: s.guarded,
        note:
          `có transcript: lấy ngưỡng mạnh tay nhất còn an toàn ${s.db}dB ` +
          `(${(s.midpointRate * 100).toFixed(1)}% chữ bị nuốt, trần ${(WORD_MIDPOINT_MAX_RATE * 100).toFixed(0)}%); ` +
          `${totalSec(s.ranges).toFixed(1)}s tai máy gọi là lặng, transcript cho phép cắt ${totalSec(s.guarded).toFixed(1)}s`,
      };
    }
  }

  const inBand = sweep.find((s) => s.ratio >= SANE_RATIO_LO && s.ratio <= SANE_RATIO_HI);
  const prefix = hasWords
    ? "CÓ transcript nhưng không ngưỡng nào giữ được tỉ lệ chữ bị nuốt dưới trần (mốc thời gian của transcript nhiều khả năng sai) - lùi về luật đo bằng tai máy: "
    : "";
  if (inBand) {
    return {
      db: inBand.db,
      ranges: hasWords ? inBand.guarded : inBand.ranges,
      note:
        `${prefix}ngưỡng yên nhất còn đo được lượng lặng hợp lý: ${inBand.db}dB ` +
        `(${(inBand.ratio * 100).toFixed(1)}% thời lượng, ${inBand.count} khoảng)`,
    };
  }
  const distance = (r: number): number =>
    r < SANE_RATIO_LO ? SANE_RATIO_LO - r : r - SANE_RATIO_HI;
  const best = [...sweep].sort((a, b) => distance(a.ratio) - distance(b.ratio))[0];
  const why =
    best.ratio < SANE_RATIO_LO
      ? "không ngưỡng nào đo đủ 2% lặng - file gần như không có chỗ chết, hoặc nền quá ồn"
      : "mọi ngưỡng đều đo trên 35% lặng - nền rất yên hoặc giọng rất nhỏ, cắt sâu dễ ăn vào tiếng";
  return {
    db: best.db,
    ranges: hasWords ? best.guarded : best.ranges,
    note: `${prefix}KHÔNG có ngưỡng nào rơi vào dải hợp lý (${why}); lấy ngưỡng gần dải nhất: ${best.db}dB (${(best.ratio * 100).toFixed(1)}%)`,
  };
}

async function measureNoiseFloorDb(
  wavAbs: string,
  silences: SilenceRange[],
  fallbackMeanDb: number,
  isCanceled?: () => boolean,
): Promise<number> {
  const sample = silences.slice(0, 30);
  if (sample.length === 0) return fallbackMeanDb;
  const expr = sample
    .map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`)
    .join("+");
  const stderr = await runFfmpeg(
    ["-i", wavAbs, "-af", `aselect='${expr}',volumedetect`, "-f", "null", "-"],
    { timeoutMs: 300_000, isCanceled, allowNonZero: true },
  );
  const mean = parseFloat(stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)?.[1] ?? "");
  return Number.isFinite(mean) ? mean : fallbackMeanDb;
}

async function measureVolume(
  wavAbs: string,
  isCanceled?: () => boolean,
): Promise<{ meanDb: number; maxDb: number }> {
  const stderr = await runFfmpeg(["-i", wavAbs, "-af", "volumedetect", "-f", "null", "-"], {
    timeoutMs: 300_000,
    isCanceled,
    allowNonZero: true,
  });
  const mean = parseFloat(stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)?.[1] ?? "");
  const max = parseFloat(stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/)?.[1] ?? "");
  return {
    meanDb: Number.isFinite(mean) ? mean : -30,
    maxDb: Number.isFinite(max) ? max : 0,
  };
}

function tmpWavPath(tag: string): string {
  ensureDir(paths.uploadTmpDir);
  return path.join(
    paths.uploadTmpDir,
    `autotrim-${tag}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`,
  );
}

interface Detection {
  durationSec: number;
  thresholdDb: number;
  noiseFloorDb: number;

  raw: SilenceRange[];
  note: string;
  sweep: Array<{ db: number; count: number; ratio: number; midpointRate: number }>;
  guarded: boolean;
  wordGuard: { droppedSec: number; droppedRanges: number };
}

async function detect(
  fileAbs: string,
  isCanceled?: () => boolean,
  words?: WordSpan[],
): Promise<Detection> {
  if (!fs.existsSync(fileAbs)) {
    throw new HttpError(404, "TRIM_FILE_NOT_FOUND", `Không thấy file: ${fileAbs}`);
  }
  const wordList = (words ?? []).filter(
    (w) => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start,
  );
  const hasWords = wordList.length > 0;
  const wavAbs = tmpWavPath("probe");
  try {
    await extractProbeWav(fileAbs, wavAbs, isCanceled);
    const durationSec = await probeSeconds(wavAbs, isCanceled);
    const { meanDb } = await measureVolume(wavAbs, isCanceled);
    const gaps = hasWords ? wordGapRanges(wordList, durationSec) : [];

    const sweep: SweepEntry[] = [];
    for (const db of CANDIDATE_DB) {
      if (isCanceled?.()) throw new Error("Job đã bị hủy");
      const ranges = await detectSilences(wavAbs, db, SWEEP_MIN_DUR, durationSec, isCanceled);
      const merged = mergeRanges(ranges);
      sweep.push({
        db,
        count: ranges.length,
        ratio: totalSec(ranges) / durationSec,
        ranges,
        guarded: hasWords ? intersectRanges(merged, gaps) : merged,
        midpointRate: hasWords ? midpointHitRate(wordList, merged) : 0,
      });
    }

    const picked = pickThreshold(sweep, hasWords);
    const chosen = sweep.find((s) => s.db === picked.db);
    const droppedSec = chosen ? Math.max(0, totalSec(chosen.ranges) - totalSec(picked.ranges)) : 0;

    const droppedRanges =
      chosen && hasWords
        ? chosen.ranges.filter((r) => {
            const kept = totalSec(intersectRanges([r], picked.ranges));
            return r.duration - kept > 1e-3;
          }).length
        : 0;

    const noiseFloorDb = await measureNoiseFloorDb(wavAbs, picked.ranges, meanDb, isCanceled);
    return {
      durationSec,
      thresholdDb: picked.db,
      noiseFloorDb,
      raw: picked.ranges,
      note: picked.note,
      sweep: sweep.map(({ db, count, ratio, midpointRate }) => ({
        db,
        count,
        ratio,
        midpointRate,
      })),
      guarded: hasWords,
      wordGuard: { droppedSec: round3(droppedSec), droppedRanges },
    };
  } finally {

    fs.rmSync(wavAbs, { force: true });
  }
}

function resolveProfile(aggressiveness?: TrimAggressiveness): TrimProfile {
  return TRIM_PROFILES[aggressiveness ?? DEFAULT_AGGRESSIVENESS] ?? TRIM_PROFILES.default;
}

function effectiveMinSilence(p: TrimProfile): number {
  return Math.min(p.minSilenceSec, p.maxResidualSec);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mergeRanges(ranges: SilenceRange[]): SilenceRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: SilenceRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-6) {
      if (r.end > last.end) {
        last.end = r.end;
        last.duration = last.end - last.start;
      }
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

function buildCutRanges(
  raw: SilenceRange[],
  durationSec: number,
  p: TrimProfile,
): SilenceRange[] {
  const minSil = effectiveMinSilence(p);
  const cuts: SilenceRange[] = [];
  for (const s of raw) {
    const atHead = s.start <= EDGE_EPS;
    const atTail = s.end >= durationSec - EDGE_EPS;
    let start: number;
    let end: number;
    if (atHead && atTail) {

      continue;
    } else if (atHead) {
      start = 0;
      end = s.end - EDGE_KEEP_SEC;
    } else if (atTail) {
      start = s.start + EDGE_KEEP_SEC;
      end = durationSec;
    } else {
      if (s.duration < minSil) continue;
      start = s.start + p.padSec;
      end = s.end - p.padSec;
    }
    start = Math.max(0, round3(start));
    end = Math.min(durationSec, round3(end));
    if (end - start >= MIN_PIECE_SEC) cuts.push({ start, end, duration: round3(end - start) });
  }
  return mergeRanges(cuts);
}

function guardMidpoints(cuts: SilenceRange[], words: WordSpan[]): SilenceRange[] {
  if (words.length === 0) return cuts;
  const mids = words
    .filter((w) => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start)
    .map((w) => (w.start + w.end) / 2)
    .sort((a, b) => a - b);
  return cuts.filter((c) => !mids.some((m) => m >= c.start && m <= c.end));
}

export function toKeepRanges(cuts: SilenceRange[], durationSec: number): Array<[number, number]> {
  const keep: Array<[number, number]> = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start - cursor >= MIN_PIECE_SEC) keep.push([round3(cursor), round3(c.start)]);
    cursor = Math.max(cursor, c.end);
  }
  if (durationSec - cursor >= MIN_PIECE_SEC) keep.push([round3(cursor), round3(durationSec)]);
  return keep;
}

export async function analyzeSilence(
  fileAbs: string,
  aggressiveness?: TrimAggressiveness,
  opts?: {
    isCanceled?: () => boolean;

    words?: WordSpan[];
  },
): Promise<TrimAnalysis> {
  const profile = resolveProfile(aggressiveness);
  const d = await detect(fileAbs, opts?.isCanceled, opts?.words);
  const cuts = guardMidpoints(
    buildCutRanges(d.raw, d.durationSec, profile),
    opts?.words ?? [],
  );
  const keepRanges = toKeepRanges(cuts, d.durationSec);
  const keptSec = keepRanges.reduce((s, [a, b]) => s + (b - a), 0);
  return {
    durationSec: round3(d.durationSec),
    noiseFloorDb: Math.round(d.noiseFloorDb * 10) / 10,
    thresholdDb: d.thresholdDb,
    profile,
    silences: cuts,
    keepRanges,
    removedSec: round3(Math.max(0, d.durationSec - keptSec)),
    thresholdNote: d.note,
    sweep: d.sweep,
    ...(d.guarded ? { wordGuard: d.wordGuard } : {}),
  };
}

export function buildTrimFilter(
  keepRanges: Array<[number, number]>,
  hasVideo: boolean,
  hasAudio: boolean,
): { filter: string; maps: string[] } {
  const parts: string[] = [];
  const labels: string[] = [];
  keepRanges.forEach(([s, e], i) => {

    const from = s.toFixed(6);
    const to = e.toFixed(6);
    if (hasVideo) {
      parts.push(`[0:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS[v${i}]`);
    }
    if (hasAudio) {

      const fade = audioCutFade(Number(to) - Number(from));
      parts.push(
        `[0:a]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS${fade ? `,${fade}` : ""}[a${i}]`,
      );
    }
    labels.push(`${hasVideo ? `[v${i}]` : ""}${hasAudio ? `[a${i}]` : ""}`);
  });
  const outLabels = `${hasVideo ? "[vout]" : ""}${hasAudio ? "[aout]" : ""}`;
  parts.push(
    `${labels.join("")}concat=n=${keepRanges.length}:v=${hasVideo ? 1 : 0}:a=${hasAudio ? 1 : 0}${outLabels}`,
  );
  const maps: string[] = [];
  if (hasVideo) maps.push("-map", "[vout]");
  if (hasAudio) maps.push("-map", "[aout]");
  return { filter: parts.join(";"), maps };
}

const FILTER_INLINE_MAX = 24_000;

export async function alignKeepRangesToFrames(
  fileAbs: string,
  keepRanges: Array<[number, number]>,
  opts?: { isCanceled?: () => boolean; onLog?: (l: string) => void },
): Promise<Array<[number, number]>> {
  const log = opts?.onLog ?? ((): void => {});

  if (keepRanges.length < 2) return keepRanges;
  let r: Awaited<ReturnType<typeof execFileCaptureAll>> | null = null;
  try {
    r = await execFileCaptureAll(
      "ffprobe",
      ffprobeSafeArgs([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=pts_time:format=start_time",
        "-of",
        "csv",
        fileAbs,
      ]),

      { timeoutMs: 300_000, isCanceled: opts?.isCanceled },
    );
  } catch {
    r = null;
  }
  if (r?.canceled) throw new Error("Job đã bị hủy");
  let startTime = 0;
  const frames: number[] = [];
  for (const line of (r?.stdout ?? "").split(/\r?\n/)) {
    const [kind, value] = line.trim().split(",");
    const n = parseFloat(value ?? "");
    if (!Number.isFinite(n)) continue;
    if (kind === "packet") frames.push(n);
    else if (kind === "format") startTime = n;
  }
  if (!r || r.timedOut || r.code !== 0 || frames.length < 2) {
    log("[trim] Không đọc được mốc frame video - giữ nguyên mép đoạn (mỗi mối nối có thể lệch vài ms).");
    return keepRanges;
  }
  const f = frames.map((t) => t - startTime).sort((a, b) => a - b);
  const snap = (b: number): number => {

    if (b <= Math.max(0, f[0]) || b > f[f.length - 1]) return b;

    let lo = 1;
    let hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (f[mid] < b) lo = mid + 1;
      else hi = mid;
    }
    return (f[lo - 1] + f[lo]) / 2;
  };
  const out = keepRanges
    .map(([s, e]): [number, number] => [snap(s), snap(e)])
    .filter(([s, e]) => e - s >= MIN_PIECE_SEC);
  return out.length > 0 ? out : keepRanges;
}

export async function applyTrim(
  fileAbs: string,
  keepRanges: Array<[number, number]>,
  outAbs: string,
  opts?: { isCanceled?: () => boolean; onLog?: (l: string) => void },
): Promise<void> {
  const log = opts?.onLog ?? ((): void => {});
  if (!fs.existsSync(fileAbs)) {
    throw new HttpError(404, "TRIM_FILE_NOT_FOUND", `Không thấy file: ${fileAbs}`);
  }
  if (keepRanges.length === 0) {
    log("[trim] Không có đoạn nào để giữ - bỏ qua, giữ nguyên file gốc.");
    return;
  }
  const durationSec = await probeSeconds(fileAbs, opts?.isCanceled);
  const keptSec = keepRanges.reduce((s, [a, b]) => s + (b - a), 0);

  if (keepRanges.length === 1 && keptSec >= durationSec - EDGE_EPS) {
    log(
      `[trim] Không có khoảng lặng nào đáng cắt (giữ ${keptSec.toFixed(2)}s/${durationSec.toFixed(2)}s) - bỏ qua encode.`,
    );
    return;
  }

  const { hasVideo, hasAudio } = await probeStreams(fileAbs, opts?.isCanceled);
  if (!hasVideo && !hasAudio) {
    throw new HttpError(
      400,
      "TRIM_NO_STREAM",
      `File ${path.basename(fileAbs)} không có stream video lẫn audio - không cắt được.`,
    );
  }
  const { filter, maps } = buildTrimFilter(keepRanges, hasVideo, hasAudio);
  ensureDir(path.dirname(outAbs));

  let scriptAbs: string | null = null;
  const filterArgs: string[] =
    filter.length <= FILTER_INLINE_MAX ? ["-filter_complex", filter] : [];
  try {
    if (filterArgs.length === 0) {
      scriptAbs = path.join(
        paths.uploadTmpDir,
        `autotrim-filter-${process.pid}-${Date.now()}.txt`,
      );
      ensureDir(paths.uploadTmpDir);
      fs.writeFileSync(scriptAbs, filter, "utf8");
      filterArgs.push("-filter_complex_script", scriptAbs);
      log(`[trim] Filter dài ${filter.length} ký tự - đẩy qua file tạm cho khỏi vượt trần lệnh.`);
    }

    log(
      `[trim] Cắt ${keepRanges.length} đoạn giữ lại, ${keptSec.toFixed(2)}s/${durationSec.toFixed(2)}s ` +
        `(bỏ ${(durationSec - keptSec).toFixed(2)}s).`,
    );

    const timeoutMs = Math.min(3_600_000, 300_000 + Math.ceil(keptSec) * 4_000);
    await runFfmpeg(
      [
        "-i",
        fileAbs,
        ...filterArgs,
        ...maps,

        ...(hasVideo
          ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
          : []),
        ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
        "-movflags",
        "+faststart",
        outAbs,
      ],
      { timeoutMs, isCanceled: opts?.isCanceled },
    );
    const outSec = await probeSeconds(outAbs, opts?.isCanceled);
    log(`[trim] Xong: ${path.basename(outAbs)} dài ${outSec.toFixed(2)}s (dự kiến ${keptSec.toFixed(2)}s).`);
  } finally {
    if (scriptAbs) fs.rmSync(scriptAbs, { force: true });
  }
}

interface WordLike {
  start?: number;
  end?: number;
  [k: string]: unknown;
}
interface SegmentLike {
  start?: number;
  end?: number;
  words?: WordLike[];
  [k: string]: unknown;
}
interface TranscriptLike {
  duration?: number;
  segments?: SegmentLike[];
  [k: string]: unknown;
}

function buildMapper(keepRanges: Array<[number, number]>): {
  ranges: Array<{ start: number; end: number; offset: number }>;
  totalSec: number;
} {
  const sorted = [...keepRanges].sort((a, b) => a[0] - b[0]);
  const ranges: Array<{ start: number; end: number; offset: number }> = [];
  let offset = 0;
  for (const [s, e] of sorted) {
    if (e <= s) continue;
    ranges.push({ start: s, end: e, offset });
    offset += e - s;
  }
  return { ranges, totalSec: offset };
}

function mapTime(
  t: number,
  ranges: Array<{ start: number; end: number; offset: number }>,
  dir: "start" | "end",
): number | null {
  for (const r of ranges) {
    if (t >= r.start && t <= r.end) return round3(r.offset + (t - r.start));
  }
  if (dir === "start") {
    const next = ranges.find((r) => r.start > t);
    return next ? round3(next.offset) : null;
  }
  let prev: { start: number; end: number; offset: number } | null = null;
  for (const r of ranges) if (r.end < t) prev = r;
  return prev ? round3(prev.offset + (prev.end - prev.start)) : null;
}

function survives(
  a: number,
  b: number,
  ranges: Array<{ start: number; end: number; offset: number }>,
): boolean {
  for (const r of ranges) {
    const lo = Math.max(a, r.start);
    const hi = Math.min(b, r.end);
    if (hi - lo > 1e-6) return true;

    if (a === b && a >= r.start && a <= r.end) return true;
  }
  return false;
}

function keptPart(
  a: number,
  b: number,
  ranges: Array<{ start: number; end: number; offset: number }>,
): number {
  let sum = 0;
  for (const r of ranges) sum += Math.max(0, Math.min(b, r.end) - Math.max(a, r.start));
  return sum;
}

export function remapWordTimestamps<T>(transcript: T, keepRanges: Array<[number, number]>): T {
  const src = transcript as unknown as TranscriptLike;
  const { ranges, totalSec } = buildMapper(keepRanges);
  if (!src || typeof src !== "object" || !Array.isArray(src.segments)) return transcript;

  if (ranges.length === 0) return transcript;

  const segments: SegmentLike[] = [];
  for (const seg of src.segments) {
    const words = Array.isArray(seg.words) ? seg.words : null;
    if (words && words.length > 0) {
      const kept: WordLike[] = [];
      for (const w of words) {
        const ws = typeof w.start === "number" ? w.start : null;
        const we = typeof w.end === "number" ? w.end : ws;
        if (ws === null || we === null) continue;
        if (!survives(ws, we, ranges)) continue;

        if (we > ws && keptPart(ws, we, ranges) < (we - ws) / 2) continue;
        const ns = mapTime(ws, ranges, "start");
        const ne = mapTime(we, ranges, "end");
        if (ns === null || ne === null) continue;
        kept.push({ ...w, start: ns, end: Math.max(ns, ne) });
      }
      if (kept.length === 0) continue;
      const first = kept[0].start as number;
      const last = kept[kept.length - 1].end as number;
      segments.push({ ...seg, start: first, end: Math.max(first, last), words: kept });
      continue;
    }

    const ss = typeof seg.start === "number" ? seg.start : null;
    const se = typeof seg.end === "number" ? seg.end : ss;
    if (ss === null || se === null) {
      segments.push({ ...seg });
      continue;
    }
    if (!survives(ss, se, ranges)) continue;
    const ns = mapTime(ss, ranges, "start");
    const ne = mapTime(se, ranges, "end");
    if (ns === null || ne === null) continue;
    segments.push({ ...seg, start: ns, end: Math.max(ns, ne) });
  }

  const out: TranscriptLike = { ...src, segments };

  if (typeof src.duration === "number") out.duration = round3(totalSec);
  return out as unknown as T;
}

function residualFloor(p: TrimProfile): number {
  return Math.min(p.maxResidualSec, effectiveMinSilence(p));
}

export async function verifyTrim(
  fileAbs: string,
  aggressiveness?: TrimAggressiveness,
  opts?: {
    isCanceled?: () => boolean;

    words?: WordSpan[];
  },
): Promise<TrimVerification> {
  const profile = resolveProfile(aggressiveness);
  const d = await detect(fileAbs, opts?.isCanceled, opts?.words);
  const floor = residualFloor(profile);
  const residual = d.raw
    .filter((s) => s.duration >= floor)
    .map((s) => ({ start: round3(s.start), end: round3(s.end), duration: round3(s.duration) }));
  const totalSilenceSec = round3(residual.reduce((sum, s) => sum + s.duration, 0));
  const ratio = d.durationSec > 0 ? totalSilenceSec / d.durationSec : 0;
  const longest = residual.reduce((m, s) => Math.max(m, s.duration), 0);

  const fails: string[] = [];
  if (longest > profile.maxResidualSec) {
    const worst = residual.find((s) => s.duration === longest);
    fails.push(
      `còn khoảng lặng ${longest.toFixed(2)}s (trần ${profile.maxResidualSec}s)` +
        (worst ? ` tại ${worst.start.toFixed(2)}s` : ""),
    );
  }
  if (ratio > profile.maxResidualRatio) {
    fails.push(
      `tổng lặng ${totalSilenceSec.toFixed(2)}s = ${(ratio * 100).toFixed(1)}% thời lượng ` +
        `(trần ${(profile.maxResidualRatio * 100).toFixed(0)}%)`,
    );
  }
  const pass = fails.length === 0;
  const how = d.guarded
    ? `Đo ở ngưỡng ${d.thresholdDb}dB có đối chiếu transcript (${d.wordGuard.droppedSec}s tai máy gọi là lặng nhưng thật ra là tiếng nói nhỏ, đã loại)`
    : `Đo ở ngưỡng ${d.thresholdDb}dB, KHÔNG có transcript nên chỉ nghe mức âm thanh - con số này không đáng tin theo cả hai chiều (vừa có thể chấm đậu oan vì tự chấm bằng chính ngưỡng đã dùng để cắt, vừa có thể chấm trượt oan vì đếm cả tiếng nói nhỏ trong chữ là lặng). Truyền words đã dời mốc để đo thật`;
  return {
    residual,
    totalSilenceSec,
    ratio: Math.round(ratio * 10000) / 10000,
    longest: round3(longest),
    pass,
    ...(pass && d.guarded
      ? {}
      : {
          reason: pass
            ? `Đạt ở mức "${aggressiveness ?? DEFAULT_AGGRESSIVENESS}", NHƯNG chưa chắc chắn: ${how}.`
            : `Chưa đạt ở mức "${aggressiveness ?? DEFAULT_AGGRESSIVENESS}": ${fails.join("; ")}. ` +
              `${how}, nền nhiễu ${d.noiseFloorDb.toFixed(1)}dB, chỉ tính khoảng lặng >= ${floor}s.`,
        }),
  };
}
