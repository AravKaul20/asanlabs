#!/usr/bin/env node
/**
 * `pnpm eval` — replays the labelled corpus in data/eval through the engine and
 * reports per-rule precision, recall and false alarms per minute against the
 * Phase 0 ship gates.
 *
 * Exit codes: 0 pass, 1 gates failed, 2 corpus too thin to judge, 3 load error.
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadCorpus, type CorpusEntry } from "./corpus.ts";
import { replay } from "./replay.ts";
import { MetricsAccumulator, type RuleMetrics } from "./metrics.ts";
import { gradeRule, overallVerdict } from "./gates.ts";
import { splitByPerson } from "./split.ts";
import { formatGateReasons, formatMetricsTable, verdictBanner } from "./report.ts";

const DEFAULT_DIR = new URL("../../../data/eval", import.meta.url).pathname;

function evaluate(entries: readonly CorpusEntry[]) {
  const accumulator = new MetricsAccumulator();
  let totalMs = 0;
  let settledMs = 0;
  for (const entry of entries) {
    const result = replay(entry.recording, entry.pose, entry.label.side);
    accumulator.add(result, entry.pose, entry.label.mistakes);
    totalMs += result.durationMs;
    settledMs += result.settledMs;
  }
  return { metrics: accumulator.results(), totalMs, settledMs };
}

function reportGroup(
  title: string,
  entries: readonly CorpusEntry[],
  persons: readonly string[],
): { metrics: RuleMetrics[]; verdict: ReturnType<typeof overallVerdict> } {
  const { metrics, totalMs, settledMs } = evaluate(entries);
  const gates = metrics.map((m) => gradeRule(m, persons.length));
  const verdict = overallVerdict(gates);

  console.log(`\n${title}`);
  console.log(`${"=".repeat(title.length)}`);
  console.log(
    `${entries.length} recording(s), ${persons.length} person(s): ${persons.join(", ") || "none"}`,
  );
  console.log(
    `${(totalMs / 1000).toFixed(1)}s recorded, ${(settledMs / 1000).toFixed(1)}s settled\n`,
  );
  if (metrics.length > 0) console.log(formatMetricsTable(metrics, gates));
  const reasons = formatGateReasons(gates);
  if (reasons) console.log(`\n${reasons}`);
  return { metrics, verdict };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log("Usage: pnpm eval [--dir <path to recordings>]");
    return 0;
  }

  const dir = resolve(values.dir ?? DEFAULT_DIR);
  const { entries, warnings } = await loadCorpus(dir);
  for (const warning of warnings) console.log(`warning: ${warning}`);

  if (entries.length === 0) {
    console.log(`No labelled recordings found in ${dir}.`);
    console.log(verdictBanner("insufficient"));
    return 2;
  }

  const persons = [...new Set(entries.map((e) => e.label.person))].sort();
  const split = splitByPerson(persons);

  reportGroup("All recordings", entries, persons);

  // The split exists to keep tuning honest: ranges are adjusted against the tune
  // group, and the gates are read from people the tuning never saw.
  if (split.test.length > 0) {
    const testSet = new Set(split.test);
    const tuneSet = new Set(split.tune);
    reportGroup(
      "Tune group (adjust ranges against these)",
      entries.filter((e) => tuneSet.has(e.label.person)),
      split.tune,
    );
    const heldOut = reportGroup(
      "Held-out group (the gates are read from here)",
      entries.filter((e) => testSet.has(e.label.person)),
      split.test,
    );
    console.log(`\n${verdictBanner(heldOut.verdict)}`);
    return heldOut.verdict === "pass" ? 0 : heldOut.verdict === "fail" ? 1 : 2;
  }

  console.log(
    "\nOnly one person in the corpus, so there is no held-out group and no split to make.",
  );
  const all = evaluate(entries);
  const verdict = overallVerdict(all.metrics.map((m) => gradeRule(m, persons.length)));
  console.log(`\n${verdictBanner(verdict)}`);
  return verdict === "pass" ? 0 : verdict === "fail" ? 1 : 2;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`eval failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(3);
  },
);
