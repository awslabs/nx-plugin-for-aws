/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  readAwsNxPluginConfig,
  updateAwsNxPluginConfig,
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
} from './utils';
import { LicenseLinesContent } from '../../license/config-types';

describe('config utils', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await ensureAwsNxPluginConfig(tree);
  });

  it('should ensure config exists', async () => {
    expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBe(true);
  });

  it('should update user config', async () => {
    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Test Copyright Header'] },
          format: {
            '**/*.ts': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();

    expect(
      (
        (await readAwsNxPluginConfig(tree)).license.header
          .content as LicenseLinesContent
      ).lines[0],
    ).toBe('Test Copyright Header');

    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Test Copyright Header 2'] },
          format: {
            '**/*.ts': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    expect(
      (
        (await readAwsNxPluginConfig(tree)).license.header
          .content as LicenseLinesContent
      ).lines[0],
    ).toBe('Test Copyright Header 2');
  });

  it('should not delete other user config', async () => {
    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Test Copyright Header'] },
          format: {
            '**/*.ts': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    await updateAwsNxPluginConfig(tree, {});

    expect(
      (
        (await readAwsNxPluginConfig(tree)).license.header
          .content as LicenseLinesContent
      ).lines[0],
    ).toBe('Test Copyright Header');
  });
});
