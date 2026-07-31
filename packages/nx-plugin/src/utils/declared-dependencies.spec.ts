/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  applicableDependencies,
  declareDependencies,
  declaredNames,
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
      // Still owned, so the sync keeps its version current.
      expect(declaredNames(pinned.ts)).toContain('@nx/devkit');
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
