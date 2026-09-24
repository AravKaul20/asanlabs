/**
 * MediaPipe Pose Landmarker binding.
 *
 * API confirmed against @mediapipe/tasks-vision 1.0.1's own type definitions:
 * `runningMode` is the uppercase "VIDEO", `detectForVideo` returns the result
 * synchronously, and results carry `landmarks` (normalized image space) plus
 * `worldLandmarks` (metres, hip-centred).
 *
 * The wasm runtime is served from /mediapipe/wasm, copied out of the npm package
 * at build time, so the camera page does not depend on a CDN.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { LANDMARK_COUNT, type Frame } from "@asan/core";
import type { ModelVariant } from "./adaptive.ts";

const WASM_BASE = "/mediapipe/wasm";

const CDN_MODEL_URLS: Record<ModelVariant, string> = {
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
};

/**
 * Where to fetch the .task model from.
 *
 * Google's CDN by default, but overridable: behind a TLS-intercepting proxy, on a
 * locked-down network, or offline, that fetch is the one thing that can stop the
 * page working — the wasm runtime is already served from our own origin. Set
 * NEXT_PUBLIC_POSE_MODEL_BASE to a directory holding
 * pose_landmarker_full.task and pose_landmarker_lite.task to self-host both.
 */
export function modelUrl(variant: ModelVariant): string {
  const base = process.env.NEXT_PUBLIC_POSE_MODEL_BASE;
  if (base && base.length > 0) {
    return `${base.replace(/\/$/, "")}/pose_landmarker_${variant}.task`;
  }
  return CDN_MODEL_URLS[variant];
}

/**
 * Two, not one. The default is one pose, which would make the "only one person
 * in frame" check impossible to implement — the detector would simply never
 * mention the second person. We ask for two so we can notice and warn, then
 * coach pose 0.
 */
const MAX_POSES = 2;

export interface DetectResult {
  /** Raw frame for the chosen person, or null when nobody was detected. */
  frame: Frame | null;
  /** How many people the detector found, for the setup check. */
  poseCount: number;
}

export type CreateLandmarker = (variant: ModelVariant) => Promise<PoseLandmarker>;
export type ToFrame = (result: PoseLandmarkerResult, t: number) => DetectResult;

export async function createLandmarker(variant: ModelVariant): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: modelUrl(variant),
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: MAX_POSES,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

/** Convert a MediaPipe result into the engine's Frame shape. */
export function toFrame(result: PoseLandmarkerResult, t: number): DetectResult {
  const poseCount = result.landmarks.length;
  const image = result.landmarks[0];
  const world = result.worldLandmarks[0];
  if (!image || !world || image.length < LANDMARK_COUNT || world.length < LANDMARK_COUNT) {
    return { frame: null, poseCount };
  }

  return {
    frame: {
      t,
      image: image.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
      world: world.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
      // World and image landmarks carry the same visibility; lift it to the frame
      // so downstream code has one place to read it from.
      visibility: image.map((p) => p.visibility),
    },
    poseCount,
  };
}

export { CDN_MODEL_URLS };
