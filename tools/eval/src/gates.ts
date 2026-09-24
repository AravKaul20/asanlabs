/**
 * The Phase 0 ship gates.
 *
 * A gate can come out three ways, and the third matters: with too few people in
 * the corpus, precision and recall are noise. Reporting that as a pass would be
 * worse than reporting a failure, so "insufficient data" is its own verdict and
 * never reads as green.
 */
import type { Priority } from "@asan/core";
import type { RuleMetrics } from "./metrics.ts";

export interface Threshold {
  minPrecision: number;
  minRecall: number;
}

export const PRIORITY_GATES: Record<Priority, Threshold | null> = {
  safety: { minPrecision: 0.8, minRecall: 0.7 },
  alignment: { minPrecision: 0.75, minRecall: 0.6 },
  // Refinement cues are cosmetic; no accuracy gate, but the false-alarm budget
  // below still applies to them.
  refinement: null,
};

/** Every rule, whatever its priority, shares one false-alarm budget. */
export const MAX_FALSE_ALARMS_PER_MINUTE = 0.5;

/** Below this many people the accuracy gates cannot be read honestly. */
export const MIN_PERSONS_FOR_GATES = 3;
/** Below this much judged time per rule the same applies. */
export const MIN_JUDGED_MS_PER_RULE = 20000;

export type Verdict = "pass" | "fail" | "insufficient";

export interface GateResult {
  ruleId: string;
  priority: Priority;
  verdict: Verdict;
  reasons: string[];
}

const pct = (n: number | undefined) => (n === undefined ? "n/a" : `${(n * 100).toFixed(1)}%`);

export function gradeRule(metrics: RuleMetrics, personCount: number): GateResult {
  const reasons: string[] = [];
  const judgedMs = metrics.tpMs + metrics.fpMs + metrics.fnMs + metrics.tnMs;

  // The false-alarm budget is checkable with any amount of correct-form footage.
  let failed = false;
  if (metrics.falseAlarmsPerMinute > MAX_FALSE_ALARMS_PER_MINUTE) {
    failed = true;
    reasons.push(
      `${metrics.falseAlarmsPerMinute.toFixed(2)} false alarms/min exceeds ${MAX_FALSE_ALARMS_PER_MINUTE}`,
    );
  }

  const gate = PRIORITY_GATES[metrics.priority];
  const thin: string[] = [];
  if (personCount < MIN_PERSONS_FOR_GATES) {
    thin.push(`only ${personCount} person(s) in corpus, need ${MIN_PERSONS_FOR_GATES}`);
  }
  if (judgedMs < MIN_JUDGED_MS_PER_RULE) {
    thin.push(
      `only ${(judgedMs / 1000).toFixed(1)}s judged, need ${MIN_JUDGED_MS_PER_RULE / 1000}s`,
    );
  }

  if (gate) {
    if (metrics.recall === undefined) thin.push("no labelled mistakes for this rule");
    if (metrics.precision === undefined) thin.push("rule never fired");

    if (thin.length === 0) {
      if ((metrics.precision ?? 0) < gate.minPrecision) {
        failed = true;
        reasons.push(`precision ${pct(metrics.precision)} below ${pct(gate.minPrecision)}`);
      }
      if ((metrics.recall ?? 0) < gate.minRecall) {
        failed = true;
        reasons.push(`recall ${pct(metrics.recall)} below ${pct(gate.minRecall)}`);
      }
    }
  }

  // A blown false-alarm budget is a real failure even on a thin corpus.
  if (failed)
    return { ruleId: metrics.ruleId, priority: metrics.priority, verdict: "fail", reasons };
  if (thin.length > 0) {
    return {
      ruleId: metrics.ruleId,
      priority: metrics.priority,
      verdict: "insufficient",
      reasons: thin,
    };
  }
  return { ruleId: metrics.ruleId, priority: metrics.priority, verdict: "pass", reasons: [] };
}

/** Overall verdict: any failure fails; otherwise any thin rule is insufficient. */
export function overallVerdict(results: readonly GateResult[]): Verdict {
  if (results.some((r) => r.verdict === "fail")) return "fail";
  if (results.length === 0 || results.some((r) => r.verdict === "insufficient")) {
    return "insufficient";
  }
  return "pass";
}
