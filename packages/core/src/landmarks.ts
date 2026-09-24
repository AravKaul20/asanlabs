/** The 33 MediaPipe Pose (BlazePose) landmarks, in model index order. */
export const LANDMARK_NAMES = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "right_pinky",
  "left_index",
  "right_index",
  "left_thumb",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];

export const LANDMARK_COUNT = LANDMARK_NAMES.length;

const INDEX_BY_NAME: Record<string, number> = Object.fromEntries(
  LANDMARK_NAMES.map((name, i) => [name, i]),
);

/** Model index for a landmark name, or undefined if the name is not a pose landmark. */
export function landmarkIndex(name: string): number | undefined {
  return INDEX_BY_NAME[name];
}

export function isLandmarkName(name: string): name is LandmarkName {
  return name in INDEX_BY_NAME;
}

/**
 * Bone pairs for drawing a skeleton overlay. Mirrors MediaPipe's POSE_CONNECTIONS
 * but expressed as names so `packages/core` stays free of any MediaPipe import.
 */
export const POSE_BONES: ReadonlyArray<readonly [LandmarkName, LandmarkName]> = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_heel"],
  ["left_heel", "left_foot_index"],
  ["left_ankle", "left_foot_index"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_heel"],
  ["right_heel", "right_foot_index"],
  ["right_ankle", "right_foot_index"],
];

/** Landmarks a full-body setup check needs; face/hand detail is irrelevant for yoga holds. */
export const BODY_LANDMARKS: readonly LandmarkName[] = [
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

export function otherSide(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

/** Joints that exist on both sides and can be named side-relatively in pose JSON. */
export const SIDED_JOINT_BASES = [
  "shoulder",
  "elbow",
  "wrist",
  "hip",
  "knee",
  "ankle",
  "heel",
  "foot_index",
] as const;

/**
 * Resolve a joint name that may be side-relative ("front_knee", "back_ankle")
 * into a concrete landmark name, given which side the session treats as front.
 * Concrete names pass through. Returns undefined for anything unrecognized.
 */
export function resolveJoint(name: string, side: "left" | "right"): LandmarkName | undefined {
  if (isLandmarkName(name)) return name;
  for (const base of SIDED_JOINT_BASES) {
    if (name === `front_${base}`) return `${side}_${base}` as LandmarkName;
    if (name === `back_${base}`) return `${otherSide(side)}_${base}` as LandmarkName;
  }
  return undefined;
}

/** True if a joint name is usable in pose JSON: concrete or side-relative. */
export function isJointReference(name: string): boolean {
  if (isLandmarkName(name)) return true;
  return SIDED_JOINT_BASES.some((b) => name === `front_${b}` || name === `back_${b}`);
}
