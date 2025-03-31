/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  ProjectConfiguration,
  readProjectConfiguration,
  Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { LambdaHandlerProjectGeneratorSchema } from './schema';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import { parse, stringify } from '@iarna/toml';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { toClassName, toKebabCase, toSnakeCase } from '../../utils/names';
import { addStarExport } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { addLambdaHandler } from '../../utils/lambda-handler';
import { sortObjectKeys } from '../../utils/object';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const LAMBDA_HANDLER_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

console.log('LAMBDA_HANDLER_GENERATOR_INFO', LAMBDA_HANDLER_GENERATOR_INFO);

/**
 * Generates a Python Lambda Handler project
 */
export const lambdaHandlerProjectGenerator = async (
  tree: Tree,
  schema: LambdaHandlerProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  await sharedConstructsGenerator(tree);

  const { dir, normalizedName, normalizedModuleName, fullyQualifiedName } =
    getPyProjectDetails(tree, {
      name: schema.name,
      directory: schema.directory,
    });

  const lambdaHandlerClassName = toClassName(schema.name);
  const lambdaHandlerKebabCase = toKebabCase(schema.name);
  const lambdaHandlerSnakeCase = toSnakeCase(schema.name);
  const enhancedOptions = {
    ...schema,
    dir,
    lambdaHandlerClassName,
    lambdaHandlerKebabCase,
    lambdaHandlerSnakeCase,
  };

  await pyProjectGenerator(tree, {
    name: normalizedName,
    directory: schema.directory,
    moduleName: normalizedModuleName,
    projectType: 'application',
  });

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);

  projectConfig.targets.bundle = {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${dir}/bundle`],
    options: {
      commands: [
        `uv export --frozen --no-dev --no-editable --project ${normalizedName} -o dist/${dir}/bundle/requirements.txt`,
        `uv pip install -n --no-installer-metadata --no-compile-bytecode --python-platform x86_64-manylinux2014 --target dist/${dir}/bundle -r dist/${dir}/bundle/requirements.txt`,
      ],
      parallel: false,
    },
    dependsOn: ['compile'],
  };
  projectConfig.targets.build.dependsOn = [
    ...(projectConfig.targets.build.dependsOn ?? []),
    'bundle',
  ];

  projectConfig.metadata = {
    handlerName: schema.name,
  } as any;

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, normalizedName, projectConfig);

  [
    joinPathFragments(dir, normalizedModuleName ?? normalizedName, 'hello.py'),
    joinPathFragments(dir, 'tests', 'test_hello.py'),
  ].forEach((f) => tree.delete(f));

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files', 'app'), // path to the file templates
    dir, // destination path of the files
    {
      name: normalizedName,
      lambdaHandlerClassName,
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  if (
    !tree.exists(
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'lambda-handlers',
        `${lambdaHandlerKebabCase}.ts`,
      ),
    )
  ) {
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        'files',
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
      ),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app'),
      enhancedOptions,
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );

    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'index.ts',
      ),
      './lambda-handlers/index.js',
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'lambda-handlers',
        'index.ts',
      ),
      `./${lambdaHandlerKebabCase}.js`,
    );
  }

  addLambdaHandler(tree, lambdaHandlerKebabCase);

  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      if (!config.targets) {
        config.targets = {};
      }
      if (!config.targets.build) {
        config.targets.build = {};
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        `${fullyQualifiedName}:build`,
      ];
      return config;
    },
  );

  const projectToml = parse(
    tree.read(joinPathFragments(dir, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;
  projectToml.project.dependencies = [
    'aws-lambda-powertools',
    'aws-lambda-powertools[tracer]',
  ].concat(projectToml.project?.dependencies || []);
  tree.write(joinPathFragments(dir, 'pyproject.toml'), stringify(projectToml));

  await addGeneratorMetricsIfApplicable(tree, [LAMBDA_HANDLER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return async () => {
    await new UVProvider(tree.root, new Logger(), tree).install();
    installPackagesTask(tree);
  };
};
export default lambdaHandlerProjectGenerator;
