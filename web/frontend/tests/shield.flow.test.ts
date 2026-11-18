import { applyMasks } from "@haven/backend";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Firebase AI is mocked: no model, no network.
vi.mock("../lib/ai", () => ({
  detectEntities: vi.fn(),
  cloudGenerate: vi.fn(),
  cloudGenerateStream: vi.fn(),
}));
import { cloudGenerate, cloudGenerateStream, detectEntities } from "../lib/ai";
import { PLACEHOLDER_RULE, prepareShield, sendMasked } from "../lib/shield";

const detect = vi.mocked(detectEntities);
const cloud = vi.mocked(cloudGenerate);
const stream = vi.mocked(cloudGenerateStream);

const TEXT = "I'm Sam, a student at Oakridge High in Boston. Reach me at sam@school.edu.";

beforeEach(() => {
  detect.mockReset();
  cloud.mockReset();
  stream.mockReset();
});

describe("prepareShield", () => {
  it("combines regex and on-device model detection when the local model is ready", async () => {
    detect.mockResolvedValue({
      people: ["Sam"],
      places: ["Boston"],
      organizations: ["Oakridge High"],
    });
    const prep = await prepareShield(TEXT, true);
    expect(prep.weak).toBe(false);
    const found = prep.entries.map((e) => e.text);
    expect(found).toEqual(
      expect.arrayContaining(["sam@school.edu", "Sam", "Boston", "Oakridge High"]),
    );
    expect(detect).toHaveBeenCalledOnce();
  });

  it("uses regex only and flags weak detection when the local model is unavailable", async () => {
    const prep = await prepareShield(TEXT, false);
    expect(prep.weak).toBe(true);
    expect(prep.entries.map((e) => e.text)).toEqual(["sam@school.edu"]);
    expect(detect).not.toHaveBeenCalled();
  });

  it("falls back to regex-only (weak) if the model fails", async () => {
    detect.mockRejectedValue(new Error("boom"));
    const prep = await prepareShield(TEXT, true);
    expect(prep.weak).toBe(true);
    expect(prep.entries.map((e) => e.text)).toContain("sam@school.edu");
  });
});

describe("sendMasked", () => {
  it("sends only masked text, with the placeholder rule, and un-masks the reply locally", async () => {
    const prep = await prepareShield(TEXT, false);
    const { masked, map } = applyMasks(TEXT, [
      ...prep.entries,
      { text: "Sam", kind: "PERSON" },
      { text: "Boston", kind: "PLACE" },
    ]);
    cloud.mockResolvedValue({
      text: "Take care, [PERSON_1]. Boston can be tough.\nMaybe tell [PLACE_1]...",
      source: "in_cloud",
    });

    const res = await sendMasked(masked, map, "INSTRUCTION");
    const sent = cloud.mock.calls[0][0];
    for (const secret of ["Sam", "Boston", "sam@school.edu"]) expect(sent).not.toContain(secret);
    expect(sent).toContain("[PERSON_1]");
    expect(sent).toContain("INSTRUCTION");
    expect(sent).toContain(PLACEHOLDER_RULE);
    expect(res.text).toContain("Take care, Sam.");
    expect(res.text).toContain("tell Boston");
    expect(res.altered).toBe(false);
  });

  it("fails gracefully when the cloud alters or invents a placeholder", async () => {
    cloud.mockResolvedValue({ text: "Hello [PERSON_7]", source: "in_cloud" });
    const res = await sendMasked("x", {}, "I");
    expect(res.text).toBe("Hello (a private detail)");
    expect(res.altered).toBe(true);
  });

  it("propagates cloud errors so the UI can show them (nothing is swallowed)", async () => {
    cloud.mockRejectedValue(new Error("429"));
    await expect(sendMasked("x", {}, "I")).rejects.toThrow("429");
  });
});

describe("sendMasked streaming", () => {
  const map = { "[PERSON_1]": "Maya", "[PLACE_1]": "Toronto" };
  const REPLY = "Week 1: Ask [PERSON_1] to a walk in [PLACE_1] soon.";

  /** A fake cloud that delivers the reply in small pieces, like a real stream. */
  const streams = (reply: string, size: number) =>
    stream.mockImplementation(async (_prompt, onPartial) => {
      for (let i = size; i < reply.length + size; i += size) onPartial(reply.slice(0, i));
      return { text: reply, source: "in_cloud" };
    });

  it("restores names as the reply arrives, and never shows half a placeholder", async () => {
    streams(REPLY, 3);
    const seen: string[] = [];
    const r = await sendMasked("masked", map, "instruction", (t) => seen.push(t));
    expect(seen.length).toBeGreaterThan(5);
    for (const t of seen) expect(t).not.toMatch(/\[|PERSON_|PLACE_/);
    expect(seen[seen.length - 1]).toBe("Week 1: Ask Maya to a walk in Toronto soon.");
    expect(r.text).toBe("Week 1: Ask Maya to a walk in Toronto soon.");
    expect(r.altered).toBe(false);
  });

  it("only ever sends masked text, with the instruction and the placeholder rule", async () => {
    streams("fine", 2);
    await sendMasked("masked [PERSON_1] text", map, "INSTRUCTION", () => {});
    const prompt = stream.mock.calls[0][0];
    expect(prompt).toContain("INSTRUCTION");
    expect(prompt).toContain(PLACEHOLDER_RULE);
    expect(prompt).toContain("masked [PERSON_1] text");
    expect(prompt).not.toContain("Maya");
  });

  it("without a callback it does not stream", async () => {
    cloud.mockResolvedValue({ text: "Hi [PERSON_1]", source: "in_cloud" });
    const r = await sendMasked("masked", map, "instruction");
    expect(r.text).toBe("Hi Maya");
    expect(stream).not.toHaveBeenCalled();
  });

  it("reports an unknown placeholder as altered, left generic", async () => {
    streams("Call [PERSON_9] tomorrow", 4);
    const r = await sendMasked("masked", map, "instruction", () => {});
    expect(r.altered).toBe(true);
    expect(r.text).not.toContain("PERSON_9");
  });
});
