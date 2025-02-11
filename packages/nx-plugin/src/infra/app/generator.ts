/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  readProjectConfiguration,
  addDependenciesToPackageJson,
  generateFiles,
  Tree,
  updateJson,
  ProjectConfiguration,
  GeneratorCallback,
  OverwriteStrategy,
  getPackageManagerCommand,
  installPackagesTask,
} from '@nx/devkit';
import { InfraGeneratorSchema } from './schema';
import tsLibGenerator, { getTsLibDetails } from '../../ts/lib/generator';
import { withVersions } from '../../utils/versions';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { addStarExport } from '../../utils/ast';
import path from 'path';
import { formatFilesInSubtree } from '../../utils/format';

export async function infraGenerator(
  tree: Tree,
  schema: InfraGeneratorSchema,
): Promise<GeneratorCallback> {
  const lib = getTsLibDetails(tree, schema);
  await tsLibGenerator(tree, schema);
  await sharedConstructsGenerator(tree);
  const synthDirFromRoot = `/dist/${lib.dir}/cdk.out`;
  const synthDirFromProject =
    lib.dir
      .split('/')
      .map(() => '..')
      .join('/') + synthDirFromRoot;
  const projectConfig = readProjectConfiguration(tree, lib.fullyQualifiedName);
  const libraryRoot = projectConfig.root;
  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = toScopeAlias(npmScopePrefix);
  const fullyQualifiedName = `${npmScopePrefix}${schema.name}`;
  tree.delete(joinPathFragments(libraryRoot, 'src'));
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, './files/app'), // path to the file templates
    libraryRoot, // destination path of the files
    {
      synthDir: synthDirFromProject,
      scopeAlias: scopeAlias,
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerCommand().exec,
      ...schema,
      ruleSet: schema.ruleSet.toUpperCase(),
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR, 'src', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
    {
      synthDir: synthDirFromProject,
      scopeAlias: toScopeAlias(getNpmScopePrefix(tree)),
      ...schema,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
  updateJson(
    tree,
    `${libraryRoot}/project.json`,
    (config: ProjectConfiguration) => {
      config.projectType = 'application';
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        'synth',
      ];
      config.targets.compile.options.main = joinPathFragments(
        libraryRoot,
        'src',
        'main.ts',
      );
      config.targets.synth = {
        cache: true,
        executor: 'nx:run-commands',
        outputs: [`{workspaceRoot}${synthDirFromRoot}`],
        dependsOn: ['^build', 'compile'], // compile clobbers dist directory, so ensure synth runs afterwards
        options: {
          cwd: libraryRoot,
          command: 'cdk synth',
        },
      };
      config.targets.deploy = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: `cdk deploy --require-approval=never --app ${synthDirFromProject}`,
        },
      };
      return config;
    },
  );
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'index.ts',
    ),
    './cfn-guard.js',
  );
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@cdklabs/cdk-validator-cfnguard',
      'aws-cdk-lib',
      'aws-cdk',
      'esbuild',
      'constructs',
      'source-map-support',
    ]),
    withVersions(['tsx']),
  );

  updateJson(tree, `${libraryRoot}/tsconfig.json`, (tsConfig) => ({
    ...tsConfig,
    references: [
      ...(tsConfig.references || []),
      {
        path: `${path.relative(
          libraryRoot,
          `${tree.root}/${PACKAGES_DIR}`,
        )}/${SHARED_CONSTRUCTS_DIR}/tsconfig.json`,
      },
    ],
  }));

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default infraGenerator;
