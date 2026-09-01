/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  type MigrationReturnObject,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { resolveContainers } from '../../../utils/containers.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import {
  PY_VERSIONS,
  terraformProviderVersions,
} from '../../../utils/versions.js';

/**
 * Split the vended Terraform AgentCore runtime module in two: a generic
 * `core/agent-core` holding the runtime, its role and its network configuration,
 * and a `core/agent-core-container` wrapper owning the ECR repository and the
 * image publish. Agents and MCP servers packaged as code get a sibling
 * `core/agent-core-code` wrapper, so a workspace mixing both packagings vends one
 * copy of the runtime rather than two near-identical modules.
 *
 * Existing runtimes stay on container deployment. This migration only reshapes
 * the modules — it never switches a deployed runtime to code packaging, which is
 * a deliberate choice made by re-running the generator with `--infra=agentcore`.
 *
 * State is carried across by `moved` blocks in the container wrapper, so an
 * upgrade keeps the deployed runtime, its role and its generated name rather than
 * replacing them. The ECR repository is the exception: its name embeds the
 * suffix whose state moves into the shared module, so it takes a fresh suffix and
 * is replaced on the next apply, with the image re-pushed as part of it.
 *
 * A module that has diverged from the generated shape is left untouched and
 * reported through `nextSteps`, since rewriting it would discard the user's edits.
 */
const TERRAFORM_CORE_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core`;
const TERRAFORM_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const divergedMessage = (filePath: string) =>
  `${filePath}: the vended AgentCore runtime module has diverged from the generated shape, so it was left untouched and still holds both the runtime and its ECR plumbing. To adopt the split modules, compare it against \`core/agent-core\` and \`core/agent-core-container\` as the generator now writes them and move your edits across, keeping the \`moved\` blocks so Terraform does not replace your deployed runtime.`;

const appModuleMessage = (count: number) =>
  `${count} vended AgentCore app module${count === 1 ? ' now sources' : 's now source'} \`core/agent-core-container\` rather than \`core/agent-core\`, keeping container deployment. Run \`terraform plan\` before applying: the runtime moves state into the shared module (no replacement), while the ECR repository is replaced and its image re-pushed. To move a component onto the faster code packaging instead, re-run its generator with \`--infra=agentcore\`.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const legacyModulePath = joinPathFragments(
    TERRAFORM_CORE_DIR,
    'agent-core',
    'runtime.tf',
  );

  // Nothing to do for a workspace with no vended AgentCore Terraform, or one
  // already on the split modules (the container wrapper only exists after this).
  if (
    !tree.exists(legacyModulePath) ||
    tree.exists(
      joinPathFragments(
        TERRAFORM_CORE_DIR,
        'agent-core-container',
        'runtime.tf',
      ),
    )
  ) {
    return {};
  }

  // The legacy module built an image, so it is recognisable by its ECR
  // repository. A module without one has been edited past the point where
  // rewriting it is safe.
  const isGeneratedShape = await matchGritQL(
    tree,
    legacyModulePath,
    hcl('`resource "aws_ecr_repository" "agent_core_repository" { $_ }`'),
  );

  if (!isGeneratedShape) {
    return { nextSteps: [divergedMessage(legacyModulePath)] };
  }

  const templateContext = {
    containers: await resolveContainers(tree, 'inherit'),
    boto3Version: PY_VERSIONS.boto3,
    // The legacy module is the container one, so the split keeps that packaging.
    container: true,
    ...terraformProviderVersions(),
  };

  // Replace the legacy module with the generic runtime, and add the container
  // wrapper beside it. `Overwrite` is deliberate here: the legacy file is the
  // generated shape (checked above), and the whole point of this migration is to
  // reshape it.
  const templatesDir = joinPathFragments(
    import.meta.dirname,
    '../../../utils/agent-core-constructs/files/terraform/core',
  );

  tree.delete(legacyModulePath);
  generateFiles(
    tree,
    joinPathFragments(templatesDir, 'agent-core'),
    joinPathFragments(TERRAFORM_CORE_DIR, 'agent-core'),
    templateContext,
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );
  generateFiles(
    tree,
    joinPathFragments(templatesDir, 'agent-core-container'),
    joinPathFragments(TERRAFORM_CORE_DIR, 'agent-core-container'),
    templateContext,
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  // Point every app module at the container wrapper, so they keep deploying an
  // image. Agents and MCP servers are both vended under `app/`.
  let repointed = 0;
  for (const appDirectory of ['agents', 'mcp-servers']) {
    const dir = joinPathFragments(TERRAFORM_APP_DIR, appDirectory);
    if (!tree.exists(dir)) {
      continue;
    }
    for (const child of tree.children(dir)) {
      const modulePath = joinPathFragments(dir, child, `${child}.tf`);
      if (!tree.exists(modulePath)) {
        continue;
      }
      const changed = await applyGritQL(
        tree,
        modulePath,
        hcl(
          '`source = "../../../core/agent-core"` => `source = "../../../core/agent-core-container"`',
        ),
      );
      if (changed) {
        repointed += 1;
      }
    }
  }

  if (repointed > 0) {
    nextSteps.push(appModuleMessage(repointed));
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
