import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Firebase AI library is mocked: only the cloud model's calls matter here.
const cloud = vi.hoisted(() => ({ generateContent: vi.fn(), generateContentStream: vi.fn() }));
vi.mock("firebase/ai", () => ({
  getGenerativeModel: vi.fn((_ai: unknown, params: { mode?: string }) =>
    params.mode === "only_in_cloud" ? cloud : { generateContent: vi.fn() },
  ),
  InferenceMode: { ONLY_ON_DEVICE: "only_on_device", ONLY_IN_CLOUD: "only_in_cloud" },
}));
vi.mock("../lib/firebase", () => ({ getFirebaseAI: () => ({}) }));

import { cloudGenerate, cloudGenerateStream } from "../lib/ai";

const busy = () =>
  new Error("AI: Error fetching [500 ] This model is currently experiencing high demand.");
const ok = (text: string) => ({ response: { text: () => text, inferenceSource: "in_cloud" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  cloud.generateContent.mockReset();
  cloud.generateContentStream.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Runs a call to the end while the retry waits are skipped. */
async function settle<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
  const done = Promise.allSettled([p]).then(([r]) => r);
  await vi.runAllTimersAsync();
  return done;
}

describe("a busy cloud is tried again before the person sees anything", () => {
  it("recovers when the second try works", async () => {
    cloud.generateContent.mockRejectedValueOnce(busy()).mockResolvedValueOnce(ok("fine"));
    const r = await settle(cloudGenerate("hi"));
    expect(r).toMatchObject({ status: "fulfilled", value: { text: "fine" } });
    expect(cloud.generateContent).toHaveBeenCalledTimes(2);
  });

  it("gives up after three more tries with a plain message", async () => {
    cloud.generateContent.mockRejectedValue(busy());
    const r = await settle(cloudGenerate("hi"));
    expect(cloud.generateContent).toHaveBeenCalledTimes(4);
    expect(r.status).toBe("rejected");
    const reason = (r as PromiseRejectedResult).reason as Error;
    expect(reason.message).toMatch(/cloud is busy/i);
    expect(reason.message).not.toMatch(/500|https?:|demand/i);
  });

  it("does not retry a real rate limit", async () => {
    cloud.generateContent.mockRejectedValue(new Error("[429 ] Too many requests"));
    const r = await settle(cloudGenerate("hi"));
    expect(cloud.generateContent).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("rejected");
  });

  it("does not retry a refusal", async () => {
    cloud.generateContent.mockRejectedValue(new Error("[403 ] App Check token is invalid"));
    await settle(cloudGenerate("hi"));
    expect(cloud.generateContent).toHaveBeenCalledTimes(1);
  });

  it("also retries when a streaming reply cannot start", async () => {
    const stream = {
      stream: (async function* () {
        yield { text: () => "Hello" };
      })(),
      response: Promise.resolve({ text: () => "Hello" }),
    };
    cloud.generateContentStream.mockRejectedValueOnce(busy()).mockResolvedValueOnce(stream);
    const partials: string[] = [];
    const r = await settle(cloudGenerateStream("hi", (t) => partials.push(t)));
    expect(r).toMatchObject({ status: "fulfilled", value: { text: "Hello", source: "in_cloud" } });
    expect(partials).toEqual(["Hello"]);
    expect(cloud.generateContentStream).toHaveBeenCalledTimes(2);
  });
});
