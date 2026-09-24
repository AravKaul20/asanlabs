# asan — Phase 0 engine spike

Real-time yoga form correction. All vision runs on-device; video and raw landmark
streams never leave the browser.

This is the Phase 0 spike: the correction pipeline and the harness to measure it.
Not a product, and not a medical device.

## Layout

| Path             | What it is                                                        |
| ---------------- | ----------------------------------------------------------------- |
| `packages/core`  | The engine. Pure TypeScript — no DOM, no browser or Node APIs.    |
| `packages/poses` | One JSON file per pose, validated by the core schema at import.    |
| `apps/web`       | Next.js app with the `/practice` page.                             |
| `tools/eval`     | `pnpm eval` — replays labelled recordings and grades the rules.    |
| `data/eval`      | Recordings plus label files. Landmarks only, never video.          |

## Commands

```bash
pnpm install
pnpm test        # 353 tests
pnpm typecheck
pnpm lint
pnpm dev         # the /practice page on :3000
pnpm eval        # grade the engine against data/eval
```

No build step links the packages: they ship TypeScript source, and Node 22 strips
types natively, so the eval CLI runs the same sources the browser does.

## Using /practice

Prop a device so your whole body is in frame, a few metres back, then pick a pose
and press Start. The page walks you through setup ("Step back — I can't see your
feet"), waits until you settle into the pose, then coaches one correction at a
time by voice and on screen.

The pose model is fetched from Google's CDN by default. To self-host it — behind a
TLS-intercepting proxy, on a locked-down network, or offline — drop
`pose_landmarker_full.task` and `pose_landmarker_lite.task` somewhere served and
set `NEXT_PUBLIC_POSE_MODEL_BASE` to that directory. The wasm runtime is always
served from this origin, copied out of the npm package at build time.

## Recording and evaluating

**Record landmarks** on `/practice` downloads the smoothed world and image
landmarks as JSON, in exactly the format `tools/eval` reads. There is no video in
it, and nothing is uploaded.

To evaluate a clip, drop it in `data/eval` alongside a label file:

```json
{
  "recording": "my-clip.json",
  "pose": "warrior-ii",
  "side": "right",
  "person": "alex",
  "mistakes": [{ "ruleId": "front-knee-over-ankle", "start": 4200, "end": 9100 }]
}
```

Then `pnpm eval`. It reports per-rule precision, recall and false alarms per
minute, and grades them against the ship gates: safety ≥ 80% precision and ≥ 70%
recall, alignment ≥ 75% and ≥ 60%, and every rule under 0.5 false alarms per
minute.

Three things about how it scores:

- Metrics are weighted by **elapsed time**, not frame count, because the pipeline
  drops to every other frame on slow devices.
- A false alarm is one **contiguous run** of a rule firing while the labels say
  the form was correct — not one per frame. At 15 fps a per-frame rate could never
  be read against a "0.5 per minute" budget.
- Splits are **by person**, never by frame or recording. Frames within a hold are
  near-duplicates, so any finer split leaks.

`pnpm eval` exits 0 on a pass, 1 on a failure, and **2 when the corpus is too thin
to judge** — which is what the committed synthetic fixtures produce. Those
fixtures test the harness, not the rules: their ground truth is derived from the
poses' own ranges. Only recordings of real people can say whether the ranges fit
real bodies.

## Adding or tuning a pose

Edit the JSON. `packages/poses/warrior-ii.json` is the worked example. Rules look
like this:

```json
{
  "id": "front-knee-over-ankle",
  "priority": "safety",
  "feature": "front_knee_over_ankle",
  "range": [-0.12, 0.12],
  "hysteresis": 0.04,
  "cues": { "tooHigh": ["Ease your front knee back over your heel."] },
  "highlight": ["front_hip", "front_knee", "front_ankle"],
  "weight": 3,
  "source": "self"
}
```

`front_` and `back_` resolve to whichever side the session is practising, so one
rule covers both. `hysteresis` is a deadband in the feature's own unit, sticky
toward the current state, which stops a cue flickering at the boundary.

Two things the schema and tests will catch for you:

- An unknown feature or joint name fails at load time rather than silently
  disabling the rule.
- A rule whose failing region sits outside the pose's `settleShape` band can never
  fire, because the gate stops judging before the fault appears. A test asserts
  every rule is reachable — it caught exactly this in Mountain's safety rule.

Adding a genuinely new measurement is the one change that touches code: add a
descriptor to `packages/core/src/features/registry.ts`, declaring the landmarks it
reads.
