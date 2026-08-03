/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isVendedUpgrade } from './vended-upgrade';

describe('isVendedUpgrade', () => {
  it('should upgrade an exact version below the vended one', () => {
    expect(isVendedUpgrade('4.4.3', '4.3.0')).toBe(true);
  });

  it('should not downgrade an exact version above the vended one', () => {
    expect(isVendedUpgrade('4.4.3', '4.9.0')).toBe(false);
  });

  it('should not rewrite an equal version', () => {
    expect(isVendedUpgrade('4.4.3', '4.4.3')).toBe(false);
  });

  it('should leave a range the user chose alone', () => {
    for (const declared of ['^4.3.0', '~4.3', '>=4', '4 || 5', '*']) {
      expect(isVendedUpgrade('4.4.3', declared)).toBe(false);
    }
  });

  it('should never rewrite a reference specifier', () => {
    // The version lives elsewhere — the catalog, the linked project — and is
    // synced there, so overwriting the reference would sever the indirection.
    for (const declared of [
      'catalog:',
      'catalog:build',
      'workspace:*',
      'workspace:^',
      'npm:zod@4',
      'file:../zod',
      'link:../zod',
      'latest',
      '',
    ]) {
      expect(isVendedUpgrade('4.4.3', declared)).toBe(false);
    }
  });

  it('should never rewrite when the vended version is unparseable', () => {
    expect(isVendedUpgrade('not-a-version', '1.0.0')).toBe(false);
  });

  it('should compare prereleases', () => {
    expect(isVendedUpgrade('1.0.0-rc.82', '1.0.0-rc.81')).toBe(true);
    expect(isVendedUpgrade('1.0.0-rc.81', '1.0.0-rc.82')).toBe(false);
  });
});
