import fs from "node:fs";
import path from "node:path";
import { projectDirOf } from "./meta.js";
import { toRepoRel } from "./util.js";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface ProjectTranscript {

  relPath: string;
  segments: TranscriptSegment[];

  durationSec: number;
}

const CANDIDATE_RELS = [
  "assets/transcript.final.json",
  "assets/transcript.cut.json",
  "assets/transcript.json",
  "assets/audio/transcript.final.json",
  "assets/audio/transcript.cut.json",
  "assets/audio/transcript.json",
  "assets/transcript.raw.json",
  "assets/audio/transcript.raw.json",
];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseTranscriptJson(raw: unknown): TranscriptSegment[] | null {
  const segsRaw: unknown = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).segments
      : null;

  if (Array.isArray(segsRaw)) {
    const segments: TranscriptSegment[] = [];
    for (const s of segsRaw) {
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
      const start = num(o.start);
      const end = num(o.end);
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (start === null || end === null) continue;
      const words: TranscriptWord[] = [];
      if (Array.isArray(o.words)) {
        for (const w of o.words) {
          if (!w || typeof w !== "object") continue;
          const wo = w as Record<string, unknown>;

          const token = typeof wo.word === "string" ? wo.word : typeof wo.text === "string" ? wo.text : "";
          const ws = num(wo.start);
          const we = num(wo.end);
          if (!token.trim() || ws === null || we === null) continue;
          words.push({ word: token, start: ws, end: we });
        }
      }
      if (!text && words.length === 0) continue;
      segments.push({
        start,
        end,
        text: text || words.map((w) => w.word).join("").trim(),
        words,
      });
    }
    return segments.length > 0 ? segments : null;
  }

  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).words)) {
    const words: TranscriptWord[] = [];
    for (const w of (raw as { words: unknown[] }).words) {
      if (!w || typeof w !== "object") continue;
      const wo = w as Record<string, unknown>;
      const token = typeof wo.word === "string" ? wo.word : typeof wo.text === "string" ? wo.text : "";
      const ws = num(wo.start);
      const we = num(wo.end);
      if (!token.trim() || ws === null || we === null) continue;
      words.push({ word: token, start: ws, end: we });
    }
    if (words.length === 0) return null;
    const segments: TranscriptSegment[] = [];
    let cur: TranscriptWord[] = [];
    const flush = (): void => {
      if (cur.length === 0) return;
      segments.push({
        start: cur[0].start,
        end: cur[cur.length - 1].end,
        text: cur.map((w) => w.word).join("").trim(),
        words: cur,
      });
      cur = [];
    };
    for (const w of words) {
      if (cur.length > 0 && w.start - cur[cur.length - 1].end > 0.6) flush();
      cur.push(w);
    }
    flush();
    return segments.length > 0 ? segments : null;
  }

  return null;
}

export function readProjectTranscript(id: string): ProjectTranscript | null {
  const dir = projectDirOf(id);
  const rels = [...CANDIDATE_RELS];

  const assetsDir = path.join(dir, "assets");
  try {
    const scan = (base: string, prefix: string): void => {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (e.isFile() && /transcript.*\.json$/i.test(e.name)) {
          const rel = `${prefix}${e.name}`;
          if (!rels.includes(rel)) rels.push(rel);
        }
      }
    };
    scan(assetsDir, "assets/");
    for (const e of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (e.isDirectory()) scan(path.join(assetsDir, e.name), `assets/${e.name}/`);
    }
  } catch {

  }

  for (const rel of rels) {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) continue;
    let parsed: TranscriptSegment[] | null = null;
    try {
      parsed = parseTranscriptJson(JSON.parse(fs.readFileSync(abs, "utf8")));
    } catch {
      continue;
    }
    if (!parsed) continue;
    const segments = parsed.slice().sort((a, b) => a.start - b.start);
    return {
      relPath: toRepoRel(abs),
      segments,
      durationSec: segments.length > 0 ? segments[segments.length - 1].end : 0,
    };
  }
  return null;
}

export function transcriptToTimedText(t: ProjectTranscript, maxChars = 24_000): string {
  const lines: string[] = [];
  let total = 0;
  for (const s of t.segments) {
    const line = `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`;
    total += line.length + 1;
    if (total > maxChars) {
      lines.push("… (transcript bị cắt bớt do quá dài)");
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function sliceSegments(
  t: ProjectTranscript,
  from: number,
  to: number,
): TranscriptSegment[] {
  return t.segments.filter((s) => s.end > from && s.start < to);
}
