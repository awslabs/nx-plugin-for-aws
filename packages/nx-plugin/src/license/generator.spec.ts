/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { readNxJson, Tree } from '@nx/devkit';

import { LICENSE_GENERATOR_INFO, licenseGenerator } from './generator';
import { LicenseGeneratorSchema } from './schema';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from '../utils/config/utils';
import { SYNC_GENERATOR_NAME } from './sync/generator';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { expectHasMetricTags } from '../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../utils/test';

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

    let source = tree.read('aws-nx-plugin.config.mts', 'utf-8')!;
    expect(source).toContain("spdx: 'MIT'");
    expect(source).toContain("copyrightHolder: 'Foo'");

    await licenseGenerator(tree, {
      license: 'MIT',
      copyrightHolder: 'Bar',
    });

    source = tree.read('aws-nx-plugin.config.mts', 'utf-8')!;
    expect(source).toContain("copyrightHolder: 'Bar'");

    await licenseGenerator(tree, {
      license: 'ASL',
      copyrightHolder: 'Baz',
    });

    source = tree.read('aws-nx-plugin.config.mts', 'utf-8')!;
    expect(source).toContain("spdx: 'ASL'");
    expect(source).toContain("copyrightHolder: 'Baz'");
  });

  it('should configure dependency check by default', async () => {
    await licenseGenerator(tree, options);

    const configSource = tree.read('aws-nx-plugin.config.mts', 'utf-8')!;
    expect(configSource).toContain("from '@aws/nx-plugin/license'");
    expect(configSource).toContain('allow: DEFAULT_LICENSE_ALLOWLIST');
    expect(configSource).toContain('exceptions');

    const nxJson = readNxJson(tree);
    expect(
      (nxJson.plugins ?? []).some(
        (p) =>
          (typeof p === 'string' ? p : p.plugin) ===
          '@aws/nx-plugin/license-check-plugin',
      ),
    ).toBe(true);
  });

  it('should skip dependency check wiring when disabled', async () => {
    await licenseGenerator(tree, {
      ...options,
      dependencyCheck: false,
    });

    const config = await readAwsNxPluginConfig(tree);
    expect(config.license!.dependencyCheck).toBeUndefined();

    const nxJson = readNxJson(tree);
    expect(
      (nxJson.plugins ?? []).some(
        (p) =>
          (typeof p === 'string' ? p : p.plugin) ===
          '@aws/nx-plugin/license-check-plugin',
      ),
    ).toBe(false);
  });

  it('should add generator metric to app.ts', async () => {
    tree = createTreeUsingTsSolutionSetup();

    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    // Call the generator function
    await licenseGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, LICENSE_GENERATOR_INFO.metric);
  });
});
