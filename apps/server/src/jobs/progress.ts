

export function parseProgressLine(line: string): number | null {
  let best: number | null = null;

  for (const m of line.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);

    if (b >= 2 && a >= 0 && a <= b) {
      const pct = Math.floor((a / b) * 100);
      if (best === null || pct > best) best = pct;
    }
  }

  for (const m of line.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)) {
    const pct = Math.floor(parseFloat(m[1]));
    if (pct >= 0 && pct <= 100 && (best === null || pct > best)) best = pct;
  }

  return best;
}

export function shortenStep(line: string, max = 120): string {
  const clean = line.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
