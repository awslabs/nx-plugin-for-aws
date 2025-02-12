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
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { FastApiProjectGeneratorSchema } from './schema';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import { parse, stringify } from '@iarna/toml';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { toClassName, toKebabCase, toSnakeCase } from '../../utils/names';
import { addStarExport } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { addHttpApi } from '../../utils/http-api';

/**
 * Generates a Python FastAPI project
 */
export const fastApiProjectGenerator = async (
  tree: Tree,
  schema: FastApiProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  await sharedConstructsGenerator(tree);

  const { dir, normalizedName, normalizedModuleName } = getPyProjectDetails(
    tree,
    {
      name: schema.name,
      directory: schema.directory,
    },
  );
  const apiNameSnakeCase = toSnakeCase(schema.name);
  const apiNameKebabCase = toKebabCase(schema.name);
  const apiNameClassName = toClassName(schema.name);
  const enhancedOptions = {
    ...schema,
    dir,
    apiNameClassName,
    apiNameKebabCase,
    apiNameSnakeCase,
  };

  await pyProjectGenerator(tree, {
    name: normalizedName,
    directory: schema.directory,
    moduleName: normalizedModuleName,
    projectType: 'application',
  });

  const projectConfig = readProjectConfiguration(tree, normalizedName);

  projectConfig.targets.bundle = {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${dir}/bundle`],
    options: {
      commands: [
        `uv export --frozen --no-dev --no-editable --project ${normalizedName} -o dist/${dir}/bundle/requirements.txt`,
        `uv pip install --no-installer-metadata --no-compile-bytecode --python-platform x86_64-manylinux2014 --python 3.12 --target dist/${dir}/bundle/bundle -r dist/${dir}/bundle/requirements.txt`,
        `npx -y --package=cross-zip-cli cross-zip dist/${dir}/bundle/bundle bundle.zip`,
      ],
      parallel: false
    },
    dependsOn: ['compile'],
  };
  projectConfig.targets.build.dependsOn = [...(projectConfig.targets.build.dependsOn ?? []), 'bundle'];
  projectConfig.targets.start = {
    executor: '@nxlv/python:run-commands',
    options: {
      command: `uv run fastapi dev ${normalizedName}/main.py`,
      cwd: dir,
    },
  };

  projectConfig.targets = Object.keys(projectConfig.targets)
    .sort()
    .reduce((obj, key) => {
      obj[key] = projectConfig.targets[key];
      return obj;
    }, {});
  updateProjectConfiguration(tree, normalizedName, projectConfig);

  tree.delete(
    joinPathFragments(dir, normalizedModuleName ?? normalizedName, 'hello.py'),
  );

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files', 'app'), // path to the file templates
    dir, // destination path of the files
    {
      name: normalizedName,
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
        'http-apis',
        `${apiNameKebabCase}.ts`,
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
      './http-apis/index.js',
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'http-apis',
        'index.ts',
      ),
      `./${apiNameKebabCase}.js`,
    );
  }

  addHttpApi(tree, apiNameClassName);

  const projectToml = parse(
    tree.read(joinPathFragments(dir, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;
  projectToml.project.dependencies = ['fastapi', 'mangum'].concat(
    projectToml.project?.dependencies || [],
  );
  projectToml['dependency-groups'] = { dev: ['fastapi[standard]>=0.115'] };
  tree.write(joinPathFragments(dir, 'pyproject.toml'), stringify(projectToml));

  await formatFilesInSubtree(tree);

  return async () => {
    await new UVProvider(tree.root, new Logger(), tree).install();
    installPackagesTask(tree);
  };
};
export default fastApiProjectGenerator;
