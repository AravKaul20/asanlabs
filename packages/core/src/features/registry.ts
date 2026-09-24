/**
 * The feature registry: every named quantity the rule engine can reference.
 *
 * Each descriptor declares the landmarks it needs, so visibility gating is
 * derived rather than restated in every pose rule. All math runs on world
 * landmarks (meters, hip-centered) — never on 2D image coordinates.
 *
 * Adding a feature here is the only code change a new pose can require; ranges
 * and cues stay in pose JSON.
 */
import type { LandmarkName } from "../landmarks.ts";
import {
  angleAtDeg,
  angleFromHorizontalDeg,
  distance,
  horizontal,
  midpoint,
  projectOnto,
  sub,
  tiltFromVerticalDeg,
  type Vec3,
} from "../geometry.ts";

export type JointGetter = (name: LandmarkName) => Vec3;

export interface FeatureDescriptor {
  name: string;
  /** Landmarks this feature reads. The weakest one's visibility gates the rule. */
  landmarks: readonly LandmarkName[];
  /** Degrees for angles; a ratio of a body length for offsets. */
  unit: "deg" | "ratio";
  compute(get: JointGetter): number;
}

/** Base names that exist per side and can be addressed as front_ / back_. */
export const SIDED_FEATURE_BASES = [
  "knee_angle",
  "hip_angle",
  "elbow_angle",
  "shoulder_angle",
  "knee_over_ankle",
] as const;

function sidedDescriptors(side: "left" | "right"): FeatureDescriptor[] {
  const hip: LandmarkName = `${side}_hip`;
  const knee: LandmarkName = `${side}_knee`;
  const ankle: LandmarkName = `${side}_ankle`;
  const shoulder: LandmarkName = `${side}_shoulder`;
  const elbow: LandmarkName = `${side}_elbow`;
  const wrist: LandmarkName = `${side}_wrist`;

  return [
    {
      name: `${side}_knee_angle`,
      landmarks: [hip, knee, ankle],
      unit: "deg",
      compute: (g) => angleAtDeg(g(hip), g(knee), g(ankle)),
    },
    {
      name: `${side}_hip_angle`,
      landmarks: [shoulder, hip, knee],
      unit: "deg",
      compute: (g) => angleAtDeg(g(shoulder), g(hip), g(knee)),
    },
    {
      name: `${side}_elbow_angle`,
      landmarks: [shoulder, elbow, wrist],
      unit: "deg",
      compute: (g) => angleAtDeg(g(shoulder), g(elbow), g(wrist)),
    },
    {
      name: `${side}_shoulder_angle`,
      landmarks: [elbow, shoulder, hip],
      unit: "deg",
      compute: (g) => angleAtDeg(g(elbow), g(shoulder), g(hip)),
    },
    {
      /**
       * How far the knee sits past the ankle along the ground, as a fraction of
       * leg length. Positive means the knee has travelled outward beyond the
       * ankle (the Warrior II safety fault); negative means it trails behind.
       *
       * "Outward" is the horizontal direction from the hip center to that ankle,
       * so the sign is the same on both sides and survives a mirrored camera.
       * Normalizing by leg length makes it body-size independent.
       */
      name: `${side}_knee_over_ankle`,
      landmarks: [hip, knee, ankle, "left_hip", "right_hip"],
      unit: "ratio",
      compute: (g) => {
        const ankleP = g(ankle);
        const kneeP = g(knee);
        const hipCenter = midpoint(g("left_hip"), g("right_hip"));
        const outward = horizontal(sub(ankleP, hipCenter));
        const legLength = distance(g(hip), kneeP) + distance(kneeP, ankleP);
        if (legLength === 0) return Number.NaN;
        return projectOnto(horizontal(sub(kneeP, ankleP)), outward) / legLength;
      },
    },
  ];
}

const UNSIDED: FeatureDescriptor[] = [
  {
    /** Lean of the hip-to-shoulder line off vertical, in degrees. 0 is upright. */
    name: "torso_tilt",
    landmarks: ["left_hip", "right_hip", "left_shoulder", "right_shoulder"],
    unit: "deg",
    compute: (g) =>
      tiltFromVerticalDeg(
        sub(
          midpoint(g("left_shoulder"), g("right_shoulder")),
          midpoint(g("left_hip"), g("right_hip")),
        ),
      ),
  },
  {
    /**
     * Tilt of the wrist-to-wrist line off horizontal, in degrees. 0 is level.
     * Unsigned: either hand riding high reads the same, which is what the cue
     * needs — the pose JSON says which wording to use via tooHigh.
     */
    name: "arm_line_deviation",
    landmarks: ["left_wrist", "right_wrist"],
    unit: "deg",
    compute: (g) => angleFromHorizontalDeg(sub(g("right_wrist"), g("left_wrist"))),
  },
];

export const FEATURE_DESCRIPTORS: readonly FeatureDescriptor[] = [
  ...sidedDescriptors("left"),
  ...sidedDescriptors("right"),
  ...UNSIDED,
];

const BY_NAME = new Map(FEATURE_DESCRIPTORS.map((d) => [d.name, d]));

export function getDescriptor(name: string): FeatureDescriptor | undefined {
  return BY_NAME.get(name);
}
