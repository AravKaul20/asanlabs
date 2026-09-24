/**
 * @asan/core — the pose-correction engine.
 *
 * Pure TypeScript: no DOM, no React, no browser or Node APIs, so it runs
 * unchanged in the browser, in Node (the eval harness) and later in React
 * Native. Time is always injected.
 *
 * Per-frame pipeline:
 *   FrameSmoother -> FeatureExtractor -> SettleGate -> RuleEngine -> CueManager
 *                                                              \-> FormScore
 */
export type {
  Clock,
  Cue,
  CueEvent,
  EvalResult,
  FeatureValue,
  Features,
  Frame,
  Landmark,
  Priority,
  RuleResult,
  RuleStatus,
  Side,
  WorldLandmark,
} from "./types.ts";

export {
  BODY_LANDMARKS,
  LANDMARK_COUNT,
  LANDMARK_NAMES,
  POSE_BONES,
  SIDED_JOINT_BASES,
  isJointReference,
  isLandmarkName,
  landmarkIndex,
  otherSide,
  resolveJoint,
  type LandmarkName,
} from "./landmarks.ts";

export {
  WORLD_UP,
  angleAtDeg,
  angleBetweenDeg,
  angleFromHorizontalDeg,
  distance,
  dot,
  horizontal,
  horizontalDistance,
  length,
  midpoint,
  normalizeVec,
  projectOnto,
  sub,
  tiltFromVerticalDeg,
  type Vec3,
} from "./geometry.ts";

export {
  DEFAULT_COORD_CONFIG,
  DEFAULT_VISIBILITY_CONFIG,
  FrameSmoother,
  OneEuroFilter,
  type OneEuroConfig,
} from "./oneEuro.ts";

export {
  FEATURE_DESCRIPTORS,
  SIDED_FEATURE_BASES,
  getDescriptor,
  type FeatureDescriptor,
} from "./features/registry.ts";

export {
  FEATURE_NAMES,
  FeatureExtractor,
  featureLandmarks,
  isKnownFeature,
  resolveFeatureName,
} from "./features/extractor.ts";

export {
  parsePose,
  poseSchema,
  prioritySchema,
  ruleSchema,
  safeParsePose,
  settleShapeSchema,
  sideSchema,
  sourceSchema,
  viewSchema,
  type PoseDefinition,
  type PoseRule,
  type SettleShape,
} from "./pose/schema.ts";

export { SettleGate, type SettleGateConfig, type SettleState } from "./settleGate.ts";
export { RuleEngine, VISIBILITY_THRESHOLD } from "./ruleEngine.ts";
export { CueManager, type CueManagerConfig } from "./cueManager.ts";
export { FormScore, isFormCorrect } from "./formScore.ts";
