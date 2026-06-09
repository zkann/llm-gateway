import type { Ledger } from "./ledger.js";

const money = (n: number) =>
  n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(5)}` : "$0";

/** Render the ledger as a fixed-width terminal table. */
export function renderReport(ledger: Ledger): string {
  const rows = ledger.rows();
  if (rows.length === 0) return "ledger is empty - no calls recorded yet\n";

  const header = [
    pad("task", 16),
    pad("model", 22),
    pad("calls", 6),
    pad("ok", 5),
    pad("cost", 10),
    pad("avg/task", 10),
    pad("p50", 7),
    pad("p95", 7),
  ].join(" ");
  const rule = "-".repeat(header.length);

  const lines = [header, rule];
  for (const r of rows) {
    lines.push(
      [
        pad(r.task, 16),
        pad(`${r.provider}/${r.model}`, 22),
        pad(String(r.calls), 6),
        pad(`${Math.round(r.successRate * 100)}%`, 5),
        pad(money(r.totalCostUsd), 10),
        pad(money(r.avgCostUsd), 10),
        pad(`${r.p50LatencyMs}ms`, 7),
        pad(`${r.p95LatencyMs}ms`, 7),
      ].join(" "),
    );
  }
  lines.push(rule);
  lines.push(`total spend: ${money(ledger.totalCostUsd())}`);
  return `${lines.join("\n")}\n`;
}

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}
