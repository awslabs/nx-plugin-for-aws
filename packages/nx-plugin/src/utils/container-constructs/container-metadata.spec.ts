/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveContainerOptions } from './container-metadata';

describe('resolveContainerOptions', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('should apply the defaults when no option is given', () => {
    expect(resolveContainerOptions({})).toEqual({
      infra: 'ecs',
      ingress: 'http-api',
      auth: 'iam',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  // The schemas default ingress to http-api and auth to iam, so Nx passes
  // both on every run. Those values alone must not produce a warning.
  it('should not warn for the schema defaults with infra=none', () => {
    expect(
      resolveContainerOptions({
        infra: 'none',
        ingress: 'http-api',
        auth: 'iam',
      }),
    ).toEqual({ infra: 'none' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('should warn when a non-default ingress is ignored with infra=none', () => {
    expect(
      resolveContainerOptions({
        infra: 'none',
        ingress: 'private',
        auth: 'iam',
      }),
    ).toEqual({ infra: 'none' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ignored when infra is none'),
    );
  });

  it('should warn when a non-default auth is ignored with infra=none', () => {
    expect(
      resolveContainerOptions({
        infra: 'none',
        ingress: 'http-api',
        auth: 'cognito',
      }),
    ).toEqual({ infra: 'none' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ignored when infra is none'),
    );
  });

  it('should not warn for the schema default auth with ingress=private', () => {
    expect(
      resolveContainerOptions({
        infra: 'ecs',
        ingress: 'private',
        auth: 'iam',
      }),
    ).toEqual({ infra: 'ecs', ingress: 'private' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('should warn when a non-default auth is ignored with ingress=private', () => {
    expect(
      resolveContainerOptions({
        infra: 'ecs',
        ingress: 'private',
        auth: 'none',
      }),
    ).toEqual({ infra: 'ecs', ingress: 'private' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ignored when ingress is private'),
    );
  });

  it('should keep a chosen auth with ingress=http-api', () => {
    expect(
      resolveContainerOptions({ ingress: 'http-api', auth: 'cognito' }),
    ).toEqual({ infra: 'ecs', ingress: 'http-api', auth: 'cognito' });
    expect(warn).not.toHaveBeenCalled();
  });
});
