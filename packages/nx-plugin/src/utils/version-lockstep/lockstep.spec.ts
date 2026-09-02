/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { holdGroupsInLockstep } from './lockstep.js';

describe('holdGroupsInLockstep', () => {
  it('holds every member at the lowest version proposed across the group', () => {
    const ts = { a: '2.0.0', b: '1.5.0', c: '3.0.0' };

    const notes = holdGroupsInLockstep([['a', 'b', 'c']], ts);

    expect(ts).toEqual({ a: '1.5.0', b: '1.5.0', c: '1.5.0' });
    // Only the members that actually moved are reported.
    expect(notes).toHaveLength(2);
    // The held name is reported separately, so callers can correct a manifest.
    expect(notes.map(({ name }) => name).sort()).toEqual(['a', 'c']);
    const reported = notes.map((note) => note.note).join('\n');
    expect(reported).toContain('a held at 1.5.0');
    expect(reported).toContain('2.0.0 available');
  });

  it('reports nothing when the group already agrees', () => {
    const ts = { a: '1.2.3', b: '1.2.3' };
    expect(holdGroupsInLockstep([['a', 'b']], ts)).toEqual([]);
    expect(ts).toEqual({ a: '1.2.3', b: '1.2.3' });
  });

  it('spans tables, so a group may mix TypeScript and Python pins', () => {
    const ts = { tool: '0.16.5' };
    const py = { 'tool-cli': '==0.17.0' };

    holdGroupsInLockstep([['tool', 'tool-cli']], ts, py);

    // Each pin keeps the range prefix it was written with.
    expect(ts.tool).toBe('0.16.5');
    expect(py['tool-cli']).toBe('==0.16.5');
  });

  it('picks the lowest numerically rather than lexically', () => {
    // '0.0.9' > '0.0.10' lexically, which is the bug semver ordering avoids.
    const ts = { a: '0.0.10', b: '0.0.9' };
    holdGroupsInLockstep([['a', 'b']], ts);
    expect(ts).toEqual({ a: '0.0.9', b: '0.0.9' });
  });

  it('ignores a member whose pin is not a comparable version', () => {
    // A tag or protocol specifier has no version to compare, so the group is
    // left alone rather than held against something meaningless.
    const ts = { a: 'workspace:*', b: '2.0.0' };
    expect(holdGroupsInLockstep([['a', 'b']], ts)).toEqual([]);
    expect(ts).toEqual({ a: 'workspace:*', b: '2.0.0' });
  });

  it('skips a group the run proposed fewer than two members for', () => {
    // One pin has nothing to stay in step with, so leave the bump alone rather
    // than holding it against a version nothing proposed.
    const ts = { a: '2.0.0' };
    expect(holdGroupsInLockstep([['a', 'absent']], ts)).toEqual([]);
    expect(ts.a).toBe('2.0.0');
  });

  it('ignores members no table declares', () => {
    const ts = { a: '2.0.0', b: '1.0.0' };
    holdGroupsInLockstep([['a', 'b', 'absent']], ts);
    expect(ts).toEqual({ a: '1.0.0', b: '1.0.0' });
    expect(ts).not.toHaveProperty('absent');
  });

  it('handles several groups independently', () => {
    const ts = { a: '2.0.0', b: '1.0.0', c: '5.0.0', d: '4.0.0' };
    holdGroupsInLockstep(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      ts,
    );
    expect(ts).toEqual({ a: '1.0.0', b: '1.0.0', c: '4.0.0', d: '4.0.0' });
  });
});
