/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  detectPackageManager,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readNxJson,
  type TargetConfiguration,
  type Tree,
  updateJson,
  updateNxJson,
} from '@nx/devkit';
import { join, relative } from 'path';
import { addLicenseCheckToLintTarget } from '../../license/config.js';
import { getTsLibDetails } from '../../ts/lib/generator.js';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { updateGitIgnore } from '../../utils/git.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase } from '../../utils/names.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx.js';
import { sortObjectKeys } from '../../utils/object.js';
import { uvxCommand } from '../../utils/py.js';
import { sharedConstructsGenerator } from '../../utils/shared-constructs.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  SHARED_TERRAFORM_DIR,
  SHARED_TERRAFORM_NAME,
} from '../../utils/shared-constructs-constants.js';
import {
  terraformProviderVersions,
  withVersions,
} from '../../utils/versions.js';
import type { TerraformProjectGeneratorSchema } from './schema';

// Terraform projects carry no package.json, so their build tooling and the AWS
// SDK the vended deploy scripts import are declared at the workspace root. This
// generator records no metadata, so nothing a predicate could read.
export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: '@nx-extend/terraform', dev: true, root: true },
    { name: 'shx', dev: true, root: true },
    { name: 'tsx', dev: true, root: true },
    { name: '@aws-sdk/client-s3', dev: true, root: true },
    { name: '@aws-sdk/client-sts', dev: true, root: true },
    { name: '@aws-sdk/credential-providers', dev: true, root: true },
    { name: '@smithy/config-resolver', dev: true, root: true },
    { name: '@smithy/node-config-provider', dev: true, root: true },
    // Declared for its pinned version, which goes into npm's `overrides` below.
    { name: '@nx/devkit', versionOnly: true },
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
});

const NX_EXTEND_PLUGIN = '@nx-extend/terraform';
export const TERRAFORM_PROJECT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Checks formatting, mirroring the TypeScript and Python `format` targets: the
 * base target fails on an unformatted file and the `fix` configuration rewrites
 * it. Writing from the base target would rewrite the `default` input the hash is
 * computed over, so the target could never cache-hit.
 *
 * Scoped to the project's own `src` rather than `-recursive`, so it checks the
 * files the vended templates cover. `-diff` names what to fix when it fails.
 */
export const TERRAFORM_FORMAT_TARGET: TargetConfiguration = {
  executor: 'nx:run-commands',
  cache: true,
  inputs: ['default'],
  options: {
    command: 'terraform fmt -check -diff',
    forwardAllArgs: true,
    cwd: '{projectRoot}/src',
  },
  configurations: {
    fix: {
      command: 'terraform fmt',
    },
    'skip-lint': {
      // Cross-platform no-op (`true` is not available on Windows cmd).
      command: 'node -e ""',
    },
  },
};

export async function terraformProjectGenerator(
  tree: Tree,
  schema: TerraformProjectGeneratorSchema,
): Promise<GeneratorCallback> {
  // Just use getTsLibDetails as it isn't specific to TS
  const lib = getTsLibDetails(tree, schema);
  const { fullyQualifiedName: sharedTfProjectName } = getTsLibDetails(tree, {
    name: SHARED_TERRAFORM_NAME,
  });

  const outDirToRootRelativePath = relative(
    join(tree.root, lib.dir, 'src'),
    tree.root,
  ).replace(/\\/g, '/');
  const distDir = joinPathFragments(
    outDirToRootRelativePath,
    'dist',
    '{projectRoot}',
  );
  const tfDistDir = joinPathFragments(distDir, 'terraform');
  const checkovReportJsonPath = joinPathFragments(
    distDir,
    'checkov',
    'checkov_report.json',
  );
  // `test` keeps its `.terraform` here rather than in `src`, so initialising it
  // never races the backend-configured targets over the shared one.
  const testDataDir = joinPathFragments(distDir, 'terraform-test');

  // Provider downloads persist here, so a target whose `.terraform` was cleaned
  // links the providers it already has rather than re-downloading them. Nx does
  // not interpolate `{workspaceRoot}` inside `env`, so this is relative to the
  // target's `cwd`. It sits under `.terraform`, which this generator gitignores
  // — that is also what keeps the providers out of Nx's file walk — and unlike
  // `.nx/cache` it survives `nx reset`.
  //
  // One cache per project rather than one for the workspace: two `terraform
  // init` runs filling a shared cache concurrently each compute a different hash
  // for the same provider, because the hash covers a directory the other is
  // still writing, and terraform then rejects the mismatch against the lock
  // file. Per project, no two writers ever meet, so the targets stay parallel.
  const pluginCacheDir = joinPathFragments(
    outDirToRootRelativePath,
    '.terraform',
    'plugin-cache',
    '{projectRoot}',
  );

  // Calculate relative path from current project to common/terraform/metrics
  // Use forward slashes for terraform module source paths (even on Windows)
  const metricsModulePath = relative(
    join(tree.root, lib.dir, 'src'),
    join(tree.root, 'packages', SHARED_TERRAFORM_DIR, 'src', 'metrics'),
  ).replace(/\\/g, '/');

  updateGitIgnore(tree, '.', (patterns) => [...patterns, '.terraform']);

  const applicationTargets: {
    [targetName: string]: TargetConfiguration;
  } = {
    apply: {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: {
        dev: {
          command: `terraform apply ${tfDistDir}/dev.tfplan`,
        },
      },
      options: {
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
      dependsOn: ['plan'],
    },
    bootstrap: {
      executor: 'nx:run-commands',
      options: {
        forwardAllArgs: true,
        commands: ['tsx {projectRoot}/scripts/bootstrap.ts {projectRoot}'],
        cwd: '{workspaceRoot}',
      },
    },
    'bootstrap-destroy': {
      executor: 'nx:run-commands',
      options: {
        forwardAllArgs: true,
        commands: [
          'tsx {projectRoot}/scripts/bootstrap-destroy.ts {projectRoot}',
        ],
        cwd: '{workspaceRoot}',
      },
    },
    build: {
      dependsOn: ['format', 'checkov', 'test', `${sharedTfProjectName}:build`],
    },
    deploy: {
      dependsOn: ['apply'],
    },
    // The artifact-only sibling of build, which `plan` depends on.
    assemble: {
      dependsOn: [`${sharedTfProjectName}:assemble`],
    },
    destroy: {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: {
        dev: {
          command: 'terraform destroy -var-file=env/dev.tfvars',
        },
      },
      options: {
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
      dependsOn: ['init'],
    },
    init: {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: {
        dev: {
          env: { TF_ENV: 'dev' },
        },
      },
      options: {
        forwardAllArgs: true,
        commands: ['tsx {projectRoot}/scripts/init.ts {projectRoot}'],
        cwd: '{workspaceRoot}',
      },
      dependsOn: ['^init'],
    },
    output: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default'],
      options: {
        command: 'terraform output -json',
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
    },
    plan: {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: {
        dev: {
          commands: [
            `shx mkdir -p ${tfDistDir}`,
            `terraform plan -var-file=env/dev.tfvars -out=${tfDistDir}/dev.tfplan`,
          ],
        },
      },
      options: {
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
        parallel: false,
      },
      dependsOn: ['init', 'validate', '^validate', 'assemble'],
    },
  };

  const libTargets: {
    [targetName: string]: TargetConfiguration;
  } = {
    build: {
      dependsOn: ['format', 'checkov', 'test'],
    },
    // A Terraform library vends modules rather than a deployable artifact, so
    // its `assemble` carries only whatever the consuming projects register on it.
    assemble: {
      executor: 'nx:noop',
    },
    format: TERRAFORM_FORMAT_TARGET,
    // Terraform has no linter of its own, so `lint` orchestrates the format
    // check. It exists so `nx run-many --target lint` reaches terraform
    // projects, and so `--configuration=fix` and `--configuration=skip-lint`
    // propagate to `format` the way they do for TypeScript and Python projects.
    lint: {
      dependsOn: ['format'],
    },
    init: {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: {
        dev: {
          commands: [
            {
              command: `shx mkdir -p ${pluginCacheDir}`,
              forwardAllArgs: false,
            },
            'terraform init',
          ],
        },
      },
      options: {
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
        parallel: false,
        env: { TF_PLUGIN_CACHE_DIR: pluginCacheDir },
      },
    },
    // `^production` mirrors `test`: checkov resolves the relative modules a
    // project consumes, so a change in one must invalidate the scan.
    checkov: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default', '^production'],
      outputs: ['{workspaceRoot}/dist/{projectRoot}/checkov'],
      options: {
        command: uvxCommand(
          'checkov',
          `--config-file ../checkov.yml --directory . -o cli -o json --output-file-path console,${checkovReportJsonPath}`,
        ),
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
    },
    // Terraform's native test framework, which runs any `.tftest.hcl` files.
    // A project with none is a no-op success.
    //
    // `-backend=false` installs the modules and providers the tests need
    // without configuring the S3 backend, so this runs before `bootstrap` and
    // needs no credentials. `TF_DATA_DIR` keeps that `.terraform` out of `src`,
    // so it never races the backend-configured targets over the shared one.
    // `^production` is what invalidates the cache when a consumed module
    // changes; `{projectRoot}/**/*` alone would serve a stale pass.
    //
    // `TF_DATA_DIR` is terraform's working directory, not an artifact: its
    // provider entries are symlinks into the shared plugin cache, so restoring
    // it on another machine would yield dangling links while the commands that
    // repopulate them are skipped. Declaring no outputs keeps a cache hit to
    // what it actually asserts — that the tests passed for these inputs.
    test: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default', '^production'],
      outputs: [],
      options: {
        commands: [
          { command: `shx mkdir -p ${pluginCacheDir}`, forwardAllArgs: false },
          'terraform init -backend=false',
          'terraform test',
        ],
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
        parallel: false,
        env: { TF_DATA_DIR: testDataDir, TF_PLUGIN_CACHE_DIR: pluginCacheDir },
      },
    },
    validate: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default'],
      options: {
        command: 'terraform validate',
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
      dependsOn: ['init'],
    },
  };

  const projectConfiguration = {
    root: lib.dir,
    projectType: schema.type,
    sourceRoot: joinPathFragments(lib.dir, 'src'),
    targets: sortObjectKeys({
      ...libTargets,
      ...(schema.type === 'application' ? applicationTargets : {}),
    }),
  };

  // Only create the project configuration on first run; skip it on re-run so
  // existing project.json customisations are preserved.
  if (!projectExists(tree, lib.fullyQualifiedName)) {
    addProjectConfiguration(tree, lib.fullyQualifiedName, projectConfiguration);
  }

  // The `lint` target checks licenses alongside formatting, as it does for
  // TypeScript and Python projects.
  addLicenseCheckToLintTarget(tree, lib.fullyQualifiedName);

  // This generator IS the Terraform project, so the provider is fixed.
  addGeneratorMetadata(
    tree,
    lib.fullyQualifiedName,
    TERRAFORM_PROJECT_GENERATOR_INFO,
    { iac: 'terraform' },
  );

  // The guides tell the reader to declare resources in `main.tf`, add variables
  // and outputs, and configure environments in `env/*.tfvars`, so everything
  // here is scaffolded once and then left alone. Provider version bumps reach
  // `providers.tf` through the vended version sync, which rewrites the pin in
  // place rather than the whole file.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, `./files/${schema.type}`),
    lib.dir,
    {
      metricsModulePath,
      stateKeyPrefix: kebabCase(lib.fullyQualifiedName),
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Checkov skips are the user's to curate, so preserve any they have added.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, './files/checkov'),
    lib.dir,
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  const nxJson = readNxJson(tree);

  if (
    !nxJson.plugins?.find((p) =>
      typeof p === 'string'
        ? p === NX_EXTEND_PLUGIN
        : p.plugin === NX_EXTEND_PLUGIN,
    )
  ) {
    nxJson.plugins = [...(nxJson.plugins ?? []), NX_EXTEND_PLUGIN];
    updateNxJson(tree, nxJson);
  }

  // Ensure shared constructs for Terraform are created
  await sharedConstructsGenerator(tree, { iac: 'terraform' }, DEPENDENCIES);

  // Add Terraform metrics
  await addGeneratorMetricsIfApplicable(tree, [
    TERRAFORM_PROJECT_GENERATOR_INFO,
  ]);

  addTsDependencies(tree, DEPENDENCIES);

  // @nx-extend/terraform has a peer dependency on @nx/devkit ^21.0.0 which causes
  // npm install to fail, so for NPM we add a resolution
  // Can remove when https://github.com/TriPSs/nx-extend/issues/407 is addressed
  if (detectPackageManager() === 'npm') {
    updateJson(tree, 'package.json', (packageJson) => {
      packageJson.overrides = {
        ...packageJson.overrides,
        ...withVersions(DEPENDENCIES, ['@nx/devkit']),
      };
      return packageJson;
    });
  }

  // `updateProjectConfiguration` re-serialises project.json with every inline
  // array expanded, which the vended `format` target rejects.
  await formatFilesInSubtree(tree);

  // `@nx-extend/terraform` is registered as an Nx plugin in nx.json, so Nx
  // loads it when computing the project graph — it must resolve even if the
  // caller would otherwise prefer to defer installing.
  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript'],
      ensureResolvable: [NX_EXTEND_PLUGIN],
    });
}
export default terraformProjectGenerator;
