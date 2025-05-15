/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  ensurePackage,
  GeneratorCallback,
  joinPathFragments,
  readNxJson,
  readProjectConfiguration,
  Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyProjectGeneratorSchema } from './schema';
import migrateToSharedVenvGenerator from '@nxlv/python/src/generators/migrate-to-shared-venv/generator';
import uvProjectGenerator from '@nxlv/python/src/generators/uv-project/generator';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import { withVersions } from '../../utils/versions';
import { getNpmScope } from '../../utils/npm-scope';
import { toSnakeCase } from '../../utils/names';
import { sortObjectKeys } from '../../utils/object';
import { updateGitIgnore } from '../../utils/git';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const PY_PROJECT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export interface PyProjectDetails {
  readonly normalizedName: string;
  /**
   * Full package name including scope (eg foo.bar)
   */
  readonly fullyQualifiedName: string;
  /**
   * Directory of the library relative to the root
   */
  readonly dir: string;

  readonly normalizedModuleName?: string;
}

/**
 * Returns details about the Python project to be created
 */
export const getPyProjectDetails = (
  tree: Tree,
  schema: { name: string; directory?: string; moduleName?: string },
): PyProjectDetails => {
  const scope = toSnakeCase(getNpmScope(tree));
  const normalizedName = toSnakeCase(schema.name);
  const normalizedModuleName = toSnakeCase(schema.moduleName);
  const fullyQualifiedName = `${scope}.${normalizedName}`;
  const dir = joinPathFragments(
    toSnakeCase(schema.directory) ?? '.',
    normalizedName,
  );
  return { dir, fullyQualifiedName, normalizedName, normalizedModuleName };
};

/**
 * Generates a Python project
 */
export const pyProjectGenerator = async (
  tree: Tree,
  schema: PyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const { dir, normalizedName, normalizedModuleName, fullyQualifiedName } =
    getPyProjectDetails(tree, schema);

  const pythonPlugin = withVersions(['@nxlv/python']);
  addDependenciesToPackageJson(tree, {}, pythonPlugin);

  Object.entries(pythonPlugin).forEach(([name, version]) =>
    ensurePackage(name, version),
  );

  const nxJson = readNxJson(tree);

  if (
    !nxJson.plugins?.find((p) =>
      typeof p === 'string'
        ? p === '@nxlv/python'
        : p.plugin === '@nxlv/python',
    )
  ) {
    nxJson.plugins = [
      ...(nxJson.plugins ?? []),
      {
        plugin: '@nxlv/python',
        options: {
          packageManager: 'uv',
        },
      },
    ];
    updateNxJson(tree, nxJson);
  }

  if (!tree.exists('uv.lock')) {
    await migrateToSharedVenvGenerator(tree, {
      autoActivate: true,
      packageManager: 'uv',
      moveDevDependencies: false,
      pyenvPythonVersion: '3.12.0',
      pyprojectPythonDependency: '>=3.12',
    });
  }

  await uvProjectGenerator(tree, {
    name: normalizedName,
    publishable: false,
    buildLockedVersions: true,
    buildBundleLocalDependencies: true,
    linter: 'ruff',
    rootPyprojectDependencyGroup: 'main',
    pyenvPythonVersion: '3.12.0',
    pyprojectPythonDependency: '>=3.12',
    projectType: schema.projectType,
    projectNameAndRootFormat: 'as-provided',
    moduleName: normalizedModuleName,
    directory: dir,
    unitTestRunner: 'pytest',
    codeCoverage: true,
    codeCoverageHtmlReport: true,
    codeCoverageXmlReport: true,
    unitTestHtmlReport: true,
    unitTestJUnitReport: true,
  });

  const outputPath = `{workspaceRoot}/dist/${dir}`;
  const buildOutputPath = joinPathFragments(outputPath, 'build');
  const projectConfiguration = readProjectConfiguration(tree, normalizedName);
  projectConfiguration.name = fullyQualifiedName;
  const buildTarget = projectConfiguration.targets.build;
  projectConfiguration.targets.compile = {
    ...buildTarget,
    outputs: [buildOutputPath],
    options: {
      ...buildTarget.options,
      outputPath: buildOutputPath,
    },
  };
  projectConfiguration.targets.build = {
    dependsOn: ['lint', 'compile', 'test', ...(buildTarget.dependsOn ?? [])],
    options: {
      outputPath,
    },
  };
  projectConfiguration.targets = sortObjectKeys(projectConfiguration.targets);
  updateProjectConfiguration(tree, normalizedName, projectConfiguration);

  // Update root .gitignore
  updateGitIgnore(tree, '.', (patterns) => [...patterns, '/reports']);

  // Update project level .gitignore
  updateGitIgnore(tree, dir, (patterns) => [
    ...patterns,
    '**/__pycache__',
    '.coverage',
  ]);

  await addGeneratorMetricsIfApplicable(tree, [PY_PROJECT_GENERATOR_INFO]);

  return async () => {
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};
export default pyProjectGenerator;
