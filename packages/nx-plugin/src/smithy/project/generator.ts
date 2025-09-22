/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  Tree,
  addProjectConfiguration,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
} from '@nx/devkit';
import { SmithyProjectGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { getTsLibDetails } from '../../ts/lib/generator';
import { toClassName, toKebabCase } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import { FsCommands } from '../../utils/fs';

export const SMITHY_PROJECT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const smithyProjectGenerator = async (
  tree: Tree,
  options: SmithyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const cmd = new FsCommands(tree);

  // Create project.json
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, options);
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
            cmd.rm(`dist/${dir}/build`),
            cmd.mkdir(`dist/${dir}/build`),
            `docker build -f ${dir}/build.Dockerfile --target export --output type=local,dest=dist/${dir}/build ${dir}`,
          ],
          parallel: false,
          cwd: '{workspaceRoot}',
        },
      },
    },
  });

  const serviceName = options.serviceName ?? options.name;
  const serviceNameClassName = toClassName(serviceName);
  const serviceNameKebabCase = toKebabCase(serviceName);
  const scope = getNpmScope(tree);
  const namespace = options.namespace ?? toKebabCase(scope).replace(/-/g, '.');

  generateFiles(tree, joinPathFragments(__dirname, 'files'), dir, {
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
  return () => {
    installPackagesTask(tree);
  };
};

export default smithyProjectGenerator;
