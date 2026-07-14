/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  type GeneratorCallback,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import tsProjectGenerator from '../../ts/lib/generator';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import {
  addDcrProxyInfra,
  DCR_PROXY_HANDLERS,
  type DcrProxyHandler,
} from '../../utils/dcr-proxy-constructs/dcr-proxy-constructs';
import { formatFilesInSubtree } from '../../utils/format';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import {
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import type { TsDcrProxyGeneratorSchema } from './schema';

export const TS_DCR_PROXY_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const tsDcrProxyGenerator = async (
  tree: Tree,
  options: TsDcrProxyGeneratorSchema,
): Promise<GeneratorCallback> => {
  const name = kebabCase(options.name ? options.name : 'dcr-proxy');
  const nameClassName = toClassName(name);

  const iac = await resolveIac(tree, options.iac);

  // The handlers live in a standalone TypeScript project so they can be bundled
  // (rolldown) into deployable artifacts referenced by both CDK and Terraform.
  const namespace = getNpmScopePrefix(tree);
  const proxyProjectName = `${namespace}${name}`;

  let projectExists: boolean;
  try {
    readProjectConfigurationUnqualified(tree, proxyProjectName);
    projectExists = true;
  } catch {
    projectExists = false;
  }

  if (!projectExists) {
    await tsProjectGenerator(tree, {
      name,
      directory: options.directory,
      subDirectory: options.subDirectory,
      preferInstallDependencies: false,
    });
  }

  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    proxyProjectName,
  );
  const proxyRoot = projectConfig.root;

  // Place the Lambda handlers in the project source
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      '..',
      '..',
      'utils',
      'dcr-proxy-constructs',
      'files',
      'project',
    ),
    proxyRoot,
    { nameClassName, nameKebabCase: name },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Bundle each handler independently to dist/<root>/bundle/<handler>/index.js
  for (const handler of DCR_PROXY_HANDLERS) {
    await addTypeScriptBundleTarget(tree, projectConfig, {
      targetFilePath: `src/handlers/${handler}.ts`,
      bundleOutputDir: handler,
      external: [/@aws-sdk\/.*/], // lambda runtime provides the aws sdk
      platform: 'node',
    });
  }

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  const bundlePathsFromRoot = Object.fromEntries(
    DCR_PROXY_HANDLERS.map((handler) => [
      handler,
      joinPathFragments('dist', proxyRoot, 'bundle', handler),
    ]),
  ) as Record<DcrProxyHandler, string>;

  await sharedConstructsGenerator(tree, { iac });

  await addDcrProxyInfra(tree, {
    dcrProxyNameClassName: nameClassName,
    dcrProxyNameKebabCase: name,
    proxyProjectName,
    bundlePathsFromRoot,
    iac,
  });

  await addGeneratorMetricsIfApplicable(tree, [TS_DCR_PROXY_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsDcrProxyGenerator;
