import { describe, expect, it } from "vitest";
import { detectCrisis, isCrisis } from "../src";

describe("crisis detection (rule-based, no AI)", () => {
  const mustMatch = [
    "I want to kill myself",
    "i dont want to be here anymore",
    "Don’t want to be here any more", // curly apostrophe
    "thinking about ending it all",
    "there's no point living",
    "no reason to live anymore",
    "I wish I was dead",
    "I think I'd be better off dead",
    "nobody would miss me",
    "I'm going to hurt myself",
    "going to cut myself tonight",
    "i can't go on",
    "I've been thinking about suicide",
    "I want to END MY LIFE.",
    "thinking of an overdose",
  ];
  it.each(mustMatch)("flags: %s", (t) => {
    expect(detectCrisis(t).matched).toBe(true);
  });

  const mustNotMatch = [
    "I have an exam tomorrow and I'm stressed",
    "this assignment is killing me",
    "I killed it on my presentation",
    "my phone battery is about to die",
    "I'm dying to see that movie",
    "this exam will end me lol",
    "my friend said she was killing it at the gym",
    "feeling lonely tonight",
    "",
  ];
  it.each(mustNotMatch)("does not flag everyday language: %s", (t) => {
    expect(isCrisis(t)).toBe(false);
  });

  it("returns which patterns matched", () => {
    const r = detectCrisis("I want to die");
    expect(r.matched).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  });
});
