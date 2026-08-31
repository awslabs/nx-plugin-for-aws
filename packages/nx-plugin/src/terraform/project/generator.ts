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
import { getTsLibDetails } from '../../ts/lib/generator.js';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
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
    { name: 'make-dir-cli', dev: true, root: true },
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
      dependsOn: ['fmt', 'checkov', 'test', `${sharedTfProjectName}:build`],
    },
    deploy: {
      dependsOn: ['apply'],
    },
    // The artifact-only sibling of build, which `plan` depends on. `checkov`
    // stays in it: policy scanning is a security control rather than a code
    // quality gate, and it caches on the module sources so a warm run is free.
    assemble: {
      dependsOn: ['checkov', `${sharedTfProjectName}:assemble`],
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
            `make-dir ${tfDistDir}`,
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
      dependsOn: ['fmt', 'checkov', 'test'],
    },
    // A Terraform library vends modules rather than a deployable artifact, so
    // its `assemble` scans them and carries whatever the consuming projects
    // register on it.
    assemble: {
      dependsOn: ['checkov'],
    },
    fmt: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default'],
      options: {
        command: 'terraform fmt',
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
    },
    init: {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: {
        dev: {
          command: 'terraform init',
        },
      },
      options: {
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
    },
    checkov: {
      executor: 'nx:run-commands',
      cache: true,
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
    test: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default', '^production'],
      outputs: [`{workspaceRoot}/dist/{projectRoot}/terraform-test`],
      options: {
        commands: ['terraform init -backend=false', 'terraform test'],
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
        parallel: false,
        env: { TF_DATA_DIR: testDataDir },
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
  // This generator IS the Terraform project, so the provider is fixed.
  addGeneratorMetadata(
    tree,
    lib.fullyQualifiedName,
    TERRAFORM_PROJECT_GENERATOR_INFO,
    { iac: 'terraform' },
  );

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(import.meta.dirname, `./files/${schema.type}`), // path to the file templates
    lib.dir, // destination path of the files
    {
      metricsModulePath,
      stateKeyPrefix: kebabCase(lib.fullyQualifiedName),
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
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
