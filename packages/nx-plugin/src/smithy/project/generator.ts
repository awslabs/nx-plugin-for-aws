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
  smithyCliCommand,
  smithyMavenVersions,
  warnIfSmithyMissing,
} from '../../utils/smithy';
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
 * Neither the Smithy CLI nor `mise` is among them: the compile target fetches mise
 * with `npx` and mise resolves the CLI, so neither is a workspace dependency — see
 * `utils/smithy.ts`.
 */
export const DEPENDENCIES = declareDependencies<SmithyProjectMetadata>()({
  ts: [
    // Added to the root by `FsCommands` as it builds each command.
    ...ownedElsewhere(FS_DEPENDENCIES),
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
 * The commands that build a Smithy project's model, run from the workspace root.
 *
 * This is the whole of a shape library's build. A service's Server SDK is built
 * separately by {@link smithyGenerateSsdkCommands}, from the codegen output this
 * leaves under {@link SMITHY_OUT_DIR}.
 */
export const smithyCompileCommands = (
  cmd: FsCommands<typeof DEPENDENCIES>,
  type: SmithyProjectGeneratorSchema['type'],
): string[] => [
  cmd.rm(BUILD_DIR),
  cmd.rm(SMITHY_OUT_DIR),
  cmd.mkdir(BUILD_DIR),
  // `imports` in smithy-build.json resolve relative to that file, so a shape
  // library is referenced by its path from the consuming project.
  `${smithyCliCommand()} build -c {projectRoot}/smithy-build.json --output ${SMITHY_OUT_DIR}`,
  ...(type === 'shapes'
    ? [
        cmd.cp(
          `${SOURCE_PROJECTION}/model/model.json`,
          `${BUILD_DIR}/model.json`,
        ),
      ]
    : [
        // Named after the service shape by the OpenAPI plugin, so it is matched
        // rather than named, and published under a stable name.
        cmd.cpGlobToFile(
          `${SOURCE_PROJECTION}/openapi/*.openapi.json`,
          `${BUILD_DIR}/openapi`,
          'openapi.json',
        ),
      ]),
];

/**
 * The commands that turn a service's generated TypeScript Server SDK into the
 * single module its consumer imports, run from the workspace root.
 *
 * Only a service has one, and it reads what the model build left behind, so this
 * runs after `compile`.
 */
export const smithyGenerateSsdkCommands = (): string[] => [
  // `npm` regardless of the workspace's package manager: this installs a generated
  // package under `dist` that is not a workspace member, and npm ships with Node so
  // it is always present. It reads the user's `.npmrc`, so a private registry still
  // applies. `--include=dev` because the compiler below is among the generated
  // package's devDependencies, which `NODE_ENV=production` would otherwise omit.
  `npm install --prefix ${SSDK_CODEGEN_DIR} --include=dev --ignore-scripts --no-audit --no-fund`,
  // The Server SDK is compiled by its own TypeScript before it is bundled, using
  // the config and compiler the codegen pinned. This keeps the bundler off the
  // sources: the SDK merges an `interface` with a `namespace`, and it also has an
  // import cycle between an operation and its protocol, which together make the
  // namespace's emitted assignment look like a write to an import
  // (ASSIGN_TO_IMPORT) depending on which side of the cycle the bundler enters.
  // `tsc` resolves the merge to a plain local binding, so the cycle stops
  // mattering. `-p` resolves the config's paths relative to itself, so both run
  // from the workspace root.
  //
  // `--noCheck` on both: the codegen's own config already sets it for the JS pass,
  // and the declaration pass needs it too. On a case-insensitive filesystem the
  // operation↔service import cycle makes tsc conflate an imported name with the
  // local declaration it is merged with (TS2440/TS2395); the emit is unaffected —
  // it still writes the same declarations — so the check is skipped rather than
  // relied on, the same way the JS pass does.
  `node ${SSDK_CODEGEN_DIR}/node_modules/typescript/bin/tsc -p ${SSDK_CODEGEN_DIR}/tsconfig.es.json`,
  `node ${SSDK_CODEGEN_DIR}/node_modules/typescript/bin/tsc -p ${SSDK_CODEGEN_DIR}/tsconfig.types.json --noCheck`,
  `rolldown -c {projectRoot}/ssdk.rolldown.config.mjs`,
];

/**
 * What the model build publishes, listed per artifact rather than as the whole
 * `build` directory: a service's `generate-ssdk` writes into that directory too, and
 * restoring `compile` from cache would otherwise discard the Server SDK beside it.
 */
export const smithyCompileOutputs = (
  type: SmithyProjectGeneratorSchema['type'],
): string[] => [
  `{workspaceRoot}/${SMITHY_OUT_DIR}`,
  type === 'shapes'
    ? `{workspaceRoot}/${BUILD_DIR}/model.json`
    : `{workspaceRoot}/${BUILD_DIR}/openapi`,
];

/**
 * The target that builds a service's Server SDK, shared with the migration moving
 * an existing project onto it.
 */
export const smithyGenerateSsdkTarget = () => ({
  cache: true,
  outputs: [`{workspaceRoot}/${BUILD_DIR}/ssdk`],
  executor: 'nx:run-commands',
  dependsOn: ['compile'],
  options: {
    commands: smithyGenerateSsdkCommands(),
    parallel: false,
    cwd: '{workspaceRoot}',
  },
});

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
    // The config's paths are workspace-root relative, so it needs only the
    // project's root — the compile target runs from the workspace root.
    { projectRoot },
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
          dependsOn:
            type === 'shapes' ? ['compile'] : ['compile', 'generate-ssdk'],
        },
        compile: {
          cache: true,
          outputs: smithyCompileOutputs(type),
          executor: 'nx:run-commands',
          options: {
            commands: smithyCompileCommands(cmd, type),
            parallel: false,
            cwd: '{workspaceRoot}',
          },
        },
        // Only a service generates a Server SDK, and it is built from what the
        // model build leaves behind.
        ...(type === 'shapes'
          ? {}
          : { 'generate-ssdk': smithyGenerateSsdkTarget() }),
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

  // On Windows the build runs the Smithy CLI from the PATH rather than through
  // mise, so flag a missing prerequisite while the project is still being set up.
  warnIfSmithyMissing();

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default smithyProjectGenerator;
