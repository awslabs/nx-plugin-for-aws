/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  applicableDependencies,
  declareDependencies,
  declaredNames,
  onlyWhen,
  ownedDependencyEntries,
  ownedElsewhere,
} from './declared-dependencies.js';

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

    // A predicate may hand back the value it read rather than a comparison.
    it('should include an entry whose predicate returns a truthy value', () => {
      const truthy = declareDependencies<{ port?: number; name?: string }>()({
        ts: [
          { name: 'zod', when: (m) => m.port },
          { name: 'express', when: (m) => m.name },
        ],
      });

      expect(
        applicableDependencies(truthy.ts, { port: 8080 }).map((e) => e.name),
      ).toEqual(['zod']);
      // 0 and '' are falsy, so neither applies.
      expect(applicableDependencies(truthy.ts, { port: 0, name: '' })).toEqual(
        [],
      );
    });
  });

  // `dev` is a TypeScript concept and `group` a Python one, so each is typed as
  // never-present on the other — a misplaced flag fails to compile.
  describe('language-specific flags', () => {
    it('should reject a Python flag on a TypeScript entry', () => {
      declareDependencies()({
        // @ts-expect-error group is Python-only
        ts: [{ name: 'zod', group: 'dev' }],
      });
    });

    it('should reject a TypeScript flag on a Python entry', () => {
      declareDependencies()({
        // @ts-expect-error dev is TypeScript-only
        py: [{ name: 'boto3', dev: true }],
      });
    });

    it('should accept each flag on its own language', () => {
      const declaration = declareDependencies()({
        ts: [{ name: 'tsx', dev: true, root: true }],
        py: [{ name: 'ruff', group: 'dev', root: true }],
      });

      expect(declaration.ts[0].dev).toBe(true);
      expect(declaration.py[0].group).toBe('dev');
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

  describe('onlyWhen', () => {
    const helper = [
      { name: 'zod' },
      { name: 'express', when: (m: AgentMetadata) => m.auth === 'iam' },
    ] as const;

    it('should not apply an entry when the added condition fails', () => {
      expect(
        applicableDependencies(
          onlyWhen(helper, (m: AgentMetadata) => m.protocol === 'ag-ui'),
          { protocol: 'http', auth: 'iam' },
        ),
      ).toEqual([]);
    });

    // Replacing `when` outright would widen ownership to the helper's every
    // branch, claiming packages this project never received.
    it("should keep each entry's own condition within the branch", () => {
      const narrowed = onlyWhen(
        helper,
        (m: AgentMetadata) => m.protocol === 'ag-ui',
      );

      expect(
        applicableDependencies(narrowed, {
          protocol: 'ag-ui',
          auth: 'cognito',
        }).map((entry) => entry.name),
      ).toEqual(['zod']);
      expect(
        applicableDependencies(narrowed, {
          protocol: 'ag-ui',
          auth: 'iam',
        }).map((entry) => entry.name),
      ).toEqual(['zod', 'express']);
    });

    it('should preserve the flags an entry carries', () => {
      const [entry] = onlyWhen([{ name: 'zod', dev: true }], () => true);

      expect(entry.dev).toBe(true);
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
