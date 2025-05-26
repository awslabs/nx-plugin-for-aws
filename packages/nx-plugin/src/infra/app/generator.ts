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
import { TsInfraGeneratorSchema } from './schema';
import tsProjectGenerator, { getTsLibDetails } from '../../ts/lib/generator';
import { withVersions } from '../../utils/versions';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { addStarExport } from '../../utils/ast';
import path from 'path';
import { formatFilesInSubtree } from '../../utils/format';
import kebabCase from 'lodash.kebabcase';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const INFRA_APP_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsInfraGenerator(
  tree: Tree,
  schema: TsInfraGeneratorSchema,
): Promise<GeneratorCallback> {
  const lib = getTsLibDetails(tree, schema);
  await tsProjectGenerator(tree, schema);

  addGeneratorMetadata(tree, lib.fullyQualifiedName, INFRA_APP_GENERATOR_INFO);

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
      namespace: kebabCase(npmScopePrefix),
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
      config.targets.synth = {
        cache: true,
        executor: 'nx:run-commands',
        inputs: ['default'],
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
          command: `cdk deploy --require-approval=never`,
        },
      };
      config.targets['deploy-ci'] = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: `cdk deploy --require-approval=never --app ${synthDirFromProject}`,
        },
      };
      config.targets.destroy = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: `cdk destroy --require-approval=never`,
        },
      };
      config.targets['destroy-ci'] = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: `cdk destroy --require-approval=never --app ${synthDirFromProject}`,
        },
      };
      config.targets.cdk = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: 'cdk',
        },
      };
      config.targets.bootstrap = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: 'cdk bootstrap',
        },
      };
      config.targets = sortObjectKeys(config.targets);
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

  await addGeneratorMetricsIfApplicable(tree, [INFRA_APP_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsInfraGenerator;
