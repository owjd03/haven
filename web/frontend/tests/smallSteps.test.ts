import { describe, expect, it } from "vitest";
import type { PlanIdea } from "@haven/backend";
import {
  ABOUT_ME_MAX_WORDS,
  answersHaveCrisis,
  buildAnswersText,
  buildSteps,
  FIXED_QUESTIONS,
  GENERIC_QUESTIONS,
  parseStageOne,
  PLAN_MAX_WORDS,
  planInstruction,
  questionsFor,
  questionsInstruction,
} from "../lib/smallSteps";
import { countWords } from "../lib/promptBuilder";
import type { PlanSources } from "../lib/plan";
import type { ChatMessage, JournalEntry } from "../lib/types";

const at = (day: number) => new Date(2026, 10, day, 12).getTime();
let id = 1;
const note = (day: number, over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: id++,
  day: `2026-11-${String(day).padStart(2, "0")}`,
  mood: 5,
  text: "A journal note.",
  createdAt: at(day) + id,
  updatedAt: at(day) + id,
  ...over,
});
const msg = (day: number, content: string): ChatMessage => ({
  id: id++,
  role: "user",
  content,
  ts: at(day) + id,
  summarized: false,
});
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");
const ALL: PlanSources = { journal: true, chats: true, aboutMe: true };
const none = { journal: [], summaries: [], messages: [] };

describe("Small steps: gathering for the first request", () => {
  it("puts About me notes first, then the days", () => {
    const g = buildSteps(
      {
        ...none,
        journal: [note(14, { text: "Rough day." })],
        messages: [msg(14, "exam tomorrow")],
      },
      ["Finals next week", "Lives with two roommates"],
      ALL,
    );
    expect(g.text.startsWith("About me")).toBe(true);
    expect(g.text.indexOf("Finals next week")).toBeLessThan(g.text.indexOf("Rough day."));
    expect(g.text).toContain("exam tomorrow");
    expect(g.aboutMe).toBe(2);
  });

  it("uses only the sources that are on, and handles About me alone", () => {
    const input = {
      ...none,
      journal: [note(14, { text: "IN MY JOURNAL" })],
      messages: [msg(14, "IN MY CHAT")],
    };
    const j = buildSteps(input, ["A fact"], { journal: true, chats: false, aboutMe: false });
    expect(j.text).toContain("IN MY JOURNAL");
    expect(j.text).not.toMatch(/IN MY CHAT|A fact/);
    const a = buildSteps(input, ["A fact"], { journal: false, chats: false, aboutMe: true });
    expect(a.text).toContain("A fact");
    expect(a.gathered.text).toBe("");
    expect(buildSteps(none, [], ALL).text).toBe("");
  });

  it("allows 3,000 words, not 900, and keeps far more of each note", () => {
    expect(PLAN_MAX_WORDS).toBe(3000);
    const entries = Array.from({ length: 12 }, (_, i) =>
      note(i + 1, { text: `e${i} ${words(200)}` }),
    );
    const g = buildSteps({ ...none, journal: entries }, [], ALL);
    expect(g.gathered.journalEntries).toBeGreaterThanOrEqual(9);
    expect(countWords(g.text)).toBeGreaterThan(900);
    expect(countWords(g.text)).toBeLessThanOrEqual(PLAN_MAX_WORDS + 40);
    // A long note keeps up to 250 words, not 80.
    const one = buildSteps({ ...none, journal: [note(14, { text: words(300, "w") })] }, [], ALL);
    expect(one.text).toContain(words(250, "w") + "…");
    expect(one.text).not.toContain(words(251, "w"));
  });

  it("still stops at the budget, About me included", () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      note((i % 28) + 1, { text: `e${i} ${words(240)}` }),
    );
    const facts = Array.from({ length: 10 }, (_, i) => `fact${i} ${words(40)}`);
    const g = buildSteps({ ...none, journal: entries }, facts, ALL);
    expect(countWords(g.text)).toBeLessThanOrEqual(PLAN_MAX_WORDS + 40);
    expect(g.gathered.wontFit.length).toBeGreaterThan(0);
  });

  it("keeps About me notes to 200 words", () => {
    const facts = Array.from({ length: 30 }, (_, i) => `fact${i} ${words(30)}`);
    const g = buildSteps(none, facts, ALL);
    expect(countWords(g.text.split("\n").slice(1).join(" "))).toBeLessThanOrEqual(
      ABOUT_ME_MAX_WORDS,
    );
    expect(g.aboutMe).toBeGreaterThan(0);
    expect(g.aboutMe).toBeLessThan(facts.length);
  });

  it("never includes crisis language: not in journal notes, and not in an About me note", () => {
    const crisis = "I want to end my life";
    const g = buildSteps(
      {
        ...none,
        journal: [
          note(14, { text: "Fine, a bit tired." }),
          note(13, { text: crisis, crisisFlag: true }),
          note(12, { text: crisis }),
        ],
      },
      ["Finals next week", crisis],
      ALL,
    );
    expect(g.text).toContain("a bit tired");
    expect(g.text).toContain("Finals next week");
    expect(g.text.toLowerCase()).not.toContain("end my life");
    expect(g.gathered.excluded).toBe(2);
  });

  it("reports the average rating, for the support note", () => {
    const g = buildSteps(
      { ...none, journal: [note(14, { mood: 2 }), note(13, { mood: 3 })] },
      [],
      ALL,
    );
    expect(g.gathered.averageMood).toBe(2.5);
  });
});

describe("Small steps: the first instruction (understand)", () => {
  it("asks for a summary with no names, and 3 to 5 numbered questions", () => {
    const i = questionsInstruction(ALL);
    expect(i).toMatch(/"Summary:"/);
    expect(i).toMatch(/without any names or places/);
    expect(i).toMatch(/"Questions:" and 3 to 5 numbered questions/);
  });

  it("asks about what they enjoy and what helps, never about the painful details or anything clinical", () => {
    const i = questionsInstruction(ALL);
    expect(i).toMatch(/what they enjoy or have enjoyed/);
    expect(i).toMatch(/Never ask about the details of what hurt them/);
    expect(i).toMatch(/never ask for names or places/);
    expect(i).toMatch(/never ask anything clinical/);
    expect(i).toMatch(/Never diagnose or give medical advice/);
  });

  it("says what was sent, and mentions the rating only with the journal", () => {
    expect(questionsInstruction(ALL)).toMatch(
      /their journal, their chats with Haven and things they wrote/,
    );
    expect(questionsInstruction(ALL)).toMatch(/their own number, not a measurement/);
    expect(questionsInstruction({ journal: false, chats: true, aboutMe: false })).not.toMatch(
      /rating/,
    );
  });
});

describe("Small steps: reading the first reply", () => {
  const REPLY = [
    "Summary: They are going through a breakup and feel lonely in the evenings. Walking with a friend seems to help.",
    "",
    "Questions:",
    "1. What did you enjoy doing before the relationship?",
    "2. Who makes you feel better when you see them?",
    "3. What would you like more of in your week?",
  ].join("\n");

  it("reads the summary and the questions", () => {
    const p = parseStageOne(REPLY)!;
    expect(p.summary).toMatch(/^They are going through a breakup/);
    expect(p.questions).toEqual([
      "What did you enjoy doing before the relationship?",
      "Who makes you feel better when you see them?",
      "What would you like more of in your week?",
    ]);
  });

  it("handles bold labels, a summary on the next line, wrapped questions and more than five questions", () => {
    const p = parseStageOne(
      "**Summary:**\nA short summary.\n**Questions:**\n1) First one\nwraps here?\n2) Second?\n3) Third?\n4) Fourth?\n5) Fifth?\n6) Sixth?",
    )!;
    expect(p.summary).toBe("A short summary.");
    expect(p.questions[0]).toBe("First one wraps here?");
    expect(p.questions).toHaveLength(5);
  });

  it("reads numbered questions even with no labels", () => {
    expect(parseStageOne("1. One question here?\n2. Another question?")!.questions).toHaveLength(2);
  });

  it("returns null when nothing usable came back", () => {
    expect(parseStageOne("")).toBeNull();
    expect(parseStageOne("I'm so sorry you're going through this.")).toBeNull();
  });

  it("the person is asked the cloud's questions, then the two fixed ones", () => {
    const qs = questionsFor(parseStageOne(REPLY));
    expect(qs.slice(0, 3)).toEqual(parseStageOne(REPLY)!.questions);
    expect(qs.slice(-2)).toEqual(FIXED_QUESTIONS);
    expect(qs).toHaveLength(5);
  });

  it("falls back to generic questions (plus the two fixed ones) when there is no usable reply", () => {
    for (const parsed of [
      null,
      { summary: "x", questions: [] },
      { summary: "x", questions: ["only one"] },
    ]) {
      const qs = questionsFor(parsed);
      expect(qs.slice(0, 3)).toEqual(GENERIC_QUESTIONS);
      expect(qs.slice(-2)).toEqual(FIXED_QUESTIONS);
    }
  });

  it("always asks what to avoid, and how much time there is", () => {
    expect(FIXED_QUESTIONS[0]).toMatch(/rather not do, or not be reminded of/);
    expect(FIXED_QUESTIONS[1]).toMatch(/How much time/);
  });
});

describe("Small steps: the answers and the second request", () => {
  const qa = [
    { question: "What do you enjoy?", answer: "Climbing and cooking" },
    { question: "Anything to avoid?", answer: "   " },
    { question: "How much time?", answer: "About three hours a week" },
  ];

  it("sends the summary and only the questions that were answered", () => {
    const t = buildAnswersText("They are lonely.", qa);
    expect(t).toContain("They are lonely.");
    expect(t).toContain("Q: What do you enjoy?\nA: Climbing and cooking");
    expect(t).toContain("Q: How much time?\nA: About three hours a week");
    expect(t).not.toContain("Anything to avoid");
  });

  it("works when nothing was answered, or there is no summary", () => {
    expect(
      buildAnswersText(
        "A summary.",
        qa.map((x) => ({ ...x, answer: "" })),
      ),
    ).toContain("They chose not to answer the questions.");
    expect(buildAnswersText("", qa)).toContain("(nothing yet)");
  });

  it("recognises crisis language in an answer, in plain code", () => {
    expect(answersHaveCrisis(qa)).toBe(false);
    expect(answersHaveCrisis([...qa, { answer: "I want to end my life" }])).toBe(true);
    expect(answersHaveCrisis([])).toBe(false);
  });
});

describe("Small steps: the plan instruction", () => {
  const IDEAS: PlanIdea[] = [
    {
      id: "heartbreak-1",
      situation: "heartbreak",
      title: "Join a club and keep attending",
      idea: "Pick a group around something you like and go weekly.",
      why: "Groups help you meet people.",
      tags: ["breakup"],
      source: { name: "NHS Every Mind Matters", url: "https://www.nhs.uk/example" },
      sourceChecked: "2026-11-18",
      reviewed: false,
    },
  ];
  const text = "We broke up and I keep thinking about my ex.";
  const i = planInstruction(text, IDEAS);

  it("never contains the person's own words", () => {
    expect(i).not.toContain("keep thinking about my ex");
  });

  it("asks for four weeks, two or three activities a week, in the format the app can read", () => {
    expect(i).toMatch(/next four weeks/);
    expect(i).toMatch(/Week 1: <a short theme for the week>/);
    expect(i).toMatch(/Why: <one sentence/);
    expect(i).toMatch(/First step: <one concrete first step>/);
    expect(i).toMatch(/How often: <a short phrase/);
    expect(i).toMatch(/2 or 3 activities for each of weeks 1 to 4/);
    expect(i).toMatch(/Closing: <one gentle sentence/);
  });

  it("wants longer-term, concrete activities, not quick tips", () => {
    expect(i).toMatch(/longer-term, concrete activities/);
    expect(i).toMatch(/not quick tips for today/);
    expect(i).toMatch(/Be specific/);
  });

  it("never suggests what is tied to the hurt, a shared past, or what they want to avoid", () => {
    expect(i).toMatch(
      /Never suggest anything connected to the person, place or situation that is hurting them/,
    );
    expect(i).toMatch(/rather avoid or not be reminded of/);
    expect(i).toMatch(/If they used to do something with a particular person, do not suggest it/);
  });

  it("fits the time they have, and builds up gently", () => {
    expect(i).toMatch(/fit the time they said they have/);
    expect(i).toMatch(/Start gently and build up/);
  });

  it("keeps the safety rules: no diagnosis, medical advice, medication, therapy, goals or streaks", () => {
    expect(i).toMatch(/Never diagnose/);
    expect(i).toMatch(/never give medical advice/);
    expect(i).toMatch(/never mention medication, therapy techniques or treatment/);
    expect(i).toMatch(/Don't set goals or targets/);
    expect(i).toMatch(/streaks, tracking or reminders/);
  });

  it("ends with the line about talking to a counselor or doctor", () => {
    expect(i).toMatch(/talking to a counselor or doctor/);
  });

  it("adds the matched library ideas, with their source names, and nothing personal", () => {
    expect(i).toContain(
      "Join a club and keep attending: Pick a group around something you like and go weekly. (NHS Every Mind Matters)",
    );
    expect(i).toMatch(/Adapt them to this person/);
    expect(i).not.toContain("https://");
  });

  it("works with no matching ideas", () => {
    const bare = planInstruction("hello", []);
    expect(bare).not.toMatch(/Ideas from general wellbeing guidance/);
    expect(bare).toMatch(/next four weeks/);
  });
});
