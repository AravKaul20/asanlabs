import { describe, expect, it } from "vitest";
import { splitByPerson } from "../src/split.ts";

describe("splitByPerson", () => {
  it("puts nobody in both groups", () => {
    const { tune, test } = splitByPerson(["a", "b", "c", "d", "e", "f"]);
    expect(tune.filter((p) => test.includes(p))).toEqual([]);
  });

  it("keeps every person in exactly one group", () => {
    const people = ["a", "b", "c", "d", "e"];
    const { tune, test } = splitByPerson(people);
    expect([...tune, ...test].sort()).toEqual(people);
  });

  it("is deterministic and order independent", () => {
    const a = splitByPerson(["c", "a", "b", "d"]);
    const b = splitByPerson(["d", "b", "a", "c"]);
    expect(a).toEqual(b);
  });

  it("holds out about a third of people", () => {
    expect(splitByPerson(Array.from({ length: 9 }, (_, i) => `p${i}`)).test).toHaveLength(3);
  });

  it("leaves at least one person to tune against", () => {
    const { tune, test } = splitByPerson(["a", "b"]);
    expect(tune).toHaveLength(1);
    expect(test).toHaveLength(1);
  });

  it("makes no split at all for a single person", () => {
    expect(splitByPerson(["solo"])).toEqual({ tune: ["solo"], test: [] });
  });

  it("handles an empty corpus", () => {
    expect(splitByPerson([])).toEqual({ tune: [], test: [] });
  });

  it("de-duplicates people appearing in several recordings", () => {
    const { tune, test } = splitByPerson(["a", "a", "b", "b", "b", "c"]);
    expect([...tune, ...test].sort()).toEqual(["a", "b", "c"]);
  });

  it("honours a custom held-out fraction", () => {
    expect(splitByPerson(["a", "b", "c", "d"], 0.5).test).toHaveLength(2);
  });
});
