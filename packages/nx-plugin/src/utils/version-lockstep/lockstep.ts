/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Groups of pins that must move together.
 *
 * Packages published as a family are often only mutually resolvable at the same
 * version, but their bumps arrive independently — so left alone a run takes one
 * and leaves the rest behind, and the mismatch fails the build.
 *
 * A group is held at the lowest version proposed across its members, so it only
 * moves once every member can. Whichever member is furthest behind is the
 * constraint; the rest are taken on a later run, once it catches up.
 *
 * This assumes the members share a version line, which is what makes "lowest"
 * meaningful. A package coupled to something on an unrelated line (a dependant
 * that pins it exactly, say) needs its own hold instead.
 */

/** A note explaining a pin the run deliberately did not take. */
export interface LockstepNote {
  note: string;
}

/**
 * The pins in one group, named as they appear in the versions tables. Members may
 * live in different tables (e.g. the TypeScript and Python pins).
 */
export type LockstepGroup = readonly string[];

/** Strip a range prefix (`==`, `^`, `~`, …) to leave a bare version. */
const bare = (version: string): string =>
  version.replace(/^[=~^><!\s]+/, '').trim();

/** The range prefix a pin was written with, so it can be preserved. */
const prefixOf = (version: string): string =>
  version.slice(0, version.indexOf(bare(version)));

/**
 * Compare bare `major.minor.patch[...]` versions segment by segment. Numeric
 * segments compare numerically; anything else (prereleases) compares as a
 * string, which is enough to order the pins these tables hold.
 */
export const compareVersions = (a: string, b: string): number => {
  const as = bare(a).split(/[.\-+]/);
  const bs = bare(b).split(/[.\-+]/);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? '';
    const y = bs[i] ?? '';
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isNaN(nx) || Number.isNaN(ny)) return x < y ? -1 : 1;
    return nx - ny;
  }
  return 0;
};

/**
 * Hold every member of each group at the lowest version proposed across it.
 *
 * Applied to the *proposed* versions before they are written, so a held pin is
 * never recorded. Each pin keeps the range prefix it was written with, so a
 * `==x.y.z` Python pin stays in that form.
 *
 * @param groups the coupling declarations to enforce
 * @param tables the proposed-version tables to read and rewrite; a member is
 *   looked up in the first table that declares it
 */
export const holdGroupsInLockstep = (
  groups: readonly LockstepGroup[],
  ...tables: readonly Record<string, string>[]
): LockstepNote[] => {
  const notes: LockstepNote[] = [];

  for (const group of groups) {
    // A group can only be held where the run actually proposed something for at
    // least two of its members; a single pin has nothing to stay in step with.
    const members = group.flatMap((name) => {
      const table = tables.find((candidate) => name in candidate);
      return table ? [{ name, table }] : [];
    });
    if (members.length < 2) continue;

    const lowest = members
      .map(({ name, table }) => table[name])
      .reduce((min, version) =>
        compareVersions(version, min) < 0 ? version : min,
      );

    for (const { name, table } of members) {
      const proposed = table[name];
      const held = `${prefixOf(proposed)}${bare(lowest)}`;
      if (proposed === held) continue;
      table[name] = held;
      notes.push({
        note: `${name} held at ${held} (${proposed} available): must move in step with ${group
          .filter((other) => other !== name)
          .join(', ')}`,
      });
    }
  }

  return notes;
};
