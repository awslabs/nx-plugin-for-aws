/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  defaultLicenseConfig,
  readLicenseConfig,
  writeLicenseConfig,
} from './config';
import { SPDXLicenseIdentifier } from './schema';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../utils/config/utils';
import { LicenseConfig } from './config-types';

const LICENSES: SPDXLicenseIdentifier[] = ['Apache-2.0', 'MIT', 'ASL'];

describe('license config', () => {
  let tree: Tree;

  const sampleConfig: LicenseConfig = {
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
    it('should write license configuration and update package.json spdx', async () => {
      tree.write('package.json', `{ "name": "test-package" }`);
      tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, `export default {}`);

      await writeLicenseConfig(tree, 'Apache-2.0', sampleConfig);

      expect(JSON.parse(tree.read('package.json', 'utf-8')).license).toBe(
        'Apache-2.0',
      );
      expect(tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')).toContain(
        'this is a test license header',
      );
    });
  });
});
