/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Groups of pins that must move together.
 *
 * Some packages are only correct at matching versions: a Python formatter and the
 * wasm build of it that actually runs, or an npm library and a second library
 * that depends on an exact release of it. The bumps behind those pins arrive
 * independently, so left alone a run takes one and leaves the other behind and
 * the mismatch fails the build.
 *
 * A group nominates one member as the leader. Every other member is rewritten to
 * whatever the leader resolves to, so a group only ever moves as a unit — one
 * place to declare the constraint instead of a bespoke hold per pair.
 */

/** A note explaining a pin the run deliberately did not take. */
export interface LockstepNote {
  note: string;
}

/**
 * How a member's version is written, for groups that span registries or
 * manifests. `plain` is a bare version (npm); `pep440` is the `==x.y.z` form
 * `PY_VERSIONS` uses.
 */
export type VersionFormat = 'plain' | 'pep440';

export interface LockstepMember {
  /** Key in the versions table this member lives in. */
  readonly name: string;
  /** Defaults to `plain`. */
  readonly format?: VersionFormat;
  /**
   * Resolve the version to hold against, for a constraint that lives somewhere
   * other than one of our own pins — e.g. a dependant's dependency range, read
   * from the registry. Receives the merged proposed versions. Returning
   * `undefined` leaves the group untouched and reports why.
   */
  readonly resolve?: (versions: Record<string, string>) => string | undefined;
}

export interface LockstepGroup {
  /** Shown in the report to explain why the group is coupled. */
  readonly reason: string;
  /**
   * The member the rest follow. Chosen as whichever is the harder constraint to
   * move — typically the one already installed and running, or the one whose
   * dependant pins it exactly.
   */
  readonly leader: LockstepMember;
  readonly followers: readonly LockstepMember[];
}

const stripFormat = (version: string): string =>
  version.replace(/^[=~^><!]+/, '').trim();

const applyFormat = (
  version: string,
  format: VersionFormat = 'plain',
): string =>
  format === 'pep440' ? `==${stripFormat(version)}` : stripFormat(version);

/**
 * Read a member's version from whichever of the supplied tables declares it, so
 * a group can span the TypeScript and Python pins.
 */
const readMember = (
  member: LockstepMember,
  tables: readonly Record<string, string>[],
): string | undefined => {
  for (const table of tables) {
    const version = table[member.name];
    if (version !== undefined) return version;
  }
  return undefined;
};

const writeMember = (
  member: LockstepMember,
  version: string,
  tables: readonly Record<string, string>[],
): boolean => {
  for (const table of tables) {
    if (member.name in table) {
      table[member.name] = version;
      return true;
    }
  }
  return false;
};

/**
 * Hold every follower in each group at the version its leader resolves to.
 *
 * Applied to the *proposed* versions before they are written, so a held pin is
 * never recorded. Followers are taken next run, once the leader catches up.
 *
 * @param groups the coupling declarations to enforce
 * @param tables the proposed-version tables to read and rewrite, in precedence
 *   order — a member is looked up in the first table that declares it
 */
export const holdGroupsInLockstep = (
  groups: readonly LockstepGroup[],
  ...tables: readonly Record<string, string>[]
): LockstepNote[] => {
  const notes: LockstepNote[] = [];

  const merged = Object.assign({}, ...[...tables].reverse()) as Record<
    string,
    string
  >;

  for (const group of groups) {
    const leaderVersion = group.leader.resolve
      ? group.leader.resolve(merged)
      : readMember(group.leader, tables);
    if (leaderVersion === undefined) {
      notes.push({
        note: `could not resolve ${group.leader.name} to hold its group against — ${group.followers
          .map((f) => f.name)
          .join(', ')} left as proposed`,
      });
      continue;
    }

    for (const follower of group.followers) {
      const proposed = readMember(follower, tables);
      if (proposed === undefined) continue;

      const required = applyFormat(leaderVersion, follower.format);
      if (proposed === required) continue;

      if (!writeMember(follower, required, tables)) continue;
      notes.push({
        note: `${follower.name} held at ${required} (${proposed} available): ${group.reason}`,
      });
    }
  }

  return notes;
};
