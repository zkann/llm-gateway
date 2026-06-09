# llm-gateway

Tool 2 of OpsCenter (see `../CLAUDE.md` for the suite-wide guide). A TypeScript
multi-model LLM router: task-profile routing, same-model retries with backoff,
cross-provider fallback, and a cost-per-task ledger. Public, single repo, MIT.

It exists to make the "built the LLM routing/cost/reliability layer by hand"
claim verifiable in public code; the production original lives in Content
Raptor's private codebase. Honest scope: portfolio-grade library + CLI, no
server/streaming/queueing.

## Layout

- `src/types.ts`: contracts: Provider, TaskProfile (route = fallback chain), AttemptRecord, RouteResult
- `src/gateway.ts`: the router: chain walk, retries × backoff, ledger writes
- `src/ledger.ts`: every attempt (failures included) + aggregation rows
- `src/pricing.ts`: $/MTok table (June 2026 defaults, override via `prices`)
- `src/providers/`: anthropic, gemini, and the deterministic seeded mock
- `src/report.ts`: terminal table; `src/cli.ts`: `demo` (zero-key) and `run`

## Conventions

- Strict tsc + Biome (`npm run lint` / `typecheck` / `test`; vitest).
- The mock provider is the demo AND test backend: seeded PRNG, planted failure
  rates, deterministic trails. Keep `npm run demo` working with zero keys.
- Provider SDK retries stay disabled (maxRetries 0); retrying is the gateway's
  job; double-retrying skews telemetry and fallback timing.
- Unknown models price at $0, never a guess; add to the table or pass `prices`.
- CI: lint, typecheck, test, build, run the demo, gitleaks.
