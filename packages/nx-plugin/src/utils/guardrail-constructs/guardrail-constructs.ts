/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { addStarExport } from '../ast.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import { terraformProviderVersions } from '../versions.js';

export interface AddGuardrailInfraOptions {
  iac: Iac;
  /** Class name of the guarded agent, eg `MyAgent` gives `MyAgentGuardrail`. */
  nameClassName: string;
  /**
   * Kebab-case name of the guarded agent, used for the directory and, with a
   * `-guardrail` suffix, the file.
   */
  nameKebabCase: string;
  /** Workspace-root-relative path of the guardrail.json policy file. */
  policyPath: string;
}

/**
 * Write the guardrail.json policy next to the agent. The policy is the
 * user's to edit, so a re-run never touches an existing file.
 */
export const addGuardrailPolicy = (tree: Tree, agentDir: string): void => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'policy'),
    agentDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
};

/**
 * Add the Amazon Bedrock Guardrail infrastructure for the selected IaC
 * provider: a CDK construct in the shared constructs project, or a Terraform
 * module in the shared Terraform project. Both read the policy file at synth
 * or plan time.
 *
 * Files are written with `KeepExisting`, so a re-run leaves them unchanged.
 * No build dependency is added on the agent's project, since the
 * infrastructure reads a source file and imports none of the agent's code;
 * for CDK the generator lists that file as a `synth` input instead, so the
 * infrastructure's cached synth follows it.
 */
export const addGuardrailInfra = async (
  tree: Tree,
  options: AddGuardrailInfraOptions,
): Promise<void> => {
  const templateContext = {
    nameClassName: options.nameClassName,
    nameKebabCase: options.nameKebabCase,
    policyPath: options.policyPath,
  };

  switch (options.iac) {
    case 'cdk': {
      const appDir = joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
      );
      generateFiles(
        tree,
        joinPathFragments(
          import.meta.dirname,
          'files',
          'cdk',
          'app',
          'guardrails',
        ),
        joinPathFragments(appDir, 'guardrails'),
        { ...templateContext, ...esmVars(tree) },
        { overwriteStrategy: OverwriteStrategy.KeepExisting },
      );
      await addStarExport(
        tree,
        joinPathFragments(appDir, 'guardrails', 'index.ts'),
        `./${options.nameKebabCase}/${options.nameKebabCase}-guardrail.js`,
      );
      await addStarExport(
        tree,
        joinPathFragments(appDir, 'index.ts'),
        './guardrails/index.js',
      );
      break;
    }
    case 'terraform':
      generateFiles(
        tree,
        joinPathFragments(
          import.meta.dirname,
          'files',
          'terraform',
          'app',
          'guardrails',
        ),
        joinPathFragments(
          PACKAGES_DIR,
          SHARED_TERRAFORM_DIR,
          'src',
          'app',
          'guardrails',
        ),
        {
          ...templateContext,
          // Guardrail names are at most 50 characters: the prefix, a hyphen
          // and the 8 hex characters of the random suffix.
          guardrailNamePrefix: `${options.nameKebabCase}-guardrail`.slice(
            0,
            41,
          ),
          ...terraformProviderVersions(),
        },
        { overwriteStrategy: OverwriteStrategy.KeepExisting },
      );
      break;
  }
};
