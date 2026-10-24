/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `RecipeFormatVersion` a Greengrass v2 recipe declares. Fixed by the
 * service since the format's introduction; there is no later version to
 * migrate to.
 */
export const RECIPE_FORMAT_VERSION = '2020-01-25' as const;

/**
 * Component platforms the generator supports. Windows and `linux-any` are
 * deferred. A recipe may carry one manifest per platform - see
 * `GREENGRASS_PLATFORM_SELECTIONS`.
 */
export const GREENGRASS_PLATFORMS = ['linux-amd64', 'linux-arm64'] as const;

export type GreengrassPlatform = (typeof GREENGRASS_PLATFORMS)[number];

/**
 * `Platform.os` / `Platform.architecture` values written into a recipe manifest.
 * The nucleus matches `aarch64` (not the Docker-style `arm64`) on 64-bit ARM
 * devices - verified against a real core device reporting
 * `{os=linux, architecture=aarch64}`.
 */
export interface GreengrassManifestPlatform {
  readonly os: 'linux';
  readonly architecture: 'amd64' | 'aarch64';
}

/** How a {@link GreengrassPlatform} maps onto a `uv` target platform and a manifest `Platform` block. */
export interface GreengrassPlatformMapping {
  /** Value for `uv`'s `--python-platform` flag when vendoring dependencies. */
  readonly uvPlatform: 'x86_64-manylinux_2_28' | 'aarch64-manylinux_2_28';
  /**
   * The `dist/bin/<platform>-<arch>-<cRuntime>` directory name aws-crt uses for
   * its prebuilt Node addon on this platform. Node's arch token (`x64`,
   * `arm64`) is not the manifest token (`amd64`, `aarch64`), so both live in one
   * entry instead of being derived from each other. glibc only - a musl device
   * needs the escape hatch the guide documents.
   */
  readonly nodeCrtAddonDir: 'linux-x64-glibc' | 'linux-arm64-glibc';
  readonly manifestPlatform: GreengrassManifestPlatform;
}

/**
 * Per-platform `uv` target and recipe manifest `Platform` block. Mirrors the
 * platform strings `addPythonBundleTarget` uses for Lambda, but this map is
 * not shared with it: a device's Python floor is not a Lambda runtime.
 */
export const GREENGRASS_PLATFORM_MAPPINGS: Readonly<
  Record<GreengrassPlatform, GreengrassPlatformMapping>
> = {
  'linux-amd64': {
    uvPlatform: 'x86_64-manylinux_2_28',
    nodeCrtAddonDir: 'linux-x64-glibc',
    manifestPlatform: { os: 'linux', architecture: 'amd64' },
  },
  'linux-arm64': {
    uvPlatform: 'aarch64-manylinux_2_28',
    nodeCrtAddonDir: 'linux-arm64-glibc',
    manifestPlatform: { os: 'linux', architecture: 'aarch64' },
  },
} as const;

/**
 * What a component generator's `platform` option accepts: one architecture, or
 * the explicit pair. Deliberately not a `multi` value that means "every
 * supported architecture" - that would silently change what an existing
 * invocation produces the day a third architecture lands.
 */
export const GREENGRASS_PLATFORM_SELECTIONS = [
  'linux-amd64',
  'linux-arm64',
  'linux-amd64-arm64',
] as const;

export type GreengrassPlatformSelection =
  (typeof GREENGRASS_PLATFORM_SELECTIONS)[number];

/** The platforms each selection expands to, in manifest order. */
export const GREENGRASS_SELECTION_PLATFORMS: Readonly<
  Record<GreengrassPlatformSelection, readonly GreengrassPlatform[]>
> = {
  'linux-amd64': ['linux-amd64'],
  'linux-arm64': ['linux-arm64'],
  'linux-amd64-arm64': ['linux-amd64', 'linux-arm64'],
} as const;

export const resolvePlatforms = (
  selection: GreengrassPlatformSelection,
): readonly GreengrassPlatform[] => GREENGRASS_SELECTION_PLATFORMS[selection];
