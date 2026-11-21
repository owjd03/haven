#!/usr/bin/env node
// Looks inside the built site (web/frontend/out) for things that must never be shipped.
// Run from CI after `npm run build`, with CHECK_DEBUG_TOKEN set to the same fake token that was
// given to the build as NEXT_PUBLIC_APP_CHECK_DEBUG_TOKEN.
//
//   1. Leak check: that token must not appear in any built file. (A real debug token once ended up
//      in the shipped JavaScript this way, because Next.js copies NEXT_PUBLIC_* values into it.)
//   2. Hidden pages check: text from the developer-only pages must not appear in any built file.
//
// Each check first makes sure it can still fail: the token has to be set, and each marker has to
// still exist in the source. Otherwise a rename would turn the check into one that always passes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "web/frontend/out");

const MARKERS = [
  { file: "web/frontend/components/Phase1Demo.tsx", text: "Phase 1 check", page: "/debug" },
  {
    file: "web/frontend/app/dev/prompt/page.tsx",
    text: "Developer page, not part of the app",
    page: "/dev/prompt",
  },
];
const TEXT_FILE = /\.(html|js|mjs|css|txt|json|map|xml)$/i;

const problems = [];
const token = process.env.CHECK_DEBUG_TOKEN;
if (!token || token.length < 12) {
  console.error("CHECK_DEBUG_TOKEN must be set to the fake token used for the build (12+ characters).");
  process.exit(2);
}

for (const m of MARKERS) {
  const source = readFileSync(join(root, m.file), "utf8");
  if (!source.includes(m.text)) {
    problems.push(`The marker "${m.text}" is no longer in ${m.file}. Update tools/ci/check-build-output.mjs.`);
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

let scanned = 0;
const leaks = new Set();
const shipped = new Map();
for (const path of walk(outDir)) {
  if (!TEXT_FILE.test(path)) continue;
  scanned += 1;
  const body = readFileSync(path, "utf8");
  const where = path.slice(outDir.length + 1);
  if (body.includes(token)) leaks.add(where);
  for (const m of MARKERS) {
    if (body.includes(m.text)) {
      if (!shipped.has(m.page)) shipped.set(m.page, new Set());
      shipped.get(m.page).add(where);
    }
  }
}
if (scanned < 20) problems.push(`Only ${scanned} files were found in ${outDir}. Was the site built?`);
for (const where of leaks) problems.push(`The debug token is inside the built file ${where}.`);
for (const [page, files] of shipped) {
  problems.push(`Text from the developer page ${page} is in the build: ${[...files].join(", ")}.`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL: ${p}`);
  process.exit(1);
}
console.log(`OK: scanned ${scanned} files. No debug token, and no developer pages.`);
