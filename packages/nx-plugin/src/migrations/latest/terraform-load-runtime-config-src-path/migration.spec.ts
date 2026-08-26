/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const BROKEN_SRC_FILE = 'dist/packages/common/terraform/runtime-config.json';
const FIXED_SRC_FILE =
  'dist/packages/common/terraform/runtime-config/connection.json';

const terraformTarget = (srcFile = BROKEN_SRC_FILE) => ({
  executor: 'nx:run-commands',
  metadata: {
    description:
      "Load runtime config from most recently applied terraform env for dev purposes. Copies the runtime config from the Terraform dist directory to the website's public directory.",
  },
  options: {
    command:
      'node -e "const fs=require(\'fs\');fs.mkdirSync(process.env.DEST_DIR,{recursive:true});fs.copyFileSync(process.env.SRC_FILE,process.env.DEST_FILE);"',
    env: {
      SRC_FILE: srcFile,
      DEST_DIR: '{projectRoot}/public',
      DEST_FILE: '{projectRoot}/public/runtime-config.json',
    },
  },
});

const cdkTarget = () => ({
  executor: 'nx:run-commands',
  options: {
    command:
      'aws s3 cp s3://`aws cloudformation describe-stacks`/runtime-config.json "{projectRoot}/public/runtime-config.json"',
  },
});

describe('terraform-load-runtime-config-src-path migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should point SRC_FILE at the aggregated namespace file', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { 'load-runtime-config': terraformTarget() },
    });

    await migration(tree);

    const target = readProjectConfiguration(tree, 'website').targets?.[
      'load-runtime-config'
    ];
    expect(target?.options?.env).toEqual({
      SRC_FILE: FIXED_SRC_FILE,
      DEST_DIR: '{projectRoot}/public',
      DEST_FILE: '{projectRoot}/public/runtime-config.json',
    });
    // The command is untouched — only the path it reads was wrong.
    expect(target?.options?.command).toBe(terraformTarget().options.command);
  });

  it('should also fix the load:runtime-config target left in place by the rename', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: {
        'load:runtime-config': terraformTarget(),
        'load-runtime-config': terraformTarget(),
      },
    });

    await migration(tree);

    const targets = readProjectConfiguration(tree, 'website').targets;
    expect(targets?.['load:runtime-config']?.options?.env?.SRC_FILE).toBe(
      FIXED_SRC_FILE,
    );
    expect(targets?.['load-runtime-config']?.options?.env?.SRC_FILE).toBe(
      FIXED_SRC_FILE,
    );
  });

  it('should leave a customised SRC_FILE untouched', async () => {
    const customised = terraformTarget('dist/my/own/config.json');
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { 'load-runtime-config': customised },
    });

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'website').targets?.[
        'load-runtime-config'
      ],
    ).toEqual(customised);
  });

  it('should leave CDK websites untouched', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { 'load-runtime-config': cdkTarget() },
    });

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'website').targets?.[
        'load-runtime-config'
      ],
    ).toEqual(cdkTarget());
  });

  it('should do nothing when no project has the target', async () => {
    addProjectConfiguration(tree, 'api', {
      root: 'packages/api',
      targets: { build: { executor: 'nx:run-commands' } },
    });

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'api').targets?.['load-runtime-config'],
    ).toBeUndefined();
  });

  it('should handle multiple projects', async () => {
    addProjectConfiguration(tree, 'website-a', {
      root: 'packages/website-a',
      targets: { 'load-runtime-config': terraformTarget() },
    });
    addProjectConfiguration(tree, 'website-b', {
      root: 'packages/website-b',
      targets: { 'load-runtime-config': terraformTarget() },
    });

    await migration(tree);

    for (const project of ['website-a', 'website-b']) {
      expect(
        readProjectConfiguration(tree, project).targets?.['load-runtime-config']
          ?.options?.env?.SRC_FILE,
      ).toBe(FIXED_SRC_FILE);
    }
  });

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { 'load-runtime-config': terraformTarget() },
    });

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, 'website');

    await migration(tree);

    expect(readProjectConfiguration(tree, 'website')).toEqual(afterFirst);
  });
});
