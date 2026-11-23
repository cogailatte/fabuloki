

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const vi = readFileSync(join(ROOT, "src/lib/locales/vi.ts"), "utf8");
const en = readFileSync(join(ROOT, "src/lib/locales/en.ts"), "utf8");
const has = (src, k) => src.includes(`"${k}":`);

function walk(d) {
  const out = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const missing = [];
const used = new Set();

for (const f of walk(join(ROOT, "src"))) {
  if (f.includes("locales")) continue;

  const text = readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(?:\*|\/\/)/.test(l))
    .join("\n");

  for (const m of text.matchAll(/\btf?\(\s*"([^"]+)"/g)) {
    const key = m[1];
    used.add(key);
    if (!has(vi, key)) missing.push({ f: relative(ROOT, f), key });
  }
}

const enMissing = [...used].filter((k) => has(vi, k) && !has(en, k));

if (missing.length) {
  console.log(
    `THIẾU trong vi.ts (${missing.length}) - giao diện sẽ hiện ra chính chuỗi key:`
  );
  for (const m of missing.slice(0, 30)) console.log(`  ${m.f}  ${m.key}`);
} else {
  console.log(`vi.ts: đủ cả ${used.size} key được gọi.`);
}
console.log(
  `en.ts thiếu ${enMissing.length} key (fallback về vi - chấp nhận được)`
);
if (enMissing.length) console.log("  " + enMissing.slice(0, 15).join("\n  "));

process.exit(missing.length ? 1 : 0);
