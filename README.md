# llm-gateway

A multi-model LLM router in TypeScript. Route each *task* to the model that
earns it, retry with exponential backoff, fall back across providers when one
is down, and account for every attempt in a cost-per-task ledger.

This is the pattern behind production multi-model apps (cheap model for bulk
work, stronger model where quality pays, a second provider as insurance),
extracted into a small, typed, dependency-light library you can read in one
sitting.

```
request("summarize", ...) ──▶ profile: summarize
                                │
                                ├─ claude-haiku-4-5     (retry ×2, backoff)
                                ├─ gemini-2.5-flash     (fallback)
                                ▼
                              ledger: tokens · latency · $ per attempt
```

## Try it in ten seconds (no API keys)

```bash
git clone https://github.com/zkann/llm-gateway
cd llm-gateway
npm install
npm run demo
```

The demo routes six tasks through a deterministic mock provider with planted
failure rates, so you can watch same-model retry and fallback happen, then
prints the ledger:

```
[summarize] mock-small✗ -> mock-small  ($0.00084, 2 attempts)
[summarize] mock-small  ($0.00056, 1 attempt)
...
task             model                  calls  ok    cost       avg/task   p50     p95
------------------------------------------------------------------------------------------
draft            mock/mock-large        2      100%  $0.00945   $0.00472   201ms   285ms
summarize        mock/mock-small        5      80%   $0.00281   $0.00070   73ms    120ms
------------------------------------------------------------------------------------------
total spend: $0.01
```

## Use it as a library

```ts
import { AnthropicProvider, Gateway, GeminiProvider, renderReport } from "llm-gateway";

const gateway = new Gateway({
  providers: [new AnthropicProvider(), new GeminiProvider()],
  profiles: [
    {
      name: "summarize",                 // bulk work: cheap model, cross-provider insurance
      route: [
        { provider: "anthropic", model: "claude-haiku-4-5" },
        { provider: "gemini", model: "gemini-2.5-flash" },
      ],
      retriesPerModel: 2,
      maxTokens: 512,
    },
    {
      name: "draft",                     // quality-critical: stronger model first
      route: [
        { provider: "anthropic", model: "claude-sonnet-4-6" },
        { provider: "gemini", model: "gemini-2.5-pro" },
      ],
      retriesPerModel: 2,
      maxTokens: 2048,
    },
  ],
});

const result = await gateway.complete("summarize", { prompt: "..." });
result.text;        // the completion
result.servedBy;    // which model actually answered
result.costUsd;     // dollars spent on this request, failed attempts included
result.attempts;    // the full trail: every try, with latency and error

console.log(renderReport(gateway.ledger));  // cost/latency/success by task x model
gateway.ledger.sinkTo("gateway.ledger.jsonl");  // durable JSONL trail
```

Provider credentials come from the standard env vars (`ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`). Provider-level SDK retries are disabled on purpose: retries
are the gateway's job, and double-retrying skews telemetry and fallback timing.

## Design notes

- **Tasks, not calls, are the routing unit.** A `TaskProfile` names the work
  ("summarize", "draft") and owns its fallback chain, retry budget, token cap,
  and system prompt. Callers say what they're doing; the profile decides who
  does it.
- **The ledger records failures too.** Cost-per-task is only honest if the
  retries that produced nothing are counted against the task. Aggregations
  report success rate, p50/p95 latency, and average cost per successful task.
- **Prices are data, not constants.** A built-in table (June 2026) covers the
  common models; pass `prices` to override or extend. Unknown models cost $0
  rather than being silently mispriced.
- **Custom providers are one interface away.** Implement `Provider` (a name and
  a `complete()`) to add OpenAI, a local model, or your own stub.

## Develop

```bash
npm test             # vitest (9 tests: routing, retries, fallback, ledger math)
npm run lint         # biome
npm run typecheck    # tsc --noEmit, strict
```

Honest scope: this is a portfolio-grade demonstration of the routing/cost/
reliability layer, not a hosted gateway product. No streaming, no server, no
queueing; the surface is deliberately small enough to audit.

## License

MIT. Built by [Zak Kann](https://zakkann.com). Part of
[OpsCenter](https://github.com/zkann), a suite of applied-AI, automation, and
cloud tools. Sibling project: [cost-engine](https://github.com/zkann/cost-engine),
a FinOps analyzer that finds dollar-quantified savings in an AWS bill.
