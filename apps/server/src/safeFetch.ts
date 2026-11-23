import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TOTAL_TIMEOUT_MS = 15_000;

const SOCKET_IDLE_MS = 8_000;

export type SafeFetchCode =
  | "BAD_SCHEME"
  | "BAD_URL"
  | "BAD_PORT"
  | "BLOCKED_IP"
  | "TOO_LARGE"
  | "BAD_CONTENT_TYPE"
  | "CONNECT_TIMEOUT"
  | "HTTP_ERROR"
  | "DNS_FAIL"
  | "TIMEOUT"
  | "TOO_MANY_REDIRECTS";

export class SafeFetchError extends Error {

  public code: string;

  public status: number | null;

  constructor(code: SafeFetchCode, message: string, status: number | null = null) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

export interface SafeFetchResult {
  html: string;

  finalUrl: string;
  status: number;

  chain: string[];
}

function ip4ToInt(ip: string): number {
  return ip.split(".").reduce((a, o) => ((a << 8) >>> 0) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const n = ip4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (ip4ToInt(base) & mask);
  });
}

function expandV6(a: string): number[] | null {
  let s = a;

  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (net.isIP(tail[1]) !== 4) return null;
    const n = ip4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const nums = groups.map((g) => parseInt(g, 16));
  return nums.length === 8 && nums.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff)
    ? nums
    : null;
}

function isPrivateV6(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const g = expandV6(a);
  if (!g) return true;
  const v4 = (hi: number, lo: number): string =>
    [hi >>> 8, hi & 0xff, lo >>> 8, lo & 0xff].join(".");
  const zeros = (n: number): boolean => g.slice(0, n).every((x) => x === 0);

  if (zeros(7) && (g[7] === 0 || g[7] === 1)) return true;

  if (zeros(5) && g[5] === 0xffff) return isPrivateV4(v4(g[6], g[7]));
  if (zeros(6)) return isPrivateV4(v4(g[6], g[7]));
  if (zeros(4) && g[4] === 0xffff && g[5] === 0) return isPrivateV4(v4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xffc0) === 0xfec0) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  if (g[0] === 0x2002) return true;
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return true;
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;
}

const INTERNAL_HOST_RE = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError("BAD_URL", "URL không hợp lệ");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SafeFetchError(
      "BAD_SCHEME",
      `Chỉ hỗ trợ http/https, không hỗ trợ ${u.protocol.replace(":", "")}`,
    );
  }

  if (u.username || u.password) {
    throw new SafeFetchError("BAD_URL", "URL không được chứa user:pass");
  }
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    throw new SafeFetchError("BAD_PORT", `Cổng ${port} không được phép`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new SafeFetchError("BLOCKED_IP", `Địa chỉ nội bộ bị chặn: ${host}`);
  }
  if (INTERNAL_HOST_RE.test(u.hostname)) {
    throw new SafeFetchError("BLOCKED_IP", `Tên miền nội bộ bị chặn: ${u.hostname}`);
  }
  return u;
}

interface PinnedAddress {
  address: string;
  family: number;
}

async function resolvePinned(hostname: string): Promise<PinnedAddress> {
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SafeFetchError("BLOCKED_IP", `IP nội bộ: ${hostname}`);
    }
    return { address: hostname, family: net.isIP(hostname) };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError("DNS_FAIL", `Không phân giải được tên miền: ${hostname}`);
  }
  if (records.length === 0) {
    throw new SafeFetchError("DNS_FAIL", `Không có bản ghi A/AAAA: ${hostname}`);
  }

  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new SafeFetchError(
        "BLOCKED_IP",
        `${hostname} trỏ về địa chỉ nội bộ (${r.address})`,
      );
    }
  }
  return { address: records[0].address, family: records[0].family };
}

interface HopResult {
  redirect?: URL;
  status?: number;
  html?: string;
}

function requestOnce(u: URL, pinned: PinnedAddress, deadline: number): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const options: https.RequestOptions = {
      protocol: u.protocol,
      host: u.hostname,
      servername: net.isIP(u.hostname) ? undefined : u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",

      lookup: (_hostname, opts, cb) => {
        if (opts && (opts as { all?: boolean }).all) {
          cb(null, [{ address: pinned.address, family: pinned.family }]);
        } else {
          (cb as (e: null, a: string, f: number) => void)(
            null,
            pinned.address,
            pinned.family,
          );
        }
      },
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "vi,en;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        host: u.host,
      },
    };

    const req = mod.request(options, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.destroy();
        let next: URL;
        try {
          next = new URL(location, u);
        } catch {
          reject(new SafeFetchError("BAD_URL", `Link chuyển hướng không hợp lệ: ${location}`));
          return;
        }
        resolve({ redirect: next });
        return;
      }
      if (status >= 400) {
        res.destroy();
        reject(
          new SafeFetchError("HTTP_ERROR", `Máy chủ trả mã ${status}`, status),
        );
        return;
      }
      const ct = String(res.headers["content-type"] || "");
      if (ct && !/^(text\/html|application\/xhtml\+xml|text\/plain)/i.test(ct)) {
        res.destroy();
        reject(new SafeFetchError("BAD_CONTENT_TYPE", `Không phải trang HTML (${ct})`));
        return;
      }
      const declared = Number(res.headers["content-length"] || 0);
      if (declared > MAX_BYTES) {
        res.destroy();
        reject(new SafeFetchError("TOO_LARGE", `Trang quá lớn (${declared} bytes)`));
        return;
      }

      let stream: NodeJS.ReadableStream = res;
      const enc = String(res.headers["content-encoding"] || "").toLowerCase();
      if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

      const chunks: Buffer[] = [];
      let size = 0;
      res.setTimeout(SOCKET_IDLE_MS, () => {
        req.destroy(new SafeFetchError("CONNECT_TIMEOUT", "Máy chủ ngừng gửi dữ liệu"));
      });
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy(new SafeFetchError("TOO_LARGE", `Trang vượt quá ${MAX_BYTES} bytes`));
          return;
        }
        if (Date.now() > deadline) {
          req.destroy(new SafeFetchError("TIMEOUT", "Quá thời gian chờ"));
          return;
        }
        chunks.push(c);
      });
      stream.on("end", () => {
        resolve({ status, html: Buffer.concat(chunks).toString("utf8") });
      });
      stream.on("error", reject);
    });
    req.on("error", (err) => {

      if (err instanceof SafeFetchError) reject(err);
      else reject(new SafeFetchError("CONNECT_TIMEOUT", `Không kết nối được: ${err.message}`));
    });
    req.setTimeout(SOCKET_IDLE_MS, () => {
      req.destroy(new SafeFetchError("CONNECT_TIMEOUT", "Kết nối quá lâu"));
    });
    req.end();
  });
}

export async function safeFetchHtml(rawUrl: string): Promise<SafeFetchResult> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let u = validateUrl(rawUrl);
  const chain: string[] = [u.href];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() > deadline) throw new SafeFetchError("TIMEOUT", "Quá thời gian chờ");

    const pinned = await resolvePinned(u.hostname);
    const out = await requestOnce(u, pinned, deadline);
    if (out.redirect) {
      u = validateUrl(out.redirect.href);
      chain.push(u.href);
      continue;
    }
    return { html: out.html ?? "", status: out.status ?? 0, finalUrl: u.href, chain };
  }
  throw new SafeFetchError("TOO_MANY_REDIRECTS", "Chuyển hướng quá nhiều lần");
}
