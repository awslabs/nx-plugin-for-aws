/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { coerce, compare } from 'semver';
import type {
  IJavaVersion,
  IMiseVersion,
  IPyDepVersion,
  ITsDepVersion,
} from '../versions.js';

/** Any dependency a version table pins. */
export type IVersionedDep =
  | ITsDepVersion
  | IPyDepVersion
  | IJavaVersion
  | IMiseVersion;

/** A pin the run deliberately did not take, and why. */
export interface LockstepNote {
  name: IVersionedDep;
  note: string;
}

/** Proposed versions from a run, keyed by dependency name. */
export type ProposedVersions = Partial<Record<IVersionedDep, string>>;

/**
 * Dependencies that must move as a unit. At least two, since one pin has nothing
 * to stay in step with.
 */
export type LockstepGroup = readonly [
  IVersionedDep,
  IVersionedDep,
  ...IVersionedDep[],
];

/** The bare version in a pin, whatever range syntax it was written with. */
const bare = (version: string): string | undefined =>
  coerce(version, { includePrerelease: true })?.version;

/** The range prefix a pin was written with, so it is preserved. */
const prefixOf = (version: string, bareVersion: string): string =>
  version.slice(0, version.indexOf(bareVersion));

/**
 * Hold every member of each group at the lowest version proposed across it, so a
 * group only moves once all of its members can.
 *
 * Mutates the tables, which hold proposed versions not yet written anywhere.
 * Groups the run proposed fewer than two comparable versions for are left alone.
 */
export const holdGroupsInLockstep = (
  groups: readonly LockstepGroup[],
  ...tables: readonly ProposedVersions[]
): LockstepNote[] => {
  const notes: LockstepNote[] = [];

  for (const group of groups) {
    const members = group.flatMap((name) => {
      const table = tables.find((candidate) => candidate[name] !== undefined);
      const proposed = table?.[name];
      const version = proposed && bare(proposed);
      return table && proposed && version
        ? [{ name, table, proposed, version }]
        : [];
    });
    if (members.length < 2) continue;

    const lowest = members
      .map(({ version }) => version)
      .reduce((min, version) => (compare(version, min) < 0 ? version : min));

    for (const { name, table, proposed, version } of members) {
      if (version === lowest) continue;
      const held = `${prefixOf(proposed, version)}${lowest}`;
      table[name] = held;
      notes.push({
        name,
        note: `${name} held at ${held} (${proposed} available): must move in step with ${group
          .filter((other) => other !== name)
          .join(', ')}`,
      });
    }
  }

  return notes;
};
