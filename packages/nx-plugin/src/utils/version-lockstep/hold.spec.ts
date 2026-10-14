/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { IPyDepVersion } from '../versions.js';
import { PY_VERSIONS } from '../versions.js';
import {
  holdPinnedVersions,
  PY_VERSION_HOLDS,
  type VersionHold,
} from './hold.js';

describe('holdPinnedVersions', () => {
  const holds: VersionHold<IPyDepVersion>[] = [
    { name: 'httpx', reason: 'httpx breaks things', liftWhen: 'it is fixed' },
  ];

  it('keeps a held pin at its current version and reports why', () => {
    const proposed = { httpx: '==2.0.0', boto3: '==3.0.0' };

    const notes = holdPinnedVersions(holds, { httpx: '==1.0.0' }, proposed);

    // Only the held pin is put back; the rest of the run's proposals stand.
    expect(proposed).toEqual({ httpx: '==1.0.0', boto3: '==3.0.0' });
    expect(notes).toEqual([
      {
        name: 'httpx',
        note: 'httpx held at ==1.0.0 (==2.0.0 available): httpx breaks things. Lift when it is fixed',
      },
    ]);
  });

  it('reports nothing when the run proposed no change to a held pin', () => {
    const proposed = { httpx: '==1.0.0' };
    expect(holdPinnedVersions(holds, { httpx: '==1.0.0' }, proposed)).toEqual(
      [],
    );
    expect(proposed).toEqual({ httpx: '==1.0.0' });
  });

  it('ignores a held pin the run proposed nothing for', () => {
    const proposed = { boto3: '==3.0.0' };
    expect(holdPinnedVersions(holds, { httpx: '==1.0.0' }, proposed)).toEqual(
      [],
    );
    expect(proposed).toEqual({ boto3: '==3.0.0' });
  });
});

describe('PY_VERSION_HOLDS', () => {
  it('holds ty at the pinned version when a newer one is available', () => {
    const proposed: Record<string, string> = {
      ...PY_VERSIONS,
      ty: '==0.0.999',
    };

    const notes = holdPinnedVersions(PY_VERSION_HOLDS, PY_VERSIONS, proposed);

    expect(proposed).toEqual(PY_VERSIONS);
    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('ty');
    expect(notes[0].note).toContain(`ty held at ${PY_VERSIONS.ty}`);
    expect(notes[0].note).toContain('==0.0.999 available');
    expect(notes[0].note).toContain('Lift when');
  });

  it('gives every hold a pinned package, a reason and a lift condition', () => {
    for (const { name, reason, liftWhen } of PY_VERSION_HOLDS) {
      expect(PY_VERSIONS[name]).toMatch(/^==/);
      expect(reason).not.toBe('');
      expect(liftWhen).not.toBe('');
    }
  });
});
