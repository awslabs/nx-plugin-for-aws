/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator.js';
import { TS_AGENT_GUARDRAILS_GENERATOR_INFO } from '../../../ts/agent/guardrails/generator.js';
import {
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { kebabCase, toClassName } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { TERRAFORM_VERSIONS } from '../../../utils/versions.js';

/**
 * Keep a replaced guardrail version for 15 seconds after the runtime-config
 * deployment in each Terraform guardrail module of a `ts#agent#guardrails`
 * agent.
 *
 * When `guardrail.json` changes, `aws_bedrock_guardrail_version.this` is
 * replaced with `create_before_destroy`, and Terraform destroyed the old
 * version as soon as the runtime-config deployment completed. Agents cache
 * their runtime-config entry for 5 seconds, so a request in that window used
 * the deleted version and failed. The module now has a `time_sleep` whose
 * `triggers` hold the guardrail ID and version, and the runtime-config entry
 * reads both from those triggers. On a version change the sleep is replaced
 * too: the deposed sleep is destroyed after everything that depends on the new
 * one (the entry and, through the root module's `depends_on`, the
 * runtime-config deployment), waits its 15-second `destroy_duration`, and only
 * then is the deposed version, which it depends on, destroyed.
 *
 * Guarded agents are found from the `ts#agent#guardrails` components in project
 * metadata, each paired with the `ts#agent` component of the same name whose
 * IaC is Terraform. The module is written with `KeepExisting`, so an upgraded
 * workspace keeps the older module until this runs. A module that no longer
 * has the generated shape is left untouched and reported via `nextSteps` with
 * the lines to add.
 */

const TERRAFORM_GUARDRAILS_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/guardrails`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const TIME_SLEEP = '`resource "time_sleep" "version_retention" { $_ }`';

/** Indented as `terraform fmt` writes it, since `.tf` files are not reformatted. */
const TIME_PROVIDER_TEXT = `    time = {
      source  = "hashicorp/time"
      version = "${TERRAFORM_VERSIONS.time}"
    }`;

const TIME_SLEEP_TEXT = `resource "time_sleep" "version_retention" {
  destroy_duration = "15s"

  triggers = {
    guardrail_id      = aws_bedrock_guardrail.this.guardrail_id
    guardrail_version = aws_bedrock_guardrail_version.this.version
  }

  lifecycle {
    create_before_destroy = true
  }
}`;

const ENTRY_ID = 'guardrailId = aws_bedrock_guardrail.this.guardrail_id';
const ENTRY_VERSION =
  'guardrailVersion = aws_bedrock_guardrail_version.this.version';

/** Every shape the migration rewrites, so a module missing one is reported rather than half-migrated. */
const REQUIRED_SHAPES = [
  '`required_providers { $_ }`',
  '`resource "aws_bedrock_guardrail_version" "this" { $_ }`',
  `\`module "add_guardrail_to_runtime_config" { $body }\` where { $body <: and { contains \`${ENTRY_ID}\`, contains \`${ENTRY_VERSION}\` } }`,
];

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To keep a replaced guardrail version until agents have read the new one, add the time provider to required_providers:

${TIME_PROVIDER_TEXT}

add this resource:

${TIME_SLEEP_TEXT}

and make the runtime-config entry read guardrailId = time_sleep.version_retention.triggers.guardrail_id and guardrailVersion = time_sleep.version_retention.triggers.guardrail_version.`;

/** The Terraform guardrail module of each Terraform-deployed `ts#agent#guardrails` agent. */
const guardedTerraformModules = (tree: Tree): string[] => {
  const files = new Set<string>();
  for (const project of getProjects(tree).values()) {
    const components: ComponentMetadata[] =
      (project.metadata as { components?: ComponentMetadata[] } | undefined)
        ?.components ?? [];
    for (const guardrail of components.filter(
      (c) => c.generator === TS_AGENT_GUARDRAILS_GENERATOR_INFO.id,
    )) {
      const agent = components.find(
        (c) =>
          c.generator === TS_AGENT_GENERATOR_INFO.id &&
          (c.name ?? 'agent') === guardrail.name,
      );
      if (agent?.iac !== 'terraform') {
        continue;
      }
      const nameKebabCase = kebabCase(
        agent.rc ?? toClassName(agent.name ?? 'agent'),
      );
      files.add(
        joinPathFragments(
          TERRAFORM_GUARDRAILS_DIR,
          nameKebabCase,
          `${nameKebabCase}-guardrail.tf`,
        ),
      );
    }
  }
  return [...files];
};

const migrateModule = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  if (await matchGritQL(tree, filePath, hcl(TIME_SLEEP))) {
    return; // Already migrated.
  }

  const shapeChecks = await Promise.all(
    REQUIRED_SHAPES.map((shape) => matchGritQL(tree, filePath, hcl(shape))),
  );
  if (shapeChecks.includes(false)) {
    nextSteps.push(divergedMessage(filePath));
    return;
  }

  // Appended after the existing providers, so an entry the user changed is kept.
  await insertViaGritQL(
    tree,
    filePath,
    hcl(
      `\`required_providers { $body }\` => \`required_providers {\n    $body\n    ${GRIT_INSERT_PLACEHOLDER}\n  }\`` +
        ' where { $body <: not contains `time = { $_ }` }',
    ),
    // The placeholder already sits at the entry's indentation.
    TIME_PROVIDER_TEXT.replace(/^ {4}/, ''),
  );

  // After the version it keeps, where the generator writes it.
  await insertViaGritQL(
    tree,
    filePath,
    hcl(
      `\`resource "aws_bedrock_guardrail_version" "this" { $body }\` => \`resource "aws_bedrock_guardrail_version" "this" {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
    ),
    TIME_SLEEP_TEXT,
  );

  // Only the entry reads through the sleep; the module's outputs are unchanged.
  await applyGritQL(
    tree,
    filePath,
    hcl(
      `\`module "add_guardrail_to_runtime_config" { $body }\` where { $body <: contains bubble \`${ENTRY_ID}\` => \`guardrailId = time_sleep.version_retention.triggers.guardrail_id\`, $body <: contains bubble \`${ENTRY_VERSION}\` => \`guardrailVersion = time_sleep.version_retention.triggers.guardrail_version\` }`,
    ),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const filePath of guardedTerraformModules(tree)) {
    if (!tree.exists(filePath)) {
      continue; // The guardrail module was removed or never added.
    }
    await migrateModule(tree, filePath, nextSteps);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
