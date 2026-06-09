/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { mergeTsReferences } from './ts-project-utils';

describe('mergeTsReferences', () => {
  it('appends new references to the end', () => {
    expect(
      mergeTsReferences([{ path: './a' }], [{ path: './b' }, { path: './c' }]),
    ).toEqual([{ path: './a' }, { path: './b' }, { path: './c' }]);
  });

  it('does not duplicate references that already exist', () => {
    expect(
      mergeTsReferences(
        [{ path: './a' }, { path: './b' }],
        [{ path: './b' }, { path: './c' }],
      ),
    ).toEqual([{ path: './a' }, { path: './b' }, { path: './c' }]);
  });

  it('preserves the order of existing references on re-run', () => {
    const existing = [{ path: './a' }, { path: './b' }, { path: './c' }];
    // Re-adding an existing reference must leave the array unchanged
    expect(mergeTsReferences(existing, [{ path: './a' }])).toEqual(existing);
  });

  it('is idempotent when applied repeatedly', () => {
    let references: { path: string }[] | undefined;
    const toAdd = [{ path: './common/constructs/tsconfig.lib.json' }];
    references = mergeTsReferences(references, toAdd);
    const first = references;
    references = mergeTsReferences(references, toAdd);
    references = mergeTsReferences(references, toAdd);
    expect(references).toEqual(first);
    expect(references).toHaveLength(1);
  });

  it('handles undefined existing references', () => {
    expect(mergeTsReferences(undefined, [{ path: './a' }])).toEqual([
      { path: './a' },
    ]);
  });
});
