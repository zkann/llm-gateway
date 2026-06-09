import { Ledger } from "./ledger.js";
import { DEFAULT_PRICES, type ModelPrice, costUsd } from "./pricing.js";
import {
  AllModelsFailedError,
  type AttemptRecord,
  type CompletionRequest,
  type Provider,
  type RouteResult,
  type TaskProfile,
} from "./types.js";

export interface GatewayOptions {
  providers: Provider[];
  profiles: TaskProfile[];
  /** Price overrides/additions, merged over the defaults. */
  prices?: Record<string, ModelPrice>;
  /** Base delay for exponential backoff between same-model retries. */
  backoffBaseMs?: number;
  /** Cap on any single backoff sleep. */
  backoffMaxMs?: number;
  /** Skip backoff sleeps entirely (tests, demos). */
  noSleep?: boolean;
}

/**
 * The router. One instance owns the provider pool, the task profiles, and the
 * ledger; `complete(task, request)` walks the task's fallback chain:
 *
 *   model[0] × (1 + retriesPerModel) attempts with exponential backoff,
 *   then model[1], and so on. First success wins; every attempt — success or
 *   failure — lands in the ledger with latency, tokens, and cost.
 */
export class Gateway {
  readonly ledger = new Ledger();
  private providers: Map<string, Provider>;
  private profiles: Map<string, TaskProfile>;
  private prices: Record<string, ModelPrice>;
  private backoffBaseMs: number;
  private backoffMaxMs: number;
  private noSleep: boolean;

  constructor(opts: GatewayOptions) {
    this.providers = new Map(opts.providers.map((p) => [p.name, p]));
    this.profiles = new Map(opts.profiles.map((p) => [p.name, p]));
    this.prices = { ...DEFAULT_PRICES, ...(opts.prices ?? {}) };
    this.backoffBaseMs = opts.backoffBaseMs ?? 250;
    this.backoffMaxMs = opts.backoffMaxMs ?? 4000;
    this.noSleep = opts.noSleep ?? false;

    for (const profile of opts.profiles) {
      for (const ref of profile.route) {
        if (!this.providers.has(ref.provider)) {
          throw new Error(
            `profile "${profile.name}" routes to unknown provider "${ref.provider}"`,
          );
        }
      }
    }
  }

  async complete(task: string, req: CompletionRequest): Promise<RouteResult> {
    const profile = this.profiles.get(task);
    if (!profile) {
      throw new Error(
        `unknown task "${task}"; known tasks: ${[...this.profiles.keys()].join(", ")}`,
      );
    }

    const attempts: AttemptRecord[] = [];
    const started = Date.now();

    for (const ref of profile.route) {
      const provider = this.providers.get(ref.provider);
      if (!provider) continue; // validated in constructor; belt and suspenders

      for (let retry = 0; retry <= profile.retriesPerModel; retry++) {
        if (retry > 0) await this.backoff(retry);

        const attemptStart = Date.now();
        try {
          const response = await provider.complete(ref.model, {
            ...req,
            maxTokens: req.maxTokens ?? profile.maxTokens,
            ...((req.system ?? profile.system) ? { system: req.system ?? profile.system } : {}),
          });
          const record: AttemptRecord = {
            task,
            provider: ref.provider,
            model: ref.model,
            attempt: attempts.length + 1,
            ok: true,
            latencyMs: Date.now() - attemptStart,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            costUsd: costUsd(
              ref.model,
              response.inputTokens,
              response.outputTokens,
              this.prices,
            ),
            timestampMs: attemptStart,
          };
          attempts.push(record);
          this.ledger.record(record);
          return {
            text: response.text,
            task,
            servedBy: ref,
            attempts,
            costUsd: attempts.reduce((sum, a) => sum + a.costUsd, 0),
            latencyMs: Date.now() - started,
          };
        } catch (err) {
          const record: AttemptRecord = {
            task,
            provider: ref.provider,
            model: ref.model,
            attempt: attempts.length + 1,
            ok: false,
            latencyMs: Date.now() - attemptStart,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            error: err instanceof Error ? err.message : String(err),
            timestampMs: attemptStart,
          };
          attempts.push(record);
          this.ledger.record(record);
        }
      }
    }

    throw new AllModelsFailedError(task, attempts);
  }

  private async backoff(retry: number): Promise<void> {
    if (this.noSleep) return;
    const delay = Math.min(this.backoffBaseMs * 2 ** (retry - 1), this.backoffMaxMs);
    const jitter = delay * 0.2 * Math.random();
    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  }
}
