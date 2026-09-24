/** Formatting the eval report for a terminal. */
import type { RuleMetrics } from "./metrics.ts";
import type { GateResult, Verdict } from "./gates.ts";

const pct = (n: number | undefined) =>
  n === undefined ? "    n/a" : `${(n * 100).toFixed(1)}%`.padStart(7);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const MARK: Record<Verdict, string> = { pass: "PASS", fail: "FAIL", insufficient: "THIN" };

export function formatMetricsTable(
  metrics: readonly RuleMetrics[],
  gates: readonly GateResult[],
): string {
  const byId = new Map(gates.map((g) => [g.ruleId, g]));
  const rows = [
    ["rule", "priority", "prec", "recall", "FA/min", "judged", "mistakes", "gate"],
    ["----", "--------", "----", "------", "------", "------", "--------", "----"],
  ];

  for (const m of metrics) {
    const judgedMs = m.tpMs + m.fpMs + m.fnMs + m.tnMs;
    rows.push([
      m.ruleId,
      m.priority,
      pct(m.precision),
      pct(m.recall),
      m.falseAlarmsPerMinute.toFixed(2),
      secs(judgedMs),
      `${m.mistakesDetected}/${m.mistakesTotal}`,
      MARK[byId.get(m.ruleId)?.verdict ?? "insufficient"],
    ]);
  }

  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows
    .map((r) =>
      r
        .map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function formatGateReasons(gates: readonly GateResult[]): string {
  const lines: string[] = [];
  for (const gate of gates) {
    if (gate.verdict === "pass") continue;
    lines.push(`  ${MARK[gate.verdict]} ${gate.ruleId}: ${gate.reasons.join("; ")}`);
  }
  return lines.join("\n");
}

export function verdictBanner(verdict: Verdict): string {
  if (verdict === "pass") return "SHIP GATES: PASS";
  if (verdict === "fail") return "SHIP GATES: FAIL";
  return [
    "SHIP GATES: INSUFFICIENT DATA — not a pass.",
    "The corpus is too thin to read precision and recall honestly.",
    "Record real clips from several people, label them, and run again.",
  ].join("\n");
}
