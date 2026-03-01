/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  ensurePackage,
  GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  readNxJson,
  readProjectConfiguration,
  Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyProjectGeneratorSchema } from './schema';
import {
  migrateToSharedVenvGenerator,
  uvProjectGenerator,
  UVProvider,
  Logger,
} from '../../utils/nxlv-python';
import { withVersions } from '../../utils/versions';
import { getNpmScope } from '../../utils/npm-scope';
import { toSnakeCase } from '../../utils/names';
import { sortObjectKeys } from '../../utils/object';
import { updateGitIgnore } from '../../utils/git';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { updateToml } from '../../utils/toml';
import type { UVPyprojectToml } from '../../utils/nxlv-python';

export const PY_PROJECT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export interface PyProjectDetails {
  /**
   * Full package name including scope (eg foo.bar)
   */
  readonly fullyQualifiedName: string;
  /**
   * Directory of the library relative to the root
   */
  readonly dir: string;
  /**
   * Module name for the project
   */
  readonly normalizedModuleName: string;
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
  const normalizedModuleName = toSnakeCase(
    schema.moduleName ?? `${scope}_${normalizedName}`,
  );
  const fullyQualifiedName = `${scope}.${normalizedName}`;
  const dir = joinPathFragments(schema.directory ?? '.', normalizedName);
  return { dir, fullyQualifiedName, normalizedModuleName };
};

/**
 * Generates a Python project
 */
export const pyProjectGenerator = async (
  tree: Tree,
  schema: PyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const { dir, normalizedModuleName, fullyQualifiedName } = getPyProjectDetails(
    tree,
    schema,
  );

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
  }

  updateNxJson(tree, nxJson);

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
    name: fullyQualifiedName,
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
    buildSystem: 'hatch',
    srcDir: false,
  });

  const outputPath = '{workspaceRoot}/dist/{projectRoot}';
  const buildOutputPath = joinPathFragments(outputPath, 'build');
  const projectConfiguration = readProjectConfiguration(
    tree,
    fullyQualifiedName,
  );
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

  // Set the default line length to 120, as 88 is a little too strict
  updateToml(
    tree,
    joinPathFragments(dir, 'pyproject.toml'),
    (pyProjectToml: UVPyprojectToml) => {
      if ((pyProjectToml.tool as any)?.ruff) {
        (pyProjectToml.tool as any).ruff['line-length'] = 120;
      }
      return pyProjectToml;
    },
  );

  // Add a dependency on the format target for lint in order to reduce the number of
  // fixable lint errors (eg line too long)
  projectConfiguration.targets.lint = {
    ...projectConfiguration.targets.lint,
    cache: true,
    dependsOn: [
      ...(projectConfiguration.targets.lint?.dependsOn ?? []).filter(
        (d) => d !== 'format',
      ),
      'format',
    ],
    configurations: {
      ...projectConfiguration.targets.lint?.configurations,
      fix: {
        fix: true,
      },
      'skip-lint': {
        exitZero: true,
      },
    },
  };

  projectConfiguration.targets = sortObjectKeys(projectConfiguration.targets);
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);

  addGeneratorMetadata(tree, fullyQualifiedName, PY_PROJECT_GENERATOR_INFO);

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
    installPackagesTask(tree);
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};
export default pyProjectGenerator;
