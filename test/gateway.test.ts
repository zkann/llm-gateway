import { describe, expect, it } from "vitest";
import { Gateway } from "../src/gateway.js";
import { MockProvider } from "../src/providers/mock.js";
import { AllModelsFailedError, type Provider, type TaskProfile } from "../src/types.js";

/** A provider scripted to fail N times before succeeding. */
class ScriptedProvider implements Provider {
  readonly name: string;
  calls = 0;
  private failFirst: number;

  constructor(name: string, failFirst: number) {
    this.name = name;
    this.failFirst = failFirst;
  }

  async complete(model: string, req: { prompt: string }) {
    this.calls++;
    if (this.calls <= this.failFirst) throw new Error("scripted failure");
    return {
      text: `${model}: ok (${req.prompt})`,
      inputTokens: 100,
      outputTokens: 50,
    };
  }
}

const profile = (overrides: Partial<TaskProfile> = {}): TaskProfile => ({
  name: "t",
  route: [{ provider: "a", model: "claude-haiku-4-5" }],
  retriesPerModel: 2,
  maxTokens: 256,
  ...overrides,
});

describe("routing", () => {
  it("returns the primary model's response when it succeeds", async () => {
    const gw = new Gateway({
      providers: [new ScriptedProvider("a", 0)],
      profiles: [profile()],
      noSleep: true,
    });
    const result = await gw.complete("t", { prompt: "hello" });
    expect(result.servedBy).toEqual({ provider: "a", model: "claude-haiku-4-5" });
    expect(result.attempts).toHaveLength(1);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("retries the same model before falling through", async () => {
    const a = new ScriptedProvider("a", 2); // fails twice, third call succeeds
    const gw = new Gateway({
      providers: [a],
      profiles: [profile({ retriesPerModel: 2 })],
      noSleep: true,
    });
    const result = await gw.complete("t", { prompt: "hello" });
    expect(a.calls).toBe(3);
    expect(result.attempts.filter((x) => !x.ok)).toHaveLength(2);
    expect(result.attempts.at(-1)?.ok).toBe(true);
  });

  it("falls back to the next model in the chain after retries exhaust", async () => {
    const a = new ScriptedProvider("a", 99); // never succeeds
    const b = new ScriptedProvider("b", 0);
    const gw = new Gateway({
      providers: [a, b],
      profiles: [
        profile({
          route: [
            { provider: "a", model: "claude-haiku-4-5" },
            { provider: "b", model: "gemini-2.5-flash" },
          ],
          retriesPerModel: 1,
        }),
      ],
      noSleep: true,
    });
    const result = await gw.complete("t", { prompt: "hello" });
    expect(a.calls).toBe(2); // initial + 1 retry
    expect(result.servedBy.provider).toBe("b");
    expect(result.attempts).toHaveLength(3);
  });

  it("throws AllModelsFailedError with the attempt trail when the chain is exhausted", async () => {
    const gw = new Gateway({
      providers: [new ScriptedProvider("a", 99)],
      profiles: [profile({ retriesPerModel: 1 })],
      noSleep: true,
    });
    const err = await gw.complete("t", { prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(AllModelsFailedError);
    expect(err.attempts).toHaveLength(2);
  });

  it("rejects unknown tasks and unknown providers loudly", async () => {
    const gw = new Gateway({
      providers: [new ScriptedProvider("a", 0)],
      profiles: [profile()],
      noSleep: true,
    });
    await expect(gw.complete("nope", { prompt: "x" })).rejects.toThrow(/unknown task/);
    expect(
      () =>
        new Gateway({
          providers: [],
          profiles: [profile()],
          noSleep: true,
        }),
    ).toThrow(/unknown provider/);
  });
});

describe("ledger", () => {
  it("records every attempt with cost and aggregates correctly", async () => {
    const a = new ScriptedProvider("a", 1);
    const gw = new Gateway({
      providers: [a],
      profiles: [profile({ retriesPerModel: 1 })],
      noSleep: true,
    });
    await gw.complete("t", { prompt: "hello" });
    const rows = gw.ledger.rows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.calls).toBe(2);
    expect(row?.failures).toBe(1);
    expect(row?.successRate).toBe(0.5);
    // haiku pricing: (100 * $1 + 50 * $5) / 1M
    expect(row?.totalCostUsd).toBeCloseTo(0.00035, 6);
  });

  it("prices unknown models at zero instead of guessing", async () => {
    const gw = new Gateway({
      providers: [new ScriptedProvider("a", 0)],
      profiles: [profile({ route: [{ provider: "a", model: "some-new-model" }] })],
      noSleep: true,
    });
    const result = await gw.complete("t", { prompt: "x" });
    expect(result.costUsd).toBe(0);
  });

  it("accepts price overrides", async () => {
    const gw = new Gateway({
      providers: [new ScriptedProvider("a", 0)],
      profiles: [profile({ route: [{ provider: "a", model: "custom" }] })],
      prices: { custom: { inputPerMTok: 10, outputPerMTok: 20 } },
      noSleep: true,
    });
    const result = await gw.complete("t", { prompt: "x" });
    expect(result.costUsd).toBeCloseTo((100 * 10 + 50 * 20) / 1_000_000, 9);
  });
});

describe("mock provider determinism", () => {
  it("same seed yields the same attempt trail", async () => {
    const run = async () => {
      const gw = new Gateway({
        providers: [new MockProvider({ seed: 7, instant: true })],
        profiles: [
          profile({
            route: [
              { provider: "mock", model: "mock-small" },
              { provider: "mock", model: "mock-large" },
            ],
          }),
        ],
        noSleep: true,
      });
      const out: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await gw.complete("t", { prompt: `p${i}` });
        out.push(...r.attempts.map((a) => a.ok));
      }
      return out;
    };
    expect(await run()).toEqual(await run());
  });
});
