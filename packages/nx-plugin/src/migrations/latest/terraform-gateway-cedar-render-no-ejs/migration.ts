/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Replace the Terraform gateway module's Cedar rendering script with one that
 * uses only Node's standard library.
 *
 * The script runs from `packages/common/terraform/src/app/gateways/<name>/`,
 * which belongs to the shared terraform project — a project with no
 * `package.json`. Its `require('ejs')` therefore resolved nothing under pnpm's
 * isolated layout and `terraform apply` failed reading the `external` data
 * source. Substituting the placeholders directly removes the dependency, so
 * the now-unused `ejs` / `@types/ejs` are dropped from each gateway project's
 * manifest too.
 */

const RENDER_SCRIPT = 'render-cedar.cjs';

// Read the current template rather than duplicating it, so the migration and
// the generator cannot drift.
const RENDER_SCRIPT_TEMPLATE = readFileSync(
  join(
    import.meta.dirname,
    `../../../utils/agent-core-constructs/files/terraform/app/agentcore-gateway/__nameKebabCase__/${RENDER_SCRIPT}.template`,
  ),
  'utf-8',
);

/**
 * The template's own substitutions applied: the gateway's class name, and the
 * `<%%` escapes that let it emit the literal `<%=` placeholder tokens the Cedar
 * policies use.
 */
const renderScriptContent = (nameClassName: string): string =>
  RENDER_SCRIPT_TEMPLATE.replaceAll(
    '<%- nameClassName %>',
    nameClassName,
  ).replaceAll('<%%', '<%');

/** The shape this migration replaces: a script requiring `ejs`. */
const isOldRenderScript = (contents: string): boolean =>
  /require\(['"]ejs['"]\)/.test(contents);

/** Already carrying the standard-library-only script. */
const isCurrentRenderScript = (contents: string): boolean =>
  contents.includes('PLACEHOLDER') && !isOldRenderScript(contents);

/**
 * Drop `ejs` / `@types/ejs` from a gateway project's manifest.
 *
 * Nothing in a gateway project imports either: the CDK construct's copy lives
 * in the shared constructs project, and the Terraform script no longer needs
 * one. Left in place if the user has taken a dependency on ejs themselves,
 * which a non-`catalog:` specifier signals.
 */
const removeUnusedEjs = (tree: Tree, manifestPath: string): void => {
  if (!tree.exists(manifestPath)) {
    return;
  }
  updateJson(tree, manifestPath, (json) => {
    for (const [field, name] of [
      ['dependencies', 'ejs'],
      ['devDependencies', 'ejs'],
      ['dependencies', '@types/ejs'],
      ['devDependencies', '@types/ejs'],
    ] as const) {
      if (json[field]?.[name] === 'catalog:') {
        delete json[field][name];
      }
    }
    return json;
  });
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  const gatewaysDir = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'app',
    'gateways',
  );

  for (const project of getProjects(tree).values()) {
    const metadata = project.metadata as
      | { generator?: string; name?: string; rc?: string }
      | undefined;
    if (metadata?.generator !== AGENTCORE_GATEWAY_GENERATOR_INFO.id) {
      continue;
    }

    removeUnusedEjs(tree, joinPathFragments(project.root, 'package.json'));

    // Only a Terraform gateway has a render script; a CDK one renders in its
    // construct, and `cedarPolicy: false` vends no script at all. The module
    // directory is named after the gateway, which the metadata records.
    const scriptPath = joinPathFragments(
      gatewaysDir,
      metadata.name ?? '',
      RENDER_SCRIPT,
    );
    const contents = tree.exists(scriptPath)
      ? (tree.read(scriptPath, 'utf-8') ?? '')
      : undefined;
    if (contents === undefined || isCurrentRenderScript(contents)) {
      continue;
    }
    if (!isOldRenderScript(contents)) {
      nextSteps.push(
        `${scriptPath}: has diverged from the generated shape — left untouched. It runs from the shared terraform project, which has no package.json, so it must not \`require\` a third-party package or \`terraform apply\` fails to read the \`external\` data source. Substitute the \`<%= name %>\` placeholders using Node's standard library instead (see the agentcore-gateway generator's template).`,
      );
      continue;
    }
    tree.write(scriptPath, renderScriptContent(metadata.rc ?? ''));
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
