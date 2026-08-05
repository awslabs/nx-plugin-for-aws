/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { getTsLibDetails } from '../../ts/lib/generator';
import { addTsDependencies } from '../../utils/add-dependencies';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { toClassName, toKebabCase } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import {
  isWindows,
  smithyCliCommand,
  warnIfSmithyMissing,
} from '../../utils/smithy';
import { smithyMavenVersions } from '../../utils/versions';
import type { SmithyProjectGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface SmithyProjectMetadata {
  readonly smithyType: NonNullable<SmithyProjectGeneratorSchema['type']>;
  readonly namespace: string;
}

/**
 * Only a service project generates a Server SDK, so only a service needs the
 * bundler that turns it into the single module its backend imports. A shape
 * library assembles a model and stops.
 */
const isService = (metadata: SmithyProjectMetadata) =>
  metadata.smithyType === 'service';

/**
 * Everything a Smithy build runs, all of it workspace tooling in the root
 * manifest rather than anything the model itself imports.
 *
 * The Smithy CLI is not among them: it is resolved by `mise exec`, which
 * downloads the pinned version on demand. `mise` itself is only added where it
 * has a binary to install — see `utils/smithy.ts`.
 */
export const DEPENDENCIES = declareDependencies<SmithyProjectMetadata>()({
  ts: [
    // Added to the root by `FsCommands` as it builds each command.
    ...ownedElsewhere(FS_DEPENDENCIES),
    { name: 'mise', dev: true, root: true, when: () => !isWindows() },
    { name: 'rolldown', dev: true, root: true, when: isService },
    { name: 'rolldown-plugin-dts', dev: true, root: true, when: isService },
    { name: '@rollup/plugin-esm-shim', dev: true, root: true, when: isService },
    // Resolved by `rolldown-plugin-dts` to emit the bundled declaration.
    { name: 'typescript', dev: true, root: true, when: isService },
  ],
});

export const SMITHY_PROJECT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Where the Smithy CLI writes its artifacts, and where the build publishes the
 * ones consumers read. Both sit under `dist` so a build writes nothing into the
 * project, keeping the source tree clean and the target's outputs cacheable.
 *
 * The CLI's own output is kept beside the published tree rather than inside it:
 * it holds the generated SSDK package and its installed `node_modules`, which
 * must not be mistaken for a build artifact.
 */
const SMITHY_OUT_DIR = 'dist/{projectRoot}/smithy';
const BUILD_DIR = 'dist/{projectRoot}/build';

/** The projection every generated `smithy-build.json` builds. */
const SOURCE_PROJECTION = `${SMITHY_OUT_DIR}/source`;

/** Where the generated TypeScript Server SDK lands before it is bundled. */
const SSDK_CODEGEN_DIR = `${SOURCE_PROJECTION}/typescript-ssdk-codegen`;

/**
 * The commands that build a Smithy project, run from the workspace root.
 *
 * A shape library assembles its model and stops there. A service additionally
 * bundles the generated TypeScript Server SDK into a single module its consumer
 * imports, which needs the SSDK's own dependencies installed first — they are
 * pinned by the generated package the codegen writes, so they are installed into
 * the `dist` tree rather than the workspace.
 */
export const smithyCompileCommands = (
  cmd: FsCommands<typeof DEPENDENCIES>,
  type: SmithyProjectGeneratorSchema['type'],
): string[] => {
  const smithy = smithyCliCommand();
  const commands = [
    cmd.rm(BUILD_DIR),
    cmd.rm(SMITHY_OUT_DIR),
    cmd.mkdir(BUILD_DIR),
    // `imports` in smithy-build.json resolve relative to that file, so a shape
    // library is referenced by its path from the consuming project.
    `${smithy} build -c {projectRoot}/smithy-build.json --output ${SMITHY_OUT_DIR}`,
  ];

  if (type === 'shapes') {
    return [
      ...commands,
      cmd.cp(
        `${SOURCE_PROJECTION}/model/model.json`,
        `${BUILD_DIR}/model.json`,
      ),
    ];
  }

  return [
    ...commands,
    // Named after the service shape by the OpenAPI plugin, so it is matched
    // rather than named, and published under a stable name.
    cmd.cpGlobToFile(
      `${SOURCE_PROJECTION}/openapi/*.openapi.json`,
      `${BUILD_DIR}/openapi`,
      'openapi.json',
    ),
    // `npm` regardless of the workspace's package manager: this installs a
    // generated package under `dist` that is not a workspace member, and npm
    // ships with Node so it is always present. It reads the user's `.npmrc`, so a
    // private registry still applies.
    `npm install --prefix ${SSDK_CODEGEN_DIR} --ignore-scripts --no-audit --no-fund`,
    `rolldown -c {projectRoot}/ssdk.rolldown.config.mjs`,
  ];
};

/**
 * Write the rolldown config that bundles a service's generated Server SDK.
 *
 * Shared with the migration moving an existing project off the container build,
 * so a migrated project's config cannot drift from a freshly generated one.
 */
export const writeSsdkBundleConfig = (tree: Tree, projectRoot: string): void =>
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'ssdk-bundle'),
    projectRoot,
    {
      projectRoot,
      relativePathToWorkspaceRoot:
        getRelativePathToRootByDirectory(projectRoot),
    },
    // Generated configuration rather than anything the user edits, so a re-run
    // refreshes it — unlike the models beside it.
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

export const smithyProjectGenerator = async (
  tree: Tree,
  options: SmithyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const cmd = new FsCommands(tree, DEPENDENCIES);
  const type = options.type ?? 'service';

  warnIfSmithyMissing();

  // Create project.json
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, options);

  if (!projectExists(tree, fullyQualifiedName)) {
    addProjectConfiguration(tree, fullyQualifiedName, {
      name: fullyQualifiedName,
      root: dir,
      sourceRoot: joinPathFragments(dir, 'src'),
      projectType: 'library',
      targets: {
        build: {
          dependsOn: ['compile'],
        },
        compile: {
          cache: true,
          outputs: ['{workspaceRoot}/dist/{projectRoot}/build'],
          executor: 'nx:run-commands',
          options: {
            commands: smithyCompileCommands(cmd, type),
            parallel: false,
            cwd: '{workspaceRoot}',
          },
        },
      },
    });
  }

  const serviceName = options.serviceName ?? options.name;
  const serviceNameClassName = toClassName(serviceName);
  const serviceNameKebabCase = toKebabCase(serviceName);
  const scope = getNpmScope(tree);
  const namespace = options.namespace ?? toKebabCase(scope).replace(/-/g, '.');

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', type),
    dir,
    {
      namespace,
      serviceNameClassName,
      serviceNameKebabCase,
      scope,
      projectRoot: dir,
      relativePathToWorkspaceRoot: getRelativePathToRootByDirectory(dir),
      ...smithyMavenVersions(),
    },
    {
      // Smithy models are user-owned — a re-run must not discard edits
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  if (type === 'service') {
    writeSsdkBundleConfig(tree, dir);
  }

  // Recorded here and read by the declaration's predicates, so the packages
  // added below are exactly the ones the version sync will own.
  const metadata: SmithyProjectMetadata = { smithyType: type, namespace };

  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    SMITHY_PROJECT_GENERATOR_INFO,
    {
      ...metadata,
      ...(type === 'service' ? { apiName: options.name } : {}),
    },
  );

  // No projectRoot: a Smithy model project has no manifest of its own, and every
  // dependency here is workspace tooling the build runs rather than anything the
  // model imports.
  addTsDependencies(tree, DEPENDENCIES, { metadata });

  await addGeneratorMetricsIfApplicable(tree, [SMITHY_PROJECT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default smithyProjectGenerator;
