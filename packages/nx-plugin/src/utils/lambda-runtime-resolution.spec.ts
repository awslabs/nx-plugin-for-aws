/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  LAMBDA_RUNTIME_CEILINGS,
  resolveLambdaRuntimes,
  runtimeIdentifierVersion,
  unresolvedRuntimeWarning,
} from './lambda-runtime-resolution.js';
import { compareRuntimeVersions } from './runtime-resolution.js';
import { type ILambdaRuntime, LAMBDA_RUNTIME_VERSIONS } from './versions.js';

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
      // No ceilings, so the comparison is what decides the result.
      const { versions } = resolveLambdaRuntimes(
        ['nodejs9.x', 'nodejs100.x', 'python3.9', 'python3.100'],
        {},
      );

      expect(versions).toEqual({ node: '100', python: '3.100' });
    });
  });

  describe('holding a runtime below its ceiling', () => {
    // `Runtime.ALL` lists runtimes that are not generally available: aws-cdk-lib
    // added `python3.15` in 2.276.0 and `nodejs26.x` in 2.277.0, both days
    // before Lambda made them GA. The ceiling decides in this repo when a
    // runtime moves.
    const CEILINGS = {
      node: {
        ceiling: '24',
        reason: 'the vended image',
        liftWhen: 'the newer image is published',
      },
    };

    it('should keep the pin when CDK lists a runtime above the ceiling', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(
        ['nodejs26.x', 'python3.14'],
        CEILINGS,
      );

      expect(versions.node).toBe(LAMBDA_RUNTIME_VERSIONS.node);
      expect(unresolved).toEqual([
        {
          language: 'node',
          kept: LAMBDA_RUNTIME_VERSIONS.node,
          reason: 'held-below-ceiling',
          detail: 'the vended image',
          liftWhen: 'the newer image is published',
        },
      ]);
    });

    // Surfaced in the PR body, so a hold that has outlived its reason is visible
    // without reading the resolver — carrying the lift condition as well as the
    // reason, the way a Python or Terraform hold reports it.
    it('should warn with the reason the runtime is held', () => {
      const { unresolved } = resolveLambdaRuntimes(['nodejs26.x'], CEILINGS);

      expect(unresolvedRuntimeWarning(unresolved[0])).toContain(
        'the vended image',
      );
      expect(unresolvedRuntimeWarning(unresolved[0])).toContain('node');
      expect(unresolvedRuntimeWarning(unresolved[0])).toContain(
        'Lift when the newer image is published',
      );
    });

    it('should still move a language with no ceiling', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(
        ['nodejs26.x', 'python3.99'],
        CEILINGS,
      );

      expect(versions.python).toBe('3.99');
      expect(unresolved.map((entry) => entry.language)).toEqual(['node']);
    });

    // A ceiling above the pin, and the version a held note names, are covered in
    // `runtime-resolution.spec.ts`, where the pins are a fixture rather than the
    // live ones this resolver reads.

    // A ceiling below the pin it caps does nothing, because the hold never moves
    // a runtime backwards: the pin stays and only the hold warning appears. Such
    // a ceiling reads as a hold to the next version it would cap, so the shipped
    // ones are checked against the pins instead of being taken on trust.
    it('should ship no ceiling below the runtime it caps', () => {
      const inert: string[] = [];

      for (const language of Object.keys(
        LAMBDA_RUNTIME_VERSIONS,
      ) as ILambdaRuntime[]) {
        const held = LAMBDA_RUNTIME_CEILINGS[language];
        const pin = LAMBDA_RUNTIME_VERSIONS[language];
        if (held && compareRuntimeVersions(held.ceiling, pin) < 0) {
          inert.push(`${language}: ceiling ${held.ceiling} below pin ${pin}`);
        }
      }

      expect(inert).toEqual([]);
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
