/** Performance and rule state, for tuning. Not part of the practice experience. */
import type { RuleResult } from "@asan/core";
import type { Perf } from "../lib/practiceRunner.ts";

const STATUS_COLOR: Record<string, string> = {
  pass: "text-emerald-400",
  tooLow: "text-red-400",
  tooHigh: "text-red-400",
  skipped: "text-slate-500",
};

export function DebugPanel({
  perf,
  ruleStates,
  meanVelocity,
  missing,
}: {
  perf: Perf;
  ruleStates: RuleResult[];
  meanVelocity: number;
  missing: string[];
}) {
  return (
    <details className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-sm">
      <summary className="cursor-pointer text-slate-300">
        Debug — {perf.fps.toFixed(1)} fps, {perf.variant}, {perf.frameMs.toFixed(0)} ms
      </summary>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400 sm:grid-cols-4">
        <Row label="FPS" value={perf.fps.toFixed(1)} />
        <Row label="Frame time" value={`${perf.frameMs.toFixed(1)} ms`} />
        <Row label="Model" value={perf.variant} />
        <Row label="Stride" value={`every ${perf.frameStride === 1 ? "frame" : "2nd frame"}`} />
        <Row label="Velocity" value={`${meanVelocity.toFixed(3)} m/s`} />
        <Row label="Missing" value={missing.length === 0 ? "none" : missing.join(", ")} />
      </dl>

      {perf.slowDevice && (
        <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-amber-300">
          This device is running below 10 fps. Feedback will lag behind you.
        </p>
      )}

      <table className="mt-3 w-full text-left tabular-nums">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1">Rule</th>
            <th className="py-1">Priority</th>
            <th className="py-1">Value</th>
            <th className="py-1">State</th>
          </tr>
        </thead>
        <tbody>
          {ruleStates.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-slate-500">
                Not judging yet.
              </td>
            </tr>
          )}
          {ruleStates.map((rule) => (
            <tr key={rule.ruleId} className="border-t border-slate-800">
              <td className="py-1 pr-2 text-slate-300">{rule.ruleId}</td>
              <td className="py-1 pr-2 text-slate-500">{rule.priority}</td>
              <td className="py-1 pr-2 text-slate-400">
                {rule.value === null ? "—" : rule.value.toFixed(1)}
              </td>
              <td className={`py-1 ${STATUS_COLOR[rule.status] ?? "text-slate-400"}`}>
                {rule.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-300">{value}</dd>
    </div>
  );
}
