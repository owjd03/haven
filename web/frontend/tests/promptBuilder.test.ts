import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  countWords,
  exampleFor,
  FALLBACK_WORDS,
  HELP_INSTRUCTION,
  instructionFor,
  KEEP_RECENT,
  LISTEN_INSTRUCTION,
  LISTEN_INVITE_INSTRUCTION,
  lastTalkedLine,
  MAX_WORDS,
  OFFER_IDEAS_INSTRUCTION,
  reminderFor,
  SUMMARY_BATCH,
  SUMMARY_THRESHOLD,
  trimWords,
} from "../lib/promptBuilder";

const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

const sample = {
  profileFacts: ["Finals start next week"],
  summary: "Going on: finals next week\nFeeling: anxious",
  recent: [
    { role: "user" as const, content: "I can't focus" },
    { role: "assistant" as const, content: "That sounds hard." },
  ],
  cards: [{ title: "Longer breath out", text: "Breathe in for 4, out for 6." }],
  userMessage: "I'm panicking about my exam",
};

describe("prompt builder: structure (help mode)", () => {
  const prompt = buildPrompt({ ...sample, mode: "help" });

  it("contains each section in order, ending with the new message", () => {
    const order = [
      instructionFor("help"),
      "Example of the style only, not this person:",
      "Finals start next week",
      "Earlier conversation (summary):\nGoing on: finals next week",
      "Longer breath out: Breathe in for 4, out for 6.",
      "User: I can't focus",
      "Haven: That sounds hard.",
      "User: I'm panicking about my exam\n[Remember:",
    ];
    let at = -1;
    for (const part of order) {
      const i = prompt.indexOf(part);
      expect(i, part).toBeGreaterThan(at);
      at = i;
    }
    expect(prompt.endsWith("Haven:")).toBe(true);
  });

  it("omits empty sections", () => {
    const p = buildPrompt({ profileFacts: [], recent: [], cards: [], userMessage: "hi" });
    expect(p).not.toMatch(
      /Earlier conversation \(summary\)|Recent messages:|A gentle technique you may offer|shared about their life|You last talked/,
    );
    expect(p.endsWith("User: hi\n" + reminderFor("listen") + "\nHaven:")).toBe(true);
  });
});

describe("reply modes", () => {
  it("both modes carry the safety rules", () => {
    for (const mode of ["listen", "help"] as const) {
      const i = instructionFor(mode);
      expect(i).toMatch(/not a therapist/);
      expect(i).toMatch(/Never diagnose/);
      expect(i).toMatch(/medical advice/);
    }
  });

  it("listen: short, no advice, one question; help: asks what was tried, one idea, may suggest a counselor", () => {
    expect(LISTEN_INSTRUCTION).toMatch(/2 to 4 sentences/);
    expect(LISTEN_INSTRUCTION).toMatch(/No advice or techniques unless they ask/);
    expect(LISTEN_INSTRUCTION).toMatch(/one caring question/);
    expect(HELP_INSTRUCTION).toMatch(/4 to 6 sentences/);
    expect(HELP_INSTRUCTION).toMatch(/what they've tried/);
    expect(HELP_INSTRUCTION).toMatch(/one small, practical idea/);
    expect(HELP_INSTRUCTION).toMatch(/counselor or doctor/);
  });

  it("does not force 'many people feel this way' on any reply", () => {
    expect(instructionFor("listen")).not.toMatch(/many people/);
    expect(instructionFor("help")).not.toMatch(/many people/);
  });

  it("each mode's whole instruction stays short (small models follow short rules)", () => {
    expect(countWords(instructionFor("listen"))).toBeLessThanOrEqual(130);
    expect(countWords(instructionFor("help"))).toBeLessThanOrEqual(155);
    expect(countWords(instructionFor("listen", true))).toBeLessThanOrEqual(165);
  });

  it("listen is the default mode, and never includes coping cards", () => {
    const p = buildPrompt(sample);
    expect(p).toContain(instructionFor("listen"));
    expect(p).not.toContain("A gentle technique you may offer");
    expect(p).not.toContain("Longer breath out");
    expect(buildPrompt({ ...sample, mode: "listen" })).not.toContain("Longer breath out");
  });

  it("help mode includes the cards (at most two)", () => {
    const p = buildPrompt({
      ...sample,
      mode: "help",
      cards: [
        { title: "T1", text: "x" },
        { title: "T2", text: "x" },
        { title: "T3", text: "x" },
      ],
    });
    expect(p).toContain("A gentle technique you may offer");
    expect(p).toContain("T2");
    expect(p).not.toContain("T3");
  });

  it("the one-time offer is added to listen replies only", () => {
    expect(instructionFor("listen", true)).toContain(OFFER_IDEAS_INSTRUCTION.trim());
    expect(instructionFor("listen")).not.toContain(OFFER_IDEAS_INSTRUCTION.trim());
    expect(instructionFor("help", true)).not.toContain(OFFER_IDEAS_INSTRUCTION.trim());
    expect(buildPrompt({ ...sample, offerIdeas: true })).toContain(
      "whether they'd like some ideas",
    );
  });
});

describe("example and reminder", () => {
  it("each mode has its own labelled example, placed before the real conversation", () => {
    for (const mode of ["listen", "help"] as const) {
      const p = buildPrompt({ ...sample, mode });
      const ex = exampleFor(mode);
      expect(ex).toMatch(/^Example of the style only, not this person:/);
      expect(p).toContain(ex);
      expect(p.indexOf(ex)).toBeLessThan(p.indexOf("Finals start next week"));
      expect(p.indexOf(ex)).toBeLessThan(p.indexOf("Recent messages:"));
    }
    expect(exampleFor("listen")).not.toBe(exampleFor("help"));
  });

  it("the example is about something unlike real messages, so its details aren't copied", () => {
    expect(exampleFor("listen")).toMatch(/bus/);
    expect(exampleFor("help")).toMatch(/bus/);
  });

  it("the reminder sits right before 'Haven:', after the new message", () => {
    for (const mode of ["listen", "help"] as const) {
      const p = buildPrompt({ ...sample, mode });
      expect(p.endsWith(`${sample.userMessage}\n${reminderFor(mode)}\nHaven:`)).toBe(true);
    }
    expect(reminderFor("listen")).toMatch(
      /2 to 4 sentences.*no pet names.*no advice.*one question/,
    );
    expect(reminderFor("help")).toMatch(/4 to 6 sentences.*no pet names.*one idea.*one question/);
  });

  it("the example is dropped first when over budget, before any recent message", () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({
      role: "user" as const,
      content: `m${i} ${words(40)}`,
    }));
    const fits = buildPrompt({ ...sample, recent, mode: "listen", maxWords: 900 });
    expect(fits).toContain("Example of the style only");
    const base = buildPrompt({ ...sample, recent, mode: "listen", maxWords: 900 });
    // Squeeze until the example no longer fits, but every recent message still does.
    const need = countWords(base) - countWords(exampleFor("listen")) - 1;
    const tight = buildPrompt({
      ...sample,
      recent,
      mode: "listen",
      maxWords: countWords(base) - 5,
    });
    expect(countWords(tight)).toBeLessThanOrEqual(countWords(base) - 5);
    expect(tight).not.toContain("Example of the style only");
    expect(tight).toContain("m0 ");
    expect(need).toBeGreaterThan(0);
  });
});

describe("Listen alternates a question with an invitation", () => {
  it("the asking turn ends with one caring question; the other turn asks none and invites instead", () => {
    expect(instructionFor("listen", false, true)).toContain("End with one caring question.");
    const invite = instructionFor("listen", false, false);
    expect(invite).toContain("Do not ask a question this time.");
    expect(invite).toContain("inviting them to say more");
    expect(invite).not.toContain("End with one caring question.");
    expect(invite).toContain(LISTEN_INVITE_INSTRUCTION);
  });

  it("both turns keep the same rules, apart from the ending", () => {
    for (const askQuestion of [true, false]) {
      const i = instructionFor("listen", false, askQuestion);
      expect(i).toMatch(/2 to 4 sentences/);
      expect(i).toMatch(/No advice or techniques unless they ask/);
      expect(i).toMatch(/not a therapist/);
    }
  });

  it("the example and the reminder match the turn", () => {
    expect(exampleFor("listen", true)).toMatch(/What's been the hardest part so far\?$/);
    expect(exampleFor("listen", false)).toMatch(/I'm here if you want to tell me more\.$/);
    expect(exampleFor("listen", false)).not.toMatch(/\?$/);
    expect(reminderFor("listen", true)).toMatch(/one question\.\]$/);
    expect(reminderFor("listen", false)).toMatch(/no question this time\.\]$/);
  });

  it("buildPrompt uses the invitation versions when askQuestion is false", () => {
    const p = buildPrompt({ ...sample, mode: "listen", askQuestion: false });
    expect(p).toContain(LISTEN_INVITE_INSTRUCTION);
    expect(p).toContain(exampleFor("listen", false));
    expect(p.endsWith(`${reminderFor("listen", false)}\nHaven:`)).toBe(true);
    const asks = buildPrompt({ ...sample, mode: "listen" });
    expect(asks).toContain(LISTEN_INSTRUCTION);
    expect(asks.endsWith(`${reminderFor("listen", true)}\nHaven:`)).toBe(true);
  });

  it("Help mode is unchanged by it", () => {
    expect(instructionFor("help", false, false)).toBe(instructionFor("help", false, true));
    expect(exampleFor("help", false)).toBe(exampleFor("help", true));
  });
});

describe("notes are only mentioned when relevant", () => {
  it("both modes carry the rule", () => {
    for (const mode of ["listen", "help"] as const)
      expect(instructionFor(mode)).toMatch(
        /Mention their notes or earlier events only if their message is about them/,
      );
  });
  it("memory still works: the rule says to bring them up when they are relevant", () => {
    expect(instructionFor("listen")).toMatch(/bring it up instead of asking again/);
  });
});

describe("time awareness", () => {
  it("adds a 'last talked' line with the open threads only when given", () => {
    const p = buildPrompt({ ...sample, lastTalked: "3 days ago", openThreads: "exam on Friday" });
    expect(p).toContain("You last talked 3 days ago.");
    expect(p).toContain("exam on Friday");
    expect(p.indexOf("You last talked")).toBeGreaterThan(p.indexOf("Earlier conversation"));
    expect(p.indexOf("You last talked")).toBeLessThan(p.indexOf("Recent messages:"));
    expect(buildPrompt(sample)).not.toContain("You last talked");
  });

  it("lastTalkedLine is empty without a gap and never invents threads", () => {
    expect(lastTalkedLine()).toBe("");
    expect(lastTalkedLine("yesterday")).not.toMatch(/still open/);
  });
});

describe("prompt builder: length", () => {
  const huge = {
    profileFacts: Array.from({ length: 30 }, (_, i) => `fact ${i} ${words(20)}`),
    summary: words(500),
    recent: Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      content: words(200),
    })),
    cards: [
      { title: "A", text: words(50) },
      { title: "B", text: words(50) },
      { title: "C", text: words(50) },
    ],
    userMessage: words(1000),
    lastTalked: "3 days ago",
    openThreads: words(100),
  };

  it("uses a 900-word budget, 8 recent messages, and folds 8 at a time", () => {
    expect(MAX_WORDS).toBe(900);
    expect(KEEP_RECENT).toBe(8);
    expect(SUMMARY_BATCH).toBe(8);
    expect(SUMMARY_THRESHOLD).toBe(KEEP_RECENT + SUMMARY_BATCH);
  });

  it("stays within the word budget even with huge inputs, in both modes", () => {
    for (const mode of ["listen", "help"] as const)
      expect(countWords(buildPrompt({ ...huge, mode })), mode).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("the fallback budget is smaller and is honoured", () => {
    expect(FALLBACK_WORDS).toBeLessThan(MAX_WORDS);
    const p = buildPrompt({ ...huge, mode: "help", maxWords: FALLBACK_WORDS });
    expect(countWords(p)).toBeLessThanOrEqual(FALLBACK_WORDS);
  });

  it("keeps only the last eight messages", () => {
    const recent = Array.from({ length: 12 }, (_, i) => ({
      role: "user" as const,
      content: `message-${i}`,
    }));
    const p = buildPrompt({ profileFacts: [], recent, cards: [], userMessage: "now" });
    expect(p).not.toContain("message-3\n");
    expect(p).toContain(`message-${12 - KEEP_RECENT}`);
    expect(p).toContain("message-11");
  });

  it("keeps up to 80 words of each recent message", () => {
    const p = buildPrompt({
      profileFacts: [],
      recent: [{ role: "user", content: words(100, "alpha") }],
      cards: [],
      userMessage: "now",
    });
    expect(p).toContain(words(80, "alpha") + "…");
    expect(p).not.toContain(words(81, "alpha"));
  });

  it("drops the oldest recent messages first when over budget", () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({
      role: "user" as const,
      content: `m${i} ${words(79)}`,
    }));
    const p = buildPrompt({
      profileFacts: [],
      summary: words(100),
      recent,
      cards: [],
      userMessage: words(200),
      maxWords: 500,
    });
    expect(countWords(p)).toBeLessThanOrEqual(500);
    expect(p).toContain("User: " + words(200));
    expect(p).not.toContain("m0 ");
  });

  it("trimWords truncates with an ellipsis", () => {
    expect(trimWords("a b c d", 2)).toBe("a b…");
    expect(trimWords("a b", 5)).toBe("a b");
  });
});
