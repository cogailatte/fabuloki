

type FormatLang = "vi" | "en";

let FORMAT_LANG: FormatLang = "vi";

export function setFormatLang(lang: FormatLang): void {
  FORMAT_LANG = lang;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  const en = FORMAT_LANG === "en";
  if (sec < 60) return en ? "just now" : "vừa xong";
  const min = Math.round(sec / 60);
  if (min < 60)
    return en ? `${min} minute${min === 1 ? "" : "s"} ago` : `${min} phút trước`;
  const hr = Math.round(min / 60);
  if (hr < 24)
    return en ? `${hr} hour${hr === 1 ? "" : "s"} ago` : `${hr} giờ trước`;
  const day = Math.round(hr / 24);
  if (day < 30)
    return en ? `${day} day${day === 1 ? "" : "s"} ago` : `${day} ngày trước`;
  return formatDateTime(iso);
}

export function formatJobDuration(
  startedAt: string | null,
  finishedAt: string | null
): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "-";
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}${FORMAT_LANG === "en" ? "m" : "p"} ${sec % 60}s`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  const sec = ms / 1000;

  if (sec < 59.95) return `${sec.toFixed(1)}s`;

  const total = Math.round(sec);
  const min = Math.floor(total / 60);
  return `${min}${FORMAT_LANG === "en" ? "m" : "p"} ${total % 60}s`;
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const units = [
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "K" },
  ];
  for (const { v, s } of units) {
    if (n >= v) {
      const value = n / v;
      return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}${s}`;
    }
  }
  return String(Math.round(n));
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clock(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");

  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function isRecentFile(mtime: string, windowMs = 3 * 60_000): boolean {
  const t = new Date(mtime).getTime();
  return Number.isFinite(t) && Date.now() - t < windowMs;
}

export function httpUrlOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
