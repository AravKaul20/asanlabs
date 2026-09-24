/**
 * Copies MediaPipe's wasm runtime into public/ so the app self-hosts it.
 *
 * The alternative is loading it from a CDN at runtime, which makes the camera
 * page depend on a third party being up and reachable. The files ship inside the
 * npm package, so there is no reason to fetch them over the network.
 */
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// The package's exports map does not expose package.json, but it does export the
// wasm loaders by name, so resolve one of those and take the directory it sits in.
const wasmDir = dirname(require.resolve("@mediapipe/tasks-vision/vision_wasm_internal.js"));
const target = join(import.meta.dirname, "..", "public", "mediapipe", "wasm");

await mkdir(target, { recursive: true });
await cp(wasmDir, target, { recursive: true });
console.log(`copied MediaPipe wasm -> ${target}`);
