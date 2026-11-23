

export type DeadWeightKind = "filler" | "stutter" | "repeat-take" | "hesitation";

export interface DeadWeightCandidate {
  kind: DeadWeightKind;
  start: number;
  end: number;

  text: string;

  confidence: number;

  reason: string;

  context: string;
}

export interface DeadWeightReport {
  candidates: DeadWeightCandidate[];

  totalSec: number;
  byKind: Record<DeadWeightKind, { count: number; sec: number }>;
}

const KINDS: DeadWeightKind[] = ["filler", "stutter", "repeat-take", "hesitation"];

const HARD_FILLERS = new Set([
  "ừm",
  "ừmm",
  "ưm",
  "ờ",
  "ờm",
  "à",
  "ừ",
  "ơ",
  "ehm",
  "hm",
  "hmm",
  "hử",
  "ừa",
  "ậm",
  "ừm ừm",
  "à ừ",
]);

const SOFT_FILLERS = new Set(["đó", "đấy", "ấy", "thế", "vậy"]);

const PHRASE_FILLERS = new Set([
  "kiểu như",
  "kiểu là",
  "kiểu kiểu",
  "đại loại là",
  "đại loại",
  "nói chung là",
  "nói chung",
  "thật ra thì",
  "thật ra là",
  "thì là",
  "cái là",
  "tóm lại là",
  "tóm lại",
  "cái mà",
  "thế thì là",
]);

const CONNECTOR_FILLERS = new Set([
  "hoặc là",
  "bởi vì là",
  "tức là",
  "với lại là",
  "nói cách khác là",
  "thì là vì",
]);

const REFERENT_BEFORE = new Set([
  "anh",
  "chị",
  "cô",
  "ông",
  "bà",
  "em",
  "chú",
  "bác",
  "thầy",
  "cháu",
  "bạn",
  "người",
  "con",
  "cái",
  "chỗ",
  "nơi",
  "hôm",
  "lúc",
  "ngày",
  "đêm",
  "buổi",
  "năm",
  "việc",
  "chuyện",
  "điều",
  "thứ",
  "số",
  "phía",
  "bên",
  "đằng",
  "ở",
  "từ",
  "do",
  "vì",
  "như",
  "tại",
  "đến",
  "với",
  "của",
  "này",
  "kia",
  "nọ",
  "trong",
  "ngoài",
  "trước",
  "sau",
  "mức",
  "thế",
  "vậy",
]);

const SUBJECT_AFTER = new Set(["là", "thì", "mà", "nên", "chính", "cũng", "chưa", "không"]);

const REDUPLICATIONS = new Set([
  "từ",
  "dần",
  "luôn",
  "mãi",
  "ngày",
  "người",
  "nhà",
  "đều",
  "xa",
  "xanh",
  "đo",
  "tim",
  "khe",
  "thoang",
  "lâng",
  "nao",
  "hây",
  "vừa",
  "càng",
  "ai",
  "gì",
  "nào",
  "đâu",
  "mỗi",
  "từng",
  "nhiều",
  "ít",
  "hơi",
  "rất",
  "thỉnh",
  "lăm",
  "phăng",
  "nhè",
  "cỏn",

  "nhỏ",
  "to",
  "vui",
  "buồn",
  "xinh",
  "đẹp",
  "xấu",
  "đỏ",
  "trắng",
  "đen",
  "vàng",
  "hồng",
  "cao",
  "thấp",
  "dài",
  "ngắn",
  "béo",
  "gầy",
  "mập",
  "ốm",
  "lạnh",
  "nóng",
  "ấm",
  "mát",
  "ngọt",
  "chua",
  "cay",
  "đắng",
  "mặn",
  "nhạt",
  "thơm",
  "mềm",
  "cứng",
  "nhẹ",
  "nặng",
  "nhanh",
  "chậm",
  "gần",
  "cũ",
  "lạ",
  "quen",
  "giống",
  "sơ",
  "tròn",
  "méo",
  "cong",
  "sâu",
  "rộng",
  "hẹp",
  "dày",
  "mỏng",
  "già",
  "trẻ",
  "khỏe",
  "khoẻ",
  "yếu",
  "ngon",
  "sạch",
  "ướt",
  "khô",
  "ngoan",
  "hiền",
  "chút",
  "tí",
  "xíu",
]);

const DEFAULT_MIN_CONFIDENCE = 0.5;

const ELONGATION_STRONG = 3;
const ELONGATION_MILD = 2;

const MIN_WORDS_FOR_DPC = 20;

const HESITATION_FLOOR_SEC = 0.8;

const HESITATION_FALLBACK_SEC = 1.5;

const HESITATION_PAD_SEC = 0.12;

const HESITATION_MIN_CUT_SEC = 0.3;

const STUTTER_MAX_GAP_SEC = 1.5;

const REPEAT_WINDOW_SEC = 15;

const REPEAT_MAX_INTERVENING_UNITS = 2;

const REPEAT_MIN_SIMILARITY = 0.75;

const REPEAT_ANCHOR_MAX_OFFSET = 2;

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function fmtSec(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function normToken(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  return sortedAsc[clamp(Math.floor(p * (sortedAsc.length - 1)), 0, sortedAsc.length - 1)];
}

function lcsMatch(a: string[], b: string[]): { len: number; firstB: number } {
  if (a.length === 0 || b.length === 0) return { len: 0, firstB: -1 };
  const w = b.length + 1;
  const dp = new Int32Array((a.length + 1) * w);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i * w + j] =
        a[i - 1] === b[j - 1]
          ? dp[(i - 1) * w + (j - 1)] + 1
          : Math.max(dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
    }
  }

  let i = a.length;
  let j = b.length;
  let firstB = -1;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && dp[i * w + j] === dp[(i - 1) * w + (j - 1)] + 1) {
      firstB = j - 1;
      i--;
      j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }
  return { len: dp[a.length * w + b.length], firstB };
}

interface PWord {
  raw: string;
  norm: string;
  start: number;
  end: number;

  unit: number;

  posInUnit: number;

  gi: number;
}

interface PUnit {
  index: number;
  start: number;
  end: number;
  text: string;

  words: PWord[];

  tokens: string[];

  timed: boolean;
}

function rawSegments(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.segments)) return o.segments;

    if (Array.isArray(o.words)) return [{ words: o.words }];
  }
  return [];
}

function parseUnits(input: unknown): PUnit[] {
  const units: PUnit[] = [];
  let gi = 0;
  for (const rawSeg of rawSegments(input)) {
    if (!rawSeg || typeof rawSeg !== "object") continue;
    const seg = rawSeg as Record<string, unknown>;
    const index = units.length;
    const words: PWord[] = [];
    const rawWords = Array.isArray(seg.words) ? seg.words : [];
    for (const rawWord of rawWords) {
      if (!rawWord || typeof rawWord !== "object") continue;
      const w = rawWord as Record<string, unknown>;
      const raw = str(w.word) || str(w.text);
      const start = num(w.start);
      const end = num(w.end);
      if (!raw.trim() || start === null || end === null) continue;

      if (start < 0 || end < start) continue;
      words.push({
        raw: raw.trim(),
        norm: normToken(raw),
        start,
        end,
        unit: index,
        posInUnit: words.length,
        gi: 0,
      });
    }
    const text = str(seg.text).trim() || words.map((w) => w.raw).join(" ");
    const segStart = num(seg.start);
    const segEnd = num(seg.end);
    const start = segStart !== null && segStart >= 0 ? segStart : (words[0]?.start ?? null);
    const end = segEnd !== null ? segEnd : (words[words.length - 1]?.end ?? null);
    if (start === null || end === null || end < start) {

      if (words.length === 0) continue;
    }
    const unitStart = start ?? words[0].start;
    const unitEnd = end ?? words[words.length - 1].end;
    if (!Number.isFinite(unitStart) || !Number.isFinite(unitEnd) || unitEnd < unitStart) continue;
    const tokens =
      words.length > 0
        ? words.map((w) => w.norm).filter(Boolean)
        : text
            .split(/\s+/)
            .map(normToken)
            .filter(Boolean);
    if (tokens.length === 0) continue;
    for (const w of words) w.gi = gi++;
    units.push({
      index,
      start: unitStart,
      end: unitEnd,
      text,
      words,
      tokens,
      timed: words.length > 0,
    });
  }

  units.forEach((u, i) => {
    u.index = i;
    for (const w of u.words) w.unit = i;
  });
  return units;
}

interface SpeakerStats {

  medianDpc: number;

  dpcUsable: boolean;

  pauseSec: number;

  hesitationSec: number;
}

function computeStats(words: PWord[], gaps: Array<number | null>): SpeakerStats {
  const dpc: number[] = [];
  for (const w of words) {
    const letters = w.norm.replace(/\p{N}+/gu, "").length;
    const dur = w.end - w.start;
    if (letters > 0 && dur > 0) dpc.push(dur / letters);
  }
  const medianDpc = median(dpc);

  const positive = gaps.filter((g): g is number => g !== null && g > 0.0001).sort((a, b) => a - b);
  const pauseSec = positive.length >= 8 ? clamp(percentile(positive, 0.5), 0.2, 0.6) : 0.35;
  const hesitationSec =
    positive.length >= 8
      ? Math.max(HESITATION_FLOOR_SEC, percentile(positive, 0.9) * 1.2)
      : HESITATION_FALLBACK_SEC;

  return {
    medianDpc,
    dpcUsable: dpc.length >= MIN_WORDS_FOR_DPC && medianDpc > 0,
    pauseSec,
    hesitationSec,
  };
}

interface Ctx {
  units: PUnit[];
  words: PWord[];

  gaps: Array<number | null>;
  stats: SpeakerStats;
}

function buildCtx(units: PUnit[]): Ctx {
  const words: PWord[] = [];
  for (const u of units) for (const w of u.words) words.push(w);
  const gaps: Array<number | null> = [];
  for (let i = 0; i < words.length; i++) {
    if (i === 0) {
      gaps.push(null);
      continue;
    }
    const prev = words[i - 1];

    if (words[i].unit - prev.unit > 1) {
      gaps.push(null);
      continue;
    }
    gaps.push(Math.max(0, words[i].start - prev.end));
  }
  return { units, words, gaps, stats: computeStats(words, gaps) };
}

function gapBefore(ctx: Ctx, gi: number): number | null {
  return ctx.gaps[gi] ?? null;
}

function gapAfter(ctx: Ctx, gi: number): number | null {
  return gi + 1 < ctx.words.length ? (ctx.gaps[gi + 1] ?? null) : null;
}

function unitContext(ctx: Ctx, index: number): string {
  const u = ctx.units[index];
  if (!u) return "";
  if (u.tokens.length > 5) return u.text;
  return [ctx.units[index - 1]?.text, u.text, ctx.units[index + 1]?.text]
    .filter((s): s is string => !!s)
    .join(" … ");
}

function elongation(ctx: Ctx, w: PWord): number {
  if (!ctx.stats.dpcUsable) return 1;
  const letters = w.norm.replace(/\p{N}+/gu, "").length;
  const dur = w.end - w.start;
  if (letters <= 0 || dur <= 0) return 1;
  return dur / letters / ctx.stats.medianDpc;
}

interface RawCandidate {
  kind: DeadWeightKind;
  start: number;
  end: number;
  text: string;
  confidence: number;
  reason: string;
  context: string;
}

function scoreFiller(input: {
  base: number;
  standalone: boolean;
  breakBefore: boolean;
  breakAfter: boolean;
  gapBeforeSec: number;
  gapAfterSec: number;
  pauseSec: number;
  elongation: number;
  commaAfter: boolean;
  repeatedRightAfter: boolean;
}): { confidence: number; signals: string[] } {
  const signals: string[] = [];
  let c = input.base;
  if (input.standalone) {
    c += 0.28;
    signals.push("đứng một mình thành nguyên một cụm");
  } else if (input.breakBefore && input.breakAfter) {
    c += 0.2;
    signals.push("có ngắt cả trước lẫn sau");
  }
  if (input.gapBeforeSec >= input.pauseSec) {
    c += 0.08;
    signals.push(`im lặng ${fmtSec(input.gapBeforeSec)}s ngay trước`);
  }
  if (input.gapAfterSec >= input.pauseSec) {
    c += 0.08;
    signals.push(`im lặng ${fmtSec(input.gapAfterSec)}s ngay sau`);
  }
  if (input.elongation >= ELONGATION_STRONG) {
    c += 0.28;
    signals.push(`bị ngân dài gấp ${input.elongation.toFixed(1)} lần nhịp đọc thường của chính người nói`);
  } else if (input.elongation >= ELONGATION_MILD) {
    c += 0.18;
    signals.push(`dài gấp ${input.elongation.toFixed(1)} lần nhịp đọc thường của chính người nói`);
  }
  if (input.commaAfter) {
    c += 0.08;
    signals.push("có dấu phẩy ngay sau");
  }
  if (input.repeatedRightAfter) {
    c += 0.12;
    signals.push("nói lại ngay từ đó lần nữa");
  }
  return { confidence: clamp(c, 0, 0.97), signals };
}

function fillerCandidates(ctx: Ctx): RawCandidate[] {
  const out: RawCandidate[] = [];
  const { pauseSec } = ctx.stats;

  const push = (
    unit: PUnit,
    span: PWord[],
    base: number,
    label: string,
    opts: { standalone: boolean; commaAfter?: boolean; tail?: string },
  ): void => {
    const first = span[0];
    const last = span[span.length - 1];
    const gb = gapBefore(ctx, first.gi);
    const ga = gapAfter(ctx, last.gi);
    const breakBefore = first.posInUnit === 0 || (gb !== null && gb >= pauseSec);
    const breakAfter = last.posInUnit === unit.words.length - 1 || (ga !== null && ga >= pauseSec);
    const elong = Math.max(...span.map((w) => elongation(ctx, w)));
    const nextWord = ctx.words[last.gi + 1];
    const repeatedRightAfter = !!nextWord && nextWord.norm === first.norm;

    const { confidence, signals } = scoreFiller({
      base,
      standalone: opts.standalone,
      breakBefore,
      breakAfter,
      gapBeforeSec: gb ?? 0,
      gapAfterSec: ga ?? 0,
      pauseSec,
      elongation: elong,
      commaAfter: opts.commaAfter ?? false,
      repeatedRightAfter,
    });

    const text = span.map((w) => w.raw).join(" ");
    out.push({
      kind: "filler",
      start: first.start,
      end: last.end,
      text,
      confidence,
      reason: `${label}: ${signals.join("; ")}. ${opts.tail ?? "Bỏ đi câu vẫn đủ nghĩa."}`,
      context: unitContext(ctx, unit.index),
    });
  };

  for (const unit of ctx.units) {
    if (!unit.timed) continue;
    const joined = unit.tokens.join(" ");

    if (HARD_FILLERS.has(joined)) {
      push(unit, unit.words, 0.55, `"${unit.text}" là thán từ đệm`, { standalone: true });
      continue;
    }
    if (unit.words.length === 1 && SOFT_FILLERS.has(joined)) {

      const gb = gapBefore(ctx, unit.words[0].gi);
      const prev = ctx.words[unit.words[0].gi - 1];
      if (prev && (gb === null || gb < 0.25) && REFERENT_BEFORE.has(prev.norm)) continue;
      push(unit, unit.words, 0.3, `"${unit.text}" đứng trơ một mình nên là tiếng đệm chốt câu, không phải chỉ định từ`, {
        standalone: true,
      });
      continue;
    }
    if (PHRASE_FILLERS.has(joined)) {
      push(unit, unit.words, 0.3, `"${unit.text}" là cụm đệm bỏ lửng, người nói đổi ý nói lại`, {
        standalone: true,
      });
      continue;
    }
    if (CONNECTOR_FILLERS.has(joined)) {
      push(
        unit,
        unit.words,
        0.15,
        `"${unit.text}" đứng trơ một mình, nhiều khả năng là câu bỏ dở`,
        {
          standalone: true,
          tail:
            `CẦN ĐỌC KỸ NGỮ CẢNH TRƯỚC KHI DUYỆT: cụm này cũng có thể đang nối hai vế thật ` +
            `(chọn lựa/nguyên nhân), cắt vào là mất hẳn một vế.`,
        },
      );
      continue;
    }

    for (const w of unit.words) {
      if (!HARD_FILLERS.has(w.norm)) continue;
      const gb = gapBefore(ctx, w.gi) ?? 0;
      const ga = gapAfter(ctx, w.gi) ?? 0;
      const elong = elongation(ctx, w);
      const hasBreak = gb >= pauseSec || ga >= pauseSec || elong >= ELONGATION_MILD;
      if (!hasBreak) continue;
      push(unit, [w], 0.45, `"${w.raw}" là thán từ đệm chen giữa câu`, { standalone: false });
    }

    const first = unit.words[0];
    if (first && unit.words.length > 1 && SOFT_FILLERS.has(first.norm)) {
      const commaAfter = /[,;:]$/.test(first.raw.trim());
      const next = unit.words[1];
      if (commaAfter && !SUBJECT_AFTER.has(next.norm)) {
        push(unit, [first], 0.3, `"${first.raw}" mở đầu cụm rồi ngắt ngay, là tiếng chốt câu trước`, {
          standalone: false,
          commaAfter: true,
        });
      }
    }
  }
  return out;
}

function stutterCandidates(ctx: Ctx): RawCandidate[] {
  const out: RawCandidate[] = [];
  const words = ctx.words;
  const taken = new Set<number>();
  for (let i = 0; i < words.length - 1; i++) {
    if (taken.has(i)) continue;

    for (let len = 3; len >= 1; len--) {
      const end2 = i + 2 * len;
      if (end2 > words.length) continue;
      const first = words.slice(i, i + len);
      const second = words.slice(i + len, end2);
      if (first.some((w) => !w.norm) || second.some((w) => !w.norm)) continue;
      if (!first.every((w, k) => w.norm === second[k].norm)) continue;

      if (first.every((w) => /^\p{N}+$/u.test(w.norm))) continue;
      if (len === 1 && REDUPLICATIONS.has(first[0].norm)) continue;

      if (/[,;:.!?…]$/.test(first[len - 1].raw.trim())) continue;
      const gap = second[0].start - first[len - 1].end;
      if (gap > STUTTER_MAX_GAP_SEC) continue;

      const unit = ctx.units[first[0].unit];
      const firstText = first.map((w) => w.raw).join(" ");
      const secondText = second.map((w) => w.raw).join(" ");

      const cutEnd = Math.max(first[len - 1].end, second[0].start);
      if (cutEnd <= first[0].start) continue;

      for (let k = i; k < i + len; k++) taken.add(k);
      out.push({
        kind: "stutter",
        start: first[0].start,
        end: cutEnd,
        text: firstText,
        confidence: len >= 2 ? 0.82 : 0.78,
        reason:
          `Vấp: "${firstText}" bật ra hai lần liền nhau ("${firstText} ${secondText}") - ` +
          `cắt lượt đầu, giữ lượt sau.`,
        context: unitContext(ctx, first[0].unit),
      });
      break;
    }
  }
  return out;
}

function repeatTakeCandidates(ctx: Ctx): RawCandidate[] {
  const out: RawCandidate[] = [];
  const units = ctx.units;
  for (let a = 0; a < units.length; a++) {
    const A = units[a];
    if (A.tokens.length < 2) continue;
    let best: { b: number; sim: number; prefix: boolean; skipped: number } | null = null;
    for (let b = a + 1; b <= a + 1 + REPEAT_MAX_INTERVENING_UNITS && b < units.length; b++) {
      const B = units[b];
      if (B.start - A.end > REPEAT_WINDOW_SEC) break;
      if (B.tokens.length < A.tokens.length) continue;
      const prefix = A.tokens.every((t, i) => B.tokens[i] === t);
      const m = lcsMatch(A.tokens, B.tokens);
      const sim = prefix ? 1 : m.len / A.tokens.length;
      if (sim < REPEAT_MIN_SIMILARITY) continue;

      if (!prefix && m.firstB > REPEAT_ANCHOR_MAX_OFFSET) continue;

      if (A.tokens.length < 3 && !prefix) continue;
      if (!best || sim > best.sim) best = { b, sim, prefix, skipped: b - a - 1 };
    }
    if (!best) continue;

    const B = units[best.b];
    let confidence = 0.45;
    confidence += 0.35 * clamp((best.sim - REPEAT_MIN_SIMILARITY) / (1 - REPEAT_MIN_SIMILARITY), 0, 1);
    if (best.skipped === 0) confidence += 0.12;
    else if (best.skipped === 1) confidence += 0.06;
    if (best.prefix) confidence += 0.1;

    if (A.tokens.length < 3) confidence -= 0.15;
    confidence = clamp(confidence, 0, 0.95);

    out.push({
      kind: "repeat-take",
      start: A.start,
      end: A.end,
      text: A.text,
      confidence,
      reason:
        `Nói lại: câu này được nói lại đầy đủ hơn sau ${fmtSec(B.start - A.end)}s thành "${B.text}" ` +
        `(trùng ${Math.round(best.sim * 100)}%${best.prefix ? ", lặp nguyên phần đầu" : ""}). ` +
        `Cắt lần nói hỏng ở đây, giữ lần sau.`,
      context: `${A.text} … ${B.text}`,
    });
  }
  return out;
}

function hesitationCandidates(ctx: Ctx): RawCandidate[] {
  const out: RawCandidate[] = [];
  const th = ctx.stats.hesitationSec;
  for (let i = 1; i < ctx.words.length; i++) {
    const g = ctx.gaps[i];
    if (g === null || g < th) continue;
    const prev = ctx.words[i - 1];
    const next = ctx.words[i];
    const start = prev.end + HESITATION_PAD_SEC;
    const end = next.start - HESITATION_PAD_SEC;
    if (end - start < HESITATION_MIN_CUT_SEC) continue;
    const over = clamp((g - th) / th, 0, 1);
    const prevUnit = ctx.units[prev.unit];
    const nextUnit = ctx.units[next.unit];
    out.push({
      kind: "hesitation",
      start,
      end,
      text: `(im lặng ${fmtSec(g)}s)`,
      confidence: clamp(0.5 + 0.4 * over, 0, 0.9),
      reason:
        `Chần chừ: ngừng ${fmtSec(g)}s giữa "${prev.raw}" và "${next.raw}", vượt ngưỡng ` +
        `${fmtSec(th)}s tính từ chính nhịp nghỉ của người nói. Cắt phần giữa, chừa ` +
        `${fmtSec(HESITATION_PAD_SEC)}s mỗi đầu cho khỏi cụt tiếng.`,
      context:
        prevUnit && nextUnit && prevUnit !== nextUnit
          ? `${prevUnit.text} … ${nextUnit.text}`
          : (prevUnit?.text ?? ""),
    });
  }
  return out;
}

function emptyByKind(): Record<DeadWeightKind, { count: number; sec: number }> {
  return {
    filler: { count: 0, sec: 0 },
    stutter: { count: 0, sec: 0 },
    "repeat-take": { count: 0, sec: 0 },
    hesitation: { count: 0, sec: 0 },
  };
}

function emptyReport(): DeadWeightReport {
  return { candidates: [], totalSec: 0, byKind: emptyByKind() };
}

export function findDeadWeight(
  transcript: unknown,
  opts?: {

    minConfidence?: number;
  },
): DeadWeightReport {
  try {
    const minConfidence = clamp(
      typeof opts?.minConfidence === "number" && Number.isFinite(opts.minConfidence)
        ? opts.minConfidence
        : DEFAULT_MIN_CONFIDENCE,
      0,
      1,
    );

    const units = parseUnits(transcript);
    if (units.length === 0) return emptyReport();
    const ctx = buildCtx(units);

    const raw = [
      ...fillerCandidates(ctx),
      ...stutterCandidates(ctx),
      ...repeatTakeCandidates(ctx),
      ...hesitationCandidates(ctx),
    ].filter((c) => c.end > c.start && c.confidence >= minConfidence);

    const kept: RawCandidate[] = [];
    for (const c of [...raw].sort((a, b) => b.confidence - a.confidence || a.start - b.start)) {
      if (kept.some((k) => c.start < k.end && k.start < c.end)) continue;
      kept.push(c);
    }
    kept.sort((a, b) => a.start - b.start);

    const byKind = emptyByKind();
    const candidates: DeadWeightCandidate[] = kept.map((c) => {
      const start = round2(c.start);
      const end = round2(c.end);
      const sec = Math.max(0, end - start);
      byKind[c.kind].count += 1;
      byKind[c.kind].sec += sec;
      return {
        kind: c.kind,
        start,
        end,
        text: c.text,
        confidence: Math.round(c.confidence * 100) / 100,
        reason: c.reason,
        context: c.context,
      };
    });
    for (const k of KINDS) byKind[k].sec = round2(byKind[k].sec);

    return {
      candidates,
      totalSec: round2(candidates.reduce((s, c) => s + (c.end - c.start), 0)),
      byKind,
    };
  } catch {

    return emptyReport();
  }
}
