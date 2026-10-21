/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const templatePath = join(
  import.meta.dirname,
  'files',
  'next-version',
  '__nextVersionFileName__.template',
);

const tempModulePath = (): string =>
  join(
    import.meta.dirname,
    `.tmp-next-version-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.cjs`,
  );

const loadResolver = () => {
  const tempPath = tempModulePath();
  writeFileSync(tempPath, readFileSync(templatePath, 'utf-8'));
  try {
    return { resolver: require(tempPath), tempPath };
  } catch (error) {
    unlinkSync(tempPath);
    throw error;
  }
};

const versionArn = (version: string): string =>
  `arn:aws:greengrass:us-east-1:123456789012:components:com.test.Component:versions:${version}`;

const contentKey = (bucketName: string): string =>
  createHash('sha256')
    .update(`${'a'.repeat(64)}\n${bucketName}`)
    .digest('hex');

const input = {
  componentName: 'com.test.Component',
  strategy: 'patch',
  contentSha256: 'a'.repeat(64),
  bucketName: 'test-bucket',
  region: 'us-east-1',
  accountId: '123456789012',
  partition: 'aws',
} as const;

describe('next-version resolver template', () => {
  it('parses, compares, and bumps strict versions', () => {
    const { resolver, tempPath } = loadResolver();
    try {
      expect(resolver.parseStrictVersion('0.0.0')).toEqual({
        major: 0,
        minor: 0,
        patch: 0,
      });
      expect(resolver.parseStrictVersion('12.34.56')).toEqual({
        major: 12,
        minor: 34,
        patch: 56,
      });
      for (const invalid of ['1.0', '01.0.0', '1.0.0-beta', '1.0.0+build']) {
        expect(resolver.parseStrictVersion(invalid)).toBeUndefined();
      }
      expect(resolver.compareVersions('1.2.3', '1.2.2')).toBeGreaterThan(0);
      expect(resolver.compareVersions('1.2.3', '1.2.3')).toBe(0);
      expect(resolver.compareVersions('1.2.2', '1.2.3')).toBeLessThan(0);
      expect(resolver.bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
      expect(resolver.bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
      expect(resolver.bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('returns none without querying an empty component name', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const listVersions = vi.fn();
      const describeVersion = vi.fn();
      await expect(
        resolver.resolveNextVersion(
          { listVersions, describeVersion },
          { ...input, componentName: '' },
        ),
      ).resolves.toEqual({
        version: '',
        action: 'none',
        highest: '',
        contentKey: '',
      });
      expect(listVersions).not.toHaveBeenCalled();
      expect(describeVersion).not.toHaveBeenCalled();
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('creates 1.0.0 for an empty registry', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const describeVersion = vi.fn();
      await expect(
        resolver.resolveNextVersion(
          {
            listVersions: async () => [],
            describeVersion,
          },
          input,
        ),
      ).resolves.toEqual({
        version: '1.0.0',
        action: 'create',
        highest: '',
        contentKey: contentKey(input.bucketName),
      });
      expect(describeVersion).not.toHaveBeenCalled();
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('reuses the highest deployable version with a matching content key', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const describeVersion = vi.fn(async () => ({
        state: 'DEPLOYABLE',
        tags: { [resolver.NEXT_VERSION_TAG_KEY]: contentKey(input.bucketName) },
      }));
      await expect(
        resolver.resolveNextVersion(
          {
            listVersions: async () => [
              versionArn('1.0.0'),
              versionArn('1.1.0'),
            ],
            describeVersion,
          },
          input,
        ),
      ).resolves.toEqual({
        version: '1.1.0',
        action: 'reuse',
        highest: '1.1.0',
        contentKey: contentKey(input.bucketName),
      });
      expect(describeVersion).toHaveBeenCalledTimes(1);
      expect(describeVersion).toHaveBeenCalledWith(versionArn('1.1.0'));
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('ignores a matching tag on a lower version and creates above the highest', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const describeVersion = vi.fn(async (arn: string) => ({
        state: 'DEPLOYABLE',
        tags:
          arn === versionArn('1.0.0')
            ? { [resolver.NEXT_VERSION_TAG_KEY]: contentKey(input.bucketName) }
            : {},
      }));
      await expect(
        resolver.resolveNextVersion(
          {
            listVersions: async () => [
              versionArn('1.0.0'),
              versionArn('1.1.0'),
            ],
            describeVersion,
          },
          input,
        ),
      ).resolves.toEqual({
        version: '1.1.1',
        action: 'create',
        highest: '1.1.0',
        contentKey: contentKey(input.bucketName),
      });
      expect(describeVersion).toHaveBeenCalledTimes(1);
      expect(describeVersion).toHaveBeenCalledWith(versionArn('1.1.0'));
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('creates above a failed highest version even when its content key matches', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const describeVersion = vi.fn(async () => ({
        state: 'FAILED',
        tags: { [resolver.NEXT_VERSION_TAG_KEY]: contentKey(input.bucketName) },
      }));
      await expect(
        resolver.resolveNextVersion(
          {
            listVersions: async () => [versionArn('1.0.0')],
            describeVersion,
          },
          input,
        ),
      ).resolves.toEqual({
        version: '1.0.1',
        action: 'create',
        highest: '1.0.0',
        contentKey: contentKey(input.bucketName),
      });
      expect(describeVersion).toHaveBeenCalledTimes(1);
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('uses distinct content keys for the same content in different buckets', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const api = {
        listVersions: async () => [],
        describeVersion: vi.fn(),
      };
      const first = await resolver.resolveNextVersion(api, {
        ...input,
        bucketName: 'first-bucket',
      });
      const second = await resolver.resolveNextVersion(api, {
        ...input,
        bucketName: 'second-bucket',
      });
      expect(first.contentKey).toBe(contentKey('first-bucket'));
      expect(second.contentKey).toBe(contentKey('second-bucket'));
      expect(first.contentKey).not.toBe(second.contentKey);
      expect(api.describeVersion).not.toHaveBeenCalled();
    } finally {
      unlinkSync(tempPath);
    }
  });

  it.each([
    ['patch', '1.2.4'],
    ['minor', '1.3.0'],
    ['major', '2.0.0'],
  ])('applies the %s strategy', async (strategy, version) => {
    const { resolver, tempPath } = loadResolver();
    try {
      const describeVersion = vi.fn(async () => ({
        state: 'DEPLOYABLE',
        tags: {},
      }));
      await expect(
        resolver.resolveNextVersion(
          {
            listVersions: async () => [versionArn('1.2.3')],
            describeVersion,
          },
          { ...input, strategy },
        ),
      ).resolves.toMatchObject({ version, action: 'create', highest: '1.2.3' });
      expect(describeVersion).toHaveBeenCalledTimes(1);
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('keeps Delete read-free and preserves the physical resource id', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      await expect(
        resolver.handler({
          RequestType: 'Delete',
          PhysicalResourceId: 'com.test.Component/next-version',
        }),
      ).resolves.toEqual({
        PhysicalResourceId: 'com.test.Component/next-version',
      });
    } finally {
      unlinkSync(tempPath);
    }
  });

  it('two concurrent reads can select the same next version', async () => {
    const { resolver, tempPath } = loadResolver();
    try {
      const api = {
        listVersions: vi.fn(async () => [versionArn('1.0.0')]),
        describeVersion: vi.fn(async () => ({ state: 'DEPLOYABLE', tags: {} })),
      };
      const results = await Promise.all([
        resolver.resolveNextVersion(api, input),
        resolver.resolveNextVersion(api, input),
      ]);
      expect(
        results.map((result: { version: string }) => result.version),
      ).toEqual(['1.0.1', '1.0.1']);
      expect(api.listVersions).toHaveBeenCalledTimes(2);
      expect(api.describeVersion).toHaveBeenCalledTimes(2);
    } finally {
      unlinkSync(tempPath);
    }
  });
});
