import { describe, expect, it } from "vitest";
import { READING_LINKS } from "@haven/backend";
import { makeSavedPlan, parseSavedPlan, planFromWeeks, type PlanWeek } from "../lib/plan";

const ids = READING_LINKS.slice(0, 3).map((l) => l.id);
const meta = {
  madeAt: 1,
  days: 7 as const,
  sources: { journal: true, chats: true, aboutMe: false },
  lowMood: false,
};
const weeks: PlanWeek[] = [
  {
    n: 1,
    theme: "Rest",
    activities: [{ title: "Walk", what: "A short walk.", why: "", firstStep: "", often: "" }],
  },
];

describe("a plan keeps its Read more ids", () => {
  it("keeps real ids on a weeks plan", () => {
    expect(planFromWeeks(weeks, "", { ...meta, reading: ids }).reading).toEqual(ids);
  });

  it("keeps real ids on a plan made from a reply", () => {
    const plan = makeSavedPlan("Week 1: Rest\n- Walk: A short walk.", { ...meta, reading: ids });
    expect(plan.reading).toEqual(ids);
  });

  it("drops unknown ids when saving", () => {
    const plan = planFromWeeks(weeks, "", { ...meta, reading: [...ids, "not-a-page"] });
    expect(plan.reading).toEqual(ids);
  });

  it("leaves the field out when there is nothing to show", () => {
    expect(planFromWeeks(weeks, "", { ...meta, reading: ["nope"] })).not.toHaveProperty("reading");
    expect(planFromWeeks(weeks, "", meta)).not.toHaveProperty("reading");
  });
});

describe("reading a saved plan back", () => {
  const saved = planFromWeeks(weeks, "", { ...meta, reading: ids });

  it("round-trips", () => {
    expect(parseSavedPlan(JSON.parse(JSON.stringify(saved)))?.reading).toEqual(ids);
  });

  it("still loads a plan saved before Read more existed", () => {
    const old = { ...saved };
    delete old.reading;
    const parsed = parseSavedPlan(old);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("reading");
  });

  it("drops ids that were added by hand, instead of rejecting the plan", () => {
    const tampered = { ...saved, reading: [ids[0], "https://evil.example", 7] };
    expect(parseSavedPlan(tampered)?.reading).toEqual([ids[0]]);
  });

  it("ignores a reading field that is not a list", () => {
    const parsed = parseSavedPlan({ ...saved, reading: "hello" });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("reading");
  });
});
