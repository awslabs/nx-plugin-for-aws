/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import {
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { TERRAFORM_VERSIONS } from '../../../utils/versions.js';

/**
 * Declare every provider each vended Terraform module uses in its own
 * `required_providers`.
 *
 * A provider a module uses but never declares is resolved by implicit
 * inheritance from the root module, unpinned — so `terraform init` on that
 * module takes whatever the registry serves, bypassing the version pinning the
 * generators vend. Several vended modules referenced `random`, `archive`,
 * `null`, `external` and `aws` without declaring them.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * the unpinned shape until this runs. Each missing provider is added to the
 * module's existing `required_providers`; a module with no `terraform` block at
 * all is reported via `nextSteps` rather than having one inserted, since where
 * it belongs depends on how the user has arranged the file.
 */

const TERRAFORM_SRC = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
);

const hcl = (pattern: string) => `language hcl\n${pattern}`;

/** Providers built in to Terraform, which have no entry and no version. */
const BUILTIN_TYPES = new Set(['terraform_data', 'terraform_remote_state']);

/**
 * The provider a resource or data source type resolves to. Terraform derives
 * this from the type's first underscore-delimited word; a type it can't
 * attribute to a provider the plugin vends is not this migration's to touch.
 */
const providerOf = (type: string): string | undefined => {
  // `null_resource` and `external` are the whole type, not a prefixed one.
  if (type === 'null_resource') {
    return 'null';
  }
  if (type === 'external') {
    return 'external';
  }
  const [prefix] = type.split('_');
  return prefix in TERRAFORM_VERSIONS ? prefix : undefined;
};

/**
 * Drop heredoc bodies before scanning for references. Vended modules embed
 * Python and shell in `local-exec` provisioners, whose identifiers would
 * otherwise read as HCL references.
 */
const withoutHeredocs = (contents: string): string => {
  const kept: string[] = [];
  let terminator: string | undefined;
  for (const line of contents.split('\n')) {
    if (terminator) {
      if (line.trim() === terminator) {
        terminator = undefined;
      }
      continue;
    }
    terminator = /<<[-~]?([A-Z][A-Z0-9_]*)\s*$/.exec(line)?.[1];
    kept.push(line);
  }
  return kept.join('\n');
};

/** The providers a module's resources, data sources and references require. */
const usedProviders = (contents: string): Set<string> => {
  const used = new Set<string>();
  const add = (type: string) => {
    if (BUILTIN_TYPES.has(type)) {
      return;
    }
    const provider = providerOf(type);
    if (provider) {
      used.add(provider);
    }
  };

  const source = withoutHeredocs(contents);
  for (const [, type] of source.matchAll(
    /^[ \t]*(?:resource|data)\s+"([A-Za-z0-9_]+)"/gm,
  )) {
    add(type);
  }
  for (const [, type] of source.matchAll(
    /\bdata\.([A-Za-z0-9_]+)\.[A-Za-z0-9_]+/g,
  )) {
    add(type);
  }
  for (const [, type] of source.matchAll(
    /(?:^|[^A-Za-z0-9_."])((?:null|random|archive|external|local|time|tls)_[A-Za-z0-9_]+)\.[a-z][A-Za-z0-9_]*\./g,
  )) {
    add(type);
  }
  return used;
};

/** Every `.tf` file in the workspace's shared terraform library, by directory. */
const terraformModules = (tree: Tree): Map<string, string[]> => {
  const modules = new Map<string, string[]>();
  if (!tree.exists(TERRAFORM_SRC)) {
    return modules;
  }
  visitNotIgnoredFiles(tree, TERRAFORM_SRC, (filePath) => {
    if (!filePath.endsWith('.tf')) {
      return;
    }
    const dir = filePath.slice(0, filePath.lastIndexOf('/'));
    modules.set(dir, [...(modules.get(dir) ?? []), filePath]);
  });
  return modules;
};

/** The provider entry to vend, at the version this release pins. */
const providerEntry = (provider: string) =>
  [
    `${provider} = {`,
    `  source  = "hashicorp/${provider}"`,
    `  version = "${TERRAFORM_VERSIONS[provider as keyof typeof TERRAFORM_VERSIONS]}"`,
    '}',
  ].join('\n');

/**
 * Add a provider to a file's `required_providers`. Appended after the block's
 * existing body, so an entry the user has customised is left as it is.
 */
const declareProvider = (tree: Tree, filePath: string, provider: string) =>
  insertViaGritQL(
    tree,
    filePath,
    hcl(
      `\`required_providers { $body }\` => \`required_providers {\n  $body\n\n  ${GRIT_INSERT_PLACEHOLDER}\n}\`` +
        ` where { $body <: not contains \`${provider} = { $_ }\` }`,
    ),
    providerEntry(provider),
  );

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [dir, filePaths] of terraformModules(tree)) {
    const used = new Set<string>();
    // The file holding the module's `required_providers`, which is where the
    // missing declarations are added — Terraform merges every `.tf` in a
    // directory, so one block covers the module.
    let blockFile: string | undefined;
    const declared = new Set<string>();

    for (const filePath of filePaths) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      for (const provider of usedProviders(contents)) {
        used.add(provider);
      }
      if (!contents.includes('required_providers')) {
        continue;
      }
      blockFile ??= filePath;
      for (const provider of Object.keys(TERRAFORM_VERSIONS)) {
        if (
          await matchGritQL(
            tree,
            filePath,
            hcl(
              `\`required_providers { $body }\` where { $body <: contains \`${provider} = { $_ }\` }`,
            ),
          )
        ) {
          declared.add(provider);
        }
      }
    }

    const missing = [...used].filter((p) => !declared.has(p)).sort();
    if (missing.length === 0) {
      continue;
    }

    if (!blockFile) {
      nextSteps.push(
        `${dir}: has no terraform required_providers block - left untouched. Add one declaring ${missing.join(', ')}, so the module pins the providers it uses rather than inheriting them unpinned from the root module.`,
      );
      continue;
    }

    for (const provider of missing) {
      if (!(await declareProvider(tree, blockFile, provider))) {
        nextSteps.push(
          `${blockFile}: its required_providers block has diverged from the generated shape - left untouched. Add a ${provider} entry to it, sourced from hashicorp/${provider}.`,
        );
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
