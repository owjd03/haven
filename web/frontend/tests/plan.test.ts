import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeSources,
  makeSavedPlan,
  parseSavedPlan,
  parseSteps,
  parseWeeks,
  type PlanSources,
} from "../lib/plan";
import { deletePlan, getPlan, getStepsChoices, savePlan, saveStepsChoices } from "../lib/storage";

const ALL: PlanSources = { journal: true, chats: true, aboutMe: true };
const REPLY = [
  "1. Take a ten minute walk after class, since walking with your friend helped.",
  "2. Keep one evening a week free to see someone you like.",
  "3. Have a glass of water and something to eat before you start studying.",
  "",
  "If things feel heavier, talking to someone you trust or a counselor is an option.",
].join("\n");

describe("parsing a reply into steps", () => {
  it("reads three numbered steps and the closing line", () => {
    const p = parseSteps(REPLY)!;
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0]).toBe(
      "Take a ten minute walk after class, since walking with your friend helped.",
    );
    expect(p.closing).toBe(
      "If things feel heavier, talking to someone you trust or a counselor is an option.",
    );
  });

  it("drops an introduction before the first step", () => {
    const p = parseSteps("Here are three small steps for your week:\n\n" + REPLY)!;
    expect(p.steps).toHaveLength(3);
    expect(p.steps.join(" ")).not.toMatch(/Here are/);
  });

  it("accepts '1)' numbering, bold markers and bullets", () => {
    const p = parseSteps("- **1.** Walk outside.\n2) Drink water.\n* 3. Rest early.")!;
    expect(p.steps).toEqual(["Walk outside.", "Drink water.", "Rest early."]);
  });

  it("joins a step that wraps onto the next line", () => {
    const p = parseSteps("1. Take a short walk\nafter class.\n2. Drink water.\n3. Rest.")!;
    expect(p.steps[0]).toBe("Take a short walk after class.");
  });

  it("keeps only the first three steps if there are more", () => {
    const p = parseSteps("1. a\n2. b\n3. c\n4. d\n5. e")!;
    expect(p.steps).toEqual(["a", "b", "c"]);
  });

  it("copes with no closing line", () => {
    expect(parseSteps("1. Walk.\n2. Rest.\n3. Water.")!.closing).toBe("");
  });

  it("returns null when it isn't steps, so the reply can be shown as plain text", () => {
    expect(parseSteps("You could try to rest more this week and see friends.")).toBeNull();
    expect(parseSteps("1. Only one step here.")).toBeNull();
    expect(parseSteps("")).toBeNull();
  });
});

describe("a saved plan", () => {
  const meta = { madeAt: 1_800_000_000_000, days: 7 as const, sources: ALL, lowMood: false };

  it("keeps the steps, the closing line and when it was made", () => {
    const p = makeSavedPlan(REPLY, meta);
    expect(p.steps).toHaveLength(3);
    expect(p.closing).toMatch(/counselor/);
    expect(p).toMatchObject(meta);
  });

  it("keeps a reply that isn't steps as plain text", () => {
    const p = makeSavedPlan("Rest more and see friends this week.", meta);
    expect(p.steps).toEqual([]);
    expect(p.text).toBe("Rest more and see friends this week.");
  });

  it("caps long text so a plan always fits in a backup", () => {
    const long = Array.from({ length: 3 }, (_, i) => `${i + 1}. ${"word ".repeat(300)}`).join("\n");
    const p = makeSavedPlan(long + "\n\n" + "closing ".repeat(300), meta);
    expect(JSON.stringify(p).length).toBeLessThan(20000);
    expect(parseSavedPlan(JSON.parse(JSON.stringify(p)))).not.toBeNull();
  });

  it("round-trips through JSON", () => {
    const p = makeSavedPlan(REPLY, meta);
    expect(parseSavedPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("rejects anything that isn't a valid plan, without crashing", () => {
    const good = makeSavedPlan(REPLY, meta);
    for (const bad of [
      null,
      undefined,
      5,
      "text",
      [],
      {},
      { ...good, days: 14 },
      { ...good, madeAt: "yesterday" },
      { ...good, steps: ["a", "b", "c", "d"] },
      { ...good, steps: [1, 2] },
      { ...good, sources: { journal: true } },
      { ...good, lowMood: "no" },
      { ...good, text: "", steps: [] },
      { ...good, text: "x".repeat(7000) },
    ])
      expect(parseSavedPlan(bad), JSON.stringify(bad)?.slice(0, 40)).toBeNull();
  });

  it("describes what it was made from", () => {
    expect(describeSources(ALL)).toBe("your journal, chats and About me notes");
    expect(describeSources({ journal: true, chats: false, aboutMe: true })).toBe(
      "your journal and About me notes",
    );
    expect(describeSources({ journal: false, chats: true, aboutMe: false })).toBe("your chats");
  });
});

/** A tiny stand-in for the browser's localStorage. */
function fakeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("the plan on this device", () => {
  let fake: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    fake = fakeStorage();
    vi.stubGlobal("window", { localStorage: fake.localStorage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts with no plan", () => {
    expect(getPlan()).toBeNull();
  });

  it("saves a plan and reads it back", () => {
    const saved = savePlan(REPLY, { days: 30, sources: ALL, lowMood: true }, 1234);
    expect(getPlan()).toEqual(saved);
    expect(getPlan()).toMatchObject({ madeAt: 1234, days: 30, lowMood: true });
  });

  it("a new plan replaces the old one", () => {
    savePlan(REPLY, { days: 7, sources: ALL, lowMood: false }, 1);
    savePlan("1. Rest.\n2. Walk.", { days: 7, sources: ALL, lowMood: false }, 2);
    expect(getPlan()?.madeAt).toBe(2);
    expect(getPlan()?.steps).toEqual(["Rest.", "Walk."]);
  });

  it("deleting removes it", () => {
    savePlan(REPLY, { days: 7, sources: ALL, lowMood: false });
    deletePlan();
    expect(getPlan()).toBeNull();
    expect(fake.store.has("haven.plan")).toBe(false);
  });

  it("ignores a stored plan that is damaged", () => {
    fake.store.set("haven.plan", "{not json");
    expect(getPlan()).toBeNull();
    fake.store.set("haven.plan", JSON.stringify({ steps: "no" }));
    expect(getPlan()).toBeNull();
  });

  it("a steps plan stays under the backup limit for a setting", () => {
    savePlan("1. " + "a ".repeat(400) + "\n2. " + "b ".repeat(400) + "\n3. " + "c ".repeat(400), {
      days: 7,
      sources: ALL,
      lowMood: false,
    });
    expect(fake.store.get("haven.plan")!.length).toBeLessThan(20000);
  });

  it("remembers the choices, and never lets every source be off", () => {
    expect(getStepsChoices()).toEqual({
      days: 7,
      journal: true,
      chats: true,
      aboutMe: true,
      mode: "private",
    });
    saveStepsChoices({ days: 30, journal: false, chats: true, aboutMe: false, mode: "cloud" });
    expect(getStepsChoices()).toEqual({
      days: 30,
      journal: false,
      chats: true,
      aboutMe: false,
      mode: "cloud",
    });
    fake.store.set(
      "haven.stepsChoices",
      JSON.stringify({ days: 30, journal: false, chats: false, aboutMe: false, mode: "cloud" }),
    );
    expect(getStepsChoices()).toEqual({
      days: 7,
      journal: true,
      chats: true,
      aboutMe: true,
      mode: "cloud",
    });
    fake.store.set("haven.stepsChoices", "nonsense");
    expect(getStepsChoices().journal).toBe(true);
    expect(getStepsChoices().mode).toBe("private");
  });

  it("keeps the mode a plan was written in, and reads old plans as having none", () => {
    const meta = { days: 7 as const, sources: ALL, lowMood: false };
    const priv = savePlan(REPLY, { ...meta, mode: "private" });
    expect(getPlan()?.mode).toBe("private");
    expect(priv.mode).toBe("private");
    savePlan(REPLY, meta);
    expect(getPlan()?.mode).toBeUndefined();
    fake.store.set(
      "haven.plan",
      JSON.stringify({ ...JSON.parse(fake.store.get("haven.plan")!), mode: "bogus" }),
    );
    expect(getPlan()).toBeNull();
  });
});

const WEEKS = [
  "Here is a plan for the next four weeks:",
  "",
  "Week 1: Rebuild a routine",
  "- Weekly walk with a group: Join a free walking group near you. Why: Regular movement with others lifts your mood. First step: Look up one group this week. How often: Once a week.",
  "- Evening wind-down: Keep a steady bedtime on weekdays. Why: You said sleep has been hard. First step: Pick a time tonight. How often: Most nights.",
  "",
  "Week 2: Make room for people",
  "- Standing coffee with a friend: Pick one friend and a regular slot. Why: You said talking helps. First step: Send one message. How often: Every other week.",
  "- Volunteer: Try a local volunteering role. Why: It gives you purpose. First step: Search a listing site. How often: Twice a month.",
  "",
  "Week 3: Try something new",
  "- Beginner class: Sign up for a short class in something you have wanted to try. Why: New skills build confidence. First step: Browse local classes. How often: Weekly.",
  "- Creative hour: Draw or write once a week. Why: It gives feelings somewhere to go. First step: Set a time. How often: Weekly.",
  "",
  "Week 4: Keep what works",
  "- Review your week: Spend ten minutes choosing what to keep. Why: It helps habits last. First step: Put it in your calendar. How often: Weekly.",
  "- Plan something to look forward to: Book one outing. Why: It gives you something ahead. First step: Choose a date. How often: Once.",
  "",
  "Closing: If after a couple of weeks things feel the same or heavier, it is worth talking to a counselor or doctor.",
].join("\n");

describe("parsing a 4-week plan", () => {
  it("reads four weeks, their themes and their activities", () => {
    const p = parseWeeks(WEEKS)!;
    expect(p.weeks.map((w) => w.n)).toEqual([1, 2, 3, 4]);
    expect(p.weeks.map((w) => w.theme)).toEqual([
      "Rebuild a routine",
      "Make room for people",
      "Try something new",
      "Keep what works",
    ]);
    expect(p.weeks.every((w) => w.activities.length === 2)).toBe(true);
  });

  it("splits an activity into its title, what it is, why, a first step and how often", () => {
    const a = parseWeeks(WEEKS)!.weeks[0].activities[0];
    expect(a).toEqual({
      title: "Weekly walk with a group",
      what: "Join a free walking group near you.",
      why: "Regular movement with others lifts your mood.",
      firstStep: "Look up one group this week.",
      often: "Once a week",
    });
  });

  it("reads the closing line, and drops the introduction", () => {
    const p = parseWeeks(WEEKS)!;
    expect(p.closing).toMatch(/talking to a counselor or doctor/);
    expect(JSON.stringify(p)).not.toMatch(/Here is a plan/);
  });

  it("copes with bold headings, '###' headings, numbered activities and a dash after the week number", () => {
    const p = parseWeeks(
      "**Week 1: Start small**\n1. Walk: Walk weekly. Why: Moves you. First step: Pick a route. How often: Weekly.\n### Week 2 - Add people\n2) Call: Call a friend. Why: Connects you. First step: Pick a day. How often: Monthly.",
    )!;
    expect(p.weeks).toHaveLength(2);
    expect(p.weeks[1].theme).toBe("Add people");
    expect(p.weeks[0].activities[0].title).toBe("Walk");
  });

  it("joins an activity that wraps onto the next line", () => {
    const p = parseWeeks(
      "Week 1: A\n- Walk: Walk weekly. Why: It helps\nyou feel better. First step: Pick a route. How often: Weekly.\nWeek 2: B\n- Call: Call. Why: Good. First step: Do. How often: Weekly.",
    )!;
    expect(p.weeks[0].activities[0].why).toBe("It helps you feel better.");
  });

  it("keeps an activity with no markers as plain text, and an empty closing as empty", () => {
    const p = parseWeeks(
      "Week 1: A\n- Join a club and go every week\nWeek 2: B\n- Volunteer locally",
    )!;
    expect(p.weeks[0].activities[0].what).toBe("Join a club and go every week");
    expect(p.weeks[0].activities[0].why).toBe("");
    expect(p.closing).toBe("");
  });

  it("keeps at most four weeks", () => {
    const six = Array.from(
      { length: 6 },
      (_, i) =>
        `Week ${i + 1}: T${i}\n- Do ${i}: Thing. Why: Good. First step: Go. How often: Weekly.`,
    ).join("\n");
    expect(parseWeeks(six)!.weeks).toHaveLength(4);
  });

  it("returns null when it isn't a weeks plan, so it can be shown as plain text", () => {
    expect(parseWeeks("You could rest more and see friends.")).toBeNull();
    expect(
      parseWeeks("Week 1: Only one\n- Walk: Walk. Why: Good. First step: Go. How often: Weekly."),
    ).toBeNull();
    expect(parseWeeks("Week 1: Empty\nWeek 2: Also empty")).toBeNull();
    expect(parseWeeks("")).toBeNull();
  });

  it("caps long fields, so a plan always fits in a backup", () => {
    const long =
      Array.from(
        { length: 4 },
        (_, i) =>
          `Week ${i + 1}: ${"theme ".repeat(40)}\n` +
          Array.from(
            { length: 4 },
            () =>
              `- ${"title ".repeat(30)}: ${"what ".repeat(120)}. Why: ${"why ".repeat(120)}. First step: ${"step ".repeat(120)}. How often: ${"often ".repeat(60)}.`,
          ).join("\n"),
      ).join("\n") +
      "\nClosing: " +
      "close ".repeat(200);
    const saved = makeSavedPlan(long, { madeAt: 1, days: 7, sources: ALL, lowMood: false });
    expect(saved.weeks).toHaveLength(4);
    expect(JSON.stringify(saved).length).toBeLessThan(20000);
    expect(parseSavedPlan(JSON.parse(JSON.stringify(saved)))).not.toBeNull();
  });
});

describe("saving a weeks plan", () => {
  const meta = { madeAt: 1_800_000_000_000, days: 30 as const, sources: ALL, lowMood: true };

  it("keeps weeks, with no leftover text", () => {
    const p = makeSavedPlan(WEEKS, meta);
    expect(p.weeks).toHaveLength(4);
    expect(p.text).toBe("");
    expect(p.steps).toEqual([]);
    expect(p.closing).toMatch(/counselor or doctor/);
  });

  it("round-trips through JSON, and through storage", () => {
    const p = makeSavedPlan(WEEKS, meta);
    expect(parseSavedPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("a reply that is neither weeks nor steps is kept as plain text", () => {
    const p = makeSavedPlan("Rest more and see friends.", meta);
    expect(p.weeks).toBeUndefined();
    expect(p.text).toBe("Rest more and see friends.");
  });

  it("plans made before 4-week plans existed are still read", () => {
    const old = {
      text: "1. Walk.\n2. Rest.",
      steps: ["Walk.", "Rest."],
      closing: "A counselor is an option.",
      madeAt: 1,
      days: 7,
      sources: ALL,
      lowMood: false,
    };
    expect(parseSavedPlan(old)).toEqual(old);
  });

  it("rejects a damaged weeks plan", () => {
    const good = makeSavedPlan(WEEKS, meta);
    for (const bad of [
      { ...good, weeks: "no" },
      { ...good, weeks: [{ n: 1, theme: "x", activities: [] }] },
      { ...good, weeks: [{ n: "1", theme: "x", activities: [] }] },
      { ...good, weeks: Array.from({ length: 5 }, () => good.weeks![0]) },
      { ...good, weeks: [{ ...good.weeks![0], activities: [{ title: "a" }] }] },
    ])
      expect(parseSavedPlan(bad)).toBeNull();
  });

  it("a weeks plan stays under the backup limit for a setting", () => {
    expect(JSON.stringify(makeSavedPlan(WEEKS, meta)).length).toBeLessThan(20000);
  });
});
