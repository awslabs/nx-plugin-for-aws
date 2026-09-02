/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { coerce, compare } from 'semver';

/**
 * Groups of pins that must move together.
 *
 * Packages published as a family are often only correct at the same version, but
 * their bumps arrive independently — and one may skip a release the others got.
 * Left alone a run takes whichever moved and leaves the rest behind, and the
 * mismatch fails the build.
 *
 * A group is held at the lowest version proposed across its members, so it only
 * moves once every member can. Whichever member is furthest behind is the
 * constraint; the rest are taken on a later run, once it catches up.
 *
 * This assumes members share a version line, which is what makes "lowest"
 * meaningful. A package coupled to something on an unrelated line needs its own
 * hold instead.
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

/**
 * The bare version in a pin, whatever range syntax it was written with — `==` for
 * the Python pins, a plain version or `^`/`~` for the npm ones.
 */
const bare = (version: string): string | undefined =>
  coerce(version, { includePrerelease: true })?.version;

/** The range prefix a pin was written with, so it can be preserved. */
const prefixOf = (version: string, bareVersion: string): string =>
  version.slice(0, version.indexOf(bareVersion));

/**
 * Hold every member of each group at the lowest version proposed across it.
 *
 * Applied to the *proposed* versions before they are written, so a held pin is
 * never recorded. Each pin keeps the range syntax it was written with, so a
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
    // Only members the run proposed a comparable version for can take part. A
    // group with fewer than two has nothing to stay in step with, so it is left
    // alone rather than held against a version nothing proposed.
    const members = group.flatMap((name) => {
      const table = tables.find((candidate) => name in candidate);
      const version = table && bare(table[name]);
      return table && version ? [{ name, table, version }] : [];
    });
    if (members.length < 2) continue;

    const lowest = members
      .map(({ version }) => version)
      .reduce((min, version) => (compare(version, min) < 0 ? version : min));

    for (const { name, table, version } of members) {
      if (version === lowest) continue;
      const proposed = table[name];
      const held = `${prefixOf(proposed, version)}${lowest}`;
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
