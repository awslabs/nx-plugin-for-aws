/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { kebabCase } from '../../../utils/names.js';
import { normalizeTargetKeyOrder } from '../../../utils/nx.js';
import { sortObjectKeys } from '../../../utils/object.js';

/**
 * Terraform projects gained three fixes:
 *
 * - A `checkov` target carries the security scan, matching the name CDK
 *   infrastructure projects already use, so `nx run-many --target checkov` no
 *   longer skips Terraform projects. An existing `test` target is the user's,
 *   so it is left exactly as it is.
 * - A `checkov.yml` gives Terraform users the same central place to configure
 *   skips that the CDK app has, wired in via `--config-file`.
 * - `bootstrap-destroy` runs a script that resolves the region from the AWS SDK
 *   credential chain and passes it as `-var=aws_region`. The vended
 *   `aws_region` variable has no default, so the previous bare
 *   `terraform destroy` blocked forever on an input prompt in any non-TTY
 *   context.
 * - Both vended `providers.tf` declare `required_version = ">= 1.0"`, matching
 *   every other `.tf` file the plugin vends, and the bootstrap one pins the AWS
 *   provider.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

const hcl = (pattern: string) => `language hcl\n${pattern}`;

/** The scan command, as the pre-fix generator vended it on `test`. */
const CHECKOV_COMMAND_PATTERN = /uvx --from checkov==/;

const divergedTargetsStep = (projectName: string) =>
  `${projectName}: no 'test' target carrying the checkov scan was found, so no 'checkov' target was added - add one running checkov over the project so 'nx run-many --target checkov' includes this project.`;

const divergedProvidersStep = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. Add \`required_version = ">= 1.0"\` to its \`terraform\` block to pin the minimum Terraform version.`;

const divergedBootstrapDestroyStep = (projectName: string) =>
  `${projectName}: its 'bootstrap-destroy' target no longer matches the shape the generator produced - left untouched. Pass \`-var=aws_region=<region>\` to \`terraform destroy\`, otherwise it blocks on an input prompt when run without a TTY.`;

/**
 * Add `required_version` to a `providers.tf` that omits it.
 *
 * The bootstrap copy has no `terraform` block at all, so it is created;
 * the src copy has one holding `required_providers`, so it is added to.
 */
const migrateRequiredVersion = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(filePath)) return;

  // Already declared - nothing to do, whatever constraint the user chose.
  if (await matchGritQL(tree, filePath, hcl('`required_version = $_`'))) {
    return;
  }

  const hasRequiredProviders = await matchGritQL(
    tree,
    filePath,
    hcl(
      '`terraform { $body }` where { $body <: contains `required_providers` }',
    ),
  );

  if (hasRequiredProviders) {
    await applyGritQL(
      tree,
      filePath,
      hcl(
        '`terraform { $body }` => `terraform {\n  required_version = ">= 1.0"\n\n  $body\n}`',
      ),
    );
    return;
  }

  // No `terraform` block: prepend one ahead of the aws provider block.
  const providerBlock = hcl('`provider "aws" { $body }`');
  if (!(await matchGritQL(tree, filePath, providerBlock))) {
    nextSteps.push(divergedProvidersStep(filePath));
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    hcl(
      '`provider "aws" { $body }` => `terraform {\n  required_version = ">= 1.0"\n}\n\nprovider "aws" {\n  $body\n}`',
    ),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== TERRAFORM_PROJECT_GENERATOR_INFO.id) continue;

    const targets = project.targets ?? {};
    let changed = false;

    // Add `checkov`, copying the scan from the `test` target the pre-fix
    // generator put it on. `test` itself belongs to the user and is left as it
    // is. Guarded on `checkov` being absent so a re-run is a no-op.
    if (!targets.checkov) {
      const command = targets.test?.options?.command;

      if (
        typeof command !== 'string' ||
        !CHECKOV_COMMAND_PATTERN.test(command)
      ) {
        nextSteps.push(divergedTargetsStep(projectName));
      } else {
        // The config file is vended below, so wire it in at the same time.
        const withConfigFile = command.includes('--config-file')
          ? command
          : command.replace(
              'checkov --directory',
              'checkov --config-file ../checkov.yml --directory',
            );

        targets.checkov = normalizeTargetKeyOrder({
          ...targets.test,
          options: { ...targets.test.options, command: withConfigFile },
        });
        changed = true;
      }
    }

    // Point `bootstrap-destroy` at the vended script, which resolves the
    // region rather than leaving terraform to prompt for it.
    const bootstrapDestroy = targets['bootstrap-destroy'];
    if (bootstrapDestroy) {
      const scriptCommand = `tsx {projectRoot}/scripts/bootstrap-destroy.ts {projectRoot}`;
      const alreadyMigrated =
        bootstrapDestroy.options?.commands?.[0] === scriptCommand;

      if (!alreadyMigrated) {
        const command = bootstrapDestroy.options?.command;
        // Only rewrite the exact shape the generator produced.
        const isVendedShape =
          typeof command === 'string' &&
          /^terraform destroy -state=\S+bootstrap\.tfstate$/.test(
            command.trim(),
          );

        if (!isVendedShape) {
          nextSteps.push(divergedBootstrapDestroyStep(projectName));
        } else {
          targets['bootstrap-destroy'] = normalizeTargetKeyOrder({
            executor: bootstrapDestroy.executor,
            options: {
              forwardAllArgs: true,
              commands: [scriptCommand],
              cwd: '{workspaceRoot}',
            },
          });
          changed = true;
        }
      }
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, {
        ...project,
        targets: sortObjectKeys(targets),
      });
    }

    // Vend the checkov config and the bootstrap-destroy script. KeepExisting
    // leaves a user's own copy alone and makes a re-run a no-op.
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        '../../../terraform/project/files/checkov',
      ),
      project.root,
      {},
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    // Only application projects have a bootstrap dir to destroy. The scripts
    // dir is shared with the generator's templates, so `stateKeyPrefix` is
    // resolved the same way it computes it; KeepExisting leaves the scripts
    // that already exist untouched regardless.
    if (tree.exists(joinPathFragments(project.root, 'bootstrap'))) {
      generateFiles(
        tree,
        joinPathFragments(
          import.meta.dirname,
          '../../../terraform/project/files/application/scripts',
        ),
        joinPathFragments(project.root, 'scripts'),
        { stateKeyPrefix: kebabCase(projectName) },
        { overwriteStrategy: OverwriteStrategy.KeepExisting },
      );
    }

    await migrateRequiredVersion(
      tree,
      joinPathFragments(project.root, 'src/providers.tf'),
      nextSteps,
    );
    await migrateRequiredVersion(
      tree,
      joinPathFragments(project.root, 'bootstrap/providers.tf'),
      nextSteps,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
