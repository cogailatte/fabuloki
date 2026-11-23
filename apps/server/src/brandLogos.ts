import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { HttpError } from "./util.js";

export interface BrandLogo {
  slug: string;
  title: string;

  color: string | null;

  file: string;
  source?: string | null;
  addedByUser?: boolean;
}

export interface BrandLogoLibrary {
  generatedAt: string;
  source: string;
  license: string;
  notice: string;
  count: number;
  icons: BrandLogo[];
}

export function brandLogosDir(): string {
  return path.join(paths.assetsDir, "brand-logos");
}

function libraryPath(): string {
  return path.join(brandLogosDir(), "library.json");
}

export function readBrandLogos(): BrandLogo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryPath(), "utf8")) as Partial<BrandLogoLibrary>;
    if (!Array.isArray(raw.icons)) return [];

    return raw.icons.filter(
      (i): i is BrandLogo =>
        Boolean(i && typeof i.file === "string" && i.file) &&
        fs.existsSync(path.join(brandLogosDir(), i.file)),
    );
  } catch {
    return [];
  }
}

export function countBrandLogos(): number {
  return readBrandLogos().length;
}

const ALLOWED_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "www.wikidata.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
]);

const UA = "Fabuloki/1.0 (brand logo fetch)";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

let iconIndex: { at: number; list: Array<{ slug: string; title: string; hex: string }> } | null =
  null;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\+/g, "plus")
    .replace(/\./g, "dot")
    .replace(/[^a-z0-9]/g, "");
}

async function fetchAllowed(url: string, accept: string): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new HttpError(400, "LOGO_HOST_BLOCKED", `Không tải logo từ host lạ: ${u.hostname}`);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {

    let current = u;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(current.href, {
        headers: { "user-agent": UA, accept },
        redirect: "manual",
        signal: ctrl.signal,
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, current);
        if (next.protocol !== "https:" || !ALLOWED_HOSTS.has(next.hostname)) {
          throw new HttpError(
            400,
            "LOGO_HOST_BLOCKED",
            `Logo chuyển hướng sang host lạ: ${next.hostname}`,
          );
        }
        current = next;
        continue;
      }
      return res;
    }
    throw new HttpError(502, "LOGO_TOO_MANY_REDIRECTS", "Tải logo bị chuyển hướng vòng vo");
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response): Promise<Buffer> {

  if (Number(res.headers.get("content-length") || 0) > MAX_LOGO_BYTES) {
    throw new HttpError(502, "LOGO_TOO_LARGE", `File logo lớn hơn ${MAX_LOGO_BYTES} bytes`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_LOGO_BYTES) {
    throw new HttpError(502, "LOGO_TOO_LARGE", `File logo lớn hơn ${MAX_LOGO_BYTES} bytes`);
  }
  return buf;
}

export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script[^>]*\/\s*>/gi, "")
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, "")
    .replace(/<\s*(iframe|object|embed|audio|video)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")

    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")

    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')

    .replace(/(href|src)\s*=\s*(["'])\s*https?:\/\/[^"']*\2/gi, '$1="#"');
}

export function svgLooksDangerous(svg: string): boolean {
  const decoded = svg
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d) || 32))
    .replace(/[\u0000- ]+/g, " ");
  return /<\s*([\w-]+:)?(script|foreignobject|iframe|object|embed|handler|listener)\b|<!entity|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|@import|url\s*\(\s*["']?\s*(https?:|\/\/)|(href|src)\s*=\s*["']?\s*(https?:|\/\/)|<\s*([\w-]+:)?(set|animate\w*)\b[^>]*attributename\s*=\s*["']?\s*(on|href|xlink:href)/i.test(
    decoded,
  );
}

interface Downloaded {
  buf: Buffer;
  ext: string;
  source: string;
  license: string;
  color: string | null;
}

async function loadIconIndex(): Promise<Array<{ slug: string; title: string; hex: string }>> {
  if (iconIndex && Date.now() - iconIndex.at < INDEX_TTL_MS) return iconIndex.list;
  const res = await fetchAllowed(
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json",
    "application/json",
  );
  if (!res.ok) throw new HttpError(502, "LOGO_INDEX_FAILED", `Simple Icons trả ${res.status}`);
  const raw = (await res.json()) as unknown;
  const arr = (Array.isArray(raw) ? raw : (raw as { icons?: unknown[] }).icons) ?? [];
  const list = (arr as Array<{ slug?: string; title: string; hex: string }>).map((i) => ({
    slug: i.slug ?? slugify(i.title),
    title: i.title,
    hex: i.hex,
  }));
  iconIndex = { at: Date.now(), list };
  return list;
}

async function fromSimpleIcons(name: string): Promise<(Downloaded & { title: string }) | null> {
  const want = slugify(name);
  let list: Array<{ slug: string; title: string; hex: string }>;
  try {
    list = await loadIconIndex();
  } catch {
    return null;
  }
  const hit =
    list.find((i) => i.slug === want) ??
    list.find((i) => slugify(i.title) === want) ??
    null;
  if (!hit) return null;
  const res = await fetchAllowed(
    `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${hit.slug}.svg`,
    "image/svg+xml",
  );
  if (!res.ok) return null;
  const buf = await readCapped(res);
  if (!buf.toString("utf8").includes("<svg")) return null;
  if (svgLooksDangerous(sanitizeSvg(buf.toString("utf8")))) return null;
  return {
    buf,
    ext: ".svg",
    source: "https://simple-icons.org",
    license: "Simple Icons: verify the terms for this icon and its trademark.",
    color: `#${hit.hex}`,
    title: hit.title,
  };
}

async function fromWikidata(name: string): Promise<(Downloaded & { title: string }) | null> {
  const search = await fetchAllowed(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      name,
    )}&language=en&format=json&limit=5`,
    "application/json",
  );
  if (!search.ok) return null;
  const sd = (await search.json()) as { search?: Array<{ id: string; label?: string }> };

  const timeOf = (q: Record<string, Array<{ datavalue?: { value?: { time?: string } } }>> | undefined, pid: string): string | null => {
    const t = q?.[pid]?.[0]?.datavalue?.value?.time;
    return t ? String(t).replace(/^\+/, "") : null;
  };

  for (const hit of sd.search ?? []) {
    const cr = await fetchAllowed(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(
        hit.id,
      )}&property=P154&format=json`,
      "application/json",
    );
    if (!cr.ok) continue;
    const cd = (await cr.json()) as {
      claims?: {
        P154?: Array<{
          rank?: string;
          mainsnak?: { datavalue?: { value?: string } };
          qualifiers?: Record<string, Array<{ datavalue?: { value?: { time?: string } } }>>;
        }>;
      };
    };
    const claims = cd.claims?.P154 ?? [];
    if (claims.length === 0) continue;

    const scored = claims
      .map((c) => ({
        file: c.mainsnak?.datavalue?.value ?? "",
        rank: c.rank ?? "normal",
        start: timeOf(c.qualifiers, "P580"),
        end: timeOf(c.qualifiers, "P582"),
      }))
      .filter((c) => c.file && c.rank !== "deprecated");
    if (scored.length === 0) continue;
    const live = scored.filter((c) => !c.end);
    const pool = live.length > 0 ? live : scored;
    pool.sort(
      (a, b) =>
        (b.rank === "preferred" ? 1 : 0) - (a.rank === "preferred" ? 1 : 0) ||
        String(b.start ?? "").localeCompare(String(a.start ?? "")) ||
        (/\.svg$/i.test(b.file) ? 1 : 0) - (/\.svg$/i.test(a.file) ? 1 : 0),
    );
    const best = pool[0];
    const ext = path.extname(best.file).toLowerCase();
    if (![".svg", ".png"].includes(ext)) continue;

    const fileRes = await fetchAllowed(
      `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(best.file)}`,
      "image/svg+xml,image/png",
    );
    if (!fileRes.ok) continue;
    const buf = await readCapped(fileRes);
    if (ext === ".svg" && !buf.toString("utf8").includes("<svg")) continue;
    if (ext === ".svg" && svgLooksDangerous(sanitizeSvg(buf.toString("utf8")))) continue;

    if (ext === ".png" && !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) continue;
    return {
      buf,
      ext,
      source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(best.file)}`,

      license: "Wikimedia Commons (xem trang file); nhãn hiệu thuộc chủ sở hữu",
      color: null,
      title: hit.label ?? name,
    };
  }
  return null;
}

export interface ResolvedBrandLogo extends BrandLogo {

  added: boolean;
}

export async function resolveBrandLogo(rawName: string): Promise<ResolvedBrandLogo> {
  const name = rawName.trim();
  if (!name) throw new HttpError(400, "BRAND_NAME_REQUIRED", "Thiếu tên brand cần tìm logo");
  if (name.length > 60) {
    throw new HttpError(400, "BRAND_NAME_TOO_LONG", "Tên brand dài quá 60 ký tự");
  }
  const want = slugify(name);
  if (!want) {
    throw new HttpError(400, "BRAND_NAME_INVALID", `Tên brand không hợp lệ: "${name}"`);
  }

  const existing = readBrandLogos();
  const hit =
    existing.find((l) => l.slug === want) ??
    existing.find((l) => slugify(l.title) === want) ??
    null;
  if (hit) return { ...hit, added: false };

  const got = (await fromSimpleIcons(name)) ?? (await fromWikidata(name));
  if (!got) {
    throw new HttpError(
      404,
      "BRAND_LOGO_NOT_FOUND",
      `Không tìm được logo chính thức của "${name}" ở cả Simple Icons lẫn Wikidata. ` +
        "TUYỆT ĐỐI KHÔNG tự vẽ hay nhờ AI sinh logo: hãy viết tên brand bằng chữ (font của " +
        "Style Design) và ghi vào báo cáo cuối. Muốn có logo thì tải file chính thức từ trang " +
        "brand rồi bỏ vào assets/brand-logos/.",
    );
  }

  const dir = brandLogosDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = `${want}${got.ext}`;
  const data =
    got.ext === ".svg" ? Buffer.from(sanitizeSvg(got.buf.toString("utf8")), "utf8") : got.buf;
  fs.writeFileSync(path.join(dir, file), data);

  const entry: BrandLogo = {
    slug: want,
    title: got.title,
    color: got.color,
    file,
    source: got.source,
  };
  appendToLibrary(entry, got.license);
  return { ...entry, added: true };
}

function appendToLibrary(entry: BrandLogo, license: string): void {
  const p = path.join(brandLogosDir(), "library.json");
  let lib: BrandLogoLibrary;
  try {
    lib = JSON.parse(fs.readFileSync(p, "utf8")) as BrandLogoLibrary;
  } catch {
    lib = {
      generatedAt: new Date().toISOString(),
      source: "https://simple-icons.org",
      license: "See the terms for each icon and its trademark.",
      notice: "Check each icon source for redistribution terms. Trademark rights remain with their owners.",
      count: 0,
      icons: [],
    };
  }
  const icons = (lib.icons ?? []).filter((i) => i.slug !== entry.slug);

  icons.push({ ...entry, license } as BrandLogo & { license: string });
  icons.sort((a, b) => a.title.localeCompare(b.title));
  lib.icons = icons;
  lib.count = icons.length;
  lib.generatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(lib, null, 2) + "\n", "utf8");
}
