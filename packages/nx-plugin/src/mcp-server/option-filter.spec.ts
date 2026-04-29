/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  applyOptionFilter,
  collectReferencedKeys,
  describePredicate,
  evaluatePredicate,
  parseOptionFilterAttrs,
  parseWhenExpression,
  scanOptionFilters,
} from './option-filter';

describe('parseWhenExpression', () => {
  it('parses simple key/value', () => {
    expect(parseWhenExpression("{ computeType: 'Rest' }")).toEqual({
      computeType: ['Rest'],
    });
  });

  it('parses arrays as OR', () => {
    expect(parseWhenExpression("{ auth: ['IAM', 'Cognito'] }")).toEqual({
      auth: ['IAM', 'Cognito'],
    });
  });

  it('parses multiple keys as AND', () => {
    expect(parseWhenExpression("{ computeType: 'Rest', auth: 'IAM' }")).toEqual(
      { computeType: ['Rest'], auth: ['IAM'] },
    );
  });

  it('accepts quoted keys', () => {
    expect(parseWhenExpression("{ 'computeType': 'Rest' }")).toEqual({
      computeType: ['Rest'],
    });
  });

  it('rejects complex expressions', () => {
    expect(() => parseWhenExpression('{ computeType: foo() }')).toThrowError(
      /Unsupported value/,
    );
  });
});

describe('parseOptionFilterAttrs', () => {
  it('parses when and not', () => {
    expect(
      parseOptionFilterAttrs("<OptionFilter not when={{ auth: 'IAM' }}>"),
    ).toEqual({ predicate: { auth: ['IAM'] }, not: true });
  });

  it('still parses when `not` trails `when`', () => {
    expect(
      parseOptionFilterAttrs("<OptionFilter when={{ auth: 'IAM' }} not>"),
    ).toEqual({ predicate: { auth: ['IAM'] }, not: true });
  });

  it('handles not={false}', () => {
    expect(
      parseOptionFilterAttrs(
        "<OptionFilter when={{ auth: 'IAM' }} not={false}>",
      ),
    ).toEqual({ predicate: { auth: ['IAM'] }, not: false });
  });

  it('throws when when is missing', () => {
    expect(() => parseOptionFilterAttrs('<OptionFilter>')).toThrowError(
      /missing a 'when/,
    );
  });
});

describe('scanOptionFilters', () => {
  it('finds a single top-level block', () => {
    const text = `before
<OptionFilter when={{ auth: 'IAM' }}>
inner
</OptionFilter>
after`;
    const blocks = scanOptionFilters(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].predicate).toEqual({ auth: ['IAM'] });
    expect(blocks[0].body.trim()).toBe('inner');
    expect(blocks[0].children).toEqual([]);
  });

  it('handles nested blocks', () => {
    const text = `<OptionFilter when={{ auth: 'IAM' }}>
outer
<OptionFilter when={{ computeType: 'Rest' }}>
inner
</OptionFilter>
outer-tail
</OptionFilter>`;
    const blocks = scanOptionFilters(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].predicate).toEqual({ auth: ['IAM'] });
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children[0].predicate).toEqual({
      computeType: ['Rest'],
    });
  });

  it('ignores longer tag names like <OptionFilterBar>', () => {
    const text = `<OptionFilterBar />
<OptionFilter when={{ a: 'b' }}>body</OptionFilter>`;
    const blocks = scanOptionFilters(text);
    expect(blocks).toHaveLength(1);
  });

  it('throws on unterminated block', () => {
    expect(() =>
      scanOptionFilters("<OptionFilter when={{ a: 'b' }}>no close"),
    ).toThrowError(/Unterminated/);
  });
});

describe('evaluatePredicate', () => {
  it('ANDs multiple keys', () => {
    expect(
      evaluatePredicate({ auth: ['IAM'], computeType: ['Rest'] }, false, {
        auth: 'IAM',
        computeType: 'Rest',
      }),
    ).toBe(true);
    expect(
      evaluatePredicate({ auth: ['IAM'], computeType: ['Rest'] }, false, {
        auth: 'IAM',
        computeType: 'Http',
      }),
    ).toBe(false);
  });

  it('ORs within an array', () => {
    expect(
      evaluatePredicate({ auth: ['IAM', 'Cognito'] }, false, {
        auth: 'Cognito',
      }),
    ).toBe(true);
  });

  it('honours not', () => {
    expect(
      evaluatePredicate({ auth: ['IAM'] }, true, { auth: 'Cognito' }),
    ).toBe(true);
    expect(evaluatePredicate({ auth: ['IAM'] }, true, { auth: 'IAM' })).toBe(
      false,
    );
  });

  it('treats missing key as "All" — block is shown', () => {
    expect(evaluatePredicate({ auth: ['IAM'] }, false, {})).toBe(true);
  });

  it('treats missing key as "All" for `not` blocks too', () => {
    expect(evaluatePredicate({ iacProvider: ['CDK'] }, true, {})).toBe(true);
  });
});

describe('applyOptionFilter', () => {
  const source = `before
<OptionFilter when={{ computeType: 'Rest' }}>
rest-only
</OptionFilter>
<OptionFilter when={{ computeType: 'Http' }}>
http-only
</OptionFilter>
after`;

  it('drops non-matching blocks when options given', () => {
    const out = applyOptionFilter(source, { computeType: 'Rest' });
    expect(out).toContain('rest-only');
    expect(out).not.toContain('http-only');
    expect(out).not.toContain('<OptionFilter');
  });

  it('keeps all blocks with NOTE markers when options omitted', () => {
    const out = applyOptionFilter(source);
    expect(out).toContain('rest-only');
    expect(out).toContain('http-only');
    expect(out).toContain('> [!NOTE] Only when computeType = Rest');
    expect(out).toContain('> [!NOTE] Only when computeType = Http');
    expect(out).not.toContain('<OptionFilter');
  });

  it('keeps blocks visible when the user has no opinion on their key', () => {
    // auth is not in options, so the block must still render.
    const text = `<OptionFilter when={{ auth: 'IAM' }}>
iam-content
</OptionFilter>`;
    const out = applyOptionFilter(text, { computeType: 'Http' });
    expect(out).toContain('iam-content');
  });

  it('handles nested blocks correctly with options', () => {
    const nested = `<OptionFilter when={{ auth: 'IAM' }}>
outer
<OptionFilter when={{ computeType: 'Rest' }}>
rest
</OptionFilter>
<OptionFilter when={{ computeType: 'Http' }}>
http
</OptionFilter>
</OptionFilter>`;
    const out = applyOptionFilter(nested, {
      auth: 'IAM',
      computeType: 'Rest',
    });
    expect(out).toContain('outer');
    expect(out).toContain('rest');
    expect(out).not.toContain('http');
  });

  it('drops a non-matching outer block even when inner would match', () => {
    const nested = `<OptionFilter when={{ auth: 'IAM' }}>
outer
<OptionFilter when={{ computeType: 'Rest' }}>
rest
</OptionFilter>
</OptionFilter>`;
    const out = applyOptionFilter(nested, {
      auth: 'Cognito',
      computeType: 'Rest',
    });
    expect(out).not.toContain('outer');
    expect(out).not.toContain('rest');
  });

  it('supports the not flag', () => {
    const text = `<OptionFilter not when={{ iacProvider: 'Terraform' }}>
not-terraform
</OptionFilter>`;
    expect(applyOptionFilter(text, { iacProvider: 'CDK' })).toContain(
      'not-terraform',
    );
    expect(applyOptionFilter(text, { iacProvider: 'Terraform' })).not.toContain(
      'not-terraform',
    );
  });
});

describe('collectReferencedKeys', () => {
  it('returns referenced option keys including nested', () => {
    const text = `<OptionFilter when={{ auth: 'IAM' }}>
<OptionFilter when={{ computeType: 'Rest' }}>body</OptionFilter>
</OptionFilter>
<OptionFilter when={{ iacProvider: ['CDK', 'Terraform'] }}>x</OptionFilter>`;
    const keys = collectReferencedKeys(text).sort();
    expect(keys).toEqual(['auth', 'computeType', 'iacProvider']);
  });
});

describe('describePredicate', () => {
  it('formats OR values with pipe', () => {
    expect(describePredicate({ auth: ['IAM', 'Cognito'] }, false)).toBe(
      'Only when auth = IAM | Cognito',
    );
  });

  it('formats not predicates', () => {
    expect(describePredicate({ iacProvider: ['Terraform'] }, true)).toBe(
      'Not when iacProvider = Terraform',
    );
  });
});
