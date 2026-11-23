#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

const BANNED_TEXT =
  /\btext-\[(?:9|10|11|13|15|16|17|18|19|20|21|22|23|24|25|27|29|30)px\]|\btext-base\b|\btext-lg\b|\btext-2xl\b|\btext-3xl\b/g;

const BANNED_SPACE = /\bgap-(?:0\.5|1\.5|2\.5|5|7|9)\b|\bp-(?:0\.5|1\.5|2\.5)\b/g;

const BANNED_COLOR =
  /(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]|\b(?:bg|text)-(?:white|black|gray|slate|zinc|neutral|stone|red|blue|green|yellow)-\d{2,3}\b/g;

const HANDROLLED = [
  {
    re: /rounded-\[var\(--radius\)\]\s+border\s+border-\[var\(--border\)\]\s+bg-\[var\(--bg-subtle\)\]/g,
    msg: "hộp lồng chép tay - dùng <Panel>",
  },
  {
    re: /className="btn btn-(?:primary|secondary|destructive)/g,
    msg: "class .btn viết tay - dùng <Button>",
  },
  {
    re: /\brounded-\[3px\]/g,
    msg: "bán kính thô - dùng var(--radius)",
  },
];

const ALLOW = new Map([

  ["src/app/m/[id]/page.tsx", ["BANNED_COLOR"]],

  ["src/components/MediaPreviewModal.tsx", ["BANNED_COLOR"]],

  ["src/components/PhoneConnectModal.tsx", ["BANNED_COLOR"]],

  ["src/app/translate-video/[id]/page.tsx", ["BANNED_COLOR"]],

  ["src/app/styles/[id]/page.tsx", ["BANNED_TEXT"]],

  ["src/components/StatTile.tsx", ["BANNED_TEXT"]],

  ["src/components/ProjectAssetsCard.tsx", ["HANDROLLED"]],

  ["src/components/ImageProjectForm.tsx", ["HANDROLLED"]],
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const findings = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (rel.includes("/locales/")) continue;
  const allowed = ALLOW.get(rel) ?? [];

  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => (/^\s*(?:\*|\/\/|\/\*)/.test(l) ? "" : l));

  const checks = [
    ["BANNED_TEXT", BANNED_TEXT, "cỡ chữ ngoài thang 3 bậc"],
    ["BANNED_SPACE", BANNED_SPACE, "khoảng cách ngoài nhịp 4/8/12/16/24"],
    ["BANNED_COLOR", BANNED_COLOR, "màu ngoài bảng token"],
  ];

  for (const [id, re, label] of checks) {
    if (allowed.includes(id)) continue;
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        findings.push({ rel, line: i + 1, label, hit: m[0] });
      }
    });
  }

  for (const { re, msg } of HANDROLLED) {
    if (allowed.includes("HANDROLLED")) break;
    lines.forEach((line, i) => {

      if (/<img|object-(?:cover|contain|fill)/.test(line)) return;
      for (const m of line.matchAll(re)) {
        findings.push({ rel, line: i + 1, label: msg, hit: m[0].slice(0, 40) });
      }
    });
  }
}

if (findings.length === 0) {
  console.log("Hệ thống thiết kế: sạch.");
  process.exit(0);
}

const byLabel = new Map();
for (const f of findings) {
  if (!byLabel.has(f.label)) byLabel.set(f.label, []);
  byLabel.get(f.label).push(f);
}

console.log(`Hệ thống thiết kế: ${findings.length} chỗ lệch\n`);
for (const [label, items] of [...byLabel].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${label} (${items.length})`);
  for (const it of items.slice(0, 12)) {
    console.log(`    ${it.rel}:${it.line}  ${it.hit}`);
  }
  if (items.length > 12) console.log(`    … và ${items.length - 12} chỗ nữa`);
  console.log("");
}
process.exit(1);
