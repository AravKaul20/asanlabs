/**
 * The setup check: is the camera seeing one whole body well enough to coach?
 *
 * Messages name the fix, not the problem. "Step back, I can't see your feet" is
 * something a person can act on from across the room; "left_ankle visibility
 * 0.31" is not. Pure logic, so it is testable without a camera.
 */
import {
  VISIBILITY_THRESHOLD,
  landmarkIndex,
  type LandmarkName,
  type PoseDefinition,
} from "@asan/core";
import type { Frame } from "@asan/core";

export interface SetupStatus {
  ready: boolean;
  /** What to tell the user, or null when everything is fine. */
  message: string | null;
  /** Required landmarks that are not visible enough, for the debug panel. */
  missing: LandmarkName[];
}

/** Body regions, checked from the ground up: feet go out of frame first. */
const REGIONS: ReadonlyArray<{ test: RegExp; message: string }> = [
  {
    test: /(ankle|heel|foot_index)$/,
    message: "Step back — I can't see your feet.",
  },
  { test: /knee$/, message: "Step back — I can't see your knees." },
  { test: /hip$/, message: "Step back — I can't see your hips." },
  {
    test: /(wrist|pinky|index|thumb)$/,
    message: "Bring your hands into frame — I can't see them.",
  },
  { test: /elbow$/, message: "Turn to face the camera — I can't see both arms." },
  { test: /shoulder$/, message: "Step back — I can't see your shoulders." },
];

const FALLBACK = "Step back so your whole body is in frame.";

export interface SetupInput {
  /** How many people the detector found this frame. */
  poseCount: number;
  /** The smoothed frame, or null if nothing has been detected yet. */
  frame: Frame | null;
  pose: PoseDefinition;
}

export function checkSetup({ poseCount, frame, pose }: SetupInput): SetupStatus {
  if (poseCount === 0 || frame === null) {
    return { ready: false, message: "Step into frame — I can't see you yet.", missing: [] };
  }
  if (poseCount > 1) {
    return {
      ready: false,
      message: "I can see more than one person. Make sure you're the only one in frame.",
      missing: [],
    };
  }

  const missing: LandmarkName[] = [];
  for (const name of pose.requiredLandmarks) {
    const index = landmarkIndex(name);
    if (index === undefined) continue;
    const visibility = frame.visibility[index] ?? frame.world[index]?.visibility ?? 0;
    if (visibility < VISIBILITY_THRESHOLD) missing.push(name);
  }

  if (missing.length === 0) return { ready: true, message: null, missing };

  // Lead with the lowest missing region: that is usually the one out of frame.
  const region = REGIONS.find((r) => missing.some((m) => r.test.test(m)));
  return { ready: false, message: region?.message ?? FALLBACK, missing };
}
