/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, writeJson } from '@nx/devkit';
import { coerce, satisfies, valid } from 'semver';
import type {
  IVersionedDep,
  LockstepNote,
  ProposedVersions,
} from './lockstep.js';

/**
 * Pins that must equal the exact `dependencies` a published release of another
 * pin declares, for packages that don't share a version line.
 */
export interface ExactDependencyPin {
  /** The pin whose published `dependencies` the followers take. */
  source: IVersionedDep;
  /** Pins set to exactly the version `source` depends on. */
  followers: readonly [IVersionedDep, ...IVersionedDep[]];
  /** Pins whose published `peerDependencies` must accept the followers. */
  peers: readonly IVersionedDep[];
  /** Why the followers must match, for the update's PR. */
  reason: string;
}

/** The manifest fields the rule reads. */
export type ManifestField = 'dependencies' | 'peerDependencies';

/**
 * Reads one field of a published release's manifest, for example from
 * `https://registry.npmjs.org/<name>/<version>`. Resolves to `{}` when the
 * release has no such field, and rejects when the release can't be read.
 */
export type DependencyLookup = (
  name: string,
  version: string,
  field: ManifestField,
) => Promise<Record<string, string>>;

/** Groups of pins held at one version, as in `LOCKSTEP_GROUPS`. */
type Groups = readonly (readonly string[])[];

/** The version each pin must take, or why there isn't one. */
type Targets = Map<IVersionedDep, string> | { held: string };

/** The bare version in a pin, whatever range syntax it was written with. */
const bare = (version: string): string | undefined =>
  coerce(version, { includePrerelease: true })?.version;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The versions the source's `dependencies` give its followers, and the version
 * of the follower each group mate is grouped with, so the group stays in step.
 */
const targetsFrom = (
  { source, followers }: ExactDependencyPin,
  sourceVersion: string,
  dependencies: Record<string, string>,
  groups: Groups,
  current: Readonly<ProposedVersions>,
): Targets => {
  const missing = followers.filter((name) => !dependencies[name]);
  if (missing.length > 0) {
    return {
      held: `${source} ${sourceVersion} does not depend on ${missing.join(', ')}`,
    };
  }

  // Releases so far declare exact versions. If one declares a range, take its
  // bare version: our pins are exact, and a single copy needs that version.
  const targets = new Map<IVersionedDep, string>(
    followers.map((name) => {
      const declared = dependencies[name];
      return [name, valid(declared) ?? bare(declared) ?? declared];
    }),
  );

  for (const group of groups) {
    const inGroup = followers.filter((name) => group.includes(name));
    if (inGroup.length === 0) continue;
    const version = targets.get(inGroup[0]) as string;
    const disagreeing = inGroup.find((name) => targets.get(name) !== version);
    if (disagreeing) {
      return {
        held: `${source} ${sourceVersion} depends on ${inGroup[0]} ${version} but ${disagreeing} ${targets.get(disagreeing)}, which must move in step`,
      };
    }
    for (const name of group as readonly IVersionedDep[]) {
      if (!targets.has(name) && current[name] !== undefined) {
        targets.set(name, version);
      }
    }
  }

  return targets;
};

/** Why the peers being written would reject the targets, if they would. */
const unmetPeers = async (
  { source, peers }: ExactDependencyPin,
  sourceVersion: string,
  targets: Map<IVersionedDep, string>,
  written: (name: IVersionedDep) => string | undefined,
  lookup: DependencyLookup,
): Promise<string | undefined> => {
  const unmet: string[] = [];
  for (const peer of peers) {
    const peerVersion = written(peer);
    if (peerVersion === undefined) continue;
    let ranges: Record<string, string>;
    try {
      ranges = await lookup(peer, peerVersion, 'peerDependencies');
    } catch (error) {
      return `could not read the peerDependencies of ${peer} ${peerVersion} (${message(error)})`;
    }
    for (const [name, version] of targets) {
      const range = ranges[name];
      if (range && !satisfies(version, range, { includePrerelease: true })) {
        unmet.push(
          `${peer} ${peerVersion} requires ${name} ${range}, but ${source} ${sourceVersion} needs ${version}`,
        );
      }
    }
  }
  return unmet.length > 0 ? unmet.join('; ') : undefined;
};

/**
 * Set each rule's followers, and their lockstep group mates, to the exact
 * versions the source being written depends on. Runs after the lockstep, which
 * can only hold a group back and so can't move one up to what the source needs.
 *
 * Mutates `proposed`, which holds versions not yet written anywhere. When a peer
 * would reject the result, or a manifest can't be read, every pin the rule covers
 * is put back to `current` for this run instead. Returns a note for each pin set
 * and each rule held, so the reason reaches the update's PR.
 */
export const pinToExactDependencies = async (
  rules: readonly ExactDependencyPin[],
  groups: Groups,
  current: Readonly<ProposedVersions>,
  proposed: ProposedVersions,
  lookup: DependencyLookup,
): Promise<LockstepNote[]> => {
  const notes: LockstepNote[] = [];
  const written = (name: IVersionedDep): string | undefined => {
    const version = proposed[name] ?? current[name];
    return version === undefined ? undefined : bare(version);
  };

  for (const rule of rules) {
    const { source, followers, peers, reason } = rule;
    const mates = groups
      .filter((group) => followers.some((name) => group.includes(name)))
      .flat() as IVersionedDep[];
    const covered = [
      ...new Set([source, ...followers, ...mates, ...peers]),
    ].filter((name) => current[name] !== undefined);

    // Every pin the rule covers goes back to its current version, so nothing
    // the rule could not check is written.
    const hold = (why: string) => {
      const notTaken = covered.filter(
        (name) =>
          proposed[name] !== undefined && proposed[name] !== current[name],
      );
      notes.push({
        name: source,
        note:
          `${source} held at ${current[source]}, with ${covered
            .filter((name) => name !== source)
            .join(', ')} at their current versions` +
          (notTaken.length > 0
            ? ` (not taken: ${notTaken
                .map((name) => `${name} ${proposed[name]}`)
                .join(', ')})`
            : '') +
          `: ${why}`,
      });
      for (const name of covered) proposed[name] = current[name];
    };

    const sourceVersion = written(source);
    if (sourceVersion === undefined) continue;

    let dependencies: Record<string, string>;
    try {
      dependencies = await lookup(source, sourceVersion, 'dependencies');
    } catch (error) {
      hold(
        `could not read the dependencies of ${source} ${sourceVersion} (${message(error)})`,
      );
      continue;
    }

    const targets = targetsFrom(
      rule,
      sourceVersion,
      dependencies,
      groups,
      current,
    );
    if (!(targets instanceof Map)) {
      hold(targets.held);
      continue;
    }

    const unmet = await unmetPeers(
      rule,
      sourceVersion,
      targets,
      written,
      lookup,
    );
    if (unmet) {
      hold(unmet);
      continue;
    }

    for (const [name, version] of targets) {
      const before = proposed[name] ?? current[name];
      if (before === version) continue;
      proposed[name] = version;
      notes.push({
        name,
        note: `${name} set to ${version} (${before} proposed) to match the exact dependencies of ${source} ${sourceVersion}: ${reason}`,
      });
    }
  }

  return notes;
};

/** Reads each release's field once; a failed read fails the same way when repeated. */
export const memoizeLookup = (lookup: DependencyLookup): DependencyLookup => {
  const cache = new Map<string, Promise<Record<string, string>>>();
  return async (name, version, field) => {
    const key = `${name}@${version} ${field}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = lookup(name, version, field);
      cache.set(key, cached);
    }
    return { ...(await cached) };
  };
};

/** Where the update records what each rule's source release depends on. */
export const EXACT_DEPENDENCY_SOURCES_PATH =
  'packages/nx-plugin/exact-dependency-sources.json';

/** Per rule source: the version pinned and the exact versions it depends on for its followers. */
export type ExactDependencySources = Record<
  string,
  { version: string; dependencies: Record<string, string> }
>;

/**
 * What each rule's source, at the version being written, depends on for its
 * followers. Reuses `recorded` for a source that did not move and reads the
 * registry otherwise. Throws when a follower being written is not that version,
 * or when the source's dependencies can't be read or omit a follower.
 */
export const verifyExactDependencies = async (
  rules: readonly ExactDependencyPin[],
  versions: Readonly<ProposedVersions>,
  recorded: Readonly<ExactDependencySources>,
  lookup: DependencyLookup,
): Promise<ExactDependencySources> => {
  const sources: ExactDependencySources = {};
  const written = (name: IVersionedDep): string | undefined => {
    const version = versions[name];
    return version === undefined ? undefined : bare(version);
  };

  for (const { source, followers, reason } of rules) {
    const sourceVersion = written(source);
    if (sourceVersion === undefined) continue;

    let dependencies: Record<string, string>;
    if (recorded[source]?.version === sourceVersion) {
      dependencies = recorded[source].dependencies;
    } else {
      try {
        dependencies = await lookup(source, sourceVersion, 'dependencies');
      } catch (error) {
        throw new Error(
          `could not read the dependencies of ${source} ${sourceVersion} (${message(error)})`,
        );
      }
    }

    const missing = followers.filter((name) => !dependencies[name]);
    if (missing.length > 0) {
      throw new Error(
        `${source} ${sourceVersion} does not depend on ${missing.join(', ')}`,
      );
    }

    const expected = Object.fromEntries(
      followers.map((name) => {
        const declared = dependencies[name];
        return [name, valid(declared) ?? bare(declared) ?? declared];
      }),
    );
    const differing = followers.filter(
      (name) => written(name) !== expected[name],
    );
    if (differing.length > 0) {
      throw new Error(
        `${differing.map((name) => `${name} ${written(name)}`).join(', ')} but ${source} ${sourceVersion} depends on ${differing.map((name) => `${name} ${expected[name]}`).join(', ')}: ${reason}`,
      );
    }

    sources[source] = { version: sourceVersion, dependencies: expected };
  }

  return sources;
};

/**
 * Record in `EXACT_DEPENDENCY_SOURCES_PATH` what the sources being written depend
 * on, which `versions.spec.ts` checks the pins against. Throws as
 * `verifyExactDependencies` does, before anything is written.
 * @returns paths written, for the update report
 */
export const writeExactDependencySources = async (
  tree: Tree,
  rules: readonly ExactDependencyPin[],
  versions: Readonly<ProposedVersions>,
  lookup: DependencyLookup,
): Promise<string[]> => {
  const path = EXACT_DEPENDENCY_SOURCES_PATH;
  const recorded: ExactDependencySources = tree.exists(path)
    ? JSON.parse(tree.read(path, 'utf-8') ?? '{}')
    : {};
  const sources = await verifyExactDependencies(
    rules,
    versions,
    recorded,
    lookup,
  );
  if (JSON.stringify(sources) === JSON.stringify(recorded)) return [];
  writeJson(tree, path, sources);
  return [path];
};
