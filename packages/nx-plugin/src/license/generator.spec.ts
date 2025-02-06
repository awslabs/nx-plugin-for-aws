/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { readNxJson, Tree } from '@nx/devkit';

import { licenseGenerator } from './generator';
import { LicenseGeneratorSchema } from './schema';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from '../utils/config/utils';
import { SYNC_GENERATOR_NAME } from './sync/generator';

describe('license generator', () => {
  let tree: Tree;
  const options: LicenseGeneratorSchema = {
    license: 'Apache-2.0',
    copyrightHolder: 'Test Inc. or its affiliates',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should write default license config', async () => {
    await licenseGenerator(tree, options);

    expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBeTruthy();
    expect(tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')).toContain(
      'Copyright Test Inc. or its affiliates.',
    );
  });

  it('should register the sync generator', async () => {
    await licenseGenerator(tree, options);

    expect(readNxJson(tree).targetDefaults.lint.syncGenerators).toContain(
      SYNC_GENERATOR_NAME,
    );
  });

  it('should allow successive runs to change the license', async () => {
    await licenseGenerator(tree, {
      license: 'MIT',
      copyrightHolder: 'Foo',
    });

    expect((await readAwsNxPluginConfig(tree)).license!.spdx).toBe('MIT');
    expect((await readAwsNxPluginConfig(tree)).license!.copyrightHolder).toBe(
      'Foo',
    );

    await licenseGenerator(tree, {
      license: 'MIT',
      copyrightHolder: 'Bar',
    });

    expect((await readAwsNxPluginConfig(tree)).license!.copyrightHolder).toBe(
      'Bar',
    );

    await licenseGenerator(tree, {
      license: 'ASL',
      copyrightHolder: 'Baz',
    });

    expect((await readAwsNxPluginConfig(tree)).license!.spdx).toBe('ASL');
    expect((await readAwsNxPluginConfig(tree)).license!.copyrightHolder).toBe(
      'Baz',
    );
  });
});
