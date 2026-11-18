import { describe, expect, it } from "vitest";
import { capSentences, cleanReply, finishReply, plainText, splitSentences } from "../lib/format";
import { SAMPLING, resolveSampling } from "../lib/sampling";
import { instructionFor } from "../lib/promptBuilder";

const SYSTEM_INSTRUCTION = instructionFor("listen");
const HELP_INSTRUCTION = instructionFor("help");

const chrome = { defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2 };

describe("resolveSampling", () => {
  it("passes the wanted values through when Chrome allows them", () => {
    expect(resolveSampling(chrome, SAMPLING.chat)).toEqual({ temperature: 0.6, topK: 30 });
    expect(resolveSampling(chrome, SAMPLING.summary)).toEqual({ temperature: 0.2, topK: 3 });
  });
  it("never goes outside Chrome's limits", () => {
    const tight = { ...chrome, maxTemperature: 0.5, maxTopK: 10 };
    expect(resolveSampling(tight, { temperature: 0.8, topK: 30 })).toEqual({
      temperature: 0.5,
      topK: 10,
    });
    expect(resolveSampling(chrome, { temperature: -1, topK: 0 })).toEqual({
      temperature: 0,
      topK: 1,
    });
  });
  it("returns null (keep Chrome's defaults) when Chrome gives no usable limits", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      5,
      {},
      { maxTemperature: 2 },
      { maxTemperature: NaN, maxTopK: 5 },
    ])
      expect(resolveSampling(bad, SAMPLING.chat), String(bad)).toBeNull();
  });
  it("always returns temperature and topK together", () => {
    const r = resolveSampling(chrome, SAMPLING.chat)!;
    expect(Object.keys(r).sort()).toEqual(["temperature", "topK"]);
  });
  it("keeps summaries steadier than chat", () => {
    expect(SAMPLING.summary.temperature).toBeLessThan(SAMPLING.chat.temperature);
    expect(SAMPLING.chat.temperature).toBeGreaterThan(0);
  });
});

describe("plainText", () => {
  it("removes emphasis markers but keeps the words", () => {
    expect(plainText("you're carrying a *lot* right now")).toBe("you're carrying a lot right now");
    expect(plainText("this is **really** hard")).toBe("this is really hard");
  });
  it("turns headings and star bullets into plain text", () => {
    expect(plainText("## A thought\n* try water\n- rest")).toBe("A thought\n• try water\n• rest");
  });
  it("leaves ordinary text, maths and lone asterisks alone", () => {
    expect(plainText("It costs 3 * 4 dollars, e.g. snake_case")).toBe(
      "It costs 3 * 4 dollars, e.g. snake_case",
    );
  });
});

describe("reply instruction", () => {
  it("forbids pet names, markdown and a repeated opener, and caps the length", () => {
    for (const i of [SYSTEM_INSTRUCTION, HELP_INSTRUCTION]) {
      expect(i).toMatch(/No pet names/);
      expect(i).toMatch(/no lists, bold, asterisks or emoji/);
      expect(i).toMatch(/Never start with 'Oh'/);
    }
    expect(SYSTEM_INSTRUCTION).toMatch(/2 to 4 sentences/);
    expect(HELP_INSTRUCTION).toMatch(/4 to 6 sentences/);
  });
  it("still keeps the safety rules", () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/not a therapist/);
    expect(SYSTEM_INSTRUCTION).toMatch(/Never diagnose/);
    expect(HELP_INSTRUCTION).toMatch(/not a therapist/);
    expect(HELP_INSTRUCTION).toMatch(/Never diagnose/);
  });
});

describe("cleanReply", () => {
  it("removes a speaker label the model copied from the prompt", () => {
    expect(cleanReply("Haven: That sounds hard.")).toBe("That sounds hard.");
    expect(cleanReply("Haven: Haven: That sounds hard.")).toBe("That sounds hard.");
    expect(plainText("Haven: That sounds **hard**.")).toBe("That sounds hard.");
  });

  it("removes pet names and an 'Oh' opener", () => {
    expect(cleanReply("Haven: Oh honey, that sounds like a lot.")).toBe("That sounds like a lot.");
    expect(cleanReply("Oh, that sounds exhausting.")).toBe("That sounds exhausting.");
    expect(cleanReply("That's a lot to carry, sweetie.")).toBe("That's a lot to carry.");
    expect(cleanReply("Dear, I hear you.")).toBe("I hear you.");
  });

  it("leaves normal words alone", () => {
    for (const t of [
      "Ohio sounds far from home.",
      "Your dear friend sounds kind.",
      "Honesty can be hard.",
      "Who is Haven to you?",
    ])
      expect(cleanReply(t)).toBe(t);
  });
});

describe("sentence cap", () => {
  const eight =
    "That sounds intense. You are angry and hurt. I hear how heavy it feels. Anger can be a sign of pain. " +
    "Acting on violent thoughts has serious consequences. There are resources to help you. They can help safely. Would you like some options?";

  it("splits sentences without breaking on abbreviations or decimals", () => {
    expect(
      splitSentences("Try breathing, e.g. slowly. Dr. Lee says 3.5 seconds is fine. Okay?"),
    ).toEqual(["Try breathing, e.g. slowly.", "Dr. Lee says 3.5 seconds is fine.", "Okay?"]);
  });

  it("leaves a reply within the limit exactly as written", () => {
    const t = "One.  Two!\nThree?";
    expect(capSentences(t, 4)).toBe(t);
  });

  it("keeps the opening and the closing question when it cuts", () => {
    const out = capSentences(eight, 6);
    expect(splitSentences(out)).toHaveLength(6);
    expect(out.startsWith("That sounds intense.")).toBe(true);
    expect(out.endsWith("Would you like some options?")).toBe(true);
    expect(out).not.toContain("They can help safely.");
  });

  it("keeps just the opening sentences when the reply doesn't end in a question", () => {
    const out = capSentences("A. B. C. D. E. F.", 4);
    expect(out).toBe("A. B. C. D.");
  });

  it("finishReply cleans first, then caps by mode: 4 for listen, 6 for help", () => {
    const messy = "Haven: Oh honey, " + eight.charAt(0).toLowerCase() + eight.slice(1);
    const listen = finishReply(messy, "listen");
    expect(listen.startsWith("That sounds intense.")).toBe(true);
    expect(listen).not.toMatch(/honey|Haven:/);
    expect(splitSentences(listen)).toHaveLength(4);
    expect(splitSentences(finishReply(messy, "help"))).toHaveLength(6);
  });
});
