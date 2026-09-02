/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { relative } from 'node:path';
import {
  detectPackageManager,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readProjectConfiguration,
  type Tree,
  updateJson,
  updateProjectConfiguration,
  writeJson,
} from '@nx/devkit';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import { addStarExport } from '../../utils/ast.js';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../utils/bundle/bundle.js';
import { resolveContainers } from '../../utils/containers.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import {
  addDockerScanTarget,
  DOCKER_DEPENDENCIES,
  IMAGE_BUILD_CACHE,
  NODE_IMAGE_DEPENDENCIES,
  nodeImageVersions,
} from '../../utils/docker.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs.js';
import { updateGitIgnore } from '../../utils/git.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { esmVars } from '../../utils/module-format.js';
import { kebabCase, snakeCase, toClassName } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addArtifactDependencyToTargets,
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../utils/nx.js';
import { getRelativePathToRootByDirectory } from '../../utils/paths.js';
import { registerPnpmBuiltDependencies } from '../../utils/pnpm-workspace.js';
import { assignPort } from '../../utils/port.js';
import { addRdbInfra } from '../../utils/rdb-constructs/rdb-constructs.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants.js';
import {
  SHARED_RDB_SCRIPTS_DEPENDENCIES,
  sharedRdbScriptsGenerator,
} from '../../utils/shared-rdb-scripts.js';
import { TS_VERSIONS } from '../../utils/versions.js';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator.js';
import type { TsRdbGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TsRdbMetadata extends IacMetadata {
  readonly engine: TsRdbGeneratorSchema['engine'];
}

// Each entry names the engine branch it belongs to, so the same declaration
// drives both adding and the version sync.
export const DEPENDENCIES = declareDependencies<TsRdbMetadata>()({
  ts: [
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-sdk/client-appconfigdata' },
    { name: '@aws-sdk/client-secrets-manager' },
    { name: '@aws-sdk/rds-signer' },
    { name: '@prisma/client' },
    { name: '@prisma/adapter-mariadb', when: (m) => m.engine === 'mysql' },
    { name: 'mariadb', when: (m) => m.engine === 'mysql' },
    { name: '@prisma/adapter-pg', when: (m) => m.engine !== 'mysql' },
    { name: 'pg', when: (m) => m.engine !== 'mysql' },
    { name: '@types/aws-lambda', dev: true },
    { name: '@types/pg', when: (m) => m.engine !== 'mysql', dev: true },
    // The prisma CLI and tsx run migration/seed scripts from the root.
    { name: 'prisma', dev: true, root: true },
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(SHARED_RDB_SCRIPTS_DEPENDENCIES),
    ...ownedElsewhere(NODE_IMAGE_DEPENDENCIES),
  ],
});

export const TS_RDB_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const tsRdbGenerator = async (
  tree: Tree,
  options: TsRdbGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(options.name);
  const databaseUser = options.databaseUser ?? 'dbadmin';
  const databaseName = snakeCase(options.databaseName ?? options.name);
  const containerEngine = await resolveContainers(tree, 'inherit');
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, {
    name: options.name,
    directory: options.directory,
    subDirectory: options.subDirectory,
  });

  let projectExists: boolean;
  try {
    readProjectConfiguration(tree, fullyQualifiedName);
    projectExists = true;
  } catch {
    projectExists = false;
  }

  if (!projectExists) {
    await tsProjectGenerator(tree, {
      name: options.name,
      directory: options.directory,
      subDirectory: options.subDirectory,
      preferInstallDependencies: false,
    });
  }

  updateJson(tree, joinPathFragments(dir, 'tsconfig.lib.json'), (tsConfig) => ({
    ...tsConfig,
    include: ['src/**/*.ts', 'generated/prisma/**/*.ts'],
  }));

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const localDbPort = assignPort(
    tree,
    projectConfig,
    options.engine === 'mysql' ? 3306 : 5432,
  );
  const localDbHost = 'localhost';
  const localDbUser = options.engine === 'mysql' ? 'root' : 'dbadmin';
  const localDbPassword = 'password';
  const containerName = `${getNpmScope(tree)}-${databaseName}`;
  const dockerImage =
    options.engine === 'mysql'
      ? 'public.ecr.aws/docker/library/mysql:8.0.44'
      : 'public.ecr.aws/docker/library/postgres:17.7';

  const templateOptions = {
    engine: options.engine,
    runtimeConfigKey: nameClassName,
    databasePackageAlias: fullyQualifiedName,
    databaseProvider: options.engine === 'mysql' ? 'mysql' : 'postgresql',
    prismaVersion: TS_VERSIONS.prisma,
    ...nodeImageVersions(),
    prismaAdapterPackage:
      options.engine === 'mysql'
        ? '@prisma/adapter-mariadb'
        : '@prisma/adapter-pg',
    prismaAdapterClassName:
      options.engine === 'mysql' ? 'PrismaMariaDb' : 'PrismaPg',
    localDbPort,
    localDbHost,
    localDbName: databaseName,
    localDbUser,
    localDbPassword,
    containerEngine,
    containerName,
    dockerImage,
    ...esmVars(tree),
  };

  // The Prisma schema and models, the handlers and the prisma client module are
  // all user-editable, so a re-run (to add infrastructure, or after a failed
  // run) must not clobber the user's schema and edits.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    dir,
    templateOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // The barrel re-exports prisma.ts. `tsProjectGenerator` writes a stub index.ts
  // when it creates the project, so the re-export is added to whatever is there
  // rather than replacing it — which also leaves a user's own additions to the
  // barrel alone on a re-run.
  await addStarExport(
    tree,
    joinPathFragments(dir, 'src', 'index.ts'),
    './prisma.js',
  );

  // config.json is framework-owned: it carries values derived from the
  // generator's options, so it converges on a re-run with changed options.
  writeJson(tree, joinPathFragments(dir, 'config.json'), {
    runtimeConfigKey: nameClassName,
    localDev: {
      containerEngine,
      containerName,
      image: dockerImage,
      port: localDbPort,
      host: localDbHost,
      dbName: databaseName,
      dbUser: localDbUser,
      dbPassword: localDbPassword,
      dbEngine: options.engine,
    },
  });
  updateGitIgnore(tree, dir, (patterns) => [...patterns, 'generated/prisma']);
  await sharedRdbScriptsGenerator(tree, options.engine, DEPENDENCIES);
  const waitForDbScript =
    options.engine === 'mysql'
      ? 'wait-for-mysql-db.ts'
      : 'wait-for-postgres-db.ts';
  const scriptsDir = relative(
    dir,
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'src', 'rdb'),
  );
  const relativePathToRoot = getRelativePathToRootByDirectory(
    projectConfig.root,
  );
  const fs = new FsCommands(tree, DEPENDENCIES);
  const migrationBundleDir = joinPathFragments(
    'dist',
    projectConfig.root,
    'bundle',
    'migration',
  );
  const migrationDockerImageTag = `${getNpmScope(tree)}-${kebabCase(options.name)}-migration:latest`;

  if (options.infra !== 'none') {
    await addTypeScriptBundleTarget(
      tree,
      projectConfig,
      {
        targetFilePath: 'src/migration-handler.ts',
        bundleOutputDir: 'migration',
      },
      DEPENDENCIES,
    );
    await addTypeScriptBundleTarget(
      tree,
      projectConfig,
      {
        targetFilePath: 'src/create-db-user-handler.ts',
        bundleOutputDir: 'create-db-user',
      },
      DEPENDENCIES,
    );
    const bundleTarget = projectConfig.targets['bundle'];
    // The bundle target starts with a single rolldown `command`. Wrap it with
    // the migration asset copy steps, unless it has already been transformed
    // into a `commands` array on a previous run.
    if (!bundleTarget.options.commands) {
      const rolldownCommand = bundleTarget.options.command;
      delete bundleTarget.options.command;
      bundleTarget.options = {
        ...bundleTarget.options,
        commands: [
          fs.rm(`${relativePathToRoot}dist/{projectRoot}/bundle/migration`),
          fs.mkdir(`${relativePathToRoot}dist/{projectRoot}/bundle/migration`),
          fs.cpDir(
            'prisma',
            `${relativePathToRoot}dist/{projectRoot}/bundle/migration/prisma`,
          ),
          fs.cpFile(
            'prisma.config.ts',
            `${relativePathToRoot}dist/{projectRoot}/bundle/migration/prisma.config.ts`,
          ),
          fs.cpFile(
            'Dockerfile',
            `${relativePathToRoot}dist/{projectRoot}/bundle/migration/Dockerfile`,
          ),
          rolldownCommand,
        ],
        parallel: false,
      };
    }
  }

  projectConfig.targets.generate = {
    executor: 'nx:run-commands',
    outputs: ['{projectRoot}/generated/prisma'],
    options: {
      command: 'prisma generate',
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['pull-image'] = {
    executor: 'nx:run-commands',
    options: {
      command: `tsx ${scriptsDir}/pull-image.ts`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['dev'] = {
    executor: 'nx:run-commands',
    dependsOn: ['pull-image'],
    options: {
      command: `tsx ${scriptsDir}/start-container.ts`,
      cwd: '{projectRoot}',
    },
    continuous: true,
  };
  projectConfig.targets['wait-for-db'] = {
    executor: 'nx:run-commands',
    dependsOn: ['dev'],
    options: {
      command: `tsx ${scriptsDir}/${waitForDbScript}`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets.prisma = {
    executor: 'nx:run-commands',
    dependsOn: ['dev', 'wait-for-db'],
    options: {
      cwd: '{projectRoot}',
      command: 'prisma',
      env: {
        LOCAL_DEV: 'true',
      },
    },
  };
  // Recorded in the metadata below so the version sync can tell a CDK project
  // from a Terraform one; undefined when no infrastructure was generated, in
  // which case neither provider's packages were added.
  const iac =
    options.infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  if (options.infra !== 'none') {
    if (iac === 'terraform') {
      projectConfig.targets['docker'] = {
        cache: IMAGE_BUILD_CACHE,
        executor: 'nx:run-commands',
        options: {
          command: `${containerEngine} build --platform linux/arm64 --provenance=false -t ${migrationDockerImageTag} ${migrationBundleDir}`,
        },
        dependsOn: ['bundle'],
      };
      addArtifactDependencyToTargets(projectConfig, 'docker');

      addDockerScanTarget(
        tree,
        {
          project: projectConfig,
          containerEngine,
          trivyTargetName: 'trivy',
          dockerTargetName: 'docker',
          imageTags: [migrationDockerImageTag],
        },
        DEPENDENCIES,
      );
    }
    addArtifactDependencyToTargets(projectConfig, 'bundle');
  }
  addDependencyToTargetIfNotPresent(projectConfig, 'compile', 'generate');
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);
  // Recorded here and read by the declaration's predicates, so the packages
  // added below are exactly the ones the version sync will own.
  const metadata: TsRdbMetadata = {
    engine: options.engine,
    ...(iac ? { iac } : {}),
  };
  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    TS_RDB_GENERATOR_INFO,
    metadata,
  );

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
    await addRdbInfra(tree, {
      iac,
      projectName: fullyQualifiedName,
      projectRoot: dir,
      nameClassName,
      nameKebabCase,
      databasePackageAlias: fullyQualifiedName,
      databaseName,
      adminUser: databaseUser,
      engine: options.engine,
      migrationBundleDir,
      createDbUserBundleDir: joinPathFragments(
        'dist',
        projectConfig.root,
        'bundle',
        'create-db-user',
      ),
      framework: options.framework,
      migrationDockerImageTag,
      containerEngine,
    });
  }

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: projectConfig.root,
  });

  // @prisma/adapter-pg depends on @types/pg ^8.16.0. Yarn does not dedupe it to
  // the workspace's pinned @types/pg, so it installs a separate copy under the
  // adapter's own node_modules whenever a newer @types/pg is published. The two
  // copies declare structurally incompatible Pool types, so passing our `new
  // Pool(...)` to `new PrismaPg(...)` fails to compile. Scope the resolution to
  // the adapter so other @types/pg consumers are unaffected. Classic yarn only
  // honours the `**/`-prefixed descriptor in a workspace and berry only the
  // bare one, so declare both.
  if (options.engine === 'postgres' && detectPackageManager() === 'yarn') {
    updateJson(tree, 'package.json', (packageJson) => {
      packageJson.resolutions = {
        ...packageJson.resolutions,
        '**/@prisma/adapter-pg/@types/pg': TS_VERSIONS['@types/pg'],
        '@prisma/adapter-pg/@types/pg': TS_VERSIONS['@types/pg'],
      };
      return packageJson;
    });
  }

  registerPnpmBuiltDependencies(tree, {
    '@prisma/engines': false,
    prisma: false,
  });

  await addGeneratorMetricsIfApplicable(tree, [TS_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsRdbGenerator;
