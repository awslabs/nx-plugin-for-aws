/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { type LockstepGroup, holdGroupsInLockstep } from './lockstep.js';

describe('holdGroupsInLockstep', () => {
  it('holds a follower at the leader version', () => {
    const ts = { leader: '1.2.3', follower: '2.0.0' };
    const notes = holdGroupsInLockstep(
      [
        {
          reason: 'they must match',
          leader: { name: 'leader' },
          followers: [{ name: 'follower' }],
        },
      ],
      ts,
    );

    expect(ts.follower).toBe('1.2.3');
    expect(ts.leader).toBe('1.2.3');
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toContain('follower held at 1.2.3');
    expect(notes[0].note).toContain('2.0.0 available');
    expect(notes[0].note).toContain('they must match');
  });

  it('reports nothing when the group already agrees', () => {
    const ts = { leader: '1.2.3', follower: '1.2.3' };
    expect(
      holdGroupsInLockstep(
        [
          {
            reason: 'they must match',
            leader: { name: 'leader' },
            followers: [{ name: 'follower' }],
          },
        ],
        ts,
      ),
    ).toEqual([]);
  });

  it('spans tables, rewriting a follower declared in another one', () => {
    const ts = { '@astral-sh/ruff-wasm-nodejs': '0.16.5' };
    const py = { ruff: '==0.17.0' };

    const notes = holdGroupsInLockstep(
      [
        {
          reason: 'the formatter and its bindings must match',
          leader: { name: '@astral-sh/ruff-wasm-nodejs' },
          followers: [{ name: 'ruff', format: 'pep440' }],
        },
      ],
      ts,
      py,
    );

    // Rewritten in the PEP 440 form the Python pins use.
    expect(py.ruff).toBe('==0.16.5');
    expect(notes[0].note).toContain('ruff held at ==0.16.5');
  });

  it('normalises the leader range before applying it', () => {
    const ts = { leader: '^1.2.3', follower: '2.0.0' };
    holdGroupsInLockstep(
      [
        {
          reason: 'r',
          leader: { name: 'leader' },
          followers: [{ name: 'follower' }],
        },
      ],
      ts,
    );
    expect(ts.follower).toBe('1.2.3');
  });

  it('supports a leader resolved from outside the tables', () => {
    const ts = { '@ag-ui/client': '0.0.59', '@ag-ui/core': '0.0.59' };

    const notes = holdGroupsInLockstep(
      [
        {
          reason: 'the dependant pins these exactly',
          leader: { name: '@ag-ui/client', resolve: () => '0.0.57' },
          followers: [{ name: '@ag-ui/client' }, { name: '@ag-ui/core' }],
        },
      ],
      ts,
    );

    expect(ts['@ag-ui/client']).toBe('0.0.57');
    expect(ts['@ag-ui/core']).toBe('0.0.57');
    expect(notes).toHaveLength(2);
  });

  it('passes the merged proposed versions to a resolver', () => {
    const ts = { dependant: '9.9.9', follower: '2.0.0' };
    let seen: string | undefined;

    holdGroupsInLockstep(
      [
        {
          reason: 'r',
          leader: {
            name: 'follower',
            resolve: (versions) => {
              seen = versions.dependant;
              return '1.0.0';
            },
          },
          followers: [{ name: 'follower' }],
        },
      ],
      ts,
    );

    expect(seen).toBe('9.9.9');
    expect(ts.follower).toBe('1.0.0');
  });

  it('leaves the group as proposed and reports when the leader is unresolvable', () => {
    const ts = { follower: '2.0.0' };

    const notes = holdGroupsInLockstep(
      [
        {
          reason: 'r',
          leader: { name: 'missing', resolve: () => undefined },
          followers: [{ name: 'follower' }],
        },
      ],
      ts,
    );

    // Better to take the bump and let CI catch it than to silently write a
    // wrong pin.
    expect(ts.follower).toBe('2.0.0');
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toContain('could not resolve missing');
    expect(notes[0].note).toContain('follower');
  });

  it('ignores followers no run proposed a version for', () => {
    const ts = { leader: '1.0.0' };
    expect(
      holdGroupsInLockstep(
        [
          {
            reason: 'r',
            leader: { name: 'leader' },
            followers: [{ name: 'absent' }],
          },
        ],
        ts,
      ),
    ).toEqual([]);
    expect(ts).not.toHaveProperty('absent');
  });
});
