// Re-opens every web page that Haven links to and reports the ones that no longer load.
//
//   node tools/links/check-links.mjs
//
// It checks the "Read more" list and the source page of every plan idea. It is run by hand, and it is
// not part of the required CI checks, because a website being down should not block a deploy.
// Some sites refuse automated requests (403 or 429), or send an incomplete certificate chain that
// browsers accept and Node does not. Those are listed as "blocked", not "broken", because the page
// may still open fine in a browser: open them yourself to be sure.
//
// Exit code: 1 if any page is broken (not found, server error, timeout), otherwise 0.

import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const reading = read("../../web/backend/data/readingLinks.json");
const ideas = read("../../web/backend/data/planIdeas.json");

const pages = new Map();
for (const r of reading) pages.set(r.url, `Read more: ${r.title} (${r.publisher})`);
for (const i of ideas) if (!pages.has(i.source.url)) pages.set(i.source.url, `Idea: ${i.title} (${i.source.name})`);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function check(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(25_000),
    });
    const moved = res.url !== url && res.url.replace(/\/$/, "") !== url.replace(/\/$/, "");
    if (res.ok) return { state: moved ? "moved" : "ok", status: res.status, final: res.url };
    if (res.status === 403 || res.status === 429) return { state: "blocked", status: res.status };
    return { state: "broken", status: res.status };
  } catch (e) {
    const code = String(e?.cause?.code ?? "");
    if (/CERT|SIGNATURE/.test(code)) return { state: "blocked", status: code };
    return { state: "broken", status: String(e?.name ?? e) };
  }
}

const entries = [...pages.entries()];
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < entries.length) {
      const [url, label] = entries[next++];
      results.push({ url, label, ...(await check(url)) });
    }
  }),
);

const by = (state) => results.filter((r) => r.state === state);
for (const r of by("broken")) console.log(`BROKEN  ${r.status}  ${r.label}\n        ${r.url}`);
for (const r of by("blocked"))
  console.log(`BLOCKED ${r.status}  ${r.label}\n        ${r.url}\n        (open it in a browser to be sure)`);
for (const r of by("moved"))
  console.log(`MOVED   ${r.label}\n        ${r.url}\n        now: ${r.final}\n        (update the saved address)`);
console.log(
  `\n${results.length} pages: ${by("ok").length} ok, ${by("moved").length} moved, ` +
    `${by("blocked").length} blocked, ${by("broken").length} broken`,
);
process.exit(by("broken").length > 0 ? 1 : 0);
