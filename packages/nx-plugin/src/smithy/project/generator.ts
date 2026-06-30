/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  type Tree,
} from '@nx/devkit';
import { getTsLibDetails } from '../../ts/lib/generator';
import { resolveContainers } from '../../utils/containers';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { installDeps } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { toClassName, toKebabCase } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import type { SmithyProjectGeneratorSchema } from './schema';

export const SMITHY_PROJECT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const smithyProjectGenerator = async (
  tree: Tree,
  options: SmithyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const cmd = new FsCommands(tree);
  const containers = await resolveContainers(tree, 'inherit');

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
              `${containers} build -f {projectRoot}/build.Dockerfile --target export --output type=local,dest=dist/{projectRoot}/build {projectRoot}`,
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

  generateFiles(tree, joinPathFragments(import.meta.dirname, 'files'), dir, {
    namespace,
    serviceNameClassName,
    serviceNameKebabCase,
    scope,
  });

  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    SMITHY_PROJECT_GENERATOR_INFO,
    {
      apiName: options.name,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [SMITHY_PROJECT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => installDeps(tree, options.preferInstallDependencies, {
    languages: ['typescript'],
  });
};

export default smithyProjectGenerator;
