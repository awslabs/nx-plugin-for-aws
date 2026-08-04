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
import { resolveContainers } from '../../utils/containers';
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
import { type ITsDepVersion, TS_VERSIONS } from '../../utils/versions';
import type { SmithyProjectGeneratorSchema } from './schema';

/**
 * Packages `build.Dockerfile` installs into the build image to bundle the Smithy
 * SSDK. Pinned in the file body rather than declared in a manifest, so declaring
 * them here — never installed into the workspace — is what keeps the version sync
 * moving them forward.
 */
export const SSDK_BUNDLE_DEPENDENCIES = [
  { name: 'rolldown' },
  { name: 'rolldown-plugin-dts' },
  { name: '@rollup/plugin-esm-shim' },
] as const satisfies readonly { name: ITsDepVersion }[];

export const DEPENDENCIES = declareDependencies()({
  ts: [...FS_DEPENDENCIES, ...ownedElsewhere(SSDK_BUNDLE_DEPENDENCIES)],
});

export const SMITHY_PROJECT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const smithyProjectGenerator = async (
  tree: Tree,
  options: SmithyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const cmd = new FsCommands(tree, DEPENDENCIES);
  const containers = await resolveContainers(tree, 'inherit');
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
          dependsOn: ['compile'],
        },
        compile: {
          cache: true,
          outputs: ['{workspaceRoot}/dist/{projectRoot}/build'],
          executor: 'nx:run-commands',
          options: {
            commands: [
              cmd.rm('dist/{projectRoot}/build'),
              cmd.mkdir('dist/{projectRoot}/build'),
              // The workspace build context lets a project's Dockerfile copy in
              // the built models of shape libraries it depends on. Commands run
              // from the workspace root, so it is the current directory.
              `${containers} build -f {projectRoot}/build.Dockerfile --build-context workspace=. --target export --output type=local,dest=dist/{projectRoot}/build {projectRoot}`,
            ],
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
      rolldownVersion: TS_VERSIONS.rolldown,
      rolldownDtsVersion: TS_VERSIONS['rolldown-plugin-dts'],
      esmShimVersion: TS_VERSIONS['@rollup/plugin-esm-shim'],
    },
    {
      // Smithy models are user-owned — a re-run must not discard edits
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    SMITHY_PROJECT_GENERATOR_INFO,
    {
      smithyType: type,
      namespace,
      ...(type === 'service' ? { apiName: options.name } : {}),
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [SMITHY_PROJECT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default smithyProjectGenerator;
