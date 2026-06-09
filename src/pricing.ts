/**
 * Per-model price table, USD per million tokens.
 *
 * Prices drift; these defaults are current as of June 2026 and every entry can
 * be overridden (or extended) via the gateway's `prices` option, so the ledger
 * is never locked to a stale table. Unknown models cost $0 and are flagged in
 * the report rather than silently priced wrong.
 */

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-opus-4-8": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  // Google (defaults; check current Gemini pricing for your account)
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  // The zero-key demo provider: priced like a real budget model so demo
  // ledgers carry meaningful numbers.
  "mock-small": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "mock-large": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
};

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices: Record<string, ModelPrice> = DEFAULT_PRICES,
): number {
  const price = prices[model];
  if (!price) return 0;
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

export function isPriced(
  model: string,
  prices: Record<string, ModelPrice> = DEFAULT_PRICES,
): boolean {
  return model in prices;
}
