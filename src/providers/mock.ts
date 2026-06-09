import type { CompletionRequest, CompletionResponse, Provider } from "../types.js";

/**
 * Deterministic mock provider: the zero-key demo and test backend.
 *
 * Seeded PRNG, configurable per-model failure rates and latency, so routing,
 * retries, and fallback can be exercised reproducibly without credentials —
 * the same philosophy as cost-engine's synthetic CUR. Token counts are derived
 * from prompt/response length so the cost ledger carries realistic numbers.
 */

export interface MockModelBehavior {
  /** Probability an individual call fails (0..1). */
  failureRate: number;
  /** Simulated latency range in ms. */
  latencyMs: [number, number];
}

const DEFAULT_BEHAVIOR: Record<string, MockModelBehavior> = {
  "mock-small": { failureRate: 0.25, latencyMs: [40, 120] },
  "mock-large": { failureRate: 0.05, latencyMs: [150, 400] },
};

/** Mulberry32: tiny deterministic PRNG, plenty for simulation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockProvider implements Provider {
  readonly name = "mock";
  private rng: () => number;
  private behavior: Record<string, MockModelBehavior>;
  /** When true, latency is simulated logically but not actually slept. */
  private instant: boolean;

  constructor(opts?: {
    seed?: number;
    behavior?: Record<string, MockModelBehavior>;
    instant?: boolean;
  }) {
    this.rng = mulberry32(opts?.seed ?? 42);
    this.behavior = opts?.behavior ?? DEFAULT_BEHAVIOR;
    this.instant = opts?.instant ?? false;
  }

  async complete(model: string, req: CompletionRequest): Promise<CompletionResponse> {
    const behavior = this.behavior[model] ?? { failureRate: 0, latencyMs: [50, 100] };
    const [lo, hi] = behavior.latencyMs;
    const latency = Math.round(lo + this.rng() * (hi - lo));
    if (!this.instant) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
    if (this.rng() < behavior.failureRate) {
      throw new Error(`simulated ${model} overload (529)`);
    }
    const inputTokens = Math.max(8, Math.round(req.prompt.length / 4));
    const outputTokens = Math.min(req.maxTokens ?? 1024, 64 + Math.round(this.rng() * 192));
    return {
      text: `[${model}] simulated completion for: ${req.prompt.slice(0, 48)}…`,
      inputTokens,
      outputTokens,
    };
  }
}
