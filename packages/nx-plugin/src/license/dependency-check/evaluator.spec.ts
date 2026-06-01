/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { createEvaluator } from './evaluator';
import { AllowlistEntry } from './types';

const allow: AllowlistEntry[] = [
  { spdxId: 'MIT', fullName: 'MIT License', aliases: ['MIT License'] },
  {
    spdxId: 'Apache-2.0',
    fullName: 'Apache License 2.0',
    aliases: ['Apache License 2.0', 'Apache Software License'],
  },
  {
    spdxId: 'BSD-3-Clause',
    fullName: 'BSD 3-Clause License',
    aliases: ['BSD License', '3-Clause BSD License'],
  },
  { spdxId: 'ISC', fullName: 'ISC License', aliases: ['ISC License (ISCL)'] },
  {
    spdxId: 'MPL-2.0',
    fullName: 'Mozilla Public License 2.0',
    aliases: ['Mozilla Public License 2.0 (MPL 2.0)'],
  },
];

describe('SPDX evaluator', () => {
  const evaluator = createEvaluator({ allow });

  it('approves single licenses by SPDX id', () => {
    expect(evaluator.evaluate('MIT')).toBe('PRE_APPROVED');
    expect(evaluator.evaluate('Apache-2.0')).toBe('PRE_APPROVED');
  });

  it('approves licenses by full name and aliases', () => {
    expect(evaluator.evaluate('MIT License')).toBe('PRE_APPROVED');
    expect(evaluator.evaluate('Apache Software License')).toBe('PRE_APPROVED');
    expect(evaluator.evaluate('Mozilla Public License 2.0 (MPL 2.0)')).toBe(
      'PRE_APPROVED',
    );
  });

  it('handles MIT* (license-checker guessed-from-text marker)', () => {
    expect(evaluator.evaluate('MIT*')).toBe('PRE_APPROVED');
  });

  it('returns UNKNOWN for empty/missing/Custom: tokens', () => {
    expect(evaluator.evaluate('')).toBe('UNKNOWN');
    expect(evaluator.evaluate(undefined as unknown as string)).toBe('UNKNOWN');
    expect(evaluator.evaluate('UNKNOWN')).toBe('UNKNOWN');
    expect(evaluator.evaluate('Custom: LICENSE')).toBe('UNKNOWN');
    expect(evaluator.evaluate('SEE LICENSE IN LICENSE')).toBe('UNKNOWN');
  });

  it('approves OR expressions if any operand is allowed', () => {
    expect(evaluator.evaluate('MIT OR GPL-3.0-or-later')).toBe('PRE_APPROVED');
    expect(evaluator.evaluate('(MIT OR Apache-2.0)')).toBe('PRE_APPROVED');
    expect(evaluator.evaluate('GPL-2.0 OR MIT')).toBe('PRE_APPROVED');
  });

  it('approves AND expressions only when all operands are allowed', () => {
    expect(evaluator.evaluate('MIT AND Apache-2.0')).toBe('PRE_APPROVED');
    expect(evaluator.evaluate('MIT AND GPL-3.0-or-later')).toBe('NOT_APPROVED');
  });

  it('handles ; separated lists as OR', () => {
    expect(evaluator.evaluate('Apache Software License; BSD License')).toBe(
      'PRE_APPROVED',
    );
    expect(evaluator.evaluate('GPL-3.0; LGPL-3.0')).toBe('NOT_APPROVED');
  });

  it('returns NOT_APPROVED for unknown SPDX ids', () => {
    expect(evaluator.evaluate('GPL-3.0-or-later')).toBe('NOT_APPROVED');
    expect(evaluator.evaluate('LGPL-2.1-or-later')).toBe('NOT_APPROVED');
  });

  it('handles nested parentheses', () => {
    expect(evaluator.evaluate('((MIT OR Apache-2.0) AND BSD-3-Clause)')).toBe(
      'PRE_APPROVED',
    );
    expect(evaluator.evaluate('((MIT) OR (GPL-3.0))')).toBe('PRE_APPROVED');
  });
});
