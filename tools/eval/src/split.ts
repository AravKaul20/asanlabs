/**
 * Train/test splitting, always by person.
 *
 * Frames inside one hold are near-duplicates of each other, and two recordings
 * of the same person share their proportions and habits. Splitting by frame — or
 * even by recording — would leak the test set into the tuning set and make the
 * numbers look far better than they are. So the unit is the person.
 *
 * There is nothing to train here: the engine has no classifier. The split's
 * purpose is discipline about tuning — ranges get adjusted against the tune
 * group, and the held-out group is what the ship gates are read from.
 */

export interface PersonSplit {
  tune: string[];
  test: string[];
}

/**
 * Deterministically hold out roughly `testFraction` of people, chosen from the
 * sorted person list so the same corpus always splits the same way.
 */
export function splitByPerson(persons: Iterable<string>, testFraction = 1 / 3): PersonSplit {
  const sorted = [...new Set(persons)].sort();
  if (sorted.length < 2) return { tune: sorted, test: [] };

  // At least one person on each side of the split.
  const testCount = Math.min(
    sorted.length - 1,
    Math.max(1, Math.round(sorted.length * testFraction)),
  );
  // Take the held-out people from the end of the sorted list.
  const test = sorted.slice(sorted.length - testCount);
  const tune = sorted.slice(0, sorted.length - testCount);
  return { tune, test };
}
