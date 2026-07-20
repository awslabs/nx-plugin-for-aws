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
import { getTsLibDetails } from '../../ts/lib/generator';
import { addDependenciesToPackageJson } from '../../utils/dependencies';
import { updateGitIgnore } from '../../utils/git';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { uvxCommand } from '../../utils/py';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  SHARED_TERRAFORM_DIR,
  SHARED_TERRAFORM_NAME,
} from '../../utils/shared-constructs-constants';
import { terraformProviderVersions, withVersions } from '../../utils/versions';
import type { TerraformProjectGeneratorSchema } from './schema';

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
        command: `terraform destroy -state=${tfDistDir}/bootstrap.tfstate`,
        cwd: '{projectRoot}/bootstrap',
      },
    },
    build: {
      dependsOn: ['fmt', 'test', `${sharedTfProjectName}:build`],
    },
    deploy: {
      dependsOn: ['apply'],
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
      dependsOn: ['init', 'validate', '^validate', 'build'],
    },
  };

  const libTargets: {
    [targetName: string]: TargetConfiguration;
  } = {
    build: {
      dependsOn: ['fmt', 'test'],
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
    test: {
      executor: 'nx:run-commands',
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/checkov'],
      options: {
        command: uvxCommand(
          'checkov',
          `--directory . -o cli -o json --output-file-path console,${checkovReportJsonPath}`,
        ),
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
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
  addGeneratorMetadata(
    tree,
    lib.fullyQualifiedName,
    TERRAFORM_PROJECT_GENERATOR_INFO,
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
  await sharedConstructsGenerator(tree, { iac: 'terraform' });

  // Add Terraform metrics
  await addGeneratorMetricsIfApplicable(tree, [
    TERRAFORM_PROJECT_GENERATOR_INFO,
  ]);

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions([
      '@nx-extend/terraform',
      'make-dir-cli',
      'tsx',
      '@aws-sdk/client-s3',
      '@aws-sdk/client-sts',
      '@aws-sdk/credential-providers',
      '@smithy/config-resolver',
      '@smithy/node-config-provider',
    ]),
    joinPathFragments('packages', SHARED_TERRAFORM_DIR, 'package.json'),
  );

  // @nx-extend/terraform has a peer dependency on @nx/devkit ^21.0.0 which causes
  // npm install to fail, so for NPM we add a resolution
  // Can remove when https://github.com/TriPSs/nx-extend/issues/407 is addressed
  if (detectPackageManager() === 'npm') {
    updateJson(tree, 'package.json', (packageJson) => {
      packageJson.overrides = {
        ...packageJson.overrides,
        ...withVersions(['@nx/devkit']),
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
