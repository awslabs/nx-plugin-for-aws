/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Provision AppConfig configuration profiles for every namespace the vended terraform modules write to
 *
 * `core/runtime-config/appconfig` creates one configuration profile per entry in
 * its `namespaces` list, and `appconfig-deployment` aggregates and deploys the
 * same list. A module contributing an entry to a namespace outside that list
 * writes its entry file to disk and nothing more — the value never reaches
 * AppConfig, so a consumer reading it back fails at runtime. The vended defaults
 * now cover `dynamodb` and `database` alongside `connection` and `agentcore`.
 *
 * Root modules that pass `namespaces` explicitly are updated too, since an
 * explicit list overrides the vended default.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Transform source with GritQL (`applyGritQL`, `matchGritQL`), not regexes or
 *   string replacements: it matches the AST, so it holds up against however the
 *   user's copy has been formatted. Use `updateJson` for JSON.
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, or consider a
 *   hybrid migration, rather than clobbering the user's changes.
 * - `nextSteps` is for work left for the user to do by hand, not a log of the
 *   edits you made: an edit that applied cleanly needs no entry.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files your
 *   migration wrote are formatted correctly.
 */

/** Namespaces the vended modules write to that the old defaults omitted. */
const ADDED_NAMESPACES = ['database', 'dynamodb'];

const RUNTIME_CONFIG_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/runtime-config`;
const APPCONFIG_FILE = `${RUNTIME_CONFIG_DIR}/appconfig/appconfig.tf`;
const APPCONFIG_DEPLOYMENT_FILE = `${RUNTIME_CONFIG_DIR}/appconfig-deployment/appconfig-deployment.tf`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

/**
 * Where a `namespaces` list lives, as the block that encloses it and the
 * attribute holding the list. `clauses` narrows the block further, keeping an
 * unrelated list elsewhere in the file out of scope; `$body` is the block's body
 * in every case, so the clauses below can all be written against it.
 */
interface NamespaceList {
  readonly block: string;
  readonly attribute: string;
  readonly clauses?: string;
}

/** The `namespaces` variable declaration in a vended appconfig module. */
const VENDED_DEFAULT: NamespaceList = {
  block: 'variable "namespaces" { $body }',
  attribute: 'default',
};

/**
 * A call to the vended appconfig module that passes `namespaces` explicitly.
 * `$src` binds the quoted string, so the regex ends at the closing quote — that
 * anchor is what keeps the sibling `appconfig-deployment` call, which takes its
 * namespaces from this module's output, out of scope.
 */
const ROOT_MODULE_ARGUMENT: NamespaceList = {
  block: 'module $name { $body }',
  attribute: 'namespaces',
  clauses:
    '$body <: contains `source = $src`, $src <: r".*runtime-config/appconfig\\"", $body <: contains `namespaces = $_`',
};

/** A GritQL pattern matching the enclosing block, plus any extra clauses. */
const scopePattern = (list: NamespaceList, extraClauses?: string) => {
  const clauses = [list.clauses, extraClauses].filter(Boolean).join(', ');
  return hcl(`\`${list.block}\`${clauses ? ` where { ${clauses} }` : ''}`);
};

/** Whether a namespace already appears in the list. */
const listsNamespace = (
  tree: Tree,
  filePath: string,
  list: NamespaceList,
  namespace: string,
) =>
  matchGritQL(
    tree,
    filePath,
    scopePattern(list, `$body <: contains \`"${namespace}"\``),
  );

/**
 * Append a namespace to the list. Appended within the list rather than
 * re-emitting it, so no trailing hole is introduced.
 */
const appendNamespace = (
  tree: Tree,
  filePath: string,
  list: NamespaceList,
  namespace: string,
) =>
  applyGritQL(
    tree,
    filePath,
    scopePattern(
      list,
      `$body <: contains bubble \`${list.attribute} = [$items]\` where { $items <: [$..., $last], $last += \`, "${namespace}"\` }`,
    ),
  );

/**
 * Add every missing namespace to a list, returning false when one could not be
 * added. Already-listed namespaces are skipped, which is what makes a re-run a
 * no-op.
 */
const addMissingNamespaces = async (
  tree: Tree,
  filePath: string,
  list: NamespaceList,
): Promise<boolean> => {
  for (const namespace of ADDED_NAMESPACES) {
    if (await listsNamespace(tree, filePath, list, namespace)) {
      continue;
    }
    if (!(await appendNamespace(tree, filePath, list, namespace))) {
      return false;
    }
  }
  return true;
};

/** The vended module's own description, updated to document the new defaults. */
const DESCRIPTION_REWRITE = scopePattern(
  VENDED_DEFAULT,
  '$body <: contains bubble `description = $desc` where { $desc <: r".*one Configuration Profile is created per namespace.*", $desc => `"List of runtime-config namespaces this AppConfig application should expose (one Configuration Profile is created per namespace). The default covers every namespace the generated modules write to, and a namespace with no contributions deploys an empty profile — when adding namespaces of your own, keep the defaults alongside them."` }',
);

const missing = ADDED_NAMESPACES.map((n) => `"${n}"`).join(' and ');

const divergedNextStep = (filePath: string) =>
  `${filePath}: the \`namespaces\` variable has diverged from the generated shape - left untouched. Add ${missing} to its \`default\` list, otherwise no configuration profile is created for them and the entries the vended dynamodb/database modules contribute are never deployed.`;

const rootModuleNextStep = (filePath: string) =>
  `${filePath}: passes \`namespaces\` to the runtime-config appconfig module in a shape this migration could not update - left untouched. Add ${missing} to that list, or drop the argument to take the module's defaults, otherwise the entries the vended dynamodb/database modules contribute are never deployed.`;

/** Bring one vended appconfig module's `namespaces` default up to date. */
const migrateVendedModule = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(filePath)) {
    return; // This workspace has no Terraform runtime config.
  }

  if (!(await addMissingNamespaces(tree, filePath, VENDED_DEFAULT))) {
    nextSteps.push(divergedNextStep(filePath));
  }
};

/**
 * Root modules that pass `namespaces` explicitly override the vended default, so
 * they need the same additions.
 */
const migrateRootModules = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  const terraformFiles: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => {
    if (filePath.endsWith('.tf') && !filePath.startsWith(RUNTIME_CONFIG_DIR)) {
      terraformFiles.push(filePath);
    }
  });

  for (const filePath of terraformFiles) {
    if (
      !(await matchGritQL(tree, filePath, scopePattern(ROOT_MODULE_ARGUMENT)))
    ) {
      continue; // Takes the module's defaults, so nothing to update.
    }

    if (!(await addMissingNamespaces(tree, filePath, ROOT_MODULE_ARGUMENT))) {
      nextSteps.push(rootModuleNextStep(filePath));
    }
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  await migrateVendedModule(tree, APPCONFIG_FILE, nextSteps);
  await migrateVendedModule(tree, APPCONFIG_DEPLOYMENT_FILE, nextSteps);

  if (tree.exists(APPCONFIG_FILE)) {
    await applyGritQL(tree, APPCONFIG_FILE, DESCRIPTION_REWRITE);
  }

  await migrateRootModules(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
