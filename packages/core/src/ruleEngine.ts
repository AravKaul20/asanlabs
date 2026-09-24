/**
 * The rule engine: judges one frame of features against a pose definition.
 *
 * `evaluate` is a pure function. All state it needs — the previous result, for
 * hysteresis — is passed in, so a session can be replayed frame by frame and
 * produce identical output every time.
 */
import { resolveJoint } from "./landmarks.ts";
import { resolveFeatureName } from "./features/extractor.ts";
import type { PoseDefinition, PoseRule } from "./pose/schema.ts";
import type { EvalResult, Features, RuleResult, RuleStatus, Side } from "./types.ts";

/** A rule is only judged when every landmark it depends on is at least this visible. */
export const VISIBILITY_THRESHOLD = 0.5;

function classify(value: number, rule: PoseRule, wasPassing: boolean): RuleStatus {
  const [min, max] = rule.range;
  // A rule that was already passing gets a wider band before it starts failing,
  // so a value hovering on the boundary does not flap the cue on and off.
  const pad = wasPassing ? rule.hysteresis : 0;
  if (value < min - pad) return "tooLow";
  if (value > max + pad) return "tooHigh";
  return "pass";
}

export class RuleEngine {
  /**
   * @param features  extracted features for this frame
   * @param pose      the pose being coached
   * @param side      which side the session treats as front
   * @param prev      the previous frame's result, or null to start clean
   */
  evaluate(
    features: Features,
    pose: PoseDefinition,
    side: Side,
    prev: EvalResult | null,
  ): EvalResult {
    const previousStatus = new Map<string, RuleStatus>();
    if (prev) for (const r of prev.results) previousStatus.set(r.ruleId, r.status);

    const results: RuleResult[] = [];
    let passingWeight = 0;
    let judgedWeight = 0;

    for (const rule of pose.rules) {
      const highlight = rule.highlight
        .map((joint) => resolveJoint(joint, side))
        .filter((joint): joint is NonNullable<typeof joint> => joint !== undefined);

      const feature = features.values[resolveFeatureName(rule.feature, side)];
      const judgeable =
        feature !== undefined &&
        Number.isFinite(feature.value) &&
        feature.minVisibility >= VISIBILITY_THRESHOLD;

      if (!judgeable) {
        results.push({
          ruleId: rule.id,
          status: "skipped",
          value: null,
          weight: rule.weight,
          priority: rule.priority,
          highlight,
        });
        continue;
      }

      const status = classify(feature.value, rule, previousStatus.get(rule.id) === "pass");
      judgedWeight += rule.weight;
      if (status === "pass") passingWeight += rule.weight;

      results.push({
        ruleId: rule.id,
        status,
        value: feature.value,
        weight: rule.weight,
        priority: rule.priority,
        highlight,
      });
    }

    return {
      t: features.t,
      results,
      // Weighted share of passing rules among those we could actually judge.
      // Never a similarity percentage: distance outside the range is irrelevant.
      score: judgedWeight > 0 ? (passingWeight / judgedWeight) * 100 : 0,
      judged: judgedWeight > 0,
    };
  }
}
