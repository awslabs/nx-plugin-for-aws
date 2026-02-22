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
import { sharedInfraConfigGenerator } from '../../utils/shared-infra-config';
import { sharedScriptsGenerator } from '../../utils/shared-scripts';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_INFRA_CONFIG_DIR,
} from '../../utils/shared-constructs-constants';
import path from 'path';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import { uvxCommand } from '../../utils/py';

export const INFRA_APP_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsInfraGenerator(
  tree: Tree,
  schema: TsInfraGeneratorSchema,
): Promise<GeneratorCallback> {
  const lib = getTsLibDetails(tree, schema);
  await tsProjectGenerator(tree, schema);

  addGeneratorMetadata(tree, lib.fullyQualifiedName, INFRA_APP_GENERATOR_INFO);

  // Shared constructs always in CDK for typescript infra generator
  await sharedConstructsGenerator(tree, {
    iacProvider: 'CDK',
  });

  // Shared infra-config and infra-scripts packages (lazy creation, only when enabled)
  const enableStageConfig = schema.enableStageConfig ?? false;
  if (enableStageConfig) {
    await sharedInfraConfigGenerator(tree);
    await sharedScriptsGenerator(tree);
  }

  const synthDirFromRoot = `/dist/${lib.dir}/cdk.out`;
  const synthDirFromProject =
    lib.dir
      .split('/')
      .map(() => '..')
      .join('/') + `/dist/${lib.dir}/cdk.out`;
  const distDirFromProjectRoot =
    lib.dir
      .split('/')
      .map(() => '..')
      .join('/') + '/dist/{projectRoot}/cdk.out';
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
      namespace: kebabCase(fullyQualifiedName),
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerCommand().exec,
      dir: lib.dir,
      enableStageConfig,
      ...schema,
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
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
        'checkov',
      ];
      config.targets.compile.outputs = [
        '{workspaceRoot}/dist/{projectRoot}/tsc',
      ];
      config.targets.synth = {
        cache: true,
        executor: 'nx:run-commands',
        inputs: ['default'],
        outputs: ['{workspaceRoot}/dist/{projectRoot}/cdk.out'],
        dependsOn: ['^build', 'compile'], // compile clobbers dist directory, so ensure synth runs afterwards
        options: {
          cwd: '{projectRoot}',
          command: 'cdk synth',
        },
      };
      config.targets.checkov = {
        cache: true,
        executor: 'nx:run-commands',
        inputs: ['{workspaceRoot}/dist/{projectRoot}/cdk.out'],
        outputs: ['{workspaceRoot}/dist/{projectRoot}/checkov'],
        dependsOn: ['synth'],
        options: {
          command: uvxCommand(
            'checkov',
            '--config-file {projectRoot}/checkov.yml --directory dist/{projectRoot}/cdk.out --framework cloudformation',
          ),
        },
      };
      config.targets.deploy = {
        executor: 'nx:run-commands',
        dependsOn: ['^build', 'compile'],
        options: enableStageConfig
          ? {
              command: `tsx packages/common/scripts/src/infra-deploy.ts ${libraryRoot}`,
            }
          : {
              cwd: '{projectRoot}',
              command: 'cdk deploy --require-approval=never',
            },
      };
      config.targets['deploy-ci'] = {
        executor: 'nx:run-commands',
        options: {
          cwd: '{projectRoot}',
          command: `cdk deploy --require-approval=never --app ${distDirFromProjectRoot}`,
        },
      };
      config.targets.destroy = {
        executor: 'nx:run-commands',
        dependsOn: ['^build', 'compile'],
        options: enableStageConfig
          ? {
              command: `tsx packages/common/scripts/src/infra-destroy.ts ${libraryRoot}`,
            }
          : {
              cwd: '{projectRoot}',
              command: 'cdk destroy --require-approval=never',
            },
      };
      config.targets['destroy-ci'] = {
        executor: 'nx:run-commands',
        options: {
          cwd: '{projectRoot}',
          command: `cdk destroy --require-approval=never --app ${distDirFromProjectRoot}`,
        },
      };
      config.targets.cdk = {
        executor: 'nx:run-commands',
        options: {
          cwd: '{projectRoot}',
          command: 'cdk',
        },
      };
      config.targets.bootstrap = {
        executor: 'nx:run-commands',
        options: {
          cwd: '{projectRoot}',
          command: 'cdk bootstrap',
        },
      };
      config.targets = sortObjectKeys(config.targets);
      return config;
    },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      'aws-cdk-lib',
      'aws-cdk',
      'esbuild',
      'constructs',
      'source-map-support',
    ]),
    withVersions(['tsx']),
  );

  updateJson(tree, `${libraryRoot}/tsconfig.lib.json`, (tsConfig) => ({
    ...tsConfig,
    references: [
      ...(tsConfig.references || []),
      {
        path: `${path.relative(
          libraryRoot,
          `${tree.root}/${PACKAGES_DIR}`,
        )}/${SHARED_CONSTRUCTS_DIR}/tsconfig.lib.json`,
      },
      ...(enableStageConfig
        ? [
            {
              path: `${path.relative(
                libraryRoot,
                `${tree.root}/${PACKAGES_DIR}`,
              )}/${SHARED_INFRA_CONFIG_DIR}/tsconfig.json`,
            },
          ]
        : []),
    ],
  }));

  await addGeneratorMetricsIfApplicable(tree, [INFRA_APP_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsInfraGenerator;
