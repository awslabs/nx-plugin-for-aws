/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { applyInfrastructureFilter } from './infrastructure-filter';

describe('applyInfrastructureFilter', () => {
  const source = `before
<Infrastructure>
<Fragment slot="cdk">
cdk-body
</Fragment>
<Fragment slot="terraform">
terraform-body
</Fragment>
</Infrastructure>
after`;

  it('keeps only cdk slot for CDK', () => {
    const out = applyInfrastructureFilter(source, 'CDK');
    expect(out).toContain('cdk-body');
    expect(out).not.toContain('terraform-body');
    expect(out).not.toContain('<Infrastructure>');
    expect(out).not.toContain('<Fragment');
  });

  it('keeps only terraform slot for Terraform', () => {
    const out = applyInfrastructureFilter(source, 'Terraform');
    expect(out).toContain('terraform-body');
    expect(out).not.toContain('cdk-body');
  });

  it('leaves the Infrastructure block untouched when no iacProvider given', () => {
    const out = applyInfrastructureFilter(source);
    expect(out).toBe(source);
  });

  it('treats Inherit like no selection (block untouched)', () => {
    const out = applyInfrastructureFilter(source, 'Inherit');
    expect(out).toBe(source);
  });

  it('is a no-op when no Infrastructure tags', () => {
    const text = 'just text';
    expect(applyInfrastructureFilter(text, 'CDK')).toBe(text);
  });

  it('handles multiple Infrastructure blocks', () => {
    const multi = `${source}\n\nmiddle\n\n${source}`;
    const out = applyInfrastructureFilter(multi, 'CDK');
    const occurrences = out.match(/cdk-body/g)?.length ?? 0;
    expect(occurrences).toBe(2);
    expect(out).not.toContain('terraform-body');
  });
});
