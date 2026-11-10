/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { FsCommands } from '../../../utils/fs.js';
import {
  GREENGRASS_PLATFORM_MAPPINGS,
  RECIPE_FORMAT_VERSION,
} from '../../../utils/greengrass/constants.js';
import { toSnakeCase } from '../../../utils/names.js';
import {
  addArtifactDependencyToTargets,
  normalizeTargetKeyOrder,
} from '../../../utils/nx.js';
import { sortObjectKeys } from '../../../utils/object.js';
import { toProjectRelativePath } from '../../../utils/paths.js';
import { sharedGreengrassScriptsGenerator } from '../../../utils/shared-greengrass-scripts.js';
import { tryReadToml } from '../../../utils/toml.js';
import { LAMBDA_RUNTIME_VERSIONS } from '../../../utils/versions.js';
import type { NormalizedComponent } from '../common.js';
import {
  assertUnchangedPlatform,
  finalizeComponent,
  GREENGRASS_SCRIPTS_DIR,
  sharedComponentTargets,
} from '../common.js';
import { PY_DEPENDENCIES as DEPENDENCIES } from '../dependencies.js';

/**
 * The lowest Python `major.minor` declared by `[project].requires-python`
 * (eg "3.14" from ">=3.14"), so vendoring targets the device's own floor
 * rather than the Lambda runtime `addPythonBundleTarget` pins. Falls back to
 * the plugin's Lambda Python floor only when the project declares none.
 */
const pythonVersionFloor = (requiresPython: unknown): string => {
  if (typeof requiresPython === 'string') {
    let min: { major: number; minor: number } | undefined;
    for (const match of requiresPython.matchAll(/(\d+)\.(\d+)/g)) {
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (
        !min ||
        major < min.major ||
        (major === min.major && minor < min.minor)
      ) {
        min = { major, minor };
      }
    }
    if (min) {
      return `${min.major}.${min.minor}`;
    }
  }
  return LAMBDA_RUNTIME_VERSIONS.python;
};

/**
 * Generates an AWS IoT Greengrass v2 component on an existing Python project:
 * packaging and local-deployment targets (`<c>-vendor`, `<c>-artifact`,
 * `<c>-deploy-local`, `<c>-logs`), plus, unless `--infra none`, a
 * `GreengrassComponentVersion` CDK construct (or Terraform module, via the
 * `hashicorp/awscc` provider) that publishes the built artifact.
 */
export const pythonGreengrassComponentGenerator = async (
  tree: Tree,
  component: NormalizedComponent,
): Promise<GeneratorCallback> => {
  const { project: projectConfig, options } = component;

  const componentDirName = component.componentDirName;
  const componentSnakeCase = toSnakeCase(options.name);
  const componentName = component.componentName;
  const componentVersion = component.componentVersion;
  const publisher = component.publisher;
  const ipc = component.ipc;
  const gdkConfig = component.gdkConfig;
  const platforms = component.platforms;
  const isMultiPlatform = platforms.length > 1;
  const distDir = `dist/{projectRoot}/greengrass/${componentDirName}`;
  const distDirVendor = `${distDir}/vendor`;
  // One entry per recipe manifest. Every per-architecture name - the vendor
  // subdirectory, the zip base name and the manifest `architecture` value -
  // is derived from the SAME mapping entry, so they cannot drift apart.
  const manifests = platforms.map((p) => {
    const { uvPlatform, manifestPlatform } = GREENGRASS_PLATFORM_MAPPINGS[p];
    return {
      uvPlatform,
      os: manifestPlatform.os,
      architecture: manifestPlatform.architecture,
      // Single-platform names stay flat: `<c>.zip` and `vendor/`.
      artifactBaseName: isMultiPlatform
        ? `${componentDirName}-${manifestPlatform.architecture}`
        : componentDirName,
      vendorDir: isMultiPlatform
        ? `${distDirVendor}/${manifestPlatform.architecture}`
        : distDirVendor,
    };
  });

  const pyProjectPath = joinPathFragments(projectConfig.root, 'pyproject.toml');
  const pyproject = tryReadToml(tree, pyProjectPath) as unknown as
    | { project?: { 'requires-python'?: unknown } }
    | undefined;
  const pythonFloor = pythonVersionFloor(
    pyproject?.project?.['requires-python'],
  );

  const componentDir = joinPathFragments(
    projectConfig.root,
    'greengrass',
    componentDirName,
  );
  const mainPath = joinPathFragments(componentDir, 'main.py');
  const gdkConfigPath = joinPathFragments(componentDir, 'gdk-config.json');
  // Flat under tests/greengrass/, one file per component: pytest imports a test
  // module by basename, so two components sharing a `test_main.py` basename in
  // sibling directories would collide.
  const testDir = joinPathFragments(projectConfig.root, 'tests', 'greengrass');

  const manifestPreview = manifests
    .map(
      (m) =>
        `  - Platform:\n      os: ${m.os}\n      architecture: ${m.architecture}\n    Artifacts:\n      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/${m.artifactBaseName}.zip\n        Unarchive: ZIP\n    Lifecycle:\n      Run: python${pythonFloor} {artifacts:decompressedPath}/${m.artifactBaseName}/main.py`,
    )
    .join('\n');
  assertUnchangedPlatform(component, manifestPreview);

  const templateOptions = {
    componentName,
    // Named `version` / `recipeFormat`, not `componentVersion` /
    // `recipeFormatVersion`: a `*Version` template variable is how a template
    // names a vended dependency pin (see `VENDED_TEMPLATE_VARS` in
    // `version-upgrade-migration/real-templates.spec.ts`), which neither a
    // user-owned option nor a fixed protocol constant is.
    version: componentVersion,
    recipeFormat: RECIPE_FORMAT_VERSION,
    componentDescription: `${componentName} Greengrass component using Python ${pythonFloor}, generated by greengrass#component.`,
    publisher,
    ipc,
    manifests,
    // The recipe Run command pins the same interpreter the wheels were
    // vendored for; a bare `python3` can resolve to an older device default
    // whose ABI the vendored native wheels do not support.
    pythonFloor,
    componentDirName,
    componentSnakeCase,
    project: projectConfig.name,
  };

  // recipe.yaml and main.py are user-owned from first generation onward.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'component'),
    componentDir,
    templateOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (gdkConfig) {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'gdk'),
      componentDir,
      templateOptions,
      { overwriteStrategy: OverwriteStrategy.Overwrite },
    );
  } else if (tree.exists(gdkConfigPath)) {
    tree.delete(gdkConfigPath);
    logger.info(`Removed ${gdkConfigPath}; pass --gdkConfig to keep it.`);
  }

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'tests'),
    testDir,
    templateOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await sharedGreengrassScriptsGenerator(tree, DEPENDENCIES);

  const vendorTarget = `${componentDirName}-vendor`;
  const artifactTarget = `${componentDirName}-artifact`;

  projectConfig.targets ??= {};

  const fs = new FsCommands(tree, DEPENDENCIES);

  projectConfig.targets[vendorTarget] = normalizeTargetKeyOrder({
    cache: true,
    // The vendor dir holds only exported dependencies, never test files.
    inputs: ['production', '^production'],
    outputs: [`{workspaceRoot}/${distDirVendor}`],
    executor: 'nx:run-commands',
    dependsOn: ['compile'],
    options: {
      commands: [
        // `uv pip install --target` adds to whatever is already there and
        // never prunes, so without this a dropped dependency - or the other
        // platform's `vendor/<architecture>` directory after a deliberate
        // platform change - would still be packaged into the next artifact.
        // Artifact bytes must depend only on the current source.
        fs.rm(distDirVendor),
        fs.mkdir(distDirVendor),
        `uv export --frozen --no-dev --no-editable --no-emit-project --project {projectRoot} --package ${projectConfig.name} -o ${distDirVendor}/requirements.txt`,
        // `--only-binary :all:` is required: without it an sdist can build a
        // host-architecture binary into a cross-architecture artifact.
        ...manifests.map(
          (m) =>
            `uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --only-binary :all: --python-platform ${m.uvPlatform} --python-version ${pythonFloor} --target ${m.vendorDir} -r ${distDirVendor}/requirements.txt`,
        ),
      ],
      parallel: false,
    },
  });

  projectConfig.targets[artifactTarget] = normalizeTargetKeyOrder({
    cache: true,
    // The vended scripts live outside this project, so the cache key must
    // name them explicitly or a refreshed script serves a stale artifact.
    inputs: [
      'production',
      '^production',
      `{workspaceRoot}/${GREENGRASS_SCRIPTS_DIR}/**/*`,
    ],
    outputs: [`{workspaceRoot}/${distDir}/greengrass-build`],
    executor: 'nx:run-commands',
    dependsOn: [vendorTarget],
    options: {
      command: `tsx ${GREENGRASS_SCRIPTS_DIR}/build-artifact.ts {projectRoot} ${componentDirName} ${distDir}${
        isMultiPlatform
          ? ` --platforms=${manifests.map((m) => m.architecture).join(',')}`
          : ''
      }`,
    },
  });
  addArtifactDependencyToTargets(projectConfig, artifactTarget);

  Object.assign(
    projectConfig.targets,
    sharedComponentTargets({
      artifactTarget,
      componentDirName,
      componentName,
      distDir,
    }),
  );

  // py#project and ts#project sort targets on every run, including re-runs,
  // so append in the same order or a later project re-run reorders the file.
  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  return finalizeComponent(
    tree,
    component,
    joinPathFragments(toProjectRelativePath(projectConfig, mainPath)),
    DEPENDENCIES,
  );
};

export default pythonGreengrassComponentGenerator;
