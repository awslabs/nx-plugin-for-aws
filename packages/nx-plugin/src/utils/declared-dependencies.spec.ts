/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  applicableDependencies,
  declareDependencies,
  declaredNames,
  ownedDependencyEntries,
  ownedElsewhere,
} from './declared-dependencies';

interface AgentMetadata {
  readonly protocol: string;
  readonly auth: string;
}

describe('declared dependencies', () => {
  const declaration = declareDependencies<AgentMetadata>()({
    ts: [
      { name: 'zod' },
      { name: 'express', when: (m) => m.protocol !== 'http' },
      { name: 'ws', when: (m) => m.protocol === 'http' },
      { name: 'aws4fetch', when: (m) => m.auth === 'iam', dev: true },
    ],
  });

  describe('applicableDependencies', () => {
    it('should always include entries with no predicate', () => {
      expect(
        applicableDependencies(declaration.ts, {
          protocol: 'http',
          auth: 'iam',
        }).map((entry) => entry.name),
      ).toContain('zod');
    });

    it('should include only the entries whose predicate holds', () => {
      expect(
        applicableDependencies(declaration.ts, {
          protocol: 'a2a',
          auth: 'iam',
        }).map((entry) => entry.name),
      ).toEqual(['zod', 'express', 'aws4fetch']);
    });

    it('should select a different branch for different metadata', () => {
      expect(
        applicableDependencies(declaration.ts, {
          protocol: 'http',
          auth: 'cognito',
        }).map((entry) => entry.name),
      ).toEqual(['zod', 'ws']);
    });

    it('should preserve the flags an entry carries', () => {
      const [entry] = applicableDependencies(declaration.ts, {
        protocol: 'http',
        auth: 'iam',
      }).filter((candidate) => candidate.name === 'aws4fetch');

      expect(entry.dev).toBe(true);
    });

    // The migration evaluates these against whatever a project happened to
    // record. A predicate that reads a field the metadata doesn't carry must not
    // claim the dependency — a missed upgrade beats a wrong one.
    it('should not include an entry whose predicate reads absent metadata', () => {
      expect(
        applicableDependencies(declaration.ts, {} as AgentMetadata).map(
          (entry) => entry.name,
        ),
      ).toEqual(['zod', 'express']);
    });

    it('should not include an entry whose predicate throws', () => {
      const throwing = declareDependencies<{ nested?: { value: string } }>()({
        ts: [{ name: 'zod', when: (m) => m.nested!.value === 'x' }],
      });

      expect(applicableDependencies(throwing.ts, {})).toEqual([]);
    });

    // Declared so the version sync keeps its pin current, but never installed.
    it('should never include a version-only entry', () => {
      const pinned = declareDependencies()({
        ts: [{ name: 'zod' }, { name: '@nx/devkit', versionOnly: true }],
      });

      expect(applicableDependencies(pinned.ts, {}).map((e) => e.name)).toEqual([
        'zod',
      ]);
    });
  });

  describe('ownedDependencyEntries', () => {
    // What the version sync reads. A version-only entry is declared precisely so
    // its pin stays current, so excluding it here would strand the package on
    // whatever version it was generated with.
    it('should own a version-only entry the install skips', () => {
      const pinned = declareDependencies()({
        ts: [{ name: 'zod' }, { name: '@nx/devkit', versionOnly: true }],
      });

      expect(ownedDependencyEntries(pinned.ts, {}).map((e) => e.name)).toEqual([
        'zod',
        '@nx/devkit',
      ]);
    });

    // A helper's constant is spread to claim ownership; the helper installs it
    // into the project it owns. The sync must still upgrade it.
    it('should own the entries a helper installs elsewhere', () => {
      const delegating = declareDependencies()({
        ts: [{ name: 'zod' }, ...ownedElsewhere([{ name: 'aws-cdk-lib' }])],
      });

      expect(
        applicableDependencies(delegating.ts, {}).map((e) => e.name),
      ).toEqual(['zod']);
      expect(
        ownedDependencyEntries(delegating.ts, {}).map((e) => e.name),
      ).toEqual(['zod', 'aws-cdk-lib']);
    });

    // Ownership narrows by metadata like the install does: a project generated
    // for one branch does not own another's packages.
    it('should own only the entries whose predicate holds', () => {
      expect(
        ownedDependencyEntries(declaration.ts, {
          protocol: 'http',
          auth: 'cognito',
        }).map((entry) => entry.name),
      ).toEqual(['zod', 'ws']);
    });
  });

  describe('declaredNames', () => {
    it('should list every declared package whatever its predicate', () => {
      expect(declaredNames(declaration.ts)).toEqual([
        'zod',
        'express',
        'ws',
        'aws4fetch',
      ]);
    });
  });
});
