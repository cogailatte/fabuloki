import fs from "node:fs";
import path from "node:path";
import { verifyTrim, type TrimAggressiveness, type WordSpan } from "./autoTrim.js";
import { repoRoot } from "./config.js";
import { ffmpegSafeArgs, ffprobeSafeArgs } from "./ffmpegSafe.js";
import { briefOf, projectDirOf, readMeta, type ProjectMeta } from "./meta.js";
import { readProjectTranscript } from "./transcript.js";
import { ensureDir, execFileCaptureAll, nowIso, toRepoRel } from "./util.js";

export type QcStatus = "pass" | "warn" | "fail";

export interface QcCheck {
  id: string;
  label: string;
  status: QcStatus;
  detail: string;

  value?: number | null;

  frames?: string[];
}

export interface QcReport {
  checkedAt: string;

  file: string;

  fileMtime: string;
  platform: string;
  status: QcStatus;
  checks: QcCheck[];
}

export const QC_PLATFORMS = ["tiktok", "youtube", "reels"] as const;
export type QcPlatform = (typeof QC_PLATFORMS)[number];

export function isQcPlatform(v: unknown): v is QcPlatform {
  return typeof v === "string" && (QC_PLATFORMS as readonly string[]).includes(v);
}

const TARGET_LUFS = -14;

const LUFS_WARN_DELTA = 2;
const LUFS_FAIL_DELTA = 4;

const TP_WARN_DBTP = -1.0;
const TP_FAIL_DBTP = -0.5;

const BLACK_MIN_DUR = 0.25;

const BLACK_EDGE_TOLERANCE = 0.3;

const FREEZE_MIN_DUR = 2;

const FREEZE_TAIL_TOLERANCE = 0.5;

const TAIL_WINDOW_SEC = 4;
const TAIL_SILENCE_DB = -45;
const TAIL_SILENCE_MIN_DUR = 0.6;

const TAIL_SILENCE_WARN_SEC = 1.2;

const DEAD_AIR_MAX_LISTED = 5;

const AV_DIFF_WARN_SEC = 0.5;

const FPS_WARN_DELTA = 0.5;

const DURATION_SHORT_SEC = 5;

const DURATION_LONG_SEC = 600;

const SAFE_TOP_RATIO = 0.10;
const SAFE_BOTTOM_RATIO = 0.16;

const SAFE_SAMPLES = 6;

const SAFE_SHOTS = 3;

const SAFE_SHOT_WIDTH = 540;

const FFMPEG_TIMEOUT_MS = 120_000;

const STATUS_RANK: Record<QcStatus, number> = { pass: 0, warn: 1, fail: 2 };

function worst(a: QcStatus, b: QcStatus): QcStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "?";
}

function unmeasured(id: string, label: string, why: string): QcCheck {
  return {
    id,
    label,
    status: "warn",
    detail: `Không đo được: ${why}`,
    value: null,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runFfmpeg(args: string[]): Promise<{ out: string; timedOut: boolean }> {
  const r = await execFileCaptureAll("ffmpeg", ffmpegSafeArgs(["-hide_banner", "-nostats", ...args]), {
    timeoutMs: FFMPEG_TIMEOUT_MS,
  });

  return { out: `${r.stderr}\n${r.stdout}`, timedOut: r.timedOut };
}

interface ProbeResult {
  ok: boolean;
  error: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoDurationSec: number | null;
  audioDurationSec: number | null;
  hasAudio: boolean;

  durationSec: number | null;
}

function parseNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

function parseRate(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const [a, b] = v.split("/");
  const num = parseFloat(a);
  const den = b === undefined ? 1 : parseFloat(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

async function probeFile(fileAbs: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    ok: false,
    error: "",
    width: null,
    height: null,
    fps: null,
    videoDurationSec: null,
    audioDurationSec: null,
    hasAudio: false,
    durationSec: null,
  };
  const r = await execFileCaptureAll(
    "ffprobe",
    ffprobeSafeArgs([
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,width,height,r_frame_rate,duration:format=duration",
      "-of",
      "json",
      fileAbs,
    ]),
    { timeoutMs: 30_000 },
  );
  if (r.timedOut) return { ...base, error: "ffprobe quá thời gian" };
  if (r.code !== 0) {
    return { ...base, error: `ffprobe thoát mã ${r.code}: ${r.stderr.trim().slice(0, 300)}` };
  }
  try {
    const json = JSON.parse(r.stdout) as {
      streams?: Record<string, unknown>[];
      format?: Record<string, unknown>;
    };
    const streams = Array.isArray(json.streams) ? json.streams : [];
    const video = streams.find((s) => s.codec_type === "video");
    const audio = streams.find((s) => s.codec_type === "audio");
    const out: ProbeResult = {
      ...base,
      ok: true,
      width: video ? parseNum(video.width) : null,
      height: video ? parseNum(video.height) : null,
      fps: video ? parseRate(video.r_frame_rate) : null,
      videoDurationSec: video ? parseNum(video.duration) : null,
      audioDurationSec: audio ? parseNum(audio.duration) : null,
      hasAudio: Boolean(audio),
      durationSec: parseNum(json.format?.duration),
    };
    if (out.durationSec === null) out.durationSec = out.videoDurationSec;
    if (!video) {
      return { ...out, ok: false, error: "File không có stream video" };
    }
    return out;
  } catch (err) {
    return { ...base, error: `ffprobe trả JSON không đọc được: ${errText(err)}` };
  }
}

interface LoudnormResult {
  inputI: number | null;
  inputTp: number | null;

  silent: boolean;
  error: string;
}

function isSilentValue(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "-inf" || s === "-infinity") return true;
  const n = parseFloat(s);
  return Number.isFinite(n) && n <= -70;
}

function parseLoudnormJson(out: string): Record<string, string> | null {
  const blocks = out.match(/\{[^{}]*\}/g);
  if (!blocks) return null;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (!blocks[i].includes("input_i")) continue;
    try {
      return JSON.parse(blocks[i]) as Record<string, string>;
    } catch {

    }
  }
  return null;
}

async function measureLoudness(fileAbs: string): Promise<LoudnormResult> {
  const empty: LoudnormResult = { inputI: null, inputTp: null, silent: false, error: "" };
  try {
    const { out, timedOut } = await runFfmpeg([
      "-i",
      fileAbs,

      "-vn",
      "-af",
      `loudnorm=I=${TARGET_LUFS}:TP=-1:LRA=11:print_format=json`,
      "-f",
      "null",
      "-",
    ]);
    if (timedOut) return { ...empty, error: "ffmpeg loudnorm quá thời gian (120s)" };
    const json = parseLoudnormJson(out);
    if (!json) return { ...empty, error: "không thấy khối JSON kết quả của loudnorm" };
    return {
      inputI: parseNum(json.input_i),
      inputTp: parseNum(json.input_tp),
      silent: isSilentValue(json.input_i),
      error: "",
    };
  } catch (err) {
    return { ...empty, error: errText(err) };
  }
}

async function measureEdgeDensity(
  fileAbs: string,
  atSec: number,
  crop: { w: number; h: number; x: number; y: number },
): Promise<number | null> {
  try {
    const filter =
      `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` +
      `edgedetect=low=0.1:high=0.3,signalstats,` +
      `metadata=print:key=lavfi.signalstats.YAVG`;

    const { out, timedOut } = await runFfmpeg([
      "-ss",
      String(atSec),
      "-i",
      fileAbs,
      "-frames:v",
      "1",
      "-vf",
      filter,
      "-f",
      "null",
      "-",
    ]);
    if (timedOut) return null;
    const m = out.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    return m ? parseNum(m[1]) : null;
  } catch {
    return null;
  }
}

function flattenTranscriptWords(projectId: string): {
  words: WordSpan[];
  relPath: string;
} | null {
  const t = readProjectTranscript(projectId);
  if (!t) return null;
  const words: WordSpan[] = [];
  for (const seg of t.segments) {
    if (seg.words.length > 0) {
      for (const w of seg.words) {
        if (Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start) {
          words.push({ start: w.start, end: w.end });
        }
      }
      continue;
    }
    if (Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start) {
      words.push({ start: seg.start, end: seg.end });
    }
  }
  return words.length > 0 ? { words, relPath: t.relPath } : null;
}

async function checkDeadAir(input: {
  projectId: string;
  fileAbs: string;
  hasAudio: boolean;
}): Promise<QcCheck> {
  const label = "Chỗ chết (dead air)";
  if (!input.hasAudio) return unmeasured("dead-air", label, "file không có stream audio");

  let autoCut = false;
  let level: TrimAggressiveness = "default";
  try {
    const brief = briefOf(readMeta(input.projectId));
    autoCut = brief.autoCut;
    level = brief.autoCutLevel;
  } catch {

    autoCut = false;
  }

  const t = flattenTranscriptWords(input.projectId);
  if (!t) {
    return unmeasured(
      "dead-air",
      label,
      "project chưa có transcript đọc được - đo khoảng lặng bằng mức âm thanh một mình là " +
        "đoán mò (đếm cả tiếng nói nhỏ trong chữ là lặng), nên không chấm",
    );
  }

  try {
    const v = await verifyTrim(input.fileAbs, level, { words: t.words });
    const worstList = [...v.residual]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, DEAD_AIR_MAX_LISTED)
      .map((s) => `${fmt(s.start, 2)}s (${fmt(s.duration, 2)}s)`)
      .join(", ");
    const base =
      `Còn ${fmt(v.totalSilenceSec, 2)}s chỗ chết = ${fmt(v.ratio * 100, 1)}% thời lượng, ` +
      `chỗ dài nhất ${fmt(v.longest, 2)}s` +
      (worstList ? ` - dài nhất tại: ${worstList}` : "") +
      ` (đo có đối chiếu ${t.relPath}, mức "${level}")`;

    if (v.pass) {
      return { id: "dead-air", label, status: "pass", detail: base, value: v.totalSilenceSec };
    }
    if (!autoCut) {

      return {
        id: "dead-air",
        label,
        status: "pass",
        detail:
          `${base}. Vượt ngưỡng của mức "${level}" nhưng brief KHÔNG bật tự động cắt, ` +
          "nên chỉ ghi nhận - khoảng lặng ở đây coi như nhịp có chủ ý.",
        value: v.totalSilenceSec,
      };
    }

    return {
      id: "dead-air",
      label,
      status: "warn",
      detail:
        `${base}. ${v.reason ?? ""} Brief BẬT tự động cắt nên chỗ này nên cắt thêm: gọi ` +
        `POST /api/projects/${input.projectId}/auto-trim/analyze rồi .../apply để cắt bằng ngưỡng đã đo, ` +
        "đừng tự gõ ffmpeg silencedetect. (Cảnh báo, không chặn final: phép đo này " +
        "đối chiếu transcript của bản đã cắt lên video đã lắp ráp nên có thể lệch mốc.)",
      value: v.totalSilenceSec,
    };
  } catch (err) {
    return unmeasured("dead-air", label, errText(err));
  }
}

function resolvePlatform(
  raw: string,
  probe: ProbeResult,
  meta: ProjectMeta | null,
): QcPlatform {
  if (isQcPlatform(raw)) return raw;
  const w = probe.width ?? (meta ? Number(meta.width) || null : null);
  const h = probe.height ?? (meta ? Number(meta.height) || null : null);

  if (w !== null && h !== null && h > w) return "tiktok";
  return "youtube";
}

export async function runQc(input: {
  projectId: string;
  fileAbs: string;
  platform: string;
}): Promise<QcReport> {
  const { fileAbs } = input;
  const checks: QcCheck[] = [];

  let meta: ProjectMeta | null = null;
  try {
    meta = readMeta(input.projectId);
  } catch {

    meta = null;
  }

  const st = fs.statSync(fileAbs);
  const probe = await probeFile(fileAbs);
  const platform = resolvePlatform(input.platform, probe, meta);
  const duration = probe.durationSec;

  if (!probe.ok) {
    checks.push(unmeasured("resolution", "Kích thước & fps", probe.error || "ffprobe thất bại"));
  } else {
    const w = probe.width;
    const h = probe.height;
    const fps = probe.fps;
    const parts: string[] = [`${w ?? "?"}x${h ?? "?"}`, `${fps === null ? "?" : fmt(fps, 2)} fps`];
    let status: QcStatus = "pass";
    if (meta) {
      const mw = Number(meta.width) || 0;
      const mh = Number(meta.height) || 0;
      const mfps = Number(meta.fps) || 0;
      if (mw > 0 && mh > 0 && (w !== mw || h !== mh)) {
        status = "fail";
        parts.push(`LỆCH kích thước so với meta.json (${mw}x${mh})`);
      }
      if (mfps > 0 && fps !== null && Math.abs(fps - mfps) > FPS_WARN_DELTA) {
        status = worst(status, "warn");
        parts.push(`lệch fps so với meta.json (${mfps})`);
      }
    } else {
      parts.push("không có meta.json để đối chiếu");
    }
    checks.push({
      id: "resolution",
      label: "Kích thước & fps",
      status,
      detail: parts.join(" - "),
      value: h,
    });
  }

  if (!probe.hasAudio) {

    checks.push(unmeasured("loudness", "Độ to (LUFS)", "file không có stream audio"));
    checks.push(unmeasured("truepeak", "Đỉnh thật (dBTP)", "file không có stream audio"));
  } else {
    const loud = await measureLoudness(fileAbs);
    if (loud.silent) {
      checks.push({
        id: "loudness",
        label: "Độ to (LUFS)",
        status: "fail",
        detail:
          "Track audio im lặng hoàn toàn (loudnorm trả -inf) - kiểm tra đã ghép voice/nhạc vào bản dựng chưa",
        value: null,
      });
      checks.push({
        id: "truepeak",
        label: "Đỉnh thật (dBTP)",
        status: "pass",
        detail: "Không có tín hiệu để đo đỉnh (track im lặng)",
        value: null,
      });
    } else if (loud.inputI === null) {
      checks.push(unmeasured("loudness", "Độ to (LUFS)", loud.error || "không parse được input_i"));
    } else {
      const delta = loud.inputI - TARGET_LUFS;
      const adjust = -delta;
      const status: QcStatus =
        Math.abs(delta) > LUFS_FAIL_DELTA ? "fail" : Math.abs(delta) > LUFS_WARN_DELTA ? "warn" : "pass";
      const advice =
        status === "pass"
          ? "đạt mục tiêu"
          : `nên ${adjust > 0 ? "TĂNG" : "GIẢM"} ${fmt(Math.abs(adjust), 1)} dB`;
      checks.push({
        id: "loudness",
        label: "Độ to (LUFS)",
        status,
        detail: `${fmt(loud.inputI, 2)} LUFS (mục tiêu ${TARGET_LUFS} LUFS, lệch ${fmt(delta, 2)} dB) - ${advice}`,
        value: loud.inputI,
      });
    }
    if (loud.silent) {

    } else if (loud.inputTp === null) {
      checks.push(
        unmeasured("truepeak", "Đỉnh thật (dBTP)", loud.error || "không parse được input_tp"),
      );
    } else {
      const status: QcStatus =
        loud.inputTp > TP_FAIL_DBTP ? "fail" : loud.inputTp > TP_WARN_DBTP ? "warn" : "pass";
      const detail =
        status === "fail"
          ? `${fmt(loud.inputTp, 2)} dBTP - đang clip (chuẩn nộp <= ${TP_WARN_DBTP} dBTP), phải hạ gain trước khi final`
          : status === "warn"
            ? `${fmt(loud.inputTp, 2)} dBTP - sát trần, nền tảng transcode dễ méo (chuẩn <= ${TP_WARN_DBTP} dBTP)`
            : `${fmt(loud.inputTp, 2)} dBTP - còn headroom`;
      checks.push({
        id: "truepeak",
        label: "Đỉnh thật (dBTP)",
        status,
        detail,
        value: loud.inputTp,
      });
    }
  }

  try {
    const { out, timedOut } = await runFfmpeg([
      "-i",
      fileAbs,
      "-vf",
      `blackdetect=d=${BLACK_MIN_DUR}:pic_th=0.98:pix_th=0.03`,
      "-an",
      "-f",
      "null",
      "-",
    ]);
    if (timedOut) {
      checks.push(unmeasured("blackframes", "Frame đen", "ffmpeg blackdetect quá thời gian (120s)"));
    } else {
      const re = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
      const mid: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) {
        const start = parseFloat(m[1]);
        const end = parseFloat(m[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

        if (start < BLACK_EDGE_TOLERANCE) continue;
        if (duration !== null && end >= duration - BLACK_EDGE_TOLERANCE) continue;
        mid.push({ start, end });
      }
      if (mid.length === 0) {
        checks.push({
          id: "blackframes",
          label: "Frame đen",
          status: "pass",
          detail: "Không có đoạn đen ở giữa video",
          value: 0,
        });
      } else {
        const list = mid
          .slice(0, 5)
          .map((s) => `${fmt(s.start, 2)}s-${fmt(s.end, 2)}s`)
          .join(", ");
        checks.push({
          id: "blackframes",
          label: "Frame đen",
          status: "fail",
          detail:
            `${mid.length} đoạn đen ở giữa video: ${list}` +
            (mid.length > 5 ? " ..." : "") +
            " - thường do hở frame giữa hai scene hoặc scene render thiếu",
          value: mid.length,
        });
      }
    }
  } catch (err) {
    checks.push(unmeasured("blackframes", "Frame đen", errText(err)));
  }

  try {
    const { out, timedOut } = await runFfmpeg([
      "-i",
      fileAbs,
      "-vf",
      `freezedetect=n=-60dB:d=${FREEZE_MIN_DUR}`,
      "-an",
      "-f",
      "null",
      "-",
    ]);
    if (timedOut) {
      checks.push(unmeasured("freeze", "Đứng hình", "ffmpeg freezedetect quá thời gian (120s)"));
    } else {
      const re = /freeze_start:\s*([\d.]+)/g;
      const starts: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) {
        const t = parseFloat(m[1]);
        if (!Number.isFinite(t)) continue;

        if (duration !== null && t >= duration - FREEZE_TAIL_TOLERANCE) continue;
        starts.push(t);
      }
      if (starts.length === 0) {
        checks.push({
          id: "freeze",
          label: "Đứng hình",
          status: "pass",
          detail: `Không có đoạn đứng hình >= ${FREEZE_MIN_DUR}s`,
          value: 0,
        });
      } else {
        const list = starts
          .slice(0, 5)
          .map((t) => `${fmt(t, 2)}s`)
          .join(", ");
        checks.push({
          id: "freeze",
          label: "Đứng hình",
          status: "warn",
          detail:
            `${starts.length} đoạn đứng hình >= ${FREEZE_MIN_DUR}s, bắt đầu tại: ${list}` +
            (starts.length > 5 ? " ..." : "") +
            " - kiểm tra scene tĩnh hoặc footage bị treo",
          value: starts.length,
        });
      }
    }
  } catch (err) {
    checks.push(unmeasured("freeze", "Đứng hình", errText(err)));
  }

  if (!probe.hasAudio) {
    checks.push(unmeasured("tail-silence", "Đuôi im lặng", "file không có stream audio"));
  } else if (duration === null) {
    checks.push(unmeasured("tail-silence", "Đuôi im lặng", "không xác định được thời lượng video"));
  } else {
    try {
      const from = Math.max(0, duration - TAIL_WINDOW_SEC);
      const windowLen = duration - from;
      const { out, timedOut } = await runFfmpeg([
        "-ss",
        String(from),
        "-i",
        fileAbs,
        "-af",
        `silencedetect=n=${TAIL_SILENCE_DB}dB:d=${TAIL_SILENCE_MIN_DUR}`,
        "-f",
        "null",
        "-",
      ]);
      if (timedOut) {
        checks.push(
          unmeasured("tail-silence", "Đuôi im lặng", "ffmpeg silencedetect quá thời gian (120s)"),
        );
      } else {

        const startRe = /silence_start:\s*(-?[\d.]+)/g;
        const endRe = /silence_end:\s*([\d.]+)/g;
        const starts: number[] = [];
        const ends: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = startRe.exec(out)) !== null) starts.push(parseFloat(m[1]));
        while ((m = endRe.exec(out)) !== null) ends.push(parseFloat(m[1]));
        const lastStart = starts.length ? starts[starts.length - 1] : null;
        const lastEnd = ends.length ? ends[ends.length - 1] : null;

        const reachesEnd =
          lastStart !== null &&
          (lastEnd === null || lastEnd < lastStart || lastEnd >= windowLen - 0.15);
        const tailLen = reachesEnd && lastStart !== null ? windowLen - Math.max(0, lastStart) : 0;
        if (reachesEnd && tailLen > TAIL_SILENCE_WARN_SEC) {
          checks.push({
            id: "tail-silence",
            label: "Đuôi im lặng",
            status: "warn",
            detail: `Đuôi video im lặng ${fmt(tailLen, 2)}s (từ ${fmt(from + Math.max(0, lastStart ?? 0), 2)}s), nên cắt bớt`,
            value: tailLen,
          });
        } else {
          checks.push({
            id: "tail-silence",
            label: "Đuôi im lặng",
            status: "pass",
            detail: reachesEnd
              ? `Đuôi im lặng ${fmt(tailLen, 2)}s - trong mức chấp nhận (<= ${TAIL_SILENCE_WARN_SEC}s)`
              : "Không có khoảng lặng thừa ở cuối",
            value: tailLen,
          });
        }
      }
    } catch (err) {
      checks.push(unmeasured("tail-silence", "Đuôi im lặng", errText(err)));
    }
  }

  checks.push(
    await checkDeadAir({ projectId: input.projectId, fileAbs, hasAudio: probe.hasAudio }),
  );

  if (!probe.ok) {
    checks.push(unmeasured("av-duration", "Lệch tiếng/hình", probe.error || "ffprobe thất bại"));
  } else if (!probe.hasAudio) {
    checks.push({
      id: "av-duration",
      label: "Lệch tiếng/hình",
      status: "fail",
      detail: "Video không có tiếng (không có stream audio)",
      value: null,
    });
  } else if (probe.videoDurationSec === null || probe.audioDurationSec === null) {
    checks.push(
      unmeasured("av-duration", "Lệch tiếng/hình", "container không khai thời lượng từng stream"),
    );
  } else {
    const diff = Math.abs(probe.videoDurationSec - probe.audioDurationSec);
    const status: QcStatus = diff > AV_DIFF_WARN_SEC ? "warn" : "pass";
    checks.push({
      id: "av-duration",
      label: "Lệch tiếng/hình",
      status,
      detail:
        `Hình ${fmt(probe.videoDurationSec, 2)}s, tiếng ${fmt(probe.audioDurationSec, 2)}s, lệch ${fmt(diff, 2)}s` +
        (status === "warn" ? ` - vượt ngưỡng ${AV_DIFF_WARN_SEC}s, kiểm tra lại timeline audio` : ""),
      value: diff,
    });
  }

  const w = probe.width;
  const h = probe.height;
  if (!probe.ok || w === null || h === null) {
    checks.push(unmeasured("safe-area", "Vùng an toàn", probe.error || "không đọc được kích thước"));
  } else if (h <= w) {
    checks.push({
      id: "safe-area",
      label: "Vùng an toàn",
      status: "pass",
      detail: "Video ngang - không áp dụng vùng an toàn của UI TikTok/Reels",
      value: null,
    });
  } else if (duration === null || duration <= 0) {
    checks.push(unmeasured("safe-area", "Vùng an toàn", "không xác định được thời lượng video"));
  } else {
    try {
      const topH = Math.max(2, Math.round(h * SAFE_TOP_RATIO));
      const botH = Math.max(2, Math.round(h * SAFE_BOTTOM_RATIO));

      const t0 = duration * 0.05;
      const t1 = duration * 0.95;
      const step = SAFE_SAMPLES > 1 ? (t1 - t0) / (SAFE_SAMPLES - 1) : 0;
      const topVals: number[] = [];
      const botVals: number[] = [];
      const samples: Array<{ t: number; top: number | null; bot: number | null }> = [];
      for (let i = 0; i < SAFE_SAMPLES; i++) {
        const t = t0 + step * i;
        const top = await measureEdgeDensity(fileAbs, t, { w, h: topH, x: 0, y: 0 });
        const bot = await measureEdgeDensity(fileAbs, t, { w, h: botH, x: 0, y: h - botH });
        if (top !== null) topVals.push(top);
        if (bot !== null) botVals.push(bot);
        samples.push({ t, top, bot });
      }

      const ranked = samples
        .map((s) => ({ t: s.t, score: (s.top ?? 0) + (s.bot ?? 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SAFE_SHOTS)
        .sort((a, b) => a.t - b.t);

      const shotDir = path.join(projectDirOf(input.projectId), "renders");
      ensureDir(shotDir);
      const frames: string[] = [];
      for (let i = 0; i < ranked.length; i++) {
        const t = ranked[i].t;
        const outAbs = path.join(shotDir, `qc-safe-area-${i + 1}.png`);

        const vf =
          `drawbox=x=0:y=0:w=iw:h=${topH}:color=red@0.6:t=5,` +
          `drawbox=x=0:y=ih-${botH}:w=iw:h=${botH}:color=red@0.6:t=5,` +
          `scale=${SAFE_SHOT_WIDTH}:-2`;
        const r = await runFfmpeg([
          "-y", "-ss", String(t.toFixed(2)), "-i", fileAbs,
          "-frames:v", "1", "-vf", vf, "-an", outAbs,
        ]);
        if (!r.timedOut && fs.existsSync(outAbs)) frames.push(toRepoRel(outAbs));
      }

      const avg = (xs: number[]): number | null =>
        xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      const topAvg = avg(topVals);
      const botAvg = avg(botVals);
      const at = ranked.map((r) => `${r.t.toFixed(1)}s`).join(", ");
      checks.push({
        id: "safe-area",
        label: "Vùng bị UI che (soi bằng mắt)",
        status: "pass",
        detail:
          frames.length > 0
            ? `Đã trích ${frames.length} ảnh khoanh đỏ dải TRÊN ${Math.round(SAFE_TOP_RATIO * 100)}% ` +
              `và dải DƯỚI ${Math.round(SAFE_BOTTOM_RATIO * 100)}% tại ${at} - hãy MỞ ẢNH ra soi xem ` +
              `có chữ/key nào rơi vào vùng khoanh đỏ không. Máy không tự kết luận được vì mật độ biên ` +
              `của chữ và của cảnh quay là như nhau (trên ${topAvg === null ? "?" : fmt(topAvg, 2)}, ` +
              `dưới ${botAvg === null ? "?" : fmt(botAvg, 2)}).`
            : "Không trích được ảnh vùng bị che - hãy tự tua video và soi dải trên/dưới bằng mắt.",
        value: null,
        ...(frames.length > 0 ? { frames } : {}),
      });
    } catch (err) {
      checks.push(unmeasured("safe-area", "Vùng an toàn", errText(err)));
    }
  }

  if (duration === null) {
    checks.push(unmeasured("duration", "Thời lượng", probe.error || "không đọc được thời lượng"));
  } else {
    let status: QcStatus = "pass";
    let detail = `${fmt(duration, 2)}s`;
    if (duration < DURATION_SHORT_SEC) {
      status = "warn";
      detail += ` - quá ngắn (dưới ${DURATION_SHORT_SEC}s, nền tảng gần như không phân phối)`;
    } else if (
      (platform === "tiktok" || platform === "reels") &&
      duration > DURATION_LONG_SEC
    ) {
      status = "warn";
      detail += ` - quá dài cho ${platform} (trên ${DURATION_LONG_SEC}s)`;
    }
    checks.push({ id: "duration", label: "Thời lượng", status, detail, value: duration });
  }

  const status = checks.reduce<QcStatus>((acc, c) => worst(acc, c.status), "pass");

  return {
    checkedAt: nowIso(),
    file: toRepoRel(fileAbs),
    fileMtime: st.mtime.toISOString(),
    platform,
    status,
    checks,
  };
}

export function qcJsonPathOf(projectId: string): string {
  return path.join(projectDirOf(projectId), "qc.json");
}

export function writeQcReport(projectId: string, report: QcReport): void {
  fs.writeFileSync(qcJsonPathOf(projectId), JSON.stringify(report, null, 2) + "\n", "utf8");
}

export function readQcReport(projectId: string): QcReport | null {
  try {
    const raw = JSON.parse(fs.readFileSync(qcJsonPathOf(projectId), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Partial<QcReport>;
    if (typeof r.file !== "string" || !Array.isArray(r.checks)) return null;
    return raw as QcReport;
  } catch {
    return null;
  }
}

export function isQcReportStale(report: QcReport): boolean {
  try {
    const abs = path.resolve(repoRoot, report.file);
    const mtime = fs.statSync(abs).mtime.getTime();
    const measured = Date.parse(report.fileMtime);
    if (!Number.isFinite(measured)) return true;

    return mtime > measured + 1000;
  } catch {
    return true;
  }
}
