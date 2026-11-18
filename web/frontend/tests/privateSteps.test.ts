import { describe, expect, it } from "vitest";
import { matchPlanIdeas } from "@haven/backend";
import { parseSingleWeek, planFromWeeks, plainWeek, parseSavedPlan } from "../lib/plan";
import {
  PRIVATE_CLOSING,
  StoppedError,
  combineInstruction,
  ideasForWeek,
  sliceInstruction,
  sliceNotes,
  understand,
  weekInstruction,
  writePlan,
  type Generate,
} from "../lib/privateSteps";

const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

const WEEK = (n: number, theme = `theme ${n}`) =>
  `Week ${n}: ${theme}\n- Walk with a group: Join one. Why: It helps. First step: Look one up. How often: Weekly.\n- Evening wind-down: Keep a bedtime. Why: Sleep. First step: Pick a time. How often: Most nights.`;

describe("slicing the notes", () => {
  it("makes slices of about 400 words, keeps order, and loses nothing", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line${i} ${words(99)}`);
    const slices = sliceNotes(lines.join("\n"));
    expect(slices.length).toBe(3);
    for (const s of slices) expect(s.split(/\s+/).length).toBeLessThanOrEqual(400);
    expect(slices.join("\n")).toBe(lines.join("\n"));
  });

  it("keeps the About me block first", () => {
    const text = `About me (what they have said):\n- likes swimming\n\nMon: ${words(500)}`;
    expect(sliceNotes(text)[0].startsWith("About me")).toBe(true);
  });

  it("cuts one very long line by words rather than dropping it", () => {
    const slices = sliceNotes(words(1000));
    expect(slices.length).toBe(3);
    expect(slices.join(" ").split(/\s+/).length).toBe(1000);
  });

  it("gives nothing for no text", () => {
    expect(sliceNotes("  \n \n")).toEqual([]);
  });
});

describe("the instructions", () => {
  it("never contain the person's name or other words, only the notes slice itself in its own job", () => {
    const ins = combineInstruction(["Someone is stressed.", "They like walking."]);
    expect(ins).toContain("1. Someone is stressed.");
    expect(ins).toContain("without any names");
    expect(sliceInstruction("a note")).toContain("a note");
  });

  it("a week job names its week, its focus, the earlier themes and the rules", () => {
    const ins = weekInstruction({
      n: 3,
      summary: "Someone is stressed.",
      answersText: "Q: time?\nA: two hours",
      ideas: [],
      earlierThemes: ["Rebuild a routine", "Make room for people"],
    });
    expect(ins).toContain("Week 3:");
    expect(ins).toContain("week 1, Rebuild a routine; week 2, Make room for people");
    expect(ins).toContain("Do not repeat");
    expect(ins).toMatch(/never mention medication/i);
    expect(ins).toContain("Someone is stressed.");
    expect(ins).toContain("A: two hours");
  });

  it("week 1 has no earlier-weeks line", () => {
    expect(
      weekInstruction({ n: 1, summary: "s", answersText: "a", ideas: [], earlierThemes: [] }),
    ).not.toContain("earlier weeks");
  });

  it("gives each week a different handful of library ideas", () => {
    const ideas = matchPlanIdeas("breakup heartbroken ex lonely", 8);
    expect(ideas.length).toBe(8);
    const sets = [1, 2, 3, 4].map((n) =>
      ideasForWeek(ideas, n)
        .map((i) => i.id)
        .join(),
    );
    expect(new Set(sets).size).toBe(4);
    for (const n of [1, 2, 3, 4]) expect(ideasForWeek(ideas, n)).toHaveLength(3);
  });
});

describe("stage 1: understanding", () => {
  const notes = Array.from({ length: 10 }, (_, i) => `n${i} ${words(99)}`).join("\n");

  it("summarises each slice, joins them, then asks for questions", async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    const generate: Generate = async (prompt) => {
      calls.push(prompt);
      if (prompt.includes("Notes:")) return "They are under stress and walking helps.";
      if (prompt.includes("Summaries:")) return "Overall they are stressed; walking helps.";
      return "Questions:\n1. What do you enjoy?\n2. Who helps?\n3. What would you like more of?";
    };
    const r = await understand(notes, generate, { onProgress: (l) => progress.push(l) });
    expect(calls.filter((c) => c.includes("Notes:"))).toHaveLength(3);
    expect(calls.filter((c) => c.includes("Summaries:"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("Summary:\n"))).toHaveLength(1);
    expect(r.summary).toBe("Overall they are stressed; walking helps.");
    expect(r.questions).toHaveLength(3);
    expect(r.questionList).toHaveLength(5); // plus the two fixed questions
    expect(progress[0]).toBe("Reading your notes… (1 of 3)");
    expect(progress).toContain("Putting it together…");
    expect(progress).toContain("Thinking of questions…");
  });

  it("skips the combiner when there is only one slice", async () => {
    const calls: string[] = [];
    const generate: Generate = async (p) => {
      calls.push(p);
      return p.includes("Notes:")
        ? "They feel low."
        : "Questions:\n1. One thing?\n2. Another thing?";
    };
    const r = await understand("a short note", generate);
    expect(calls).toHaveLength(2);
    expect(r.summary).toBe("They feel low.");
  });

  it("makes no model call at all when there are no notes", async () => {
    let n = 0;
    const r = await understand("", async () => {
      n++;
      return "x";
    });
    expect(n).toBe(0);
    expect(r.summary).toBe("");
    expect(r.questionList.length).toBe(5);
  });

  it("retries a slice once, then carries on without it", async () => {
    let slice = 0;
    const generate: Generate = async (p) => {
      if (p.includes("Notes:")) {
        slice++;
        if (slice <= 2) return ""; // slice 1 fails twice
        return "They like swimming.";
      }
      if (p.includes("Summaries:")) return "joined";
      return "Questions:\n1. A question here?\n2. Another question?";
    };
    const r = await understand(notes, generate);
    expect(r.summary).toBe("joined");
    expect(slice).toBe(4); // 2 tries for slice 1, then slices 2 and 3 once each
  });

  it("throws when every slice fails", async () => {
    await expect(
      understand(notes, async () => {
        throw new Error("model gone");
      }),
    ).rejects.toThrow("model gone");
  });

  it("falls back to the generic questions when the model's questions can't be read", async () => {
    const generate: Generate = async (p) =>
      p.includes("Notes:") ? "They feel low." : "I am not sure what to ask.";
    const r = await understand("a short note", generate);
    expect(r.questions).toEqual([]);
    expect(r.questionList[0]).toBe("What has been going on for you lately?");
  });

  it("stops between jobs when told to", async () => {
    let stop = false;
    const generate: Generate = async () => {
      stop = true;
      return "A summary here.";
    };
    await expect(understand(notes, generate, { shouldStop: () => stop })).rejects.toBeInstanceOf(
      StoppedError,
    );
  });
});

describe("stage 3: the plan, week by week", () => {
  const input = {
    summary: "Someone is stressed.",
    answersText: "Q: time?\nA: two hours",
    matchText: "stress exam work",
  };

  it("writes 4 weeks in order, each seeing the earlier themes", async () => {
    const prompts: string[] = [];
    const generate: Generate = async (p) => {
      prompts.push(p);
      const n = prompts.length;
      return WEEK(n, `Theme number ${n}`);
    };
    const finished: number[] = [];
    const r = await writePlan(input, generate, { onWeek: (w) => finished.push(w.n) });
    expect(r.weeks.map((w) => w.n)).toEqual([1, 2, 3, 4]);
    expect(r.weeks.every((w) => w.activities.length === 2)).toBe(true);
    expect(finished).toEqual([1, 2, 3, 4]);
    expect(prompts[0]).not.toContain("earlier weeks");
    expect(prompts[3]).toContain(
      "week 1, Theme number 1; week 2, Theme number 2; week 3, Theme number 3",
    );
    expect(r.closing).toBe(PRIVATE_CLOSING);
    expect(r.ideas.length).toBeGreaterThan(0);
  });

  it("reports progress and streams the week being written", async () => {
    const progress: string[] = [];
    const partials: Array<[number, string]> = [];
    let n = 0;
    const generate: Generate = async (_p, onPartial) => {
      n++;
      onPartial?.("Week " + n + ": so far");
      return WEEK(n);
    };
    await writePlan(
      input,
      generate,
      { onPartial: (w, t) => partials.push([w, t]) },
      { onProgress: (l) => progress.push(l) },
    );
    expect(progress).toEqual([
      "Writing week 1 of 4…",
      "Writing week 2 of 4…",
      "Writing week 3 of 4…",
      "Writing week 4 of 4…",
    ]);
    expect(partials[0]).toEqual([1, "Week 1: so far"]);
  });

  it("retries a week that comes back wrong, once", async () => {
    let calls = 0;
    const generate: Generate = async () => {
      calls++;
      if (calls === 1) return "Sure! Here are some ideas for you to try.";
      return WEEK(1);
    };
    // The first week fails once then reads; later weeks read first time.
    const r = await writePlan(input, generate);
    expect(calls).toBe(5);
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[0].activities[0].title).toBe("Walk with a group");
  });

  it("keeps a week that still can't be read as plain text, and carries on", async () => {
    let calls = 0;
    const generate: Generate = async () => {
      calls++;
      if (calls === 3 || calls === 4) return "You could try slowing down a bit this week.";
      return WEEK(calls <= 2 ? calls : calls - 1);
    };
    const r = await writePlan(input, generate);
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[2].activities).toHaveLength(1);
    expect(r.weeks[2].activities[0].what).toBe("You could try slowing down a bit this week.");
    expect(r.weeks[2].n).toBe(3);
  });

  it("leaves out a week with no words, and fails if fewer than two weeks come out", async () => {
    let calls = 0;
    const emptyThenOk: Generate = async () => {
      calls++;
      return calls <= 2 ? "" : WEEK(calls);
    };
    const r = await writePlan(input, emptyThenOk);
    expect(r.weeks.map((w) => w.n)).toEqual([2, 3, 4]);
    await expect(
      writePlan(input, async () => {
        throw new Error("model gone");
      }),
    ).rejects.toThrow("model gone");
  });

  it("stops between weeks when told to, keeping what was finished off the result", async () => {
    let stop = false;
    const finished: number[] = [];
    const generate: Generate = async () => WEEK(finished.length + 1);
    await expect(
      writePlan(
        input,
        generate,
        {
          onWeek: (w) => {
            finished.push(w.n);
            if (w.n === 2) stop = true;
          },
        },
        { shouldStop: () => stop },
      ),
    ).rejects.toBeInstanceOf(StoppedError);
    expect(finished).toEqual([1, 2]);
  });

  it("never sends the person's notes or answers anywhere but into the on-device prompt", async () => {
    // The chain only calls `generate`; there is nothing else to call, so there is no network path.
    const seen: string[] = [];
    await writePlan(input, async (p) => {
      seen.push(p);
      return WEEK(seen.length);
    });
    expect(seen.every((p) => p.includes("A: two hours"))).toBe(true);
  });
});

describe("saving a plan written week by week", () => {
  const week = parseSingleWeek(WEEK(1), 1)!;
  const meta = {
    madeAt: 1,
    days: 7 as const,
    sources: { journal: true, chats: true, aboutMe: false },
    lowMood: false,
  };

  it("reads a single week, numbering it as asked", () => {
    expect(week.theme).toBe("theme 1");
    expect(parseSingleWeek(WEEK(1), 3)!.n).toBe(3);
    expect(parseSingleWeek("just some words", 1)).toBeNull();
  });

  it("round-trips through the saved-plan check with its mode", () => {
    const plan = planFromWeeks(
      [1, 2, 3, 4].map((n) => ({ ...week, n })),
      PRIVATE_CLOSING,
      { ...meta, basedOn: ["NHS", "NHS"], mode: "private" },
    );
    const back = parseSavedPlan(JSON.parse(JSON.stringify(plan)));
    expect(back).not.toBeNull();
    expect(back!.mode).toBe("private");
    expect(back!.weeks).toHaveLength(4);
    expect(back!.basedOn).toEqual(["NHS"]);
  });

  it("a plain-text week passes the saved-plan check and fits a backup", () => {
    const w = plainWeek(2, "x ".repeat(500))!;
    expect(w.activities[0].what.length).toBeLessThanOrEqual(240);
    const plan = planFromWeeks([week, w, { ...week, n: 3 }], "c", { ...meta, mode: "private" });
    expect(parseSavedPlan(JSON.parse(JSON.stringify(plan)))).not.toBeNull();
    expect(JSON.stringify(plan).length).toBeLessThan(20000);
    expect(plainWeek(1, "   ")).toBeNull();
  });
});
