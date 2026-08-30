/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import path from 'path';
import tsProjectGenerator, { getTsLibDetails } from '../../ts/lib/generator.js';
import { mergeTsReferences } from '../../ts/lib/ts-project-utils.js';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import { resolveContainers } from '../../utils/containers.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { esmVars } from '../../utils/module-format.js';
import { kebabCase } from '../../utils/names.js';
import { getNpmScopePrefix } from '../../utils/npm-scope.js';
import {
  addArtifactDependencyToTargets,
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx.js';
import { sortObjectKeys } from '../../utils/object.js';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager.js';
import { uvxCommand } from '../../utils/py.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_INFRA_CONFIG_DIR,
} from '../../utils/shared-constructs-constants.js';
import { sharedInfraConfigGenerator } from '../../utils/shared-infra-config.js';
import {
  SHARED_INFRA_SCRIPTS_DEPENDENCIES,
  sharedInfraScriptsGenerator,
} from '../../utils/shared-infra-scripts.js';
import type { TsInfraGeneratorSchema } from './schema';

// This generator records no metadata, so nothing a predicate could read: the
// CDK app always needs the app libraries, and the CLI, bundler and tsx are
// shared tooling.
export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: 'aws-cdk-lib' },
    { name: 'constructs' },
    { name: 'source-map-support' },
    // The `aws-cdk` CLI, esbuild (CDK bundling) and tsx are shared tooling.
    { name: 'aws-cdk', dev: true, root: true },
    { name: 'esbuild', dev: true, root: true },
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(SHARED_INFRA_SCRIPTS_DEPENDENCIES),
  ],
});

export const INFRA_APP_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function tsInfraGenerator(
  tree: Tree,
  schema: TsInfraGeneratorSchema,
): Promise<GeneratorCallback> {
  const lib = getTsLibDetails(tree, schema);

  if (!projectExists(tree, lib.fullyQualifiedName)) {
    await tsProjectGenerator(tree, {
      ...schema,
      preferInstallDependencies: false,
    });
  }

  // CDK shells out to a container engine to build image assets. Default
  // (docker) needs no env override; finch is set via CDK_DOCKER per
  // https://docs.aws.amazon.com/cdk/v2/guide/build-containers.html#build-container-replace.
  const containers = await resolveContainers(tree, 'inherit');
  const cdkEnv: Record<string, string> | undefined =
    containers === 'docker' ? undefined : { CDK_DOCKER: containers };
  const withCdkEnv = <T extends Record<string, unknown>>(opts: T): T => {
    if (!cdkEnv) return opts;
    const existingEnv = (opts.env as Record<string, string> | undefined) ?? {};
    return { ...opts, env: { ...existingEnv, ...cdkEnv } } as T;
  };

  // This generator IS the CDK infrastructure project, so the provider is fixed.
  addGeneratorMetadata(tree, lib.fullyQualifiedName, INFRA_APP_GENERATOR_INFO, {
    iac: 'cdk',
  });

  // Shared constructs always in CDK for typescript infra generator
  await sharedConstructsGenerator(
    tree,
    {
      iac: 'cdk',
    },
    DEPENDENCIES,
  );

  // Shared infra-config and infra-scripts packages (lazy creation, only when enabled)
  const stageConfig = schema.stageConfig ?? false;
  if (stageConfig) {
    await sharedInfraConfigGenerator(tree);
    await sharedInfraScriptsGenerator(tree, DEPENDENCIES);
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
  const scopeAlias = npmScopePrefix;
  const fullyQualifiedName = `${npmScopePrefix}${schema.name}`;
  const namespace = kebabCase(fullyQualifiedName);
  // The stage instantiated in main.ts. Quoted so the shell does not glob `*`.
  const sandboxStagePattern = `"${namespace}-sandbox/*"`;
  tree.delete(joinPathFragments(libraryRoot, 'src'));

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(import.meta.dirname, './files/app'), // path to the file templates
    libraryRoot, // destination path of the files
    {
      synthDir: synthDirFromProject,
      scopeAlias: scopeAlias,
      namespace,
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerDisplayCommands().exec,
      dir: lib.dir,
      stageConfig,
      ...schema,
      ...esmVars(tree),
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
      // `synth` is the CDK artifact, so it belongs on `package` too; `checkov`
      // is a quality gate, so it stays on `build` alone.
      addArtifactDependencyToTargets(config, 'synth');
      addDependencyToTargetIfNotPresent(config, 'build', 'checkov');
      config.targets.compile.outputs = [
        '{workspaceRoot}/dist/{projectRoot}/tsc',
      ];
      config.targets.synth = {
        cache: true,
        executor: 'nx:run-commands',
        inputs: ['default'],
        outputs: ['{workspaceRoot}/dist/{projectRoot}/cdk.out'],
        dependsOn: ['^package', 'compile'], // compile clobbers dist directory, so ensure synth runs afterwards
        options: withCdkEnv({
          cwd: '{projectRoot}',
          command: 'cdk synth',
        }),
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
        dependsOn: ['^package', 'compile'],
        options: stageConfig
          ? withCdkEnv({
              command: `tsx packages/common/scripts/src/infra/infra-deploy.ts ${libraryRoot}`,
            })
          : withCdkEnv({
              cwd: '{projectRoot}',
              command: 'cdk deploy --require-approval=never',
            }),
      };
      config.targets['deploy-sandbox'] = {
        executor: 'nx:run-commands',
        dependsOn: ['^package', 'compile'],
        options: stageConfig
          ? withCdkEnv({
              command: `tsx packages/common/scripts/src/infra/infra-deploy.ts ${libraryRoot} ${sandboxStagePattern}`,
            })
          : withCdkEnv({
              cwd: '{projectRoot}',
              command: `cdk deploy --require-approval=never ${sandboxStagePattern}`,
            }),
      };
      config.targets['deploy-ci'] = {
        executor: 'nx:run-commands',
        options: withCdkEnv({
          cwd: '{projectRoot}',
          command: `cdk deploy --require-approval=never --app ${distDirFromProjectRoot}`,
        }),
      };
      config.targets.destroy = {
        executor: 'nx:run-commands',
        dependsOn: ['^package', 'compile'],
        options: stageConfig
          ? withCdkEnv({
              command: `tsx packages/common/scripts/src/infra/infra-destroy.ts ${libraryRoot}`,
            })
          : withCdkEnv({
              cwd: '{projectRoot}',
              command: 'cdk destroy',
            }),
      };
      config.targets['destroy-sandbox'] = {
        executor: 'nx:run-commands',
        dependsOn: ['^package', 'compile'],
        options: stageConfig
          ? withCdkEnv({
              command: `tsx packages/common/scripts/src/infra/infra-destroy.ts ${libraryRoot} ${sandboxStagePattern}`,
            })
          : withCdkEnv({
              cwd: '{projectRoot}',
              command: `cdk destroy ${sandboxStagePattern}`,
            }),
      };
      config.targets['destroy-ci'] = {
        executor: 'nx:run-commands',
        options: withCdkEnv({
          cwd: '{projectRoot}',
          command: `cdk destroy --app ${distDirFromProjectRoot}`,
        }),
      };
      config.targets.cdk = {
        executor: 'nx:run-commands',
        options: withCdkEnv({
          cwd: '{projectRoot}',
          command: 'cdk',
        }),
      };
      config.targets.bootstrap = {
        executor: 'nx:run-commands',
        options: withCdkEnv({
          cwd: '{projectRoot}',
          command: 'cdk bootstrap',
        }),
      };
      config.targets = sortObjectKeys(config.targets);
      return config;
    },
  );

  addTsDependencies(tree, DEPENDENCIES, { projectRoot: libraryRoot });

  updateJson(tree, `${libraryRoot}/tsconfig.lib.json`, (tsConfig) => ({
    ...tsConfig,
    references: mergeTsReferences(tsConfig.references, [
      {
        path: `${path.relative(
          libraryRoot,
          `${tree.root}/${PACKAGES_DIR}`,
        )}/${SHARED_CONSTRUCTS_DIR}/tsconfig.lib.json`,
      },
      ...(stageConfig
        ? [
            {
              path: `${path.relative(
                libraryRoot,
                `${tree.root}/${PACKAGES_DIR}`,
              )}/${SHARED_INFRA_CONFIG_DIR}/tsconfig.json`,
            },
          ]
        : []),
    ]),
  }));

  await addGeneratorMetricsIfApplicable(tree, [INFRA_APP_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript'],
    });
}
export default tsInfraGenerator;
