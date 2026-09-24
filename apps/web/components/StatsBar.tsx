/**
 * Hold time and form score.
 *
 * The score is a weighted share of passing rules, never a similarity percentage,
 * and the hold timer only counts seconds where the form was actually correct.
 */
export function StatsBar({
  holdSeconds,
  score,
  settled,
}: {
  holdSeconds: number;
  score: number;
  settled: boolean;
}) {
  return (
    <div className="flex items-stretch gap-3">
      <Stat label="Hold" value={`${holdSeconds.toFixed(1)}s`} hint="correct form only" />
      <Stat label="Form" value={`${Math.round(score)}`} hint="share of rules passing" />
      <Stat
        label="Status"
        value={settled ? "In pose" : "Settling"}
        hint={settled ? "judging" : "waiting for you to be still"}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex-1 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}
