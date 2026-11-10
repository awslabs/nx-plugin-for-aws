/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  GREENGRASS_PLATFORM_MAPPINGS,
  GREENGRASS_PLATFORM_SELECTIONS,
  GREENGRASS_PLATFORMS,
  RECIPE_FORMAT_VERSION,
  resolvePlatforms,
} from './constants.js';

describe('greengrass constants', () => {
  it('should pin the recipe format version', () => {
    expect(RECIPE_FORMAT_VERSION).toBe('2020-01-25');
  });

  it('should support exactly linux-amd64 and linux-arm64', () => {
    expect(GREENGRASS_PLATFORMS).toEqual(['linux-amd64', 'linux-arm64']);
  });

  it('should map linux-amd64 to the x86_64 manylinux uv platform, its aws-crt addon dir and manifest platform', () => {
    expect(GREENGRASS_PLATFORM_MAPPINGS['linux-amd64']).toEqual({
      uvPlatform: 'x86_64-manylinux_2_28',
      nodeCrtAddonDir: 'linux-x64-glibc',
      manifestPlatform: { os: 'linux', architecture: 'amd64' },
    });
  });

  it('should map linux-arm64 to the aarch64 manylinux uv platform, its aws-crt addon dir and manifest platform', () => {
    expect(GREENGRASS_PLATFORM_MAPPINGS['linux-arm64']).toEqual({
      uvPlatform: 'aarch64-manylinux_2_28',
      nodeCrtAddonDir: 'linux-arm64-glibc',
      manifestPlatform: { os: 'linux', architecture: 'aarch64' },
    });
  });

  it('should list exactly the three platform selections', () => {
    expect(GREENGRASS_PLATFORM_SELECTIONS).toEqual([
      'linux-amd64',
      'linux-arm64',
      'linux-amd64-arm64',
    ]);
  });

  it('should resolve each single selection to that one platform', () => {
    expect(resolvePlatforms('linux-amd64')).toEqual(['linux-amd64']);
    expect(resolvePlatforms('linux-arm64')).toEqual(['linux-arm64']);
  });

  it('should resolve linux-amd64-arm64 to linux-amd64 then linux-arm64', () => {
    expect(resolvePlatforms('linux-amd64-arm64')).toEqual([
      'linux-amd64',
      'linux-arm64',
    ]);
  });
});
