/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  addLicenseExceptions,
  defaultLicenseConfig,
  readLicenseConfig,
  writeLicenseConfig,
} from './config';
import { SPDXLicenseIdentifier } from './schema';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../utils/config/utils';
import { LicenseConfig } from './config-types';
import { beforeEach, afterEach, vi } from 'vitest';

const LICENSES: SPDXLicenseIdentifier[] = ['Apache-2.0', 'MIT', 'ASL'];

describe('license config', () => {
  let tree: Tree;

  const sampleConfig: LicenseConfig = {
    spdx: 'ASL',
    copyrightHolder: 'Test Inc.',
    header: {
      content: {
        lines: ['this is a test license header'],
      },
      format: {
        '**/*.js': {
          lineStart: '// ',
        },
      },
    },
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Mock Date to return a consistent year for snapshot tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaultLicenseConfig', () => {
    it.each(LICENSES)(
      'should generate default license config for %s',
      (spdx) => {
        expect(
          defaultLicenseConfig(spdx, 'Test Inc. or its affiliates'),
        ).toMatchSnapshot();
      },
    );
  });

  describe('readLicenseConfig', () => {
    it('should read license configuration', async () => {
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `
        export default {
          license: ${JSON.stringify(sampleConfig)}
        };
      `,
      );

      expect(await readLicenseConfig(tree)).toEqual(sampleConfig);
    });
  });

  describe('writeLicenseConfig', () => {
    it('should write license configuration', async () => {
      tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, `export default {}`);

      await writeLicenseConfig(tree, sampleConfig);

      expect(tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')).toContain(
        'this is a test license header',
      );
    });
  });

  describe('addLicenseExceptions', () => {
    it('should do nothing when config file does not exist', async () => {
      await addLicenseExceptions(tree, [{ package: 'foo', reason: 'test' }]);
      expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBe(false);
    });

    it('should do nothing when dependencyCheck is not configured', async () => {
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `export default { license: { spdx: 'MIT', copyrightHolder: 'X' } };`,
      );
      await addLicenseExceptions(tree, [{ package: 'foo', reason: 'test' }]);
      const source = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(source).not.toContain('foo');
    });

    it('should add exceptions when dependencyCheck is configured', async () => {
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `export default { license: { spdx: 'MIT', copyrightHolder: 'X', dependencyCheck: { allow: [], exceptions: [] } } };`,
      );
      await addLicenseExceptions(tree, [
        { package: 'foo', reason: 'test reason' },
      ]);
      const source = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(source).toContain('foo');
      expect(source).toContain('test reason');
    });

    it('should not duplicate existing exceptions', async () => {
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `export default { license: { spdx: 'MIT', copyrightHolder: 'X', dependencyCheck: { allow: [], exceptions: [{ package: 'foo', reason: 'existing' }] } } };`,
      );
      await addLicenseExceptions(tree, [
        { package: 'foo', reason: 'duplicate' },
        { package: 'bar', reason: 'new' },
      ]);
      const source = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(source).toContain('existing');
      expect(source).not.toContain('duplicate');
      expect(source).toContain('bar');
    });
  });
});
