/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  addProjectConfiguration,
  generateFiles,
  Tree,
  OverwriteStrategy,
  TargetConfiguration,
  readNxJson,
  updateNxJson,
  GeneratorCallback,
  installPackagesTask,
  addDependenciesToPackageJson,
} from '@nx/devkit';
import { TerraformProjectGeneratorSchema } from './schema';
import { getTsLibDetails } from '../../ts/lib/generator';
import { join, relative } from 'path';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { updateGitIgnore } from '../../utils/git';
import { withVersions } from '../../utils/versions';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { uvxCommand } from '../../utils/py';

const NX_EXTEND_PLUGIN = '@nx-extend/terraform';
export const TERRAFORM_PROJECT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function terraformProjectGenerator(
  tree: Tree,
  schema: TerraformProjectGeneratorSchema,
): Promise<GeneratorCallback> {
  // Just use getTsLibDetails as it isn't specific to TS
  const lib = getTsLibDetails(tree, schema);
  const { fullyQualifiedName: sharedTfProjectName } = getTsLibDetails(tree, {
    name: 'terraform',
  });

  const outDirToRootRelativePath = relative(
    join(tree.root, lib.dir, 'src'),
    tree.root,
  );
  const distDir = join(outDirToRootRelativePath, 'dist', lib.dir);
  const tfDistDir = join(distDir, 'terraform');
  const checkovReportJsonPath = join(distDir, 'checkov', 'checkov_report.json');

  // Calculate relative path from current project to common/terraform/metrics
  const metricsModulePath = relative(
    join(tree.root, lib.dir, 'src'),
    join(tree.root, 'packages', 'common', 'terraform', 'src', 'metrics'),
  );

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
        commands: [
          `aws s3 cp s3://$(aws sts get-caller-identity --query Account --output text)-tf-state-$(aws configure get region)/bootstrap.tfstate ${tfDistDir}/bootstrap.tfstate || true`,
          'terraform init',
          `terraform apply -auto-approve -state=${tfDistDir}/bootstrap.tfstate -var="aws_region=$(aws configure get region)"`,
          `aws s3 cp ${tfDistDir}/bootstrap.tfstate s3://$(aws sts get-caller-identity --query Account --output text)-tf-state-$(aws configure get region)/bootstrap.tfstate`,
        ],
        parallel: false,
        cwd: '{projectRoot}/bootstrap',
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
          command:
            'terraform init -reconfigure -backend-config="region=$(aws configure get region)" -backend-config="bucket=$(aws sts get-caller-identity --query Account --output text)-tf-state-$(aws configure get region)" -backend-config="key=dev/terraform.tfstate"',
        },
      },
      options: {
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
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
      outputs: [`{workspaceRoot}/dist/${lib.dir}/checkov`],
      options: {
        command: uvxCommand(
          'checkov',
          `--directory . -o cli -o json --output-file-path console,${checkovReportJsonPath}`,
        ),
        forwardAllArgs: true,
        cwd: '{projectRoot}/src',
      },
      dependsOn: ['validate'],
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

  addProjectConfiguration(tree, lib.fullyQualifiedName, {
    root: lib.dir,
    projectType: schema.type,
    sourceRoot: joinPathFragments(lib.dir, 'src'),
    targets: sortObjectKeys({
      ...libTargets,
      ...(schema.type === 'application' ? applicationTargets : {}),
    }),
  });
  addGeneratorMetadata(
    tree,
    lib.fullyQualifiedName,
    TERRAFORM_PROJECT_GENERATOR_INFO,
  );

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, `./files/${schema.type}`), // path to the file templates
    lib.dir, // destination path of the files
    {
      metricsModulePath,
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
  await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

  // Add Terraform metrics
  await addGeneratorMetricsIfApplicable(tree, [
    TERRAFORM_PROJECT_GENERATOR_INFO,
  ]);

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@nx-extend/terraform', 'make-dir-cli']),
  );

  return () => {
    installPackagesTask(tree);
  };
}
export default terraformProjectGenerator;
