/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import conventional from '@commitlint/config-conventional';
import { describe, expect, it } from 'vitest';
import { unresolvedAgentCoreRuntimeWarning } from '../agent-core-runtime-resolution.js';
import { unresolvedRuntimeWarning } from '../lambda-runtime-resolution.js';
import {
  EXACT_DEPENDENCY_PINS,
  LOCKSTEP_GROUPS,
  PY_VERSIONS,
  TERRAFORM_VERSIONS,
} from '../versions.js';
import {
  type DependencyLookup,
  pinToExactDependencies,
} from './exact-dependency.js';
import {
  holdPinnedVersions,
  PY_VERSION_HOLDS,
  TERRAFORM_VERSION_HOLDS,
} from './hold.js';
import type { ProposedVersions } from './lockstep.js';
import {
  type ChangeGroup,
  commitMessageLineLimit,
  formatReport,
  wrapReport,
  wrapReportLine,
} from './report.js';

/** The repo's commitlint config, as the commit-msg hook loads it. */
const commitlintConfig = createRequire(import.meta.url)(
  '../../../../../commitlint.config.js',
);

const LIMIT = commitMessageLineLimit(
  conventional.rules,
  commitlintConfig.rules,
);

/** commitlint's line-length rules skip any line containing a URL. */
const withinCommitlint = (line: string, limit: number): boolean =>
  line.length <= limit ||
  /^\S*https?:\/\/\S+$/.test(line.replace(/^\s*(?:[-+*] +)?/, ''));

/** A word that would start a Markdown block at the start of a continuation. */
const BLOCK_START = /^(?:[-+*]|\d{1,9}[.)]|#{1,6}|[<>`~].*|[-=*_]{3,})$/;

const startsBlock = (continuation: string): boolean =>
  BLOCK_START.test(continuation.trim().split(/\s+/)[0]);

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** The five lines of run 39323306100's report that commitlint rejected. */
const REJECTED_LINES = [
  '- @ag-ui/client set to 1.0.2 (1.0.3 proposed) to match the exact dependencies of @copilotkit/react-core 1.79.1: a second @ag-ui/client copy fails every generated website with TS2322',
  '- @ag-ui/core set to 1.0.2 (1.0.3 proposed) to match the exact dependencies of @copilotkit/react-core 1.79.1: a second @ag-ui/client copy fails every generated website with TS2322',
  '- @ag-ui/encoder set to 1.0.2 (1.0.3 proposed) to match the exact dependencies of @copilotkit/react-core 1.79.1: a second @ag-ui/client copy fails every generated website with TS2322',
  '- ty held at ==0.0.87 (==0.0.89 available): ty is 0.x and its releases add diagnostics that fail the vended Python templates. Lift when a newer ty has been checked against all vended Python templates (run the py-client, py#dynamodb and other Python-typecheck specs with it)',
  '- aws held at 6.68.0 (6.69.1 available): hashicorp/aws 6.69.0 moved to aws-sdk-go-base/v2 v2.0.0-beta.75, whose bufio.Scanner response logger fails reading aws_cognito_managed_login_branding with "token too long", so the vended Cognito user identity fails apply (terraform-provider-aws#50481). Lift when a hashicorp/aws release includes aws-sdk-go-base#1539 (fixes terraform-provider-aws#50481); check the provider\'s go.mod for aws-sdk-go-base/v2 > beta.75 or the changelog',
];

describe('wrapReportLine', () => {
  it('keeps lines at or under the limit byte for byte', () => {
    const exact = `- ${'a'.repeat(98)}`;
    expect(exact).toHaveLength(100);
    for (const line of [exact, '- short  line with  spaces ', '']) {
      expect(wrapReportLine(line, 100)).toEqual([line]);
    }
  });

  it.each(REJECTED_LINES.map((line) => [line.length, line]))(
    'wraps a %i-character list item at word boundaries',
    (_, line) => {
      expect(line.length).toBeGreaterThan(100);
      const out = wrapReportLine(line, 100);
      expect(out.length).toBeGreaterThan(1);
      for (const wrapped of out) {
        expect(wrapped.length).toBeLessThanOrEqual(100);
        expect(wrapped).not.toMatch(/\s$/);
      }
      expect(out[0]).toMatch(/^- \S/);
      for (const continuation of out.slice(1)) {
        expect(continuation).toMatch(/^ {2}\S/);
      }
      expect(words(out.join(' '))).toEqual(words(line));
    },
  );

  it('fills each line greedily', () => {
    expect(wrapReportLine(REJECTED_LINES[3], 100)).toEqual([
      '- ty held at ==0.0.87 (==0.0.89 available): ty is 0.x and its releases add diagnostics that fail the',
      '  vended Python templates. Lift when a newer ty has been checked against all vended Python templates',
      '  (run the py-client, py#dynamodb and other Python-typecheck specs with it)',
    ]);
  });

  it('continues a line that is not a list item at its own indent', () => {
    const line = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const out = wrapReportLine(line, 40);
    expect(out.length).toBeGreaterThan(1);
    for (const wrapped of out) {
      expect(wrapped.length).toBeLessThanOrEqual(40);
      expect(wrapped).toMatch(/^\S/);
    }
    expect(words(out.join(' '))).toEqual(words(line));
  });

  it('continues a nested list item under its text', () => {
    const line = `  - ${Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')}`;
    const out = wrapReportLine(line, 40);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]).toMatch(/^ {2}- \S/);
    for (const continuation of out.slice(1)) {
      expect(continuation).toMatch(/^ {4}\S/);
      expect(continuation.length).toBeLessThanOrEqual(40);
    }
    expect(words(out.join(' '))).toEqual(words(line));
  });

  it('keeps a word longer than the limit whole on its own line', () => {
    const url = `https://example.com/${'a'.repeat(120)}`;
    const out = wrapReportLine(`- see ${url} for details`, 100);
    expect(out).toEqual(['- see', `  ${url}`, '  for details']);
    for (const wrapped of out) {
      expect(withinCommitlint(wrapped, 100)).toBe(true);
    }

    const token = 't'.repeat(120);
    expect(wrapReportLine(`- ${token} rest of the item`, 100)).toEqual([
      `- ${token}`,
      '  rest of the item',
    ]);
  });

  // 40 characters, so the next word starts a continuation.
  const FULL = '- aaaa bbbb cccc dddd eeee ffff gggg hhh';

  it.each(['>=1.0.0', '-', '1.', '#', '```ts', '---'])(
    'never starts a continuation with %s',
    (word) => {
      expect(FULL).toHaveLength(40);
      const line = `${FULL} ${word} tail words here`;
      const out = wrapReportLine(line, 40);
      expect(out).toEqual([
        '- aaaa bbbb cccc dddd eeee ffff gggg',
        `  hhh ${word} tail words here`,
      ]);
      for (const continuation of out.slice(1)) {
        expect(startsBlock(continuation)).toBe(false);
      }
      expect(words(out.join(' '))).toEqual(words(line));
    },
  );

  it('breaks before a block-starting word when moving a word down would not fit', () => {
    const long = `- a ${'z'.repeat(36)}`;
    expect(wrapReportLine(`${long} >=1.0.0 tail`, 40)).toEqual([
      long,
      '  >=1.0.0 tail',
    ]);

    const single = `- ${'z'.repeat(38)}`;
    expect(wrapReportLine(`${single} >=1.0.0 tail`, 40)).toEqual([
      single,
      '  >=1.0.0 tail',
    ]);
  });
});

describe('wrapReport', () => {
  it('wraps each line and keeps blank lines and the trailing newline', () => {
    const text = `Title\n${REJECTED_LINES[0]}\n\nOther\n- short\n`;
    const out = wrapReport(text, 100);
    expect(out.startsWith('Title\n- @ag-ui/client')).toBe(true);
    expect(out.endsWith('\n\nOther\n- short\n')).toBe(true);
    expect(out.split('\n').every((line) => line.length <= 100)).toBe(true);
    expect(words(out)).toEqual(words(text));
  });
});

describe('commitMessageLineLimit', () => {
  it('is the body line limit of the config the commit-msg hook uses', () => {
    expect(LIMIT).toBe(100);
    expect(LIMIT).toBe(conventional.rules['body-max-line-length'][2]);
  });

  it('takes each rule from the last rule set that defines it', () => {
    expect(
      commitMessageLineLimit(conventional.rules, {
        'body-max-line-length': [2, 'always', 72],
      }),
    ).toBe(72);
  });

  it('is the smaller of the body and footer limits', () => {
    expect(
      commitMessageLineLimit({
        'body-max-line-length': [2, 'always', 100],
        'footer-max-line-length': [2, 'always', 80],
      }),
    ).toBe(80);
  });

  it('throws when a limit is missing', () => {
    expect(() =>
      commitMessageLineLimit({ 'body-max-line-length': [2, 'always', 100] }),
    ).toThrow(/footer-max-line-length/);
  });
});

describe('formatReport', () => {
  it('writes each non-empty group as a titled list', () => {
    expect(
      formatReport(
        [
          { title: 'A', changes: [] },
          {
            title: 'TypeScript Dependencies',
            changes: [
              { name: 'nx', oldVersion: '23.3.0', newVersion: '23.4.0' },
              { note: 'something held' },
              { path: 'packages/nx-plugin/src/a.json' },
            ],
          },
          { title: 'Migration', changes: [] },
        ],
        LIMIT,
      ),
    ).toBe(
      '\nTypeScript Dependencies\n- nx 23.3.0 -> 23.4.0\n- something held\n- packages/nx-plugin/src/a.json\n',
    );
    expect(formatReport([], LIMIT)).toBe('No version updates required.\n');
  });

  it('keeps the report the updater builds within the commitlint line limit', async () => {
    const current: ProposedVersions = {
      '@copilotkit/react-core': '1.79.0',
      '@ag-ui/client': '1.0.2',
      '@ag-ui/core': '1.0.2',
      '@ag-ui/encoder': '1.0.2',
      '@ag-ui/aws-strands': '1.0.0',
      '@ag-ui/a2ui-toolkit': '0.0.5',
    };
    const proposed = (): ProposedVersions => ({
      '@copilotkit/react-core': '1.79.1',
      '@ag-ui/client': '1.0.3',
      '@ag-ui/core': '1.0.3',
      '@ag-ui/encoder': '1.0.3',
    });
    const lookup =
      (peers: Record<string, string>): DependencyLookup =>
      async (name, _version, field) => {
        if (field === 'peerDependencies') return peers;
        return name === '@copilotkit/react-core'
          ? { '@ag-ui/client': '1.0.2', '@ag-ui/core': '1.0.2' }
          : {};
      };

    const exactDependencyNotes = await pinToExactDependencies(
      EXACT_DEPENDENCY_PINS,
      LOCKSTEP_GROUPS,
      current,
      proposed(),
      lookup({}),
    );
    expect(exactDependencyNotes).toHaveLength(3);
    const heldNotes = await pinToExactDependencies(
      EXACT_DEPENDENCY_PINS,
      LOCKSTEP_GROUPS,
      current,
      proposed(),
      lookup({ '@ag-ui/core': '>=9.0.0' }),
    );
    expect(heldNotes).toHaveLength(1);

    const pyHoldNotes = holdPinnedVersions(
      PY_VERSION_HOLDS,
      PY_VERSIONS,
      Object.fromEntries(
        PY_VERSION_HOLDS.map(({ name }) => [name, '==99.99.99']),
      ),
    );
    const terraformHoldNotes = holdPinnedVersions(
      TERRAFORM_VERSION_HOLDS,
      TERRAFORM_VERSIONS,
      Object.fromEntries(
        TERRAFORM_VERSION_HOLDS.map(({ name }) => [name, '99.99.99']),
      ),
    );
    expect(pyHoldNotes).toHaveLength(PY_VERSION_HOLDS.length);
    expect(terraformHoldNotes).toHaveLength(TERRAFORM_VERSION_HOLDS.length);

    const groups: ChangeGroup[] = [
      {
        title: 'TypeScript Dependencies',
        changes: [
          {
            name: '@copilotkit/react-core',
            oldVersion: '1.79.0',
            newVersion: '1.79.1',
          },
          ...[...exactDependencyNotes, ...heldNotes].map(({ note }) => ({
            note,
          })),
          {
            path: 'packages/nx-plugin/src/utils/files/exact-dependency-sources.json',
          },
        ],
      },
      {
        title: 'Python Dependencies',
        changes: [
          { name: 'ruff', oldVersion: '==0.15.0', newVersion: '==0.15.1' },
          ...pyHoldNotes.map(({ note }) => ({ note })),
        ],
      },
      {
        title: 'Terraform Providers',
        changes: terraformHoldNotes.map(({ note }) => ({ note })),
      },
      {
        title: 'Lambda Runtimes',
        changes: [
          {
            note: unresolvedRuntimeWarning({
              language: 'python',
              kept: 'python3.13',
              reason: 'no-runtimes-listed',
            }),
          },
        ],
      },
      {
        title: 'AgentCore Runtimes',
        changes: [
          {
            note: unresolvedAgentCoreRuntimeWarning({
              language: 'python',
              kept: 'PYTHON_3_13',
              reason: 'no-runtimes-listed',
            }),
          },
        ],
      },
    ];

    const unwrapped = formatReport(groups, Infinity);
    expect(unwrapped.split('\n').some((line) => line.length > LIMIT)).toBe(
      true,
    );

    const lines = formatReport(groups, LIMIT).split('\n');
    expect(lines.filter((line) => !withinCommitlint(line, LIMIT))).toEqual([]);
    expect(
      lines.filter((line) => /^\s/.test(line)).filter(startsBlock),
    ).toEqual([]);
    expect(words(lines.join('\n'))).toEqual(words(unwrapped));
  });
});
