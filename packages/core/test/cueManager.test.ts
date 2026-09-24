import { describe, expect, it } from "vitest";
import { CueManager } from "../src/cueManager.ts";
import { parsePose } from "../src/pose/schema.ts";
import type { CueEvent, Priority, RuleResult, RuleStatus } from "../src/types.ts";

const ruleDef = (id: string, priority: Priority, over: Record<string, unknown> = {}) => ({
  id,
  priority,
  feature: "torso_tilt",
  range: [0, 10],
  hysteresis: 0,
  cues: { tooLow: [`${id} low`], tooHigh: [`${id} high`] },
  highlight: ["left_hip"],
  weight: 1,
  source: "self",
  ...over,
});

const pose = (rules: unknown[]) =>
  parsePose({
    id: "p",
    name: "P",
    version: 1,
    view: "front",
    sides: ["left"],
    requiredLandmarks: ["left_hip"],
    settleShape: [],
    rules,
  });

const result = (
  ruleId: string,
  status: RuleStatus,
  priority: Priority = "alignment",
): RuleResult => ({
  ruleId,
  status,
  value: status === "skipped" ? null : 20,
  weight: 1,
  priority,
  highlight: ["left_hip"],
});

const cueTexts = (events: CueEvent[]) =>
  events.filter((e) => e.type === "cue").map((e) => (e.type === "cue" ? e.cue.text : ""));
const types = (events: CueEvent[]) => events.map((e) => e.type);

describe("CueManager emits one cue at a time", () => {
  const p = pose([ruleDef("a", "alignment"), ruleDef("b", "alignment")]);

  it("speaks a cue for a failing rule", () => {
    const m = new CueManager();
    const events = m.update([result("a", "tooHigh")], p, 0);
    expect(types(events)).toEqual(["cue"]);
    expect(cueTexts(events)).toEqual(["a high"]);
  });

  it("uses the wording matching the direction of failure", () => {
    const m = new CueManager();
    expect(cueTexts(m.update([result("a", "tooLow")], p, 0))).toEqual(["a low"]);
  });

  it("never emits two cues for two failing rules at once", () => {
    const m = new CueManager();
    const events = m.update([result("a", "tooHigh"), result("b", "tooHigh")], p, 0);
    expect(cueTexts(events)).toHaveLength(1);
  });

  it("stays quiet while the same rule keeps failing", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    expect(m.update([result("a", "tooHigh")], p, 500)).toEqual([]);
    expect(m.update([result("a", "tooHigh")], p, 3000)).toEqual([]);
  });

  it("exposes the currently active cue", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    expect(m.active?.ruleId).toBe("a");
    expect(m.active?.text).toBe("a high");
  });

  it("carries the highlight joints on the cue", () => {
    const m = new CueManager();
    const events = m.update([result("a", "tooHigh")], p, 0);
    expect(events[0]?.type === "cue" && events[0].cue.highlight).toEqual(["left_hip"]);
  });

  it("says nothing when every rule passes", () => {
    const m = new CueManager();
    expect(m.update([result("a", "pass"), result("b", "pass")], p, 0)).toEqual([]);
    expect(m.active).toBeNull();
  });
});

describe("priority ordering", () => {
  const p = pose([
    ruleDef("refine", "refinement"),
    ruleDef("align", "alignment"),
    ruleDef("safe", "safety"),
  ]);

  it("prefers safety over alignment and refinement", () => {
    const m = new CueManager();
    const events = m.update(
      [
        result("refine", "tooHigh", "refinement"),
        result("align", "tooHigh", "alignment"),
        result("safe", "tooHigh", "safety"),
      ],
      p,
      0,
    );
    expect(cueTexts(events)).toEqual(["safe high"]);
  });

  it("prefers alignment over refinement", () => {
    const m = new CueManager();
    const events = m.update(
      [result("refine", "tooHigh", "refinement"), result("align", "tooHigh", "alignment")],
      p,
      0,
    );
    expect(cueTexts(events)).toEqual(["align high"]);
  });

  it("falls back to pose rule order within a priority", () => {
    const q = pose([ruleDef("first", "alignment"), ruleDef("second", "alignment")]);
    const m = new CueManager();
    const events = m.update([result("second", "tooHigh"), result("first", "tooHigh")], q, 0);
    expect(cueTexts(events)).toEqual(["first high"]);
  });

  it("lets a safety issue take over from an alignment cue, once the rate limit allows", () => {
    const m = new CueManager();
    m.update([result("align", "tooHigh", "alignment")], p, 0);
    // Too soon: the 3.5 s limit still applies to the switch.
    expect(
      m.update(
        [result("align", "tooHigh", "alignment"), result("safe", "tooHigh", "safety")],
        p,
        1000,
      ),
    ).toEqual([]);
    const later = m.update(
      [result("align", "tooHigh", "alignment"), result("safe", "tooHigh", "safety")],
      p,
      3600,
    );
    expect(cueTexts(later)).toEqual(["safe high"]);
  });

  it("does not switch to an equal or lower priority rule", () => {
    const q = pose([ruleDef("first", "alignment"), ruleDef("second", "alignment")]);
    const m = new CueManager();
    m.update([result("second", "tooHigh")], q, 0);
    expect(m.update([result("second", "tooHigh"), result("first", "tooHigh")], q, 5000)).toEqual(
      [],
    );
    expect(m.active?.ruleId).toBe("second");
  });
});

describe("rate limiting", () => {
  const p = pose([ruleDef("a", "alignment"), ruleDef("b", "alignment")]);

  it("allows at most one new cue per 3.5 s", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 100); // fixed, clears the active cue
    expect(m.update([result("b", "tooHigh")], p, 2000)).toEqual([]);
    expect(cueTexts(m.update([result("b", "tooHigh")], p, 3500))).toEqual(["b high"]);
  });

  it("does not repeat the same cue within 8 s", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 100);
    // Rate limit satisfied at 4000, but the repeat guard is not.
    expect(m.update([result("a", "tooHigh")], p, 4000)).toEqual([]);
    expect(cueTexts(m.update([result("a", "tooHigh")], p, 8100))).toEqual(["a high"]);
  });

  it("treats the other direction of the same rule as a different cue", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 100);
    expect(cueTexts(m.update([result("a", "tooLow")], p, 3600))).toEqual(["a low"]);
  });

  it("prefers a different eligible rule over waiting out a repeat guard", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 100);
    const events = m.update([result("a", "tooHigh"), result("b", "tooHigh")], p, 4000);
    expect(cueTexts(events)).toEqual(["b high"]);
  });

  it("rotates through the wordings for a repeated cue, for variety", () => {
    const q = pose([ruleDef("a", "alignment", { cues: { tooHigh: ["first way", "second way"] } })]);
    const m = new CueManager();
    expect(cueTexts(m.update([result("a", "tooHigh")], q, 0))).toEqual(["first way"]);
    m.update([result("a", "pass")], q, 100);
    expect(cueTexts(m.update([result("a", "tooHigh")], q, 9000))).toEqual(["second way"]);
    m.update([result("a", "pass")], q, 9100);
    expect(cueTexts(m.update([result("a", "tooHigh")], q, 20000))).toEqual(["first way"]);
  });
});

describe("confirming fixes", () => {
  const p = pose([ruleDef("a", "alignment"), ruleDef("b", "alignment")]);

  it('says "Good." when the cued rule starts passing', () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    const events = m.update([result("a", "pass")], p, 900);
    expect(types(events)).toEqual(["fixed"]);
    expect(events[0]?.type === "fixed" && events[0].text).toBe("Good.");
    expect(events[0]?.type === "fixed" && events[0].ruleId).toBe("a");
  });

  it("clears the active cue after confirming", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 900);
    expect(m.active).toBeNull();
  });

  it('does not say "Good." for a rule it never cued', () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    const events = m.update([result("a", "tooHigh"), result("b", "pass")], p, 900);
    expect(types(events)).toEqual([]);
  });

  it("confirms only once per fix", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 900);
    expect(m.update([result("a", "pass")], p, 1200)).toEqual([]);
  });

  it("is not itself rate limited, so a fix always gets acknowledged", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    // Well inside the 3.5 s new-cue window: the confirmation still lands.
    const events = m.update([result("a", "pass")], p, 300);
    expect(types(events)).toEqual(["fixed"]);
  });
});

describe("staying silent when unsure", () => {
  const p = pose([ruleDef("a", "alignment"), ruleDef("b", "alignment")]);

  it("never cues a skipped rule", () => {
    const m = new CueManager();
    expect(m.update([result("a", "skipped")], p, 0)).toEqual([]);
    expect(m.active).toBeNull();
  });

  it("clears an active cue when its rule becomes unjudgeable", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    const events = m.update([result("a", "skipped")], p, 900);
    expect(types(events)).toEqual(["clear"]);
    expect(m.active).toBeNull();
  });

  it("does not claim a fix when tracking was simply lost", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    const events = m.update([result("a", "skipped")], p, 900);
    expect(types(events)).not.toContain("fixed");
  });

  it("clears when there are no results at all", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    expect(types(m.update([], p, 900))).toEqual(["clear"]);
  });

  it("emits clear only once, not on every quiet frame", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.update([], p, 900);
    expect(m.update([], p, 1200)).toEqual([]);
  });

  it("ignores a rule that is missing from the pose definition", () => {
    const m = new CueManager();
    expect(m.update([result("ghost", "tooHigh")], p, 0)).toEqual([]);
  });

  it("stays silent when a rule fails in a direction it has no wording for", () => {
    const q = pose([ruleDef("a", "alignment", { cues: { tooHigh: ["only high"] } })]);
    const m = new CueManager();
    expect(m.update([result("a", "tooLow")], q, 0)).toEqual([]);
  });
});

describe("configuration and reset", () => {
  const p = pose([ruleDef("a", "alignment"), ruleDef("b", "alignment")]);

  it("honours custom timings", () => {
    const m = new CueManager({ newCueIntervalMs: 500, repeatIntervalMs: 1000 });
    m.update([result("a", "tooHigh")], p, 0);
    m.update([result("a", "pass")], p, 100);
    expect(cueTexts(m.update([result("a", "tooHigh")], p, 1100))).toEqual(["a high"]);
  });

  it("forgets its history on reset", () => {
    const m = new CueManager();
    m.update([result("a", "tooHigh")], p, 0);
    m.reset();
    expect(m.active).toBeNull();
    expect(cueTexts(m.update([result("a", "tooHigh")], p, 100))).toEqual(["a high"]);
  });

  it("speaks the first cue of a session immediately", () => {
    const m = new CueManager();
    expect(cueTexts(m.update([result("a", "tooHigh")], p, 999999))).toEqual(["a high"]);
  });
});
