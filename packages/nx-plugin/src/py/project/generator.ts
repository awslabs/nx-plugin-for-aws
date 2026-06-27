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
import { normalizeDistributionName, toSnakeCase } from '../../utils/names';
import { sortObjectKeys } from '../../utils/object';
import { updateGitIgnore } from '../../utils/git';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { updateToml } from '../../utils/toml';
import { addDependenciesToDependencyGroupInPyProjectToml } from '../../utils/py';
import type { UVPyprojectToml } from '../../utils/nxlv-python';

export const PY_PROJECT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export interface PyProjectDetails {
  /**
   * Fully qualified Nx project id including scope, in dot notation (eg foo.bar).
   * This is the identifier Nx uses (readProjectConfiguration, the project
   * graph, target references) and is intentionally kept dotted.
   */
  readonly fullyQualifiedName: string;
  /**
   * PEP 503 normalised Python distribution name (eg foo-bar). This is the name
   * written to the project's `[project].name`, the root `[tool.uv.sources]`
   * key, and any inter-project dependency string. It is hyphenated (not dotted)
   * so `uv` and `@nxlv/python` can match it: uv writes `uv.lock` keyed by the
   * PEP 503 hyphenated name, and `@nxlv/python`'s dependency inference splits a
   * dotted name on `.` and so would otherwise drop the edge entirely. Keeping
   * the distribution name decoupled from `fullyQualifiedName` is what lets the
   * workspace dependency edge appear in the Nx project graph.
   */
  readonly distributionName: string;
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
  schema: {
    name: string;
    directory?: string;
    subDirectory?: string;
    moduleName?: string;
  },
): PyProjectDetails => {
  const scope = toSnakeCase(getNpmScope(tree));
  const normalizedName = toSnakeCase(schema.name);
  const normalizedModuleName = toSnakeCase(
    schema.moduleName ?? `${scope}_${normalizedName}`,
  );
  const fullyQualifiedName = `${scope}.${normalizedName}`;
  // The Python distribution name is the PEP 503 normalised form of the
  // fully qualified name: hyphenated, never dotted. See PyProjectDetails.
  const distributionName = normalizeDistributionName(fullyQualifiedName);
  // NB: interactive nx generator cli can pass empty string
  const dir = joinPathFragments(
    schema.directory || '.',
    schema.subDirectory || normalizedName,
  );
  return { dir, fullyQualifiedName, distributionName, normalizedModuleName };
};

/**
 * Generates a Python project
 */
export const pyProjectGenerator = async (
  tree: Tree,
  schema: PyProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const { dir, normalizedModuleName, fullyQualifiedName, distributionName } =
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
  }

  updateNxJson(tree, nxJson);

  if (!tree.exists('uv.lock')) {
    await migrateToSharedVenvGenerator(tree, {
      autoActivate: true,
      packageManager: 'uv',
      moveDevDependencies: false,
      pyenvPythonVersion: '3.14.0',
      pyprojectPythonDependency: '>=3.14',
    });
  }

  await uvProjectGenerator(tree, {
    // The Nx project id (and `uv.workspace.members` etc.) keys off `name`, so
    // keep it dotted. `packageName` is the separate PEP 503 distribution name
    // written to `[project].name` and the root `[tool.uv.sources]` key; it is
    // hyphenated so `@nxlv/python` infers the workspace dependency edge (it
    // splits a dotted name on `.` and would otherwise drop it). This split is
    // the whole fix (see PyProjectDetails.distributionName).
    name: fullyQualifiedName,
    packageName: distributionName,
    publishable: false,
    buildLockedVersions: true,
    buildBundleLocalDependencies: true,
    linter: 'ruff',
    rootPyprojectDependencyGroup: 'main',
    pyenvPythonVersion: '3.14.0',
    pyprojectPythonDependency: '>=3.14',
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

  // Remove generated hello.py and test_hello.py as they are not needed
  [
    joinPathFragments(dir, normalizedModuleName, 'hello.py'),
    joinPathFragments(dir, 'tests', 'test_hello.py'),
  ].forEach((f) => tree.delete(f));

  // Add a placeholder test so pytest doesn't fail with "no tests collected"
  tree.write(
    joinPathFragments(dir, 'tests', 'test_noop.py'),
    'def test_noop():\n    pass\n',
  );

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
    inputs: ['default', '^production'],
    outputs: [buildOutputPath],
    options: {
      ...buildTarget.options,
      outputPath: buildOutputPath,
    },
  };
  projectConfiguration.targets.typecheck = {
    cache: true,
    inputs: ['default', '^production'],
    executor: '@nxlv/python:run-commands',
    options: {
      command: 'uv run ty check',
      cwd: '{projectRoot}',
    },
  };
  projectConfiguration.targets.build = {
    inputs: ['default', '^production'],
    dependsOn: [
      'lint',
      'compile',
      'test',
      'typecheck',
      ...(buildTarget.dependsOn ?? []),
    ],
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

  addDependenciesToDependencyGroupInPyProjectToml(tree, '.', 'dev', ['ty']);

  // Add a dependency on the format target for lint in order to reduce the number of
  // fixable lint errors (eg line too long)
  projectConfiguration.targets.lint = {
    ...projectConfiguration.targets.lint,
    cache: true,
    inputs: ['default', '^production'],
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
