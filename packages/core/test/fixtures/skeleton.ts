/**
 * Synthetic world-landmark skeletons for testing.
 *
 * These are geometrically constructed, not recorded: Phase 0 has no real clips
 * yet. Coordinates are meters, hip-centered, y DOWNWARD — the same frame
 * MediaPipe's `worldLandmarks` uses. Joint positions were chosen so the derived
 * angles land where a real body in these poses would put them (documented per
 * fixture). Once real recordings exist they replace these, not the other way
 * round.
 */
import { LANDMARK_NAMES, type LandmarkName } from "../../src/landmarks.ts";
import type { Vec3 } from "../../src/geometry.ts";
import type { Frame } from "../../src/types.ts";

export type Joints = Record<LandmarkName, Vec3>;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Head/face landmarks, placed just well enough to exist. */
function headJoints(neckY: number): Partial<Joints> {
  const y = neckY - 0.15;
  return {
    nose: v(0, y, 0.08),
    left_eye_inner: v(-0.02, y - 0.03, 0.07),
    left_eye: v(-0.035, y - 0.03, 0.07),
    left_eye_outer: v(-0.05, y - 0.03, 0.06),
    right_eye_inner: v(0.02, y - 0.03, 0.07),
    right_eye: v(0.035, y - 0.03, 0.07),
    right_eye_outer: v(0.05, y - 0.03, 0.06),
    left_ear: v(-0.07, y - 0.02, 0),
    right_ear: v(0.07, y - 0.02, 0),
    mouth_left: v(-0.03, y + 0.05, 0.06),
    mouth_right: v(0.03, y + 0.05, 0.06),
  };
}

/** Hands, hung off each wrist along the arm direction. */
function handJoints(side: "left" | "right", wrist: Vec3, dir: Vec3): Partial<Joints> {
  const tip = v(wrist.x + dir.x * 0.08, wrist.y + dir.y * 0.08, wrist.z + dir.z * 0.08);
  return {
    [`${side}_pinky`]: v(tip.x, tip.y + 0.02, tip.z),
    [`${side}_index`]: v(tip.x, tip.y - 0.02, tip.z),
    [`${side}_thumb`]: v(tip.x - 0.01, tip.y, tip.z + 0.02),
  } as Partial<Joints>;
}

/** Feet, derived from each ankle: heel behind, toes in front. */
function footJoints(side: "left" | "right", ankle: Vec3): Partial<Joints> {
  return {
    [`${side}_heel`]: v(ankle.x, ankle.y + 0.04, ankle.z - 0.04),
    [`${side}_foot_index`]: v(ankle.x, ankle.y + 0.05, ankle.z + 0.14),
  } as Partial<Joints>;
}

function assemble(core: Partial<Joints>): Joints {
  const out: Partial<Joints> = { ...core };
  const ls = core.left_shoulder ?? v(-0.18, -0.5, 0);
  const rs = core.right_shoulder ?? v(0.18, -0.5, 0);
  Object.assign(out, headJoints((ls.y + rs.y) / 2));
  for (const side of ["left", "right"] as const) {
    const wrist = core[`${side}_wrist`];
    const elbow = core[`${side}_elbow`];
    if (wrist && elbow) {
      const dir = v(wrist.x - elbow.x, wrist.y - elbow.y, wrist.z - elbow.z);
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      Object.assign(out, handJoints(side, wrist, v(dir.x / len, dir.y / len, dir.z / len)));
    }
    const ankle = core[`${side}_ankle`];
    if (ankle) Object.assign(out, footJoints(side, ankle));
  }
  return out as Joints;
}

/**
 * Mountain: upright, feet under hips, arms at the sides.
 * Yields knee angles ~179 deg, torso tilt 0 deg.
 */
export const MOUNTAIN: Joints = assemble({
  left_hip: v(-0.09, 0, 0),
  right_hip: v(0.09, 0, 0),
  left_shoulder: v(-0.18, -0.5, 0),
  right_shoulder: v(0.18, -0.5, 0),
  left_elbow: v(-0.2, -0.25, 0),
  right_elbow: v(0.2, -0.25, 0),
  left_wrist: v(-0.21, -0.02, 0),
  right_wrist: v(0.21, -0.02, 0),
  left_knee: v(-0.1, 0.45, 0),
  right_knee: v(0.1, 0.45, 0),
  left_ankle: v(-0.1, 0.9, 0),
  right_ankle: v(0.1, 0.9, 0),
});

/**
 * Warrior II, right leg forward, front view: torso to camera, arms spread
 * across the frame, front knee bent out to the side and stacked over the ankle.
 * Yields right knee ~95 deg, left knee ~177 deg, arm line 0 deg from
 * horizontal, right knee-over-ankle ~-0.02 (just inside the ankle).
 */
export const WARRIOR_II_RIGHT: Joints = assemble({
  left_hip: v(-0.09, 0, 0),
  right_hip: v(0.09, 0, 0),
  left_shoulder: v(-0.18, -0.5, 0),
  right_shoulder: v(0.18, -0.5, 0),
  left_elbow: v(-0.45, -0.5, 0),
  right_elbow: v(0.45, -0.5, 0),
  left_wrist: v(-0.72, -0.5, 0),
  right_wrist: v(0.72, -0.5, 0),
  right_knee: v(0.5, 0.02, 0),
  right_ankle: v(0.52, 0.48, 0),
  left_knee: v(-0.42, 0.32, 0),
  left_ankle: v(-0.75, 0.62, 0),
});

/** Mirror a skeleton across x, swapping left and right. Warrior II on the other side. */
export function mirror(joints: Joints): Joints {
  const out: Partial<Joints> = {};
  for (const name of LANDMARK_NAMES) {
    const p = joints[name];
    const flipped = v(-p.x, p.y, p.z);
    if (name.startsWith("left_")) out[`right_${name.slice(5)}` as LandmarkName] = flipped;
    else if (name.startsWith("right_")) out[`left_${name.slice(6)}` as LandmarkName] = flipped;
    else out[name] = flipped;
  }
  return out as Joints;
}

export const WARRIOR_II_LEFT: Joints = mirror(WARRIOR_II_RIGHT);

export interface FrameOptions {
  /** Per-landmark visibility overrides; everything else defaults to 1. */
  visibility?: Partial<Record<LandmarkName, number>>;
  /** Uniform translation, e.g. to simulate the body drifting between frames. */
  offset?: Vec3;
}

/** Turn a joint map into a Frame. Image landmarks are a crude projection: drawing only. */
export function buildFrame(t: number, joints: Joints, options: FrameOptions = {}): Frame {
  const offset = options.offset ?? v(0, 0, 0);
  const world = LANDMARK_NAMES.map((name) => {
    const p = joints[name];
    return {
      x: p.x + offset.x,
      y: p.y + offset.y,
      z: p.z + offset.z,
      visibility: options.visibility?.[name] ?? 1,
    };
  });
  const image = world.map((p) => ({
    x: 0.5 + p.x / 3,
    y: 0.5 + p.y / 3,
    z: p.z,
    visibility: p.visibility,
  }));
  return { t, world, image, visibility: world.map((p) => p.visibility) };
}

/** Apply named joint overrides to a copy of a skeleton, to build a specific fault. */
export function withJoints(base: Joints, overrides: Partial<Joints>): Joints {
  return { ...base, ...overrides } as Joints;
}
