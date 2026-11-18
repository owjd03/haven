// Screenshots every Haven page in a clean headless Chrome profile via the DevTools protocol.
// Usage: node shoot.mjs <prefix>   (dev server must be running on :3000)
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const prefix = process.argv[2] ?? "shot";
const port = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "haven-shot-"))}`,
    "--window-size=1400,900",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === "page");
      if (t) return t;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const run = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
const go = async (url) => {
  await send("Page.navigate", { url });
  await sleep(4000);
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${prefix}-${name}.png`, Buffer.from(r.result.data, "base64"));
  console.log("saved", `${prefix}-${name}.png`);
};

await send("Page.enable");
await send("Runtime.enable");
const base = "http://localhost:3000";
for (const [name, p] of [
  ["welcome", "/"],
  ["journal", "/journal"],
  ["profile", "/profile"],
  ["reflection", "/reflection"],
  ["drafter", "/drafter"],
  ["settings", "/settings"],
  ["debug", "/debug"],
]) {
  await go(base + p);
  await shot(name);
  // Which elements actually scroll? More than one on a page means a double scrollbar.
  const sc = await run(`[...document.querySelectorAll("*")].filter(e => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1; }).map(e => e.tagName.toLowerCase() + "." + (e.className || "").toString().slice(0, 30))`);
  console.log("scrollers", name, JSON.stringify(sc.result?.result?.value));
  // Is the whole document taller than the window? If so, find what sticks out below it.
  const tall = await run(`(() => {
    const h = innerHeight, doc = document.documentElement.scrollHeight;
    const out = [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().bottom > h + 1 && getComputedStyle(e).position === "absolute").map(e => e.tagName.toLowerCase() + "." + (e.className || "").toString().slice(0, 25) + " bottom=" + Math.round(e.getBoundingClientRect().bottom));
    return { viewport: h, document: doc, absoluteBelow: out.slice(0, 5) };
  })()`);
  console.log("height", name, JSON.stringify(tall.result?.result?.value));
}
// ---- Journal sticky-note board: every interaction, with pass/fail checks ----
const setField = (sel, value) =>
  run(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
const clickText = (t) =>
  run(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(t)})?.click()`);
const val = async (expr) => (await run(expr)).result?.result?.value;
const check = (label, ok, detail = "") => console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? " (" + detail + ")" : ""}`);
const mouse = async (x, y) => {
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await sleep(350);
};
const press = async (key, code, vk) => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
  await sleep(350);
};
const NOTE_DIALOG = `document.querySelector('[role="dialog"][aria-labelledby="note-dialog-h"]')`;
const dialogOpen = () => val(`!!${NOTE_DIALOG}`);
const noteCount = () => val(`document.querySelectorAll("section ul li button").length`);
const noteTexts = () => val(`[...document.querySelectorAll("section ul li button")].map(b => b.innerText.replace(/\\s+/g, " ").trim())`);
const focusInDialog = () => val(`!!${NOTE_DIALOG}?.contains(document.activeElement)`);
const fillNote = async (mood, text, color) => {
  await run(`document.querySelector('input[name="mood"][value="${mood}"]').click()`);
  await setField("#entry-text", text);
  if (color) await run(`document.querySelector('input[name="note-color"][value="${color}"]').click()`);
};
const addNote = async (mood, text, color) => {
  await clickText("New note");
  await sleep(400);
  await fillNote(mood, text, color);
  await clickText("Save note");
  await sleep(700);
};

await go(base + "/journal");
await shot("board-empty");

// 1. Clicking empty board space opens the New note popup, with the cursor ready to type
await mouse(1000, 520);
check("empty-space click opens the popup", await dialogOpen());
check("heading says New note", (await val(`document.getElementById("note-dialog-h")?.textContent`)) === "New note");
check("focus starts in the text box", (await val(`document.activeElement?.id`)) === "entry-text");
await shot("note-new");
// 2. Tab never leaves the popup
let leaked = false;
for (let i = 0; i < 30; i++) {
  await press("Tab", "Tab", 9);
  if (!(await focusInDialog())) leaked = true;
}
check("30 Tab presses stay inside the popup", !leaked);
// 3. Empty popup: Esc closes it and focus returns to the New note button
await press("Escape", "Escape", 27);
check("Esc closes an empty popup", !(await dialogOpen()));
check("focus returns to the New note button", (await val(`document.activeElement?.textContent.trim()`)) === "New note");

// 4. Typed text is protected
await clickText("New note");
await sleep(400);
await fillNote(4, "Exam stress again. I keep comparing myself to everyone else.", "lilac");
check("picking a colour recolours the paper live", await val(`${NOTE_DIALOG}.className.includes("bg-note-lilac")`));
await shot("note-new-lilac");
await mouse(30, 400);
check("outside click is ignored once there is text", await dialogOpen());
await press("Escape", "Escape", 27);
check("Esc asks before discarding", (await val(`document.getElementById("confirm-title")?.textContent`)) === "Discard this note?");
await shot("note-discard");
await run(`[...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent.trim() === "Keep writing")?.click()`);
await sleep(400);
check("Keep writing returns to the popup", await dialogOpen());
check("what was typed is still there", (await val(`document.getElementById("entry-text").value`)).startsWith("Exam stress"));
check("focus is back inside the popup", await focusInDialog());

// 5. Save, then it appears on the board
await clickText("Save note");
await sleep(800);
check("popup closes after saving", !(await dialogOpen()));
check("the note is on the board", (await noteCount()) === 1, JSON.stringify(await noteTexts()));
await shot("note-saved");

await addNote(2, "Skipped lunch with friends. Felt like a burden and stayed in my room.");
await addNote(3, "Slept badly, group project is a mess, can't focus on anything.");
check("three notes on the board", (await noteCount()) === 3);
const classes = await val(`[...document.querySelectorAll("section ul li button")].map(b => [...b.classList].find(c => c.startsWith("bg-note-")))`);
check("notes have paper colours", classes.every(Boolean), JSON.stringify(classes));
await shot("journal-board");

// 6. Open, edit in place, save
await run(`[...document.querySelectorAll("section ul li button")].find(b => b.innerText.includes("Slept"))?.click()`);
await sleep(400);
check("clicking a note opens it", (await val(`document.getElementById("note-dialog-h")?.textContent`)).includes("Nov"));
await shot("note-view");
// There is no Edit button: the note opens with its words in a bordered box you just type in.
check("the note opens with its words in the text box", (await val(`document.getElementById("entry-text").value`)).startsWith("Slept badly"));
check("and shows its mood as text", (await val(`document.querySelector('[role="dialog"]')?.innerText`)).includes("Mood 3 of 10"));
check("Save changes only appears after a change", !(await val(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Save changes")`)));
await setField("#entry-text", "Slept badly, group project is a mess. Edited: talked to my TA.");
await clickText("Save changes");
await sleep(700);
check("edit saved on the board", (await noteTexts()).some((t) => t.includes("talked to my TA")));

// 7. Delete asks first
await run(`[...document.querySelectorAll("section ul li button")].find(b => b.innerText.includes("talked to my TA"))?.click()`);
await sleep(400);
await clickText("Delete note");
await sleep(400);
check("delete asks first", (await val(`document.getElementById("confirm-title")?.textContent`)) === "Delete this note?");
await run(`[...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent.trim() === "Delete")?.click()`);
await sleep(700);
check("note deleted", (await noteCount()) === 2);

// 8. Insights are still their own section: preview shows, nothing is sent
await run(`document.querySelector("main").scrollTo(0, 99999)`);
await sleep(300);
await shot("journal-insights");
await clickText("Get insights");
await sleep(4000);
await shot("insights-preview");
await run(`[...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(b => b.textContent.trim() === "Cancel")?.click()`);
await sleep(400);

// 9. The weekly reflection still sees the notes
await go(base + "/reflection");
await shot("reflection-journal");
console.log("reflection text:", JSON.stringify(await val(`document.body.innerText.match(/Ready:[^\\n]*/)?.[0]`)));

// Dark mode board
await run(`localStorage.setItem("haven.theme","dark")`);
await go(base + "/journal");
await shot("board-dark");
await clickText("New note");
await sleep(400);
await shot("note-dialog-dark");
await run(`localStorage.removeItem("haven.theme")`);

// 10. Crisis words in a note: support screen first, nothing saved
await go(base + "/journal");
await clickText("New note");
await sleep(400);
await fillNote(2, "I want to end my life");
await clickText("Save note");
await sleep(1200);
check("crisis words show the support screen", await val(`!!document.getElementById("crisis-title")`));
await shot("journal-crisis");
const rows = await val(`new Promise(res => { const r = indexedDB.open("haven"); r.onsuccess = () => { const q = r.result.transaction("journal").objectStore("journal").getAll(); q.onsuccess = () => res(q.result.map(e => e.text)); }; })`);
check("the crisis note was not saved", !rows.some((t) => t.includes("end my life")) && rows.length === 2, JSON.stringify(rows));
await run(`indexedDB.deleteDatabase("haven")`);
// Chat screen (cloud-only mode, so no on-device model is needed)
await go(base + "/");
// A scripted click is not a user gesture, so Chrome refuses the model download and the fallback appears.
await run(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Start chatting"))?.click()`);
await sleep(2500);
await run(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Continue with the cloud"))?.click()`);
await sleep(1500);
await shot("chat");
// What is the Next.js dev badge reporting? (dev-only overlay, lives in a shadow root)
await run(`document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("button")?.click()`);
await sleep(800);
const overlay = await run(
  `[...(document.querySelector("nextjs-portal")?.shadowRoot?.querySelectorAll("[data-nextjs-dialog-content], [role=dialog]") || [])].map(n => n.innerText).join("|").slice(0, 900)`,
);
console.log("dev overlay:", JSON.stringify(overlay.result?.result?.value));
// Crisis screen: a crisis phrase must show the support view and call no model
await run(`(() => {
  const t = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "I want to end my life");
  t.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await sleep(300);
await run(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Send")?.click()`);
await sleep(1500);
await shot("crisis");
// Dark mode, chosen manually
await run(`localStorage.setItem("haven.theme","dark")`);
await go(base + "/settings");
await shot("settings-dark");
await run(`localStorage.removeItem("haven.theme")`);
ws.close();
proc.kill();
process.exit(0);
