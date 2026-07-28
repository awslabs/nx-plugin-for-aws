/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ensurePackage,
  type GeneratorCallback,
  joinPathFragments,
  readNxJson,
  readProjectConfiguration,
  type Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  addLicenseCheckToLintTarget,
  ensurePythonLicenseCollector,
} from '../../license/config';
import { addDependenciesToPackageJson } from '../../utils/dependencies';
import { updateGitIgnore } from '../../utils/git';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { normalizeDistributionName, toSnakeCase } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import {
  migrateToSharedVenvGenerator,
  uvProjectGenerator,
} from '../../utils/nxlv-python';
import { sortObjectKeys } from '../../utils/object';
import { addDependenciesToDependencyGroupInPyProjectToml } from '../../utils/py';
import { updateToml } from '../../utils/toml';
import { withVersions } from '../../utils/versions';
import type { PyProjectGeneratorSchema } from './schema';

export const PY_PROJECT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

// Transient artifacts that pytest, coverage and ruff create and remove while
// the test, typecheck and compile targets run concurrently. `.coverage.*` are
// the per-process data files pytest-cov writes (`.coverage.<host>.<pid>.<rand>`)
// before combining them. Both `ty` (which respects .gitignore) and the
// `@nxlv/python:build` copy (which respects `ignorePaths`) would otherwise fail
// when they read one of these mid-deletion.
const PYTHON_TRANSIENT_ARTIFACTS = [
  '__pycache__',
  '.coverage',
  '.coverage.*',
  '.pytest_cache',
  'pytest-cache-files-*',
  '.ruff_cache',
];

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

  // Only rewrite nx.json when the plugin needs adding, so re-running does not
  // reserialize (and reformat) the file when nothing has changed.
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

  // Only scaffold the project when it does not already exist so re-running with
  // the same name does not throw. The rest of the generator still runs to apply
  // any changed options to the existing project.
  if (!projectExists(tree, fullyQualifiedName)) {
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
      projectType: schema.type,
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
  }

  const outputPath = '{workspaceRoot}/dist/{projectRoot}';
  const buildOutputPath = joinPathFragments(outputPath, 'build');
  const projectConfiguration = readProjectConfiguration(
    tree,
    fullyQualifiedName,
  );
  projectConfiguration.name = fullyQualifiedName;
  // Derive the compile target from the uv build target, and rewrite build to
  // orchestrate the other targets. This only runs on first creation: on re-run
  // build has already been transformed, so re-deriving would corrupt compile
  // and duplicate the build dependencies.
  if (!projectConfiguration.targets.compile) {
    const buildTarget = projectConfiguration.targets.build;
    projectConfiguration.targets.compile = {
      ...buildTarget,
      inputs: ['default', '^production'],
      outputs: [buildOutputPath],
      options: {
        ...buildTarget.options,
        outputPath: buildOutputPath,
        // The build executor copies the project to a temp folder; exclude the
        // executor defaults plus transient artifacts so the copy does not race
        // a concurrent test/typecheck target deleting a file mid-copy.
        ignorePaths: ['.venv', '.tox', 'tests', ...PYTHON_TRANSIENT_ARTIFACTS],
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
  }
  projectConfiguration.targets.typecheck = {
    cache: true,
    inputs: ['default', '^production'],
    executor: '@nxlv/python:run-commands',
    options: {
      command: 'uv run ty check',
      cwd: '{projectRoot}',
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

  // Pin ruff to the version generation-time formatting uses (PY_VERSIONS), so
  // generated files stay `ruff format --check`-clean across ruff releases.
  addDependenciesToDependencyGroupInPyProjectToml(tree, '.', 'dev', [
    'ruff',
    'ty',
  ]);

  // Base format target checks rather than writes (so build/lint don't rewrite
  // source); `fix` writes, and `skip-lint` writes without failing so it stays
  // a no-op when propagated through the lint -> format dependency.
  projectConfiguration.targets.format = {
    ...projectConfiguration.targets.format,
    cache: true,
    inputs: ['default', '^production'],
    options: {
      ...projectConfiguration.targets.format?.options,
      check: true,
    },
    configurations: {
      ...projectConfiguration.targets.format?.configurations,
      fix: {
        check: false,
      },
      'skip-lint': {
        check: false,
      },
    },
  };

  // Add a dependency on the format target for lint in order to reduce the number of
  // fixable lint errors (eg line too long)
  projectConfiguration.targets.lint = {
    ...projectConfiguration.targets.lint,
    cache: true,
    inputs: ['default', '^production'],
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
  // Append `format` without moving an existing entry, so re-running does not
  // reorder lint dependencies (e.g. relative to a later-added license-check).
  addDependencyToTargetIfNotPresent(projectConfiguration, 'lint', 'format');

  projectConfiguration.targets = sortObjectKeys(projectConfiguration.targets);
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);

  addGeneratorMetadata(tree, fullyQualifiedName, PY_PROJECT_GENERATOR_INFO);

  // Update root .gitignore
  updateGitIgnore(tree, '.', (patterns) => [...patterns, '/reports']);

  // Update project level .gitignore. The cache directories are also kept out
  // of type checking: `ty` respects .gitignore, and pytest creates and removes
  // transient `pytest-cache-files-*` directories while the test and typecheck
  // targets run concurrently, which would otherwise make `ty` fail with an I/O
  // error when it scans one mid-deletion.
  updateGitIgnore(tree, dir, (patterns) => [
    ...patterns,
    '**/__pycache__',
    ...PYTHON_TRANSIENT_ARTIFACTS.filter((p) => p !== '__pycache__'),
  ]);

  await addGeneratorMetricsIfApplicable(tree, [PY_PROJECT_GENERATOR_INFO]);

  await ensurePythonLicenseCollector(tree);

  // If license checking is configured, make this project's lint target depend
  // on the root license-check target. No-op if license checking isn't set up;
  // the license generator wires up existing projects itself, so the dependency
  // is added regardless of which generator runs first.
  addLicenseCheckToLintTarget(tree, fullyQualifiedName);

  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};
export default pyProjectGenerator;
