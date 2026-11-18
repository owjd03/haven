import { describe, expect, it } from "vitest";
import {
  COPING_CARDS,
  cardWasTried,
  detectHelpIntent,
  gapLabel,
  INITIAL_LISTEN_STATE,
  nextListenState,
  type ListenState,
  parseSummary,
  resolveMode,
  shouldAskQuestion,
  shouldOfferIdeas,
  vetMemory,
} from "../src";

describe("help intent", () => {
  it.each([
    "What should I do about my roommate?",
    "any tips for sleeping before an exam",
    "how do I stop overthinking",
    "Can you suggest something?",
    "I need some advice",
    "help me figure this out",
    "should I tell my professor",
  ])("asks for help: %s", (t) => expect(detectHelpIntent(t)).toBe(true));

  it.each([
    "hi",
    "I had a terrible day and I just want to vent",
    "my roommate keeps ignoring me and it hurts",
    "I already tried that",
    "thanks, that helped",
    "I feel so alone since I moved here",
  ])("does not trigger on venting or small talk: %s", (t) =>
    expect(detectHelpIntent(t)).toBe(false),
  );
});

describe("resolveMode", () => {
  it("keeps the saved mode, and a clear ask switches Listen to Help for that reply only", () => {
    expect(resolveMode("listen", "I'm so tired")).toBe("listen");
    expect(resolveMode("listen", "what should I do?")).toBe("help");
    expect(resolveMode("help", "I'm so tired")).toBe("help");
  });
});

describe("Listen alternates a question with an invitation", () => {
  /** Plays one Listen reply, the way the chat service does. */
  const play = (s: ListenState) => {
    const ask = shouldAskQuestion(s);
    const offer = shouldOfferIdeas(s);
    return { ask, offer, next: nextListenState(s, "listen", { asked: ask, offered: offer }) };
  };

  it("asks, then invites, then asks again", () => {
    let s = INITIAL_LISTEN_STATE;
    const asked: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const t = play(s);
      asked.push(t.ask);
      s = t.next;
    }
    expect(asked).toEqual([true, false, true, false]);
  });

  it("offers ideas once, only on a question turn, after at least three Listen replies", () => {
    let s = INITIAL_LISTEN_STATE;
    const offers: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      const t = play(s);
      offers.push(t.offer);
      if (t.offer) expect(t.ask).toBe(true);
      s = t.next;
    }
    // Turns 1 and 3 ask without offering; turn 4 invites; turn 5 is the first question turn with 3+ done.
    expect(offers).toEqual([false, false, false, false, true, false, false, false]);
  });

  it("the offer counts as a question turn, so the next reply is an invitation", () => {
    const offered = { streak: 4, offered: false, asked: false };
    const t = play(offered);
    expect(t.offer).toBe(true);
    expect(shouldAskQuestion(t.next)).toBe(false);
  });

  it("a Help reply resets the streak, the offer and the alternation", () => {
    const s = nextListenState({ streak: 6, offered: true, asked: true }, "help", {
      asked: false,
      offered: false,
    });
    expect(s).toEqual(INITIAL_LISTEN_STATE);
    expect(shouldAskQuestion(s)).toBe(true);
  });
});

describe("structured summary", () => {
  const text = [
    "Going on: finals next week, fight with roommate",
    "Feeling: anxious, tired",
    "Tried / didn't help: making a study plan",
    "Helped: talking to sister",
    "Open threads: whether to tell the professor",
  ].join("\n");

  it("reads each labelled line", () => {
    expect(parseSummary(text)).toEqual({
      goingOn: "finals next week, fight with roommate",
      feeling: "anxious, tired",
      tried: "making a study plan",
      helped: "talking to sister",
      openThreads: "whether to tell the professor",
    });
  });

  it("copes with bullets, bold labels and 'none'", () => {
    const p = parseSummary("- **Going on:** exams\n* Helped: none\nOpen threads: None.");
    expect(p.goingOn).toBe("exams");
    expect(p.helped).toBe("");
    expect(p.openThreads).toBe("");
  });

  it("gives empty fields for an old paragraph summary", () => {
    const p = parseSummary("The user felt overwhelmed about school and a breakup.");
    expect(Object.values(p).every((v) => v === "")).toBe(true);
  });
});

describe("cards already tried", () => {
  const breathing = COPING_CARDS.find((c) => /breath/i.test(c.title))!;

  it("flags a card whose technique the person said they tried", () => {
    expect(cardWasTried(breathing, "breathing exercises, a study plan")).toBe(true);
  });
  it("does not flag unrelated cards or an empty list", () => {
    expect(cardWasTried(breathing, "making a study plan")).toBe(false);
    expect(cardWasTried(breathing, "")).toBe(false);
  });
});

describe("time since last chat", () => {
  const h = 3_600_000;
  it("is null under six hours", () => {
    expect(gapLabel(0)).toBeNull();
    expect(gapLabel(5.9 * h)).toBeNull();
    expect(gapLabel(NaN)).toBeNull();
  });
  it("gives a plain phrase after that", () => {
    expect(gapLabel(6 * h)).toBe("6 hours ago");
    expect(gapLabel(24 * h)).toBe("yesterday");
    expect(gapLabel(72 * h)).toBe("3 days ago");
    expect(gapLabel(21 * 24 * h)).toBe("3 weeks ago");
  });
});

describe("suggested memories are vetted in plain code", () => {
  it("accepts a short lasting fact and tidies it", () => {
    expect(vetMemory('"exam on Friday"', [], [])).toBe("Exam on Friday");
    expect(vetMemory("- Sister Maya lives in another city", [], [])).toBe(
      "Sister Maya lives in another city",
    );
  });

  it.each(["none", "None.", "", "no fact", "ok", "x".repeat(200)])("drops %j", (t) =>
    expect(vetMemory(t, [], [])).toBeNull(),
  );

  it("drops anything health or crisis related", () => {
    for (const t of [
      "Takes antidepressants daily",
      "Has been diagnosed with ADHD",
      "Sees a therapist on Mondays",
      "Wants to kill myself",
      "Had a panic attack in class",
    ])
      expect(vetMemory(t, [], []), t).toBeNull();
  });

  it("drops duplicates of known facts and facts already declined", () => {
    expect(vetMemory("Exam on Friday", ["exam on friday"], [])).toBeNull();
    expect(vetMemory("Finals exam on Friday morning", ["Exam on Friday"], [])).toBeNull();
    expect(vetMemory("Works at the campus cafe", [], ["Works at the campus cafe"])).toBeNull();
    expect(vetMemory("Works at the campus cafe", ["Exam on Friday"], [])).not.toBeNull();
  });
});
