/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  addDependenciesToPackageJson,
  detectPackageManager,
  generateFiles,
  getPackageManagerCommand,
  installPackagesTask,
  joinPathFragments,
  updateJson,
} from '@nx/devkit';
import { NxGeneratorInfo, getGeneratorInfo } from '../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { formatFilesInSubtree } from '../utils/format';
import { initGenerator } from '@nx/js';
import { readModulePackageJson } from 'nx/src/utils/package-json';
import { getNpmScope } from '../utils/npm-scope';
import GeneratorsJson from '../../generators.json';
import { PresetGeneratorSchema } from './schema';

const WORKSPACES = ['packages/*'];

export const PRESET_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const setUpWorkspaces = (tree: Tree) => {
  if (detectPackageManager() === 'pnpm') {
    tree.write(
      'pnpm-workspace.yaml',
      `packages:
  ${WORKSPACES.map((workspace) => `- "${workspace}"`).join('\n  ')}
`,
    );
  } else {
    updateJson(tree, 'package.json', (json) => {
      json.workspaces = WORKSPACES;
      return json;
    });
  }
};

export const presetGenerator = async (
  tree: Tree,
  { addTsPlugin }: PresetGeneratorSchema,
): Promise<GeneratorCallback> => {
  await initGenerator(tree, {
    formatter: 'prettier',
    addTsPlugin: addTsPlugin ?? true,
  });

  tree.delete('apps/.gitkeep');
  tree.delete('libs/.gitkeep');
  tree.write('packages/.gitkeep', '');

  setUpWorkspaces(tree);

  updateJson(tree, 'package.json', (packageJson) => ({
    ...packageJson,
    type: 'module',
    scripts: {
      ...packageJson.scripts,
      'build:all': 'nx run-many --target build --all',
      'affected:all': 'nx affected --target build',
    },
  }));

  addDependenciesToPackageJson(
    tree,
    {},
    {
      '@nx/workspace': readModulePackageJson('@nx/js').packageJson.version,
    },
  );

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files'),
    '.',
    {
      projectName: getNpmScope(tree),
      generators: Object.entries(GeneratorsJson.generators)
        .filter(([_, v]) => !v['hidden'])
        .map(([k, v]) => ({ name: k, description: v.description })),
      pkgMgrCmd: getPackageManagerCommand().exec,
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [PRESET_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default presetGenerator;
