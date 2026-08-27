/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  compareRuntimeVersions,
  type ManagedRuntime,
  parseManagedRuntimes,
  resolveLambdaRuntimes,
  unresolvedRuntimeWarning,
} from './lambda-runtime-resolution.js';
import { LAMBDA_RUNTIME_VERSIONS } from './versions.js';

/** A supported-runtimes table row, as the docs page renders it. */
const row = (identifier: string, deprecation: string) =>
  `<tr><td>Name</td><td><code>${identifier}</code></td><td>Amazon Linux 2023</td><td>${deprecation}</td><td>x</td><td>y</td></tr>`;

const table = (rows: string[]) => `<html><body><table><tbody>
${rows.join('\n')}
</tbody></table></body></html>`;

// Well clear of the six-month horizon.
const FAR = 'Jun 30, 2099';

describe('lambda runtime resolution', () => {
  describe('parsing the supported runtimes table', () => {
    it('should read the identifier and deprecation date', () => {
      const runtimes = parseManagedRuntimes(
        table([row('nodejs24.x', FAR), row('python3.14', FAR)]),
      );

      expect(runtimes).toEqual([
        expect.objectContaining({ identifier: 'nodejs24.x', version: '24' }),
        expect.objectContaining({ identifier: 'python3.14', version: '3.14' }),
      ]);
    });

    // A preview runtime reads "Not scheduled", which is the only signal that
    // separates it from a GA one.
    it('should leave a preview runtime without a deprecation date', () => {
      const [preview] = parseManagedRuntimes(
        table([row('nodejs26.x', 'Not scheduled')]),
      );

      expect(preview.deprecation).toBeUndefined();
    });
  });

  describe('selecting the latest GA runtime', () => {
    it('should pick the highest runtime carrying a deprecation date', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(
        parseManagedRuntimes(
          table([
            row('nodejs26.x', 'Not scheduled'),
            row('nodejs24.x', FAR),
            row('nodejs22.x', FAR),
            row('python3.15', 'Not scheduled'),
            row('python3.14', FAR),
          ]),
        ),
      );

      expect(versions).toEqual({ node: '24', python: '3.14' });
      expect(unresolved).toEqual([]);
    });

    it('should never move a runtime backwards', () => {
      const { versions } = resolveLambdaRuntimes(
        parseManagedRuntimes(
          table([row('nodejs20.x', FAR), row('python3.12', FAR)]),
        ),
      );

      expect(versions).toEqual({ ...LAMBDA_RUNTIME_VERSIONS });
    });

    it('should skip a runtime deprecated within six months', () => {
      const soon = new Date();
      soon.setMonth(soon.getMonth() + 2);
      const runtimes: ManagedRuntime[] = [
        { identifier: 'nodejs99.x', version: '99', deprecation: soon },
        {
          identifier: 'nodejs24.x',
          version: '24',
          deprecation: new Date('2099-06-30'),
        },
        {
          identifier: 'python3.14',
          version: '3.14',
          deprecation: new Date('2099-06-30'),
        },
      ];

      const { versions } = resolveLambdaRuntimes(runtimes);

      expect(versions.node).toBe('24');
    });
  });

  // A throw here would abort the whole weekly version update, dropping that
  // week's unrelated TypeScript, Python, Terraform, Java and mise bumps.
  describe('failing in isolation', () => {
    it('should keep the current pins when the page cannot be parsed', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(
        parseManagedRuntimes('<html><body>redesigned, no table</body></html>'),
      );

      expect(versions).toEqual({ ...LAMBDA_RUNTIME_VERSIONS });
      expect(unresolved.map((u) => u.language).sort()).toEqual([
        'node',
        'python',
      ]);
      for (const entry of unresolved) {
        expect(entry.reason).toBe('unreadable-page');
        expect(unresolvedRuntimeWarning(entry)).toContain(
          'Could not read the Lambda runtimes table',
        );
        // Surfaced so it can't be mistaken for "already up to date".
        expect(unresolvedRuntimeWarning(entry)).toContain(entry.kept);
      }
    });

    it('should keep the current pins when no GA runtime is listed', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(
        parseManagedRuntimes(
          table([
            row('nodejs26.x', 'Not scheduled'),
            row('python3.15', 'Not scheduled'),
          ]),
        ),
      );

      expect(versions).toEqual({ ...LAMBDA_RUNTIME_VERSIONS });
      expect(unresolved.map((u) => u.language).sort()).toEqual([
        'node',
        'python',
      ]);
      for (const entry of unresolved) {
        // Distinct from an unreadable page: the table was read, it just offered
        // nothing generally available.
        expect(entry.reason).toBe('no-ga-runtime');
        expect(unresolvedRuntimeWarning(entry)).toContain(
          'no generally-available',
        );
      }
    });

    it('should resolve one language while reporting the other', () => {
      const { versions, unresolved } = resolveLambdaRuntimes(
        parseManagedRuntimes(
          table([row('nodejs24.x', FAR), row('python3.15', 'Not scheduled')]),
        ),
      );

      expect(versions.node).toBe('24');
      expect(versions.python).toBe(LAMBDA_RUNTIME_VERSIONS.python);
      expect(unresolved).toEqual([
        {
          language: 'python',
          kept: LAMBDA_RUNTIME_VERSIONS.python,
          reason: 'no-ga-runtime',
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
