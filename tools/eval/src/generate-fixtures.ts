/**
 * Generates the two synthetic recordings in data/eval.
 *
 * These exist to test the harness, not to validate the rules. Ground truth is
 * derived from the pose's own declared ranges: a mistake is labelled wherever the
 * feature genuinely sits outside its range. So the numbers the harness reports on
 * these clips measure the machinery around the rules — the settle gate,
 * hysteresis lag, the event counting — and say nothing about whether the ranges
 * match real bodies. Only recordings of real people can say that.
 *
 * Run with: node src/generate-fixtures.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { FeatureExtractor, LANDMARK_NAMES, resolveFeatureName } from "@asan/core";
import type { LandmarkName, PoseDefinition, Side, Vec3 } from "@asan/core";
import { MOUNTAIN, WARRIOR_II_RIGHT, buildFrame, type Joints } from "@asan/core/testing";
import { mountain, warriorII } from "@asan/poses";
import type { Mistake } from "./schema.ts";

const OUT_DIR = new URL("../../../data/eval/", import.meta.url).pathname;
const FPS = 15;
const FRAME_MS = 1000 / FPS;

/** Upper-body landmarks, rotated as one rigid unit so arm-to-torso angles hold. */
const UPPER_BODY: readonly LandmarkName[] = LANDMARK_NAMES.filter(
  (n) => !/(hip|knee|ankle|heel|foot_index)$/.test(n),
);

/** Lean the torso by rotating everything above the hips about the hip centre. */
function lean(base: Joints, degrees: number): Joints {
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pivot: Vec3 = {
    x: (base.left_hip.x + base.right_hip.x) / 2,
    y: (base.left_hip.y + base.right_hip.y) / 2,
    z: (base.left_hip.z + base.right_hip.z) / 2,
  };
  const out: Joints = { ...base };
  for (const name of UPPER_BODY) {
    const p = base[name];
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    out[name] = {
      x: pivot.x + dx * cos - dy * sin,
      y: pivot.y + dx * sin + dy * cos,
      z: p.z,
    };
  }
  return out;
}

/** Slide the front knee outward, which also deepens the bend, as it does in life. */
function pushKnee(base: Joints, deltaX: number): Joints {
  return { ...base, right_knee: { ...base.right_knee, x: base.right_knee.x + deltaX } };
}

/**
 * Trim float precision. World coordinates keep 3 decimals — 1 mm, well below
 * MediaPipe's own centimetre-scale error — and image coordinates 4, which is
 * sub-pixel at any sane resolution. This keeps the committed fixtures small.
 */
const r = (n: number, places: number): number => Number(n.toFixed(places));
const round =
  (places: number) =>
  <T extends { x: number; y: number; z: number; visibility: number }>(p: T) => ({
    x: r(p.x, places),
    y: r(p.y, places),
    z: r(p.z, places),
    visibility: r(p.visibility, 2),
  });

interface Keyframe {
  t: number;
  joints: Joints;
}

function lerpJoints(a: Joints, b: Joints, u: number): Joints {
  const out: Partial<Joints> = {};
  for (const name of LANDMARK_NAMES) {
    const p = a[name];
    const q = b[name];
    out[name] = {
      x: p.x + (q.x - p.x) * u,
      y: p.y + (q.y - p.y) * u,
      z: p.z + (q.z - p.z) * u,
    };
  }
  return out as Joints;
}

/** Sample keyframes at a steady frame rate, interpolating between them. */
function sample(keyframes: readonly Keyframe[]): Array<{ t: number; joints: Joints }> {
  const last = keyframes[keyframes.length - 1]?.t ?? 0;
  const frames: Array<{ t: number; joints: Joints }> = [];
  for (let i = 0; Math.round(i * FRAME_MS) <= last; i++) {
    const t = Math.round(i * FRAME_MS);
    let segment = 0;
    while (segment < keyframes.length - 2 && (keyframes[segment + 1]?.t ?? 0) < t) segment++;
    const a = keyframes[segment]!;
    const b = keyframes[segment + 1] ?? a;
    const span = b.t - a.t;
    const u = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - a.t) / span));
    frames.push({ t, joints: lerpJoints(a.joints, b.joints, u) });
  }
  return frames;
}

/**
 * Ground truth: for each rule, the intervals where its feature genuinely sits
 * outside the declared range. Runs shorter than two frames are dropped as
 * interpolation noise.
 */
function deriveMistakes(
  frames: ReadonlyArray<{ t: number; joints: Joints }>,
  pose: PoseDefinition,
  side: Side,
): Mistake[] {
  const extractor = new FeatureExtractor();
  const out: Mistake[] = [];

  for (const rule of pose.rules) {
    const name = resolveFeatureName(rule.feature, side);
    const [min, max] = rule.range;
    let runStart: number | null = null;
    let runEnd = 0;

    for (const frame of frames) {
      const features = extractor.extract(buildFrame(frame.t, frame.joints), side);
      const value = features.values[name]?.value;
      const outside = value !== undefined && Number.isFinite(value) && (value < min || value > max);
      if (outside) {
        runStart ??= frame.t;
        runEnd = frame.t;
      } else if (runStart !== null) {
        if (runEnd - runStart >= FRAME_MS * 2) {
          out.push({ ruleId: rule.id, start: runStart, end: runEnd });
        }
        runStart = null;
      }
    }
    if (runStart !== null && runEnd - runStart >= FRAME_MS * 2) {
      out.push({ ruleId: rule.id, start: runStart, end: runEnd });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId));
}

async function writeFixture(
  name: string,
  pose: PoseDefinition,
  side: Side,
  person: string,
  keyframes: readonly Keyframe[],
  notes: string,
): Promise<void> {
  const sampled = sample(keyframes);
  const recording = {
    version: 1 as const,
    meta: {
      synthetic: true,
      generator: "tools/eval/src/generate-fixtures.ts",
      fps: FPS,
      note: "Geometrically constructed, not recorded. Tests the harness, not the rules.",
    },
    frames: sampled.map(({ t, joints }) => {
      const frame = buildFrame(t, joints);
      return {
        t,
        world: frame.world.map(round(3)),
        image: frame.image.map(round(4)),
        visibility: frame.visibility.map((v) => r(v, 2)),
      };
    }),
  };
  const label = {
    recording: `${name}.json`,
    pose: pose.id,
    side,
    person,
    mistakes: deriveMistakes(sampled, pose, side),
    notes,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}${name}.json`, `${JSON.stringify(recording)}\n`);
  await writeFile(`${OUT_DIR}${name}.labels.json`, `${JSON.stringify(label, null, 2)}\n`);
  console.log(
    `${name}: ${recording.frames.length} frames, ${label.mistakes.length} labelled mistake(s)`,
  );
  for (const m of label.mistakes) {
    console.log(`  ${m.ruleId}: ${m.start}–${m.end} ms`);
  }
}

async function main(): Promise<void> {
  // Mountain: upright, then a slow lean well past the safety band, then upright.
  await writeFixture(
    "synthetic-mountain-lean",
    mountain,
    "left",
    "synthetic-a",
    [
      { t: 0, joints: MOUNTAIN },
      { t: 2400, joints: MOUNTAIN },
      { t: 3600, joints: lean(MOUNTAIN, 26) },
      { t: 6100, joints: lean(MOUNTAIN, 26) },
      { t: 7300, joints: MOUNTAIN },
      { t: 9200, joints: MOUNTAIN },
    ],
    "Synthetic. Upright Mountain, a 26 degree lean held for 2.5 s, then upright again.",
  );

  // Warrior II: correct, then the front knee driven out past the ankle, then back.
  await writeFixture(
    "synthetic-warrior2-knee",
    warriorII,
    "right",
    "synthetic-b",
    [
      { t: 0, joints: WARRIOR_II_RIGHT },
      { t: 2400, joints: WARRIOR_II_RIGHT },
      { t: 3500, joints: pushKnee(WARRIOR_II_RIGHT, 0.22) },
      { t: 6000, joints: pushKnee(WARRIOR_II_RIGHT, 0.22) },
      { t: 7100, joints: WARRIOR_II_RIGHT },
      { t: 9200, joints: WARRIOR_II_RIGHT },
    ],
    "Synthetic. Correct Warrior II, front knee pushed 22 cm past the ankle for 2.5 s, then back.",
  );
}

await main();
