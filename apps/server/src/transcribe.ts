import fs from "node:fs";
import path from "node:path";
import { venvPython } from "./config.js";
import { ffmpegSafeArgs, ffprobeSafeArgs } from "./ffmpegSafe.js";
import { execFileCaptureAll, ensureDir, HttpError, moveFile, toRepoRel } from "./util.js";
import { parseTranscriptJson } from "./transcript.js";

export interface TranscribeResult {

  relPath: string;
  segments: number;
  durationSec: number;
  language: string;
}

const EXIT_NO_MODULE = 97;

const MAX_WHISPER_MS = 2 * 60 * 60 * 1000;
const MIN_WHISPER_MS = 10 * 60 * 1000;

let cachedPython: string | null = null;

async function resolvePython(): Promise<string> {
  if (cachedPython) return cachedPython;

  const candidates = [
    process.env.PYTHON_BIN,
    venvPython(),
    process.env.PYTHON,
    "python",
    "py",
    "python3",
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0);

  const runnable: string[] = [];

  for (const exe of candidates) {
    try {
      const r = await execFileCaptureAll(exe, ["-c", "import faster_whisper"], {
        timeoutMs: 120_000,
      });
      if (r.code === 0 && !r.timedOut) {
        cachedPython = exe;
        return exe;
      }
      runnable.push(exe);
    } catch {

    }
  }

  if (runnable.length > 0) {

    return runnable[0];
  }

  throw new HttpError(
    503,
    "NO_WHISPER",
    "Không tìm thấy Python trên máy. Cài Python 3.10+ rồi chạy `pip install faster-whisper` " +
      "(hoặc trỏ biến môi trường PYTHON_BIN vào interpreter đã cài module).",
  );
}

function pythonScript(): string {
  return [
    "# -*- coding: utf-8 -*-",
    "# File tam do apps/server/src/transcribe.ts sinh ra - Node xoa sau khi chay xong.",
    "import sys, json",
    "",
    "# BAT BUOC: console Windows mac dinh cp1252, khong reconfigure la vo tieng Viet",
    'sys.stdout.reconfigure(encoding="utf-8")',
    'sys.stderr.reconfigure(encoding="utf-8")',
    "",
    "AUDIO = sys.argv[1]",
    "OUT = sys.argv[2]",

    "LANG = None if sys.argv[3] == 'auto' else sys.argv[3]",
    "TOTAL = float(sys.argv[4])",
    "LOGFILE = sys.argv[5]",
    "",
    "def log(msg):",
    "    # Ghi ca stderr (Node gom lai khi ket thuc) va file log (Node doc dan de hien tien do)",
    "    print(msg, file=sys.stderr)",
    "    sys.stderr.flush()",
    "    try:",
    '        with open(LOGFILE, "a", encoding="utf-8") as f:',
    "            print(msg, file=f)",
    "    except Exception:",
    "        pass",
    "",

    "try:",
    "    from faster_whisper import WhisperModel",
    "except Exception as err:",
    '    log("[whisper] THIEU MODULE faster_whisper: " + str(err))',
    `    sys.exit(${EXIT_NO_MODULE})`,
    "",
    "# GPU truoc (da kiem chung: nhanh gap doi va giai phong CPU cho render), loi thi CPU",

    "def build(dev):",
    '    return WhisperModel("large-v3", device=dev, compute_type=("float16" if dev == "cuda" else "int8"))',
    "",
    "def run(dev):",
    "    m = build(dev)",
    "    segs, inf = m.transcribe(AUDIO, language=LANG, word_timestamps=True)",
    "    first = next(iter(segs), None)   # ép chạy thật - lỗi CUDA lộ ra ở đây",
    "    return m, segs, inf, first",
    "",
    'device = "cuda"',
    "try:",
    '    model, segments, info, _first = run("cuda")',
    "except Exception as err:",
    '    log("[whisper] khong dung duoc CUDA (" + str(err)[:300] + ") - chuyen sang CPU")',
    '    device = "cpu"',
    '    model, segments, info, _first = run("cpu")',
    "",
    'log("[whisper] bat dau - device=" + device + " model=large-v3 lang=" + (LANG or "auto"))',
    "",

    "import itertools",
    "if _first is not None:",
    "    segments = itertools.chain([_first], segments)",
    "",
    "out_segments = []",
    "last_log = -99.0",
    "for seg in segments:",
    "    words = []",
    "    for w in (seg.words or []):",
    "        words.append({",
    '            "word": w.word,',
    '            "start": round(float(w.start), 3),',
    '            "end": round(float(w.end), 3),',
    "        })",
    "    out_segments.append({",
    '        "start": round(float(seg.start), 3),',
    '        "end": round(float(seg.end), 3),',
    '        "text": (seg.text or "").strip(),',
    '        "words": words,',
    "    })",
    "    # Tien do: generator cua faster-whisper chi chay khi duyet, moi segment la mot buoc",
    "    if seg.end - last_log >= 2.0:",
    "        last_log = seg.end",
    '        log("[whisper] %.1fs/%.1fs (%d segment)" % (seg.end, TOTAL, len(out_segments)))',
    "",
    "duration = TOTAL",
    "try:",
    "    if info is not None and info.duration:",
    "        duration = float(info.duration)",
    "except Exception:",
    "    pass",
    "",
    "lang_out = LANG",
    "try:",
    "    if info is not None and info.language:",
    "        lang_out = str(info.language)",
    "except Exception:",
    "    pass",
    "",
    'data = {"segments": out_segments, "language": lang_out, "duration": round(duration, 3)}',
    'with open(OUT, "w", encoding="utf-8") as f:',
    "    json.dump(data, f, ensure_ascii=False, indent=1)",
    "",
    'log("[whisper] xong: " + str(len(out_segments)) + " segment")',
    "",
  ].join("\n");
}

function tailLogFile(logFile: string, onLog?: (line: string) => void): () => void {
  if (!onLog) return () => {};
  let offset = 0;
  const pump = (): void => {
    try {
      if (!fs.existsSync(logFile)) return;
      const size = fs.statSync(logFile).size;
      if (size <= offset) return;
      const fd = fs.openSync(logFile, "r");
      try {
        const len = size - offset;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        offset = size;
        for (const line of buf.toString("utf8").split(/\r?\n/)) {
          if (line.trim()) onLog(line.trim());
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {

    }
  };
  const timer = setInterval(pump, 2000);
  return () => {
    clearInterval(timer);
    pump();
  };
}

function tail(text: string, lines = 12): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-lines)
    .join("\n");
}

function rmQuiet(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {

  }
}

export async function probeDurationSec(mediaAbs: string): Promise<number> {
  let probe: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    probe = await execFileCaptureAll(
      "ffprobe",
      ffprobeSafeArgs(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mediaAbs]),
      { timeoutMs: 20_000 },
    );
  } catch (err) {
    throw new HttpError(
      503,
      "NO_FFMPEG",
      `Không chạy được ffprobe - cài FFmpeg và thêm vào PATH. Chi tiết: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const sec = parseFloat(probe.stdout.trim());
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

export async function extractAudioWav(input: {
  videoAbs: string;
  outWavAbs: string;

  durationSec?: number;
  isCanceled?: () => boolean;
}): Promise<void> {
  const { videoAbs, outWavAbs } = input;
  const durationSec = input.durationSec ?? 0;
  ensureDir(path.dirname(outWavAbs));

  const timeoutMs = Math.min(Math.max(MIN_WHISPER_MS, durationSec * 1000), 60 * 60 * 1000);
  let wav: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    wav = await execFileCaptureAll(
      "ffmpeg",
      ffmpegSafeArgs(["-y", "-i", videoAbs, "-vn", "-ac", "1", "-ar", "16000", outWavAbs]),
      { timeoutMs, isCanceled: input.isCanceled },
    );
  } catch (err) {
    throw new HttpError(
      503,
      "NO_FFMPEG",
      `Không chạy được ffmpeg - cài FFmpeg và thêm vào PATH. Chi tiết: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (wav.timedOut) {
    throw new Error(`Tách audio quá ${Math.round(timeoutMs / 60_000)} phút chưa xong - đã hủy`);
  }
  if (wav.canceled) throw new Error("Job đã bị hủy");
  if (wav.code !== 0 || !fs.existsSync(outWavAbs)) {
    throw new Error(`Tách audio thất bại (ffmpeg thoát mã ${wav.code}):\n${tail(wav.stderr)}`);
  }
}

export async function transcribeVideo(input: {
  videoAbs: string;
  outJsonAbs: string;

  language?: string;
  onLog?: (line: string) => void;

  isCanceled?: () => boolean;
}): Promise<TranscribeResult> {
  const { videoAbs, outJsonAbs, onLog, isCanceled } = input;
  const raw = ((input.language ?? "vi").trim() || "vi").toLowerCase();

  const language = raw === "und" ? "auto" : raw.split("-")[0];
  const log = (line: string): void => onLog?.(line);

  if (!fs.existsSync(videoAbs)) {
    throw new HttpError(404, "VIDEO_NOT_FOUND", `Không tìm thấy video nguồn: ${videoAbs}`);
  }
  ensureDir(path.dirname(outJsonAbs));

  const stem = path.join(
    path.dirname(outJsonAbs),
    `${path.basename(outJsonAbs, path.extname(outJsonAbs))}.whisper-${process.pid}-${Date.now()}`,
  );
  const wavAbs = `${stem}.wav`;
  const pyAbs = `${stem}.py`;
  const logAbs = `${stem}.log`;
  const tmpJsonAbs = `${stem}.json`;

  try {

    const durationSec = await probeDurationSec(videoAbs);
    if (durationSec <= 0) {
      log("[transcribe] ffprobe không đọc được thời lượng - vẫn chạy tiếp, tiến độ sẽ không có mốc tổng");
    }

    log(`[transcribe] tách audio 16kHz mono (video dài ${durationSec.toFixed(1)}s)`);
    await extractAudioWav({ videoAbs, outWavAbs: wavAbs, durationSec, isCanceled });

    fs.writeFileSync(pyAbs, pythonScript(), "utf8");
    const python = await resolvePython();

    const whisperTimeout = Math.min(
      Math.max(MIN_WHISPER_MS, durationSec * 2000),
      MAX_WHISPER_MS,
    );
    log(
      `[transcribe] chạy faster-whisper large-v3 (${python}, lang=${language}, ` +
        `trần ${Math.round(whisperTimeout / 60_000)} phút)`,
    );

    const stopTail = tailLogFile(logAbs, onLog);
    let run: Awaited<ReturnType<typeof execFileCaptureAll>>;
    try {
      run = await execFileCaptureAll(
        python,
        [pyAbs, wavAbs, tmpJsonAbs, language, String(durationSec), logAbs],
        { timeoutMs: whisperTimeout, isCanceled },
      );
    } finally {
      stopTail();
    }

    if (run.canceled) throw new Error("Job đã bị hủy");
    if (run.code === EXIT_NO_MODULE) {
      throw new HttpError(
        503,
        "NO_WHISPER",
        "Máy chưa cài faster-whisper. Chạy `pip install faster-whisper` (Python 3.10+) rồi thử lại. " +
          "Nếu máy có nhiều bản Python, trỏ biến môi trường PYTHON_BIN vào bản đã cài module.",
      );
    }
    if (/No module named|ModuleNotFoundError/i.test(run.stderr)) {
      throw new HttpError(
        503,
        "NO_WHISPER",
        `Python thiếu module cho faster-whisper. Chạy \`pip install faster-whisper\` rồi thử lại.\n${tail(run.stderr, 5)}`,
      );
    }
    if (run.timedOut) {
      throw new Error(
        `Transcribe quá ${Math.round(whisperTimeout / 60_000)} phút chưa xong - đã hủy. ` +
          "Video quá dài hoặc đang chạy trên CPU; cân nhắc cắt bớt video nguồn.",
      );
    }
    if (run.code !== 0) {
      throw new Error(`faster-whisper thất bại (thoát mã ${run.code}):\n${tail(run.stderr)}`);
    }

    if (!fs.existsSync(tmpJsonAbs)) {
      throw new Error(`faster-whisper chạy xong nhưng không ghi ra file JSON:\n${tail(run.stderr)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(tmpJsonAbs, "utf8"));
    } catch (err) {
      throw new Error(
        `File transcript vừa tạo không phải JSON hợp lệ: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const segments = parseTranscriptJson(raw);
    if (!segments || segments.length === 0) {
      throw new Error(
        "Transcript rỗng hoặc sai định dạng (không có segment nào đọc được) - " +
          "kiểm tra lại video có tiếng nói không.",
      );
    }

    const meta = (raw ?? {}) as Record<string, unknown>;
    const langOut = typeof meta.language === "string" && meta.language ? meta.language : language;

    const lastEnd = segments[segments.length - 1].end;
    const durationOut = durationSec > 0 ? durationSec : lastEnd;

    moveFile(tmpJsonAbs, outJsonAbs);

    const withWords = segments.filter((s) => s.words.length > 0).length;
    log(
      `[transcribe] xong: ${segments.length} segment (${withWords} segment có word timestamp), ` +
        `ngôn ngữ ${langOut}`,
    );

    return {
      relPath: toRepoRel(outJsonAbs),
      segments: segments.length,
      durationSec: Math.round(durationOut * 100) / 100,
      language: langOut,
    };
  } finally {

    rmQuiet(wavAbs);
    rmQuiet(pyAbs);
    rmQuiet(logAbs);
    rmQuiet(tmpJsonAbs);
  }
}
