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
import { PyFastApiProjectGeneratorSchema } from './schema';
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
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addApiGatewayConstruct } from '../../utils/api-constructs/api-constructs';
import { addOpenApiGeneration } from './react/open-api';
import { updateGitIgnore } from '../../utils/git';
import { getLocalServerPortNumber } from '../../utils/port';

export const FAST_API_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

/**
 * Generates a Python FastAPI project
 */
export const pyFastApiProjectGenerator = async (
  tree: Tree,
  schema: PyFastApiProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  await sharedConstructsGenerator(tree);

  const { dir, normalizedName, normalizedModuleName, fullyQualifiedName } =
    getPyProjectDetails(tree, {
      name: schema.name,
      directory: schema.directory,
    });
  const apiNameSnakeCase = toSnakeCase(schema.name);
  const apiNameKebabCase = toKebabCase(schema.name);
  const apiNameClassName = toClassName(schema.name);

  const port = getLocalServerPortNumber(tree, FAST_API_GENERATOR_INFO, 8000);

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
  projectConfig.targets.serve = {
    executor: '@nxlv/python:run-commands',
    options: {
      command: `uv run fastapi dev ${normalizedName}/main.py --port ${port}`,
      cwd: dir,
    },
    continuous: true,
  };

  projectConfig.metadata = {
    apiName: schema.name,
    apiType: 'fast-api',
    auth: schema.auth,
    port,
  } as any;

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, normalizedName, projectConfig);

  // Add OpenAPI spec generation to the project, run as part of build
  const { specPath } = addOpenApiGeneration(tree, { project: projectConfig });

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
      apiNameClassName,
      computeType: schema.computeType,
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  // Add the CDK construct to deploy the FastAPI to shared constructs
  addApiGatewayConstruct(tree, {
    apiNameClassName,
    apiNameKebabCase,
    constructType:
      schema.computeType === 'ServerlessApiGatewayHttpApi' ? 'http' : 'rest',
    backend: {
      type: 'fastapi',
      dir,
      apiNameSnakeCase,
    },
    auth: schema.auth,
  });

  const generatedMetadataDir = joinPathFragments('generated', apiNameKebabCase);
  const generatedMetadataDirFromRoot = joinPathFragments(
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
    'src',
    generatedMetadataDir,
  );

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
      // If not already defined, add a target to generate metadata from the OpenAPI spec, used
      // for providing a type-safe CDK construct
      const metadataTargetName = `generate:${apiNameKebabCase}-metadata`;
      if (!config.targets[metadataTargetName]) {
        config.targets[metadataTargetName] = {
          cache: true,
          executor: 'nx:run-commands',
          inputs: [
            {
              dependentTasksOutputFiles: '**/*.json',
            },
          ],
          outputs: [
            joinPathFragments('{workspaceRoot}', generatedMetadataDirFromRoot),
          ],
          options: {
            commands: [
              `nx g @aws/nx-plugin:open-api#ts-metadata --openApiSpecPath="${specPath}" --outputPath="${generatedMetadataDirFromRoot}" --no-interactive`,
            ],
          },
          dependsOn: [`${projectConfig.name}:openapi`],
        };
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        `${fullyQualifiedName}:build`,
      ];
      if (!config.targets.compile) {
        config.targets.compile = {};
      }
      config.targets.compile.dependsOn = [
        ...(config.targets.compile.dependsOn ?? []),
        metadataTargetName,
      ];
      return config;
    },
  );

  // Ignore the generated metadata by default
  // Users can safely remove the entry from the .gitignore if they prefer to check it in
  updateGitIgnore(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
    (patterns) => [...patterns, joinPathFragments('src', generatedMetadataDir)],
  );

  const projectToml = parse(
    tree.read(joinPathFragments(dir, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;
  projectToml.project.dependencies = [
    'fastapi',
    'mangum',
    'aws-lambda-powertools',
    'aws-lambda-powertools[tracer]',
  ].concat(projectToml.project?.dependencies || []);
  projectToml['dependency-groups'] = { dev: ['fastapi[standard]>=0.115'] };
  tree.write(joinPathFragments(dir, 'pyproject.toml'), stringify(projectToml));

  addGeneratorMetadata(tree, normalizedName, FAST_API_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [FAST_API_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return async () => {
    await new UVProvider(tree.root, new Logger(), tree).install();
    installPackagesTask(tree);
  };
};
export default pyFastApiProjectGenerator;
