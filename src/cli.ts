#!/usr/bin/env node
/**
 * llm-gateway CLI.
 *
 *   llm-gateway demo                       zero-key routing demo (mock provider)
 *   llm-gateway run --task T --prompt P    route one real request (needs API keys)
 *
 * The demo is deterministic (seeded mock with planted failure rates) so the
 * retry/fallback behavior and the cost ledger are visible without credentials.
 */

import { Gateway } from "./gateway.js";
import { MockProvider } from "./providers/mock.js";
import { renderReport } from "./report.js";
import type { TaskProfile } from "./types.js";

const DEMO_PROFILES: TaskProfile[] = [
  {
    // Bulk work on the cheap model; the strong model is the fallback.
    name: "summarize",
    route: [
      { provider: "mock", model: "mock-small" },
      { provider: "mock", model: "mock-large" },
    ],
    retriesPerModel: 1,
    maxTokens: 256,
    system: "Summarize crisply.",
  },
  {
    // Quality-critical work goes straight to the strong model.
    name: "draft",
    route: [{ provider: "mock", model: "mock-large" }],
    retriesPerModel: 2,
    maxTokens: 1024,
  },
];

async function demo(): Promise<void> {
  const gateway = new Gateway({
    providers: [new MockProvider({ seed: 7 })],
    profiles: DEMO_PROFILES,
    noSleep: true,
  });

  const prompts = [
    ["summarize", "Summarize the Q2 cloud spend report for the leadership update"],
    ["summarize", "Summarize this incident postmortem for the weekly digest"],
    ["summarize", "Summarize customer feedback themes from June"],
    ["summarize", "Summarize the migration runbook for on-call"],
    ["draft", "Draft the launch announcement for the new analytics feature"],
    ["draft", "Draft a renewal email for an at-risk enterprise account"],
  ] as const;

  console.log("llm-gateway demo - deterministic mock provider, no API keys\n");
  for (const [task, prompt] of prompts) {
    const result = await gateway.complete(task, { prompt });
    const path = result.attempts.map((a) => `${a.model}${a.ok ? "" : "✗"}`).join(" -> ");
    console.log(
      `[${task}] ${path}  ($${result.costUsd.toFixed(5)}, ${result.attempts.length} attempt${result.attempts.length === 1 ? "" : "s"})`,
    );
  }

  console.log(`\n${renderReport(gateway.ledger)}`);
  console.log(
    "failed attempts above are planted (mock-small fails ~25% of calls) to show\nsame-model retry and cross-model fallback in action.",
  );
}

async function run(args: Map<string, string>): Promise<void> {
  const task = args.get("task");
  const prompt = args.get("prompt");
  if (!task || !prompt) {
    console.error("usage: llm-gateway run --task <name> --prompt <text>");
    process.exit(2);
  }

  // Real providers are imported lazily so the zero-key demo never needs them.
  const { AnthropicProvider } = await import("./providers/anthropic.js");
  const { GeminiProvider } = await import("./providers/gemini.js");

  const profiles: TaskProfile[] = [
    {
      name: "summarize",
      route: [
        { provider: "anthropic", model: "claude-haiku-4-5" },
        { provider: "gemini", model: "gemini-2.5-flash" },
      ],
      retriesPerModel: 2,
      maxTokens: 512,
    },
    {
      name: "draft",
      route: [
        { provider: "anthropic", model: "claude-sonnet-4-6" },
        { provider: "gemini", model: "gemini-2.5-pro" },
      ],
      retriesPerModel: 2,
      maxTokens: 2048,
    },
  ];

  const gateway = new Gateway({
    providers: [new AnthropicProvider(), new GeminiProvider()],
    profiles,
  });

  const result = await gateway.complete(task, { prompt });
  console.log(result.text);
  console.error(
    `\n[served by ${result.servedBy.provider}/${result.servedBy.model} in ${result.latencyMs}ms, ` +
      `$${result.costUsd.toFixed(5)}, ${result.attempts.length} attempt(s)]`,
  );
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--")) {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        args.set(arg.slice(2), value);
        i++;
      } else {
        args.set(arg.slice(2), "true");
      }
    }
  }
  return args;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "demo") {
  demo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (command === "run") {
  run(parseArgs(rest)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  console.log("usage: llm-gateway <demo|run>\n");
  console.log("  demo                          zero-key routing demo (mock provider)");
  console.log("  run --task T --prompt P       route a real request (needs API keys)");
  process.exit(command ? 2 : 0);
}
