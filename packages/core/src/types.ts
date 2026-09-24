/**
 * Core data types for the asan pipeline.
 *
 * Nothing in `packages/core` may touch the DOM, the browser, or Node APIs: the
 * `lib`/`types` settings in this package's tsconfig enforce that. Time is always
 * injected so every stage is deterministically testable.
 */

/** A landmark in normalized image space (x, y in 0..1). Drawing only — never angles. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** A landmark in world space: meters, origin at the midpoint between the hips. */
export interface WorldLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** One processed frame of pose data. `t` is milliseconds on an arbitrary monotonic clock. */
export interface Frame {
  t: number;
  image: Landmark[];
  world: WorldLandmark[];
  visibility: number[];
}

/** Which side of the body a session treats as "front". */
export type Side = "left" | "right";

/** A single extracted feature: its value plus the weakest visibility it depends on. */
export interface FeatureValue {
  /** Degrees for angles, dimensionless (normalized by a body length) for offsets. */
  value: number;
  /** The lowest `visibility` among the landmarks this feature was computed from. */
  minVisibility: number;
}

/** All features extractable from one frame, keyed by feature name. */
export interface Features {
  t: number;
  side: Side;
  values: Record<string, FeatureValue>;
}

export type Priority = "safety" | "alignment" | "refinement";

/**
 * Outcome of one rule on one frame.
 * `skipped` means the rule's landmarks were not visible enough to judge.
 */
export type RuleStatus = "pass" | "tooLow" | "tooHigh" | "skipped";

export interface RuleResult {
  ruleId: string;
  status: RuleStatus;
  /** The feature value the rule saw, or null when skipped. */
  value: number | null;
  weight: number;
  priority: Priority;
  /** Joints to highlight when this rule is the active cue. */
  highlight: string[];
}

export interface EvalResult {
  t: number;
  results: RuleResult[];
  /** Weighted share of judged rules that passed, 0..100. */
  score: number;
  /** False when every rule was skipped, i.e. we could not judge the pose at all. */
  judged: boolean;
}

/** One coaching instruction. The same text goes to voice and to screen. */
export interface Cue {
  ruleId: string;
  text: string;
  priority: Priority;
  highlight: string[];
}

export type CueEvent =
  | { type: "cue"; t: number; cue: Cue }
  | { type: "fixed"; t: number; ruleId: string; text: string }
  | { type: "clear"; t: number };

/** Injected clock. Core never reads the wall clock itself. */
export interface Clock {
  now(): number;
}
