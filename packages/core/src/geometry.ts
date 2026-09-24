/**
 * 3D vector helpers for world-landmark math.
 *
 * Axis convention: MediaPipe's world landmarks are image-aligned — x to the
 * subject's viewer-right, y DOWNWARD, z toward the camera — with the origin at
 * the midpoint between the hips, in meters. So "up" is -y.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Up in world space. y is down in MediaPipe's world frame, so up is negative y. */
export const WORLD_UP: Vec3 = { x: 0, y: -1, z: 0 };

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Distance in the ground plane, ignoring height. */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Unit vector. Returns NaN components for a zero-length input. */
export function normalizeVec(a: Vec3): Vec3 {
  const len = length(a);
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/** Drop the vertical component, keeping only ground-plane direction. */
export function horizontal(a: Vec3): Vec3 {
  return { x: a.x, y: 0, z: a.z };
}

const RAD_TO_DEG = 180 / Math.PI;

/** Unsigned angle between two vectors, 0..180 degrees. NaN if either is degenerate. */
export function angleBetweenDeg(u: Vec3, v: Vec3): number {
  const denom = length(u) * length(v);
  if (denom === 0) return Number.NaN;
  // Clamp guards against floating-point drift pushing |cos| just past 1.
  const cos = Math.min(1, Math.max(-1, dot(u, v) / denom));
  return Math.acos(cos) * RAD_TO_DEG;
}

/**
 * Joint angle at `vertex`, between the limb segments running out to `a` and `c`.
 * 180 is a straight limb, 90 a right angle, 0 fully folded.
 */
export function angleAtDeg(a: Vec3, vertex: Vec3, c: Vec3): number {
  return angleBetweenDeg(sub(a, vertex), sub(c, vertex));
}

/** How far a vector leans off vertical, 0..180 degrees. 0 is straight up. */
export function tiltFromVerticalDeg(v: Vec3): number {
  return angleBetweenDeg(v, WORLD_UP);
}

/**
 * How far a vector leans off the horizontal plane, 0..90 degrees. 0 is level.
 * Unsigned, so a line tilted either way reads the same.
 */
export function angleFromHorizontalDeg(v: Vec3): number {
  const len = length(v);
  if (len === 0) return Number.NaN;
  return Math.asin(Math.min(1, Math.abs(v.y) / len)) * RAD_TO_DEG;
}

/** Signed length of `v`'s projection onto unit-ish direction `dir`. */
export function projectOnto(v: Vec3, dir: Vec3): number {
  const len = length(dir);
  if (len === 0) return Number.NaN;
  return dot(v, dir) / len;
}
