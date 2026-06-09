/** Core contracts. Everything else in the gateway speaks these types. */

/** A single completion request, provider-agnostic. */
export interface CompletionRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
}

/** What a provider returns on success. */
export interface CompletionResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * A model served by a provider. Providers own the API call; the gateway owns
 * routing, retries, fallback, and accounting.
 */
export interface Provider {
  readonly name: string;
  complete(model: string, req: CompletionRequest): Promise<CompletionResponse>;
}

/** A concrete routing target: which provider, which model. */
export interface ModelRef {
  provider: string;
  model: string;
}

/**
 * A task profile is the routing unit: requests are made per *task*, and the
 * profile decides which models serve it and in what order.
 *
 * `route` is a fallback chain: the first entry is primary; each subsequent
 * entry is tried only after the previous one exhausts its retries. This is the
 * generalization of the production pattern this repo demonstrates (cheap model
 * for bulk work, stronger model where it matters, a different provider when
 * one is down).
 */
export interface TaskProfile {
  /** Stable task name, e.g. "summarize", "draft-intro". */
  name: string;
  /** Fallback chain, primary first. */
  route: ModelRef[];
  /** Retries per chain entry before falling through (same-provider retries). */
  retriesPerModel: number;
  /** Default max output tokens for this task. */
  maxTokens: number;
  /** Optional system prompt applied to every request for this task. */
  system?: string;
}

/** One attempt against one model, success or failure. Ledger currency. */
export interface AttemptRecord {
  task: string;
  provider: string;
  model: string;
  /** 1-based attempt number across the whole chain for this request. */
  attempt: number;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
  timestampMs: number;
}

/** The gateway's answer: the response plus how it got there and what it cost. */
export interface RouteResult {
  text: string;
  task: string;
  servedBy: ModelRef;
  attempts: AttemptRecord[];
  costUsd: number;
  latencyMs: number;
}

export class AllModelsFailedError extends Error {
  constructor(
    readonly task: string,
    readonly attempts: AttemptRecord[],
  ) {
    super(
      `all models failed for task "${task}" after ${attempts.length} attempt(s): ` +
        attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join("; "),
    );
    this.name = "AllModelsFailedError";
  }
}
