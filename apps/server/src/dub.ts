import fs from "node:fs";
import path from "node:path";
import { TTS_CHUNK_MAX_CHARS } from "./textToVideoMeta.js";
import { ffmpegSafeArgs } from "./ffmpegSafe.js";
import { extractAudioWav } from "./transcribe.js";
import type { TranslatedCue } from "./translateVideoMeta.js";
import {
  DEFAULT_TTS_LANGUAGE,
  DEFAULT_TTS_VOICE,
  TTS_LANGUAGES,
  applySpeedToWav,
  chunkForTts,
  medianF0OfWav,
  synthScript,
} from "./tts.js";
import type { TtsEngine, TtsGender, TtsVoice } from "./ttsTypes.js";
import { HttpError, ensureDir, execFileCaptureAll, ffprobeDurationMs } from "./util.js";

export const DUB_TEMPO_MIN = 1.0;
export const DUB_TEMPO_MAX = 1.25;

export const DUB_TEMPO_DEADBAND = 0.02;

export const DUB_BLEED_FREE_SEC = 1.0;

const DUB_OVERLAP_TOLERANCE_SEC = 0.12;

export const F0_GENDER_BOUNDARY = 165;

const OUT_SAMPLE_RATE = 48_000;

const MIX_BATCH = 96;

const DUB_VOLUME_WITH_BED = 0.85;
export const DUB_ORIGINAL_VOLUME_MAX = 0.12;

export const DUB_ALL_SPEAKERS = "";

export interface DubVoiceAssignment {

  speaker: string;

  voice: string;
  engine: TtsEngine;
}

export interface DubFit {

  tempo: number;

  finalSec: number;

  clipped: boolean;

  overflowed: boolean;
}

export interface DubCueResult {

  start: number;
  end: number;
  speaker?: string;

  wavAbs: string;

  naturalSec: number;

  finalSec: number;
  tempo: number;
  clipped: boolean;
  overflowed: boolean;
}

export interface DubResult {

  wavAbs: string;
  durationSec: number;
  cues: DubCueResult[];
  assignments: DubVoiceAssignment[];

  stretched: number;

  overflowed: number;

  clipped: number;
  minTempo: number;
  maxTempo: number;
}

export function genderFromF0(f0: number): TtsGender {
  if (!Number.isFinite(f0) || f0 <= 0) return "trung-tinh";
  return f0 < F0_GENDER_BOUNDARY ? "nam" : "nu";
}

export interface AutoAssignOptions {
  engine: TtsEngine;

  voices: TtsVoice[];

  speakerF0?: Record<string, number>;

  locked?: Record<string, string>;

  defaultVoice?: string;
}

interface VoiceCandidate {
  name: string;
  gender: TtsGender;
  f0: number;

  index: number;
}

export function autoAssignVoices(
  speakers: string[],
  opts: AutoAssignOptions,
): DubVoiceAssignment[] {
  const engine = opts.engine;
  const pool: VoiceCandidate[] = [];
  const seen = new Set<string>();
  for (const v of opts.voices) {
    if (v.engine !== engine) continue;
    const name = (v.name ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    pool.push({
      name,
      gender: v.gender ?? "trung-tinh",
      f0: Number.isFinite(v.f0) && v.f0 > 0 ? v.f0 : 0,
      index: pool.length,
    });
  }

  if (pool.length === 0) {
    pool.push({
      name: (opts.defaultVoice ?? DEFAULT_TTS_VOICE).trim() || DEFAULT_TTS_VOICE,
      gender: "trung-tinh",
      f0: 0,
      index: 0,
    });
  }

  const keys: string[] = [];
  for (const s of speakers) {
    const k = (s ?? "").trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  if (keys.length === 0) keys.push(DUB_ALL_SPEAKERS);

  const byName = new Map(pool.map((v) => [v.name.toLowerCase(), v]));
  const used = new Set<string>();
  const out: Array<DubVoiceAssignment | null> = keys.map(() => null);

  keys.forEach((k, i) => {
    const want = (opts.locked?.[k] ?? "").trim();
    if (!want) return;
    const hit = byName.get(want.toLowerCase());
    if (!hit) return;
    out[i] = { speaker: k, voice: hit.name, engine };
    used.add(hit.name.toLowerCase());
  });

  const defaultName = (opts.defaultVoice ?? DEFAULT_TTS_VOICE).toLowerCase();
  let lastGender: TtsGender | null = null;
  for (let i = 0; i < keys.length; i++) {
    if (out[i]) {
      lastGender = byName.get(out[i]!.voice.toLowerCase())?.gender ?? lastGender;
      continue;
    }
    const k = keys[i];
    const f0 = opts.speakerF0?.[k] ?? 0;
    let free = pool.filter((v) => !used.has(v.name.toLowerCase()));

    if (free.length === 0) free = pool;

    const want = genderFromF0(f0);
    const scored = free.map((v) => {
      let tier: number;
      let dist: number;
      if (want !== "trung-tinh") {
        tier = v.gender === want ? 0 : v.gender === "trung-tinh" ? 1 : 2;

        dist = v.f0 > 0 ? Math.abs(v.f0 - f0) : 10_000;
      } else {

        const differs = lastGender === null || v.gender !== lastGender;
        tier = differs ? 0 : 1;
        dist = v.name.toLowerCase() === defaultName && lastGender === null ? -1 : 0;
      }
      return { v, tier, dist };
    });
    scored.sort((a, b) => a.tier - b.tier || a.dist - b.dist || a.v.index - b.v.index);
    const pick = scored[0].v;
    out[i] = { speaker: k, voice: pick.name, engine };
    used.add(pick.name.toLowerCase());
    lastGender = pick.gender;
  }

  return out.map((a, i) => a ?? { speaker: keys[i], voice: pool[0].name, engine });
}

export function voiceForCue(
  assignments: DubVoiceAssignment[],
  speaker: string | undefined,
): DubVoiceAssignment {
  const key = (speaker ?? "").trim();
  return (
    assignments.find((a) => a.speaker === key) ??
    assignments.find((a) => a.speaker === DUB_ALL_SPEAKERS) ??
    assignments[0]
  );
}

const F0_SAMPLES_PER_SPEAKER = 6;

const F0_SAMPLE_MAX_SEC = 4;

const F0_SAMPLE_MIN_SEC = 0.8;

export async function measureSpeakerF0(input: {
  videoAbs: string;
  cues: TranslatedCue[];
  workDir: string;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}): Promise<Record<string, number>> {
  const bySpeaker = new Map<string, TranslatedCue[]>();
  for (const c of input.cues) {
    const k = (c.speaker ?? "").trim();
    if (!k) continue;
    const list = bySpeaker.get(k) ?? [];
    list.push(c);
    bySpeaker.set(k, list);
  }
  if (bySpeaker.size === 0) return {};

  ensureDir(input.workDir);
  const srcWav = path.join(input.workDir, "source-16k.wav");
  if (!fs.existsSync(srcWav)) {
    await extractAudioWav({
      videoAbs: input.videoAbs,
      outWavAbs: srcWav,
      isCanceled: input.isCanceled,
    });
  }

  const out: Record<string, number> = {};
  for (const [speaker, cues] of bySpeaker) {
    const picks = [...cues]
      .filter((c) => c.end - c.start >= F0_SAMPLE_MIN_SEC)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, F0_SAMPLES_PER_SPEAKER);
    const measured: number[] = [];
    for (let i = 0; i < picks.length; i++) {
      if (input.isCanceled?.()) throw new Error("Job đã bị hủy");
      const c = picks[i];

      const ss = Math.max(0, c.start + 0.1);
      const dur = Math.min(F0_SAMPLE_MAX_SEC, c.end - ss);
      if (dur < F0_SAMPLE_MIN_SEC) continue;
      const clip = path.join(input.workDir, `f0-${safeName(speaker)}-${i}.wav`);
      await runFfmpeg(
        [
          "-ss",
          ss.toFixed(3),
          "-t",
          dur.toFixed(3),
          "-i",
          srcWav,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          clip,
        ],
        { timeoutMs: 30_000, isCanceled: input.isCanceled },
      );
      const f0 = medianF0OfWav(clip);
      fs.rmSync(clip, { force: true });
      if (f0 > 0) measured.push(f0);
    }
    if (measured.length === 0) continue;
    measured.sort((a, b) => a - b);
    const median = measured[Math.floor(measured.length / 2)];
    out[speaker] = Math.round(median);
    input.onLog?.(
      `[dub] người nói "${speaker}": F0 ${Math.round(median)} Hz (${measured.length} mẫu) -> nghe như giọng ${genderFromF0(median)}`,
    );
  }
  return out;
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24) || "spk";
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function fitCue(naturalSec: number, spanSec: number, gapSec: number): DubFit {
  const natural = Math.max(0, naturalSec);
  const span = Math.max(0.01, spanSec);
  const gap = Math.max(0, Number.isFinite(gapSec) ? gapSec : 0);
  const allowance = span + Math.min(gap, DUB_BLEED_FREE_SEC);

  const room = span + gap;

  const slack = Math.min(allowance * DUB_TEMPO_DEADBAND, DUB_OVERLAP_TOLERANCE_SEC);
  if (natural <= allowance + slack) {
    return {
      tempo: 1,
      finalSec: round3(natural),
      clipped: false,
      overflowed: natural > room + DUB_OVERLAP_TOLERANCE_SEC,
    };
  }
  const ideal = natural / allowance;

  const tempo = round3(Math.min(DUB_TEMPO_MAX, Math.max(DUB_TEMPO_MIN, ideal)));
  const finalSec = natural / tempo;
  return {
    tempo,
    finalSec: round3(finalSec),
    clipped: ideal > DUB_TEMPO_MAX + 1e-9,
    overflowed: finalSec > room + DUB_OVERLAP_TOLERANCE_SEC,
  };
}

export function gapAfter(cues: TranslatedCue[], i: number, videoDurationSec: number): number {
  const cur = cues[i];
  const next = cues[i + 1];
  const until = next ? next.start : Math.max(cur.end, videoDurationSec);
  return Math.max(0, until - cur.end);
}

async function runFfmpeg(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; isCanceled?: () => boolean },
): Promise<void> {
  let r: Awaited<ReturnType<typeof execFileCaptureAll>>;
  try {
    r = await execFileCaptureAll("ffmpeg", ffmpegSafeArgs(["-hide_banner", "-nostats", "-y", ...args]), {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 300_000,
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
  if (r.timedOut) throw new Error("ffmpeg chạy quá lâu khi ghép track lồng tiếng - đã hủy");
  if (r.code !== 0) {
    const tail = r.stderr.split(/\r?\n/).slice(-12).join("\n");
    throw new Error(`ffmpeg thất bại khi ghép track lồng tiếng (mã ${r.code}):\n${tail}`);
  }
}

async function probeSeconds(absFile: string): Promise<number> {
  const ms = await ffprobeDurationMs(absFile);
  if (ms === null || ms <= 0) {
    throw new HttpError(
      503,
      "NO_FFPROBE",
      `Không đo được thời lượng ${path.basename(absFile)} bằng ffprobe - cài FFmpeg và thêm vào PATH.`,
    );
  }
  return ms / 1000;
}

export function ttsLanguageFor(targetLang: string): string {
  const want = (targetLang ?? "").trim().toLowerCase();
  if (!want) return DEFAULT_TTS_LANGUAGE;
  const exact = TTS_LANGUAGES.find((l) => l.code.toLowerCase() === want);
  if (exact) return exact.code;
  const base = want.split("-")[0];
  const hit = TTS_LANGUAGES.find((l) => l.code.toLowerCase().startsWith(`${base}-`));
  return hit ? hit.code : DEFAULT_TTS_LANGUAGE;
}

export function cueSpeechText(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

export interface SynthDubCueInput {
  text: string;
  voice: string;
  engine: TtsEngine;
  model?: string | null;
  language?: string;

  workDir: string;
  outWavAbs: string;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}

export async function synthDubCue(input: SynthDubCueInput): Promise<{ wavAbs: string; naturalSec: number }> {
  const text = cueSpeechText(input.text);
  if (!text) throw new HttpError(400, "DUB_EMPTY_CUE", "Câu rỗng - không có gì để đọc");

  const chunks = text.length > TTS_CHUNK_MAX_CHARS ? chunkForTts(text) : [text];
  const res = await synthScript({
    chunks,
    voice: input.voice,
    engine: input.engine,
    model: input.model,
    language: input.language,
    workDir: input.workDir,
    outWavAbs: input.outWavAbs,
    onLog: input.onLog,
    isCanceled: input.isCanceled,
  });
  return { wavAbs: res.wavAbs, naturalSec: res.durationSec };
}

export async function applyTempoToCue(wavAbs: string, tempo: number): Promise<number> {
  if (Math.abs(tempo - 1) < 0.001) return probeSeconds(wavAbs);
  const src = fs.readFileSync(wavAbs);
  const out = await applySpeedToWav(src, tempo);
  fs.writeFileSync(wavAbs, out);
  return probeSeconds(wavAbs);
}

interface Placement {

  file: string;

  atSec: number;

  volume: number;
}

async function mixPlacements(input: {
  places: Placement[];
  durationSec: number;
  cwd: string;
  outWavAbs: string;
  isCanceled?: () => boolean;
}): Promise<void> {
  const { places, durationSec, cwd } = input;
  const dur = Math.max(0.1, durationSec);
  const args: string[] = ["-f", "lavfi", "-i", `anullsrc=r=${OUT_SAMPLE_RATE}:cl=mono`];
  const lines: string[] = [`[0:a]atrim=end=${dur.toFixed(3)}[base]`];
  const labels: string[] = ["[base]"];

  places.forEach((p, i) => {
    args.push("-i", p.file);
    const delayMs = Math.max(0, Math.round(p.atSec * 1000));
    const label = `c${i}`;

    const vol = p.volume >= 0.999 ? "" : `,volume=${p.volume.toFixed(3)}`;
    lines.push(
      `[${i + 1}:a]aresample=${OUT_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono${vol},adelay=${delayMs}[${label}]`,
    );
    labels.push(`[${label}]`);
  });

  lines.push(
    `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[mix]`,
  );

  const scriptName = `mix-${path.basename(input.outWavAbs, ".wav")}.filter`;
  fs.writeFileSync(path.join(cwd, scriptName), lines.join(";\n") + "\n", "utf8");

  await runFfmpeg(
    [
      ...args,
      "-filter_complex_script",
      scriptName,
      "-map",
      "[mix]",
      "-t",
      dur.toFixed(3),
      "-ar",
      String(OUT_SAMPLE_RATE),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      input.outWavAbs,
    ],
    { cwd, timeoutMs: 600_000, isCanceled: input.isCanceled },
  );
  fs.rmSync(path.join(cwd, scriptName), { force: true });
}

export async function mixDubTrack(input: {
  cues: Array<{ wavAbs: string; atSec: number }>;
  durationSec: number;
  workDir: string;
  outWavAbs: string;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}): Promise<void> {
  ensureDir(input.workDir);
  ensureDir(path.dirname(input.outWavAbs));
  const places: Placement[] = input.cues.map((c) => ({
    file: path.relative(input.workDir, c.wavAbs).split(path.sep).join("/"),
    atSec: c.atSec,
    volume: 1,
  }));

  if (places.length <= MIX_BATCH) {
    await mixPlacements({
      places,
      durationSec: input.durationSec,
      cwd: input.workDir,
      outWavAbs: input.outWavAbs,
      isCanceled: input.isCanceled,
    });
    return;
  }

  const parts: string[] = [];
  for (let i = 0; i < places.length; i += MIX_BATCH) {
    const partAbs = path.join(input.workDir, `mix-part-${parts.length}.wav`);
    input.onLog?.(
      `[dub] trộn lô ${parts.length + 1} (${Math.min(MIX_BATCH, places.length - i)} câu)`,
    );
    await mixPlacements({
      places: places.slice(i, i + MIX_BATCH),
      durationSec: input.durationSec,
      cwd: input.workDir,
      outWavAbs: partAbs,
      isCanceled: input.isCanceled,
    });
    parts.push(partAbs);
  }
  await mixPlacements({
    places: parts.map((p) => ({ file: path.basename(p), atSec: 0, volume: 1 })),
    durationSec: input.durationSec,
    cwd: input.workDir,
    outWavAbs: input.outWavAbs,
    isCanceled: input.isCanceled,
  });
  for (const p of parts) fs.rmSync(p, { force: true });
}

export async function mixOriginalUnder(input: {
  dubWavAbs: string;
  videoAbs: string;
  originalVolume: number;
  durationSec: number;
  workDir: string;
  outWavAbs: string;
  isCanceled?: () => boolean;
}): Promise<void> {
  ensureDir(input.workDir);
  const vol = Math.min(DUB_ORIGINAL_VOLUME_MAX, Math.max(0, input.originalVolume));
  const dur = Math.max(0.1, input.durationSec);
  await runFfmpeg(
    [
      "-i",
      input.dubWavAbs,
      "-i",
      input.videoAbs,
      "-filter_complex",
      `[0:a]volume=${DUB_VOLUME_WITH_BED.toFixed(3)},aresample=${OUT_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono[d];` +
        `[1:a]volume=${vol.toFixed(3)},aresample=${OUT_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono[o];` +
        `[d][o]amix=inputs=2:normalize=0:dropout_transition=0[mix]`,
      "-map",
      "[mix]",
      "-t",
      dur.toFixed(3),
      "-ar",
      String(OUT_SAMPLE_RATE),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      input.outWavAbs,
    ],
    { timeoutMs: 600_000, isCanceled: input.isCanceled },
  );
}

export interface SynthesizeDubInput {
  cues: TranslatedCue[];
  assignments: DubVoiceAssignment[];
  engine: TtsEngine;
  model?: string | null;

  language?: string;

  durationSec: number;

  dubDir: string;
  outWavAbs: string;
  onProgress?: (done: number, total: number) => void;
  onLog?: (line: string) => void;
  isCanceled?: () => boolean;
}

export async function synthesizeDub(input: SynthesizeDubInput): Promise<DubResult> {
  const cues = input.cues;
  if (cues.length === 0) {
    throw new HttpError(400, "DUB_NO_CUES", "Chưa có câu nào để lồng tiếng");
  }
  if (input.assignments.length === 0) {
    throw new HttpError(400, "DUB_NO_VOICE", "Chưa gán giọng đọc cho người nói nào");
  }
  const dubDir = input.dubDir;
  const workDir = path.join(dubDir, "work");
  ensureDir(dubDir);
  ensureDir(workDir);

  const videoDur = input.durationSec > 0 ? input.durationSec : lastEnd(cues);
  const results: DubCueResult[] = [];
  let stretched = 0;
  let overflowed = 0;
  let clipped = 0;
  let minTempo = Number.POSITIVE_INFINITY;
  let maxTempo = 0;

  for (let i = 0; i < cues.length; i++) {
    if (input.isCanceled?.()) throw new Error("Job đã bị hủy");
    const cue = cues[i];
    const assign = voiceForCue(input.assignments, cue.speaker);
    const idx = String(i + 1).padStart(3, "0");
    const wavAbs = path.join(dubDir, `cue-${idx}.wav`);

    await synthDubCue({
      text: cue.text,
      voice: assign.voice,
      engine: assign.engine,
      model: input.model,
      language: input.language,
      workDir: path.join(workDir, `cue-${idx}`),
      outWavAbs: wavAbs,
      onLog: input.onLog,
      isCanceled: input.isCanceled,
    });
    const naturalSec = await probeSeconds(wavAbs);

    const span = cue.end - cue.start;
    const gap = gapAfter(cues, i, videoDur);
    const fit = fitCue(naturalSec, span, gap);
    const finalSec = await applyTempoToCue(wavAbs, fit.tempo);

    if (fit.tempo !== 1) {
      stretched++;
      minTempo = Math.min(minTempo, fit.tempo);
      maxTempo = Math.max(maxTempo, fit.tempo);
    }
    if (fit.clipped) clipped++;
    if (fit.overflowed) overflowed++;

    if (fit.overflowed) {
      input.onLog?.(
        `[dub] câu ${i + 1} (${cue.start.toFixed(2)}s) TRÀN: đọc ${naturalSec.toFixed(2)}s, ` +
          `chỗ trống ${(span + gap).toFixed(2)}s, đã co x${fit.tempo} còn ${finalSec.toFixed(2)}s ` +
          `-> lấn ${(finalSec - span - gap).toFixed(2)}s sang câu sau`,
      );
    } else if (fit.clipped) {
      input.onLog?.(
        `[dub] câu ${i + 1} (${cue.start.toFixed(2)}s) kẹp ở trần co x${DUB_TEMPO_MAX} - ` +
          `tràn ${(finalSec - span).toFixed(2)}s vào khoảng nghỉ phía sau`,
      );
    }

    const r: DubCueResult = {
      start: cue.start,
      end: cue.end,
      wavAbs,
      naturalSec: round3(naturalSec),
      finalSec: round3(finalSec),
      tempo: fit.tempo,
      clipped: fit.clipped,
      overflowed: fit.overflowed,
    };
    if (cue.speaker) r.speaker = cue.speaker;
    results.push(r);
    input.onProgress?.(i + 1, cues.length);
  }

  input.onLog?.(`[dub] trộn ${results.length} câu vào track lặng dài ${videoDur.toFixed(2)}s`);
  await mixDubTrack({
    cues: results.map((r) => ({ wavAbs: r.wavAbs, atSec: r.start })),
    durationSec: videoDur,
    workDir: dubDir,
    outWavAbs: input.outWavAbs,
    onLog: input.onLog,
    isCanceled: input.isCanceled,
  });
  const durationSec = await probeSeconds(input.outWavAbs);
  fs.rmSync(workDir, { recursive: true, force: true });

  const min = Number.isFinite(minTempo) ? minTempo : 1;
  const max = maxTempo > 0 ? maxTempo : 1;
  input.onLog?.(
    `[dub] xong: ${results.length} câu, ${stretched} câu phải co (x${min.toFixed(3)}-x${max.toFixed(3)}), ` +
      `${clipped} câu kẹp trần, ${overflowed} câu tràn sang câu sau, track dài ${durationSec.toFixed(2)}s`,
  );

  return {
    wavAbs: input.outWavAbs,
    durationSec: round3(durationSec),
    cues: results,
    assignments: input.assignments,
    stretched,
    overflowed,
    clipped,
    minTempo: round3(min),
    maxTempo: round3(max),
  };
}

function lastEnd(cues: TranslatedCue[]): number {
  let max = 0;
  for (const c of cues) max = Math.max(max, c.end);
  return max;
}
