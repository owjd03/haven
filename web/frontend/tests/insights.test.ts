import { retrieve } from "@haven/backend";
import { describe, expect, it } from "vitest";
import {
  buildInsights,
  INSIGHTS_MAX_WORDS,
  insightsInstruction,
  JOURNAL_SHARE,
  listInsightItems,
  meterInfo,
  orderForDisplay,
  showsLowMoodNote,
  type InsightSources,
} from "../lib/insights";
import { countWords } from "../lib/promptBuilder";
import type { ChatMessage, JournalEntry, SummaryRecord } from "../lib/types";

const at = (day: number) => new Date(2026, 10, day, 12).getTime(); // Nov <day>, local noon
let id = 1;
const journal = (day: number, over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: id++,
  day: `2026-11-${String(day).padStart(2, "0")}`,
  mood: 5,
  text: "A journal note.",
  createdAt: at(day) + id,
  updatedAt: at(day) + id,
  ...over,
});
const summary = (day: number, text = "Going on: exams"): SummaryRecord => ({
  id: id++,
  createdAt: at(day),
  text,
  upToMessageId: id,
});
const userMsg = (day: number, content: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: id++,
  role: "user",
  content,
  ts: at(day) + id,
  summarized: false,
  ...over,
});
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");
const BOTH: InsightSources = { journal: true, chats: true };
const JOURNAL: InsightSources = { journal: true, chats: false };
const CHATS: InsightSources = { journal: false, chats: true };
const none = { journal: [], summaries: [], messages: [] };

describe("Insights: gathering", () => {
  it("gives empty text when there is nothing to send", () => {
    const g = buildInsights({ sources: BOTH, ...none });
    expect(g).toMatchObject({
      text: "",
      days: 0,
      journalEntries: 0,
      chatDays: 0,
      averageMood: null,
    });
  });

  it("groups the same day's journal and chat together, oldest day first", () => {
    const g = buildInsights({
      sources: BOTH,
      journal: [journal(14, { mood: 3, text: "Rough day." }), journal(12, { text: "Calm." })],
      summaries: [],
      messages: [userMsg(14, "exam tomorrow"), userMsg(13, "can't sleep")],
    });
    expect(g.text.indexOf("Calm.")).toBeLessThan(g.text.indexOf("can't sleep"));
    expect(g.text.indexOf("can't sleep")).toBeLessThan(g.text.indexOf("Rough day."));
    const day14 = g.text.split("\n\n").find((d) => d.includes("Rough day."))!;
    expect(day14).toContain("Journal (mood 3 of 10): Rough day.");
    expect(day14).toContain("Chat: exam tomorrow");
    expect(g).toMatchObject({ days: 3, journalEntries: 2, chatDays: 2 });
  });

  it("uses only the chosen sources", () => {
    const input = {
      journal: [journal(14, { text: "In my journal." })],
      summaries: [summary(14)],
      messages: [userMsg(14, "In my chat.")],
    };
    const j = buildInsights({ sources: JOURNAL, ...input });
    expect(j.text).toContain("In my journal.");
    expect(j.text).not.toMatch(/In my chat|Chat summary/);
    const c = buildInsights({ sources: CHATS, ...input });
    expect(c.text).toContain("In my chat.");
    expect(c.text).not.toContain("In my journal.");
    expect(c.averageMood).toBeNull();
  });

  it("only sends the person's own messages, never Haven's or summarized ones", () => {
    const g = buildInsights({
      sources: CHATS,
      journal: [],
      summaries: [],
      messages: [
        userMsg(14, "mine"),
        { ...userMsg(14, "haven said this"), role: "assistant" },
        userMsg(14, "already summarized", { summarized: true }),
        ...Array.from({ length: 8 }, (_, i) => userMsg(15, `msg${i}`)),
      ],
    });
    expect(g.text).toContain("Chat: mine");
    expect(g.text).not.toMatch(/haven said this|already summarized/);
    // The budget decides how many fit, not a per-day cap.
    expect(g.text).toContain("msg7");
  });

  it("puts chat summaries before messages when the budget is tight", () => {
    const g = buildInsights({
      sources: CHATS,
      journal: [],
      summaries: Array.from({ length: 20 }, (_, i) => summary(i + 1, `summary${i} ${words(30)}`)),
      messages: Array.from({ length: 20 }, (_, i) => userMsg(i + 1, `message${i} ${words(30)}`)),
    });
    expect(countWords(g.text)).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS + 60);
    const summariesKept = (g.text.match(/Chat summary:/g) ?? []).length;
    const messagesKept = (g.text.match(/Chat: message/g) ?? []).length;
    expect(summariesKept).toBe(20);
    expect(messagesKept).toBeLessThan(20);
  });

  it("splits the budget 60/40 when both sources have something, and keeps the newest", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      journal(i + 1, { text: `entry${i + 1} ${words(70)}` }),
    );
    const g = buildInsights({
      sources: BOTH,
      journal: entries,
      summaries: [],
      messages: Array.from({ length: 30 }, (_, i) => userMsg(i + 1, `chat${i} ${words(35)}`)),
    });
    expect(countWords(g.text)).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS + 60);
    const journalWords = countWords(
      g.text
        .split("\n")
        .filter((l) => l.startsWith("Journal"))
        .join(" "),
    );
    expect(journalWords).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS * JOURNAL_SHARE);
    expect(g.chatDays).toBeGreaterThan(0);
    expect(g.journalEntries).toBeLessThan(g.journalInRange);
    expect(g.text).toContain("entry30 ");
    expect(g.text).not.toContain("entry1 ");
  });

  it("gives the journal the whole budget when chats are off or empty", () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      journal(i + 1, { text: words(70, `e${i}`) }),
    );
    const g = buildInsights({ sources: JOURNAL, ...none, journal: entries });
    expect(g.journalEntries).toBeGreaterThanOrEqual(10);
    expect(countWords(g.text)).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS + 60);
  });

  it("keeps each journal entry to 80 words", () => {
    const g = buildInsights({
      sources: JOURNAL,
      ...none,
      journal: [journal(14, { text: words(200) })],
    });
    expect(g.text).toContain(words(80) + "…");
    expect(g.text).not.toContain(words(81));
  });
});

describe("Insights: crisis entries never go to the cloud", () => {
  const crisis = "I want to end my life";

  it("leaves flagged entries out of the text and counts them", () => {
    const g = buildInsights({
      sources: BOTH,
      ...none,
      journal: [
        journal(14, { text: "Fine, a bit tired." }),
        journal(14, { text: crisis, crisisFlag: true }),
        journal(13, { text: crisis }),
      ],
    });
    expect(g.journalEntries).toBe(1);
    expect(g.excluded).toBe(2);
    expect(g.text).toContain("a bit tired");
    expect(g.text.toLowerCase()).not.toContain("end my life");
  });

  it("sends nothing when every entry is flagged, and flagged moods don't count", () => {
    const g = buildInsights({
      sources: JOURNAL,
      ...none,
      journal: [journal(14, { crisisFlag: true })],
    });
    expect(g.text).toBe("");
    expect(g.averageMood).toBeNull();
    const h = buildInsights({
      sources: JOURNAL,
      ...none,
      journal: [journal(14, { mood: 8 }), journal(13, { mood: 2, text: crisis, crisisFlag: true })],
    });
    expect(h.averageMood).toBe(8);
  });

  it("counts no exclusions when the journal isn't chosen", () => {
    const g = buildInsights({
      sources: CHATS,
      ...none,
      journal: [journal(14, { crisisFlag: true })],
    });
    expect(g.excluded).toBe(0);
  });
});

describe("Insights: low mood note (plain code, no model)", () => {
  it("averages the person's own ratings to one decimal", () => {
    const g = buildInsights({
      sources: JOURNAL,
      ...none,
      journal: [journal(1, { mood: 3 }), journal(2, { mood: 4 }), journal(3, { mood: 4 })],
    });
    expect(g.averageMood).toBe(3.7);
  });
  it("shows for a low average over at least two entries", () => {
    expect(showsLowMoodNote({ averageMood: 3, journalInRange: 2 })).toBe(true);
    expect(showsLowMoodNote({ averageMood: 2.1, journalInRange: 5 })).toBe(true);
  });
  it("does not show for one bad day, an ok average, or no ratings (journal off)", () => {
    expect(showsLowMoodNote({ averageMood: 2, journalInRange: 1 })).toBe(false);
    expect(showsLowMoodNote({ averageMood: 3.1, journalInRange: 4 })).toBe(false);
    expect(showsLowMoodNote({ averageMood: null, journalInRange: 0 })).toBe(false);
    const chatsOnly = buildInsights({
      sources: CHATS,
      ...none,
      journal: [journal(1, { mood: 1 }), journal(2, { mood: 1 })],
    });
    expect(showsLowMoodNote(chatsOnly)).toBe(false);
  });
});

describe("Insights: instruction", () => {
  const text = "Exam stress again. I keep panicking before tests and can't sleep.";

  it("never contains the person's own words", () => {
    expect(insightsInstruction(text, BOTH)).not.toContain("panicking before tests");
  });
  it("says what was sent", () => {
    expect(insightsInstruction(text, BOTH)).toMatch(/their chats with Haven and their journal/);
    expect(insightsInstruction(text, JOURNAL)).toMatch(/notes from their journal,/);
    expect(insightsInstruction(text, CHATS)).toMatch(/notes from their chats with Haven,/);
  });
  it("mentions the 1 to 10 rating only when the journal is included", () => {
    expect(insightsInstruction(text, JOURNAL)).toMatch(/their own number, not a measurement/);
    expect(insightsInstruction(text, CHATS)).not.toMatch(/rating/);
  });
  it("keeps the safety lines and covers hard days, themes and suggestions", () => {
    for (const s of [BOTH, JOURNAL, CHATS]) {
      const i = insightsInstruction(text, s);
      expect(i).toMatch(/Never diagnose/);
      expect(i).toMatch(/medical advice/);
      expect(i).toMatch(/streaks or missed days/);
      expect(i).toMatch(/hardest/);
      expect(i).toMatch(/themes/);
      expect(i).toMatch(/two or three small/);
    }
  });
  it("adds relevant coping techniques only when retrieval finds some", () => {
    expect(retrieve(text, 2).length, "sample text should match a card").toBeGreaterThan(0);
    expect(insightsInstruction(text, BOTH)).toContain("gentle techniques");
    expect(insightsInstruction("zzqx vlorp", BOTH)).not.toContain("gentle techniques");
  });
});

describe("Insights: choosing what to send", () => {
  const input = {
    sources: BOTH,
    journal: [
      journal(14, { mood: 3, text: "Rough day at school." }),
      journal(13, { mood: 6, text: "Calm walk with a friend." }),
      journal(12, { text: "I want to end my life", crisisFlag: true }),
    ],
    summaries: [summary(10, "Going on: exams")],
    messages: [
      userMsg(14, "exam tomorrow"),
      userMsg(13, "can't sleep"),
      { ...userMsg(13, "haven reply"), role: "assistant" as const },
      userMsg(11, "old but unsummarized", { summarized: true }),
    ],
  };
  const items = listInsightItems(input);
  const idOf = (needle: string) => items.find((i) => i.full.includes(needle))!.id;

  it("lists notes, summaries and the person's own messages, newest day first, never Haven's", () => {
    expect(items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["journal", "summary", "message"]),
    );
    expect(items.map((i) => i.day)).toEqual([...items.map((i) => i.day)].sort().reverse());
    expect(items.some((i) => i.full.includes("haven reply"))).toBe(false);
    expect(items.some((i) => i.full.includes("old but unsummarized"))).toBe(false);
    expect(items.filter((i) => i.kind === "message")).toHaveLength(2);
  });

  it("gives journal rows their mood and colour, and a short preview", () => {
    const note = items.find((i) => i.full.includes("Rough day"))!;
    expect(note.mood).toBe(3);
    expect(note.color).toBeTruthy();
    const long = listInsightItems({
      ...input,
      journal: [journal(14, { text: words(40, "w") })],
    })[0];
    expect(long.preview).toBe(words(30, "w") + "…");
    expect(long.full).toBe(words(40, "w"));
  });

  it("locks crisis notes: no text anywhere, never selectable", () => {
    const locked = items.find((i) => i.locked)!;
    expect(locked).toMatchObject({ kind: "journal", preview: "", full: "", sent: "" });
    const all = new Set(items.map((i) => i.id));
    expect(buildInsights(input, all).text.toLowerCase()).not.toContain("end my life");
    expect(JSON.stringify(locked).toLowerCase()).not.toContain("end my life");
  });

  it("has stable ids", () => {
    expect(listInsightItems(input).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("flags items longer than what is sent, with the limit that applies", () => {
    const long = listInsightItems({
      ...input,
      journal: [journal(14, { text: words(100) })],
      messages: [userMsg(14, words(60))],
    });
    const note = long.find((i) => i.kind === "journal")!;
    const msg = long.find((i) => i.kind === "message")!;
    expect(note).toMatchObject({ truncated: true, limitWords: 80 });
    expect(msg).toMatchObject({ truncated: true, limitWords: 40 });
    expect(items.find((i) => i.full.includes("exam tomorrow"))!.truncated).toBe(false);
  });

  it("with no selection given, everything is ticked (same as before)", () => {
    const all = buildInsights(input);
    const explicit = buildInsights(input, new Set(items.map((i) => i.id)));
    expect(all).toEqual(explicit);
    expect(all.text).toMatch(/Rough day at school[\s\S]*|exam tomorrow/);
  });

  it("unticked items never appear in the text", () => {
    const g = buildInsights(input, new Set([idOf("Rough day"), idOf("exam tomorrow")]));
    expect(g.text).toContain("Rough day at school.");
    expect(g.text).toContain("exam tomorrow");
    expect(g.text).not.toMatch(/Calm walk|can't sleep|exams/);
    expect(g.journalEntries).toBe(1);
  });

  it("nothing ticked sends nothing", () => {
    const g = buildInsights(input, new Set());
    expect(g).toMatchObject({ text: "", days: 0, journalEntries: 0, chatDays: 0, words: 0 });
    expect(g.selectedWords).toBe(0);
  });

  it("the low-mood numbers ignore the selection", () => {
    const g = buildInsights(input, new Set([idOf("exam tomorrow")]));
    expect(g.journalEntries).toBe(0);
    expect(g.journalInRange).toBe(2);
    expect(g.averageMood).toBe(4.5);
    expect(g.excluded).toBe(1);
  });

  it("counts words: ticked words, and the words that will really be sent", () => {
    const small = buildInsights(input);
    expect(small.words).toBe(small.selectedWords);
    expect(small.words).toBeGreaterThan(0);
    expect(small.wontFit).toEqual([]);
  });

  it("over the budget, the newest ticked items are kept and the oldest are reported as won't fit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      journal(i + 1, { text: `entry${i + 1} ${words(70)}` }),
    );
    const big = { sources: JOURNAL, ...none, journal: many };
    const g = buildInsights(big);
    expect(g.wontFit.length).toBeGreaterThan(0);
    expect(g.words).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS);
    expect(g.selectedWords).toBeGreaterThan(INSIGHTS_MAX_WORDS);
    expect(g.text).toContain("entry30 ");
    const dropped = listInsightItems(big).filter((i) => g.wontFit.includes(i.id));
    expect(dropped.every((i) => !g.text.includes(i.full.split(" ")[0] + " "))).toBe(true);
    expect(dropped.map((i) => i.day).sort()[0]).toBe("2026-11-01");
    // Unticking some makes room for what didn't fit.
    const fewer = new Set(
      listInsightItems(big)
        .slice(0, 8)
        .map((i) => i.id),
    );
    expect(buildInsights(big, fewer).wontFit).toEqual([]);
  });

  it("keeps the 60/40 split with a selection, and summaries before messages", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      journal(i + 1, { text: `entry${i + 1} ${words(70)}` }),
    );
    const g = buildInsights({
      sources: BOTH,
      journal: entries,
      summaries: Array.from({ length: 10 }, (_, i) => summary(i + 1, `sum${i} ${words(40)}`)),
      messages: Array.from({ length: 30 }, (_, i) => userMsg(i + 1, `chat${i} ${words(35)}`)),
    });
    const journalWords = countWords(
      g.text
        .split("\n")
        .filter((l) => l.startsWith("Journal"))
        .join(" "),
    );
    expect(journalWords).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS * JOURNAL_SHARE);
    const summariesKept = (g.text.match(/Chat summary:/g) ?? []).length;
    const messagesKept = (g.text.match(/Chat: chat/g) ?? []).length;
    expect(summariesKept).toBeGreaterThan(0);
    // Messages only get room once every summary is in.
    if (messagesKept > 0) expect(summariesKept).toBe(10);
    if (summariesKept < 10) expect(messagesKept).toBe(0);
    expect(g.words).toBeLessThanOrEqual(INSIGHTS_MAX_WORDS);
  });

  it("always keeps the first ticked item, even one longer than the budget share", () => {
    const g = buildInsights(
      { sources: JOURNAL, ...none, journal: [journal(14, { text: words(200) })] },
      undefined,
    );
    expect(g.journalEntries).toBe(1);
    expect(g.wontFit).toEqual([]);
  });
});

describe("Insights: word meter", () => {
  const g = (selectedWords: number, wontFit: string[] = [], excluded = 0) => ({
    selectedWords,
    wontFit,
    excluded,
  });

  it("shows the words as text, and how full the bar is", () => {
    expect(meterInfo(g(450))).toMatchObject({
      label: "450 of 900 words",
      percent: 50,
      over: false,
    });
    expect(meterInfo(g(0))).toMatchObject({
      label: "0 of 900 words",
      percent: 0,
      over: false,
      notes: [],
    });
    expect(meterInfo(g(900))).toMatchObject({ percent: 100, over: false });
  });

  it("is full and marked over when something won't fit, and says so in words", () => {
    const m = meterInfo(g(1300, ["j:1", "j:2"]));
    expect(m.percent).toBe(100);
    expect(m.over).toBe(true);
    expect(m.notes[0]).toMatch(/2 selected items won't fit and will not be sent/);
    expect(m.notes[0]).toMatch(/Select fewer to make room/);
    expect(meterInfo(g(1000, ["j:1"])).notes[0]).toMatch(/^1 selected item won't fit/);
  });

  it("says how many journal entries were left out for crisis language", () => {
    expect(meterInfo(g(100, [], 1)).notes).toEqual([
      "1 journal entry was left out and is never sent to any AI.",
    ]);
    expect(meterInfo(g(100, [], 3)).notes[0]).toMatch(
      /^3 journal entries were left out and are never sent/,
    );
  });

  it("lists both notes when both apply, and never goes above 100%", () => {
    const m = meterInfo(g(5000, ["j:1"], 2));
    expect(m.notes).toHaveLength(2);
    expect(m.percent).toBe(100);
  });
});

describe("Insights: display order", () => {
  it("orders newest day first, with a chat summary leading its day", () => {
    const items = listInsightItems({
      sources: CHATS,
      journal: [],
      summaries: [summary(14, "Going on: finals")],
      messages: [userMsg(14, "first message"), userMsg(13, "second message")],
    });
    const order = orderForDisplay(items);
    expect(order.map((i) => i.kind)).toEqual(["summary", "message", "message"]);
    const days = order.map((i) => i.day);
    expect(days).toEqual([...days].sort().reverse());
  });
});
