/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  compareRuntimeVersions,
  resolveLambdaRuntimes,
  runtimeIdentifierVersion,
  unresolvedRuntimeWarning,
} from './lambda-runtime-resolution.js';
import { LAMBDA_RUNTIME_VERSIONS } from './versions.js';

/** A slice of `Runtime.ALL` names, as `aws-cdk-lib` publishes them. */
const CDK_RUNTIMES = [
  'nodejs',
  'nodejs4.3',
  'nodejs4.3-edge',
  'nodejs18.x',
  'nodejs20.x',
  'nodejs22.x',
  'nodejs24.x',
  'python3.12',
  'python3.13',
  'python3.14',
  'java21',
  'provided.al2023',
];

describe('lambda runtime resolution', () => {
  describe('reading a runtime identifier', () => {
    it('should read the version a versioned runtime names', () => {
      expect(runtimeIdentifierVersion('nodejs24.x')).toEqual({
        language: 'node',
        version: '24',
      });
      expect(runtimeIdentifierVersion('python3.14')).toEqual({
        language: 'python',
        version: '3.14',
      });
    });

    // `nodejs` and `nodejs4.3-edge` carry no comparable version, and other
    // languages are not pinned here.
    it.each(['nodejs', 'nodejs4.3-edge', 'java21', 'provided.al2023'])(
      'should skip %s',
      (identifier) => {
        expect(runtimeIdentifierVersion(identifier)).toBeUndefined();
      },
    );
  });

  describe('selecting the latest runtime', () => {
    it('should pick the highest runtime CDK lists', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(CDK_RUNTIMES);

      expect(versions).toEqual({ node: '24', python: '3.14' });
      expect(unresolved).toEqual([]);
    });

    it('should never move a runtime backwards', () => {
      const { versions } = resolveLambdaRuntimes(['nodejs20.x', 'python3.12']);

      expect(versions).toEqual({ ...LAMBDA_RUNTIME_VERSIONS });
    });

    it('should compare majors numerically rather than as text', () => {
      const { versions } = resolveLambdaRuntimes([
        'nodejs9.x',
        'nodejs100.x',
        'python3.9',
        'python3.100',
      ]);

      expect(versions).toEqual({ node: '100', python: '3.100' });
    });
  });

  // A throw here would abort the whole weekly version update, dropping that
  // week's unrelated TypeScript, Python, Terraform, Java and mise bumps.
  describe('failing in isolation', () => {
    it('should keep the current pins when no runtimes are listed', () => {
      const { versions, unresolved } = resolveLambdaRuntimes([]);

      expect(versions).toEqual({ ...LAMBDA_RUNTIME_VERSIONS });
      expect(unresolved.map((entry) => entry.language).sort()).toEqual([
        'node',
        'python',
      ]);
      for (const entry of unresolved) {
        // Surfaced so it can't be mistaken for "already up to date".
        expect(unresolvedRuntimeWarning(entry)).toContain(entry.kept);
        expect(unresolvedRuntimeWarning(entry)).toContain(entry.language);
      }
    });

    it('should keep the pins when the list holds nothing parseable', () => {
      const { versions, unresolved } = resolveLambdaRuntimes([
        'nodejs',
        'java21',
        'provided.al2023',
      ]);

      expect(versions).toEqual({ ...LAMBDA_RUNTIME_VERSIONS });
      expect(unresolved).toHaveLength(2);
    });

    it('should resolve one language while reporting the other', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(['nodejs24.x']);

      expect(versions.node).toBe('24');
      expect(versions.python).toBe(LAMBDA_RUNTIME_VERSIONS.python);
      expect(unresolved).toEqual([
        {
          language: 'python',
          kept: LAMBDA_RUNTIME_VERSIONS.python,
          reason: 'no-runtimes-listed',
        },
      ]);
    });
  });

  it('should compare dotted versions numerically', () => {
    expect(compareRuntimeVersions('24', '22')).toBeGreaterThan(0);
    expect(compareRuntimeVersions('3.14', '3.9')).toBeGreaterThan(0);
    expect(compareRuntimeVersions('3.14', '3.14')).toBe(0);
  });
});
