import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus.ts";
import { MOUNTAIN, buildFrame } from "@asan/core/testing";

let dir = "";

const recording = (frameCount = 4) => ({
  version: 1,
  frames: Array.from({ length: frameCount }, (_, i) => {
    const f = buildFrame(i * 100, MOUNTAIN);
    return { t: f.t, world: f.world, image: f.image, visibility: f.visibility };
  }),
});

const label = (over: Record<string, unknown> = {}) => ({
  recording: "clip.json",
  pose: "mountain",
  side: "left",
  person: "p1",
  mistakes: [],
  ...over,
});

async function put(name: string, data: unknown): Promise<void> {
  await writeFile(join(dir, name), JSON.stringify(data));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "asan-eval-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadCorpus", () => {
  it("pairs a recording with its label file", async () => {
    await put("clip.json", recording());
    await put("clip.labels.json", label());
    const { entries } = await loadCorpus(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label.person).toBe("p1");
    expect(entries[0]?.pose.id).toBe("mountain");
    expect(entries[0]?.recording.frames).toHaveLength(4);
  });

  it("returns an empty corpus for an empty directory", async () => {
    expect((await loadCorpus(dir)).entries).toEqual([]);
  });

  it("warns about a recording with no label file rather than ignoring it", async () => {
    await put("orphan.json", recording());
    const { entries, warnings } = await loadCorpus(dir);
    expect(entries).toEqual([]);
    expect(warnings.join(" ")).toContain("orphan.json");
  });

  it("rejects an unknown pose id", async () => {
    await put("clip.json", recording());
    await put("clip.labels.json", label({ pose: "headstand" }));
    await expect(loadCorpus(dir)).rejects.toThrow(/unknown pose "headstand"/);
  });

  it("rejects a side the pose does not offer", async () => {
    await put("clip.json", recording());
    await put("clip.labels.json", label({ side: "middle" }));
    await expect(loadCorpus(dir)).rejects.toThrow();
  });

  it("rejects a mistake naming a rule the pose does not define", async () => {
    await put("clip.json", recording());
    await put(
      "clip.labels.json",
      label({ mistakes: [{ ruleId: "no-such-rule", start: 0, end: 100 }] }),
    );
    await expect(loadCorpus(dir)).rejects.toThrow(/no-such-rule/);
  });

  it("rejects a mistake that ends before it starts", async () => {
    await put("clip.json", recording());
    await put(
      "clip.labels.json",
      label({ mistakes: [{ ruleId: "torso-upright", start: 500, end: 100 }] }),
    );
    await expect(loadCorpus(dir)).rejects.toThrow();
  });

  it("rejects a recording whose frames are not in time order", async () => {
    const bad = recording();
    bad.frames = [bad.frames[1]!, bad.frames[0]!];
    await put("clip.json", bad);
    await put("clip.labels.json", label());
    await expect(loadCorpus(dir)).rejects.toThrow(/increase/);
  });

  it("rejects a recording with the wrong number of landmarks", async () => {
    const bad = recording();
    bad.frames[0]!.world = bad.frames[0]!.world.slice(0, 10);
    await put("clip.json", bad);
    await put("clip.labels.json", label());
    await expect(loadCorpus(dir)).rejects.toThrow(/33 pose landmarks/);
  });

  it("rejects unknown keys in a label file, catching typos", async () => {
    await put("clip.json", recording());
    await put("clip.labels.json", label({ persons: "p1" }));
    await expect(loadCorpus(dir)).rejects.toThrow();
  });

  it("names the offending file in the error", async () => {
    await put("clip.json", recording());
    await put("clip.labels.json", label({ person: "" }));
    await expect(loadCorpus(dir)).rejects.toThrow(/clip.labels.json/);
  });

  it("loads several pairs in a stable order", async () => {
    for (const name of ["b", "a"]) {
      await put(`${name}.json`, recording());
      await put(`${name}.labels.json`, label({ recording: `${name}.json`, person: name }));
    }
    const { entries } = await loadCorpus(dir);
    expect(entries.map((e) => e.name)).toEqual(["a", "b"]);
  });
});
