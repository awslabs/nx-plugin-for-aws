/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TERRAFORM_VERSIONS, terraformProviderVersions } from './versions.js';

/**
 * This scan reads the templates as text rather than through the GritQL helpers
 * in `utils/ast.ts`, which is the repo's convention for HCL everywhere else.
 * That is deliberate, and the reason is specific: GritQL parses a `.tf.template`
 * containing EJS *control flow* (`<%_ if ... _%>`) as HCL that yields no
 * resource declarations at all — and it fails open, returning zero matches
 * rather than an error.
 *
 * Measured against the templates this test guards: a GritQL implementation of
 * the same check finds 29 of the 29 resources in `static-website.tf.template`
 * (no control flow) and 0 of the 38 in the REST API app module (48 control-flow
 * tags). Run over the tree before these declarations were added, it reports 10
 * of the 14 real defects, silently skipping all 5 control-flow templates —
 * which includes both API app modules, the very modules this test exists to
 * cover. A structurally-correct matcher that cannot see the files where the bug
 * lives is worse than a textual one that can, so the invariant is asserted on
 * the text.
 *
 * The two shapes that motivate an AST matcher are handled directly instead:
 * heredoc bodies are stripped before scanning (so embedded Python and shell
 * aren't read as HCL references), and `required_providers` is located by
 * brace-matching rather than a line pattern (so an entry spread across lines is
 * still found).
 */

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..');

/**
 * Providers built in to Terraform itself, which have no entry in
 * `required_providers` and no version to pin.
 */
const BUILTIN_TYPES = new Set(['terraform_data', 'terraform_remote_state']);

/**
 * The provider a resource or data source type resolves to. Terraform derives
 * this from the type's first underscore-delimited word, so a type it can't
 * attribute to a provider we vend is not ours to check.
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

/** Every `.tf.template` under the plugin's source tree. */
const terraformTemplates = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.tf.template')) {
        found.push(path.relative(PLUGIN_SRC, full));
      }
    }
  };
  walk(PLUGIN_SRC);
  return found;
};

/**
 * Terraform loads every `.tf` in a module directory as one module, so a
 * provider one file declares covers a sibling's use of it. Group the templates
 * by the directory they are emitted into, which is the unit `terraform init`
 * resolves providers for.
 */
const moduleDirectories = (): Map<string, string[]> => {
  const modules = new Map<string, string[]>();
  for (const rel of terraformTemplates()) {
    const dir = path.dirname(rel);
    modules.set(dir, [...(modules.get(dir) ?? []), rel]);
  }
  return modules;
};

/** The provider local names a `required_providers` block declares. */
const declaredProviders = (contents: string): Set<string> => {
  const declared = new Set<string>();
  const at = contents.indexOf('required_providers');
  if (at < 0) {
    return declared;
  }
  // Walk to the matching brace: a provider entry is itself a block, so the
  // first `}` is not the end of `required_providers`.
  const open = contents.indexOf('{', at);
  let depth = 0;
  let close = open;
  for (; close < contents.length; close++) {
    if (contents[close] === '{') {
      depth++;
    } else if (contents[close] === '}' && --depth === 0) {
      break;
    }
  }
  for (const [, name] of contents
    .slice(open + 1, close)
    .matchAll(/([A-Za-z0-9_]+)\s*=\s*\{/g)) {
    declared.add(name);
  }
  return declared;
};

/**
 * Drop heredoc bodies before scanning for references. `.tf` templates embed
 * Python and shell in `local-exec` provisioners, whose identifiers would
 * otherwise read as HCL references (`local_path_obj.rglob(...)`).
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

/**
 * Reduce every quoted string to just its `${...}` interpolations, which are the
 * only part of a string HCL evaluates as a reference. Prose mentioning a
 * resource (`description = "uses random_string.suffix"`) is not a use of it,
 * while `"x-${random_string.suffix.result}"` is.
 */
const withoutStringProse = (contents: string): string =>
  contents.replace(/"(?:[^"\\]|\\.)*"/g, (literal) =>
    [...literal.matchAll(/\$\{([^}]*)\}/g)].map(([, expr]) => expr).join(' '),
  );

/** The providers a module's resources, data sources and references require. */
const usedProviders = (contents: string): Map<string, Set<string>> => {
  const used = new Map<string, Set<string>>();
  const add = (type: string) => {
    if (BUILTIN_TYPES.has(type)) {
      return;
    }
    const provider = providerOf(type);
    if (!provider) {
      return;
    }
    used.set(provider, (used.get(provider) ?? new Set()).add(type));
  };

  const hcl = withoutHeredocs(contents);
  // A declaration, e.g. `resource "random_string" "suffix" {`. Read before
  // strings are reduced, since the type itself is quoted.
  for (const [, type] of hcl.matchAll(
    /^[ \t]*(?:resource|data)\s+"([A-Za-z0-9_]+)"/gm,
  )) {
    add(type);
  }

  // References are read with string prose removed, so only evaluated
  // expressions count.
  const expressions = withoutStringProse(hcl);
  // A data source reference, e.g. `data.external.docker_digest.result`. A module
  // may read one a sibling file declares.
  for (const [, type] of expressions.matchAll(
    /\bdata\.([A-Za-z0-9_]+)\.[A-Za-z0-9_]+/g,
  )) {
    add(type);
  }
  // A managed resource reference, e.g. `random_string.suffix.result`.
  for (const [, type] of expressions.matchAll(
    /(?:^|[^A-Za-z0-9_.])((?:null|random|archive|external|local|time|tls)_[A-Za-z0-9_]+)\.[a-z][A-Za-z0-9_]*\./g,
  )) {
    add(type);
  }
  return used;
};

// A provider a module uses but never declares is resolved by implicit
// inheritance from the root module, unpinned — so `terraform init` on the module
// takes whatever the registry serves, bypassing the pinning
// `terraformProviderVersions` exists to enforce. This is the invariant that
// prevents that recurring: every provider a vended module uses must be declared
// in its own `required_providers`.
describe('terraform required_providers', () => {
  it('should declare every provider each vended module uses', () => {
    const undeclared: string[] = [];

    for (const [dir, templates] of moduleDirectories()) {
      const declared = new Set<string>();
      const used = new Map<string, Set<string>>();
      for (const rel of templates) {
        const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
        for (const provider of declaredProviders(contents)) {
          declared.add(provider);
        }
        for (const [provider, types] of usedProviders(contents)) {
          used.set(
            provider,
            new Set([...(used.get(provider) ?? []), ...types]),
          );
        }
      }

      for (const [provider, types] of used) {
        if (!declared.has(provider)) {
          undeclared.push(
            `${dir}: ${provider} (${[...types].sort().join(', ')})`,
          );
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('should pin every declared provider through the vended version', () => {
    const versionVars = new Set(Object.keys(terraformProviderVersions()));
    const unpinned: string[] = [];

    for (const rel of terraformTemplates()) {
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      const at = contents.indexOf('required_providers');
      if (at < 0) {
        continue;
      }
      for (const provider of declaredProviders(contents)) {
        // The entry declares its own source and version, so the pin is found by
        // the version attribute following that provider's name.
        const entry = new RegExp(
          `${provider}\\s*=\\s*\\{[^}]*version\\s*=\\s*"<%[-=]\\s*([A-Za-z]+)\\s*%>"`,
        ).exec(contents.slice(at));
        if (!entry || !versionVars.has(entry[1])) {
          unpinned.push(`${rel}: ${provider}`);
        }
      }
    }

    expect(unpinned).toEqual([]);
  });

  // The scan is textual (see the note at the top of this file), so the shapes an
  // AST matcher would handle for free are pinned here instead. Each of these is
  // a way a text scan could plausibly be fooled.
  describe('scanning', () => {
    it.each([
      [
        'an entry spread across lines',
        `terraform {
  required_providers {
    random
      =
      {
        source = "hashicorp/random"
      }
  }
}`,
        ['random'],
      ],
      [
        'an entry holding a nested attribute',
        `terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
    random = {
      source = "hashicorp/random"
    }
  }
}`,
        ['aws', 'random'],
      ],
    ])('should find %s', (_, contents, expected) => {
      expect([...declaredProviders(contents)].sort()).toEqual(expected);
    });

    it.each([
      [
        'a type named only in a comment',
        `# resource "random_string" "not_real" {}
resource "aws_s3_bucket" "b" {
  bucket = "x"
}`,
        ['aws'],
      ],
      [
        'a type named only in string prose',
        `resource "aws_s3_bucket" "b" {
  description = "uses random_string.suffix.result elsewhere"
}`,
        ['aws'],
      ],
      [
        'a type used only inside a heredoc script',
        `resource "aws_s3_object" "o" {
  provisioner "local-exec" {
    command = <<-EOT
      local_path_obj = Path(p)
      print(local_path_obj.name)
    EOT
  }
}`,
        ['aws'],
      ],
    ])('should not count %s as a use', (_, contents, expected) => {
      expect([...usedProviders(contents).keys()].sort()).toEqual(expected);
    });

    it.each([
      [
        'an interpolated reference',
        'resource "aws_s3_bucket" "b" {\n  bucket = "a-${random_string.suffix.result}"\n}',
        ['aws', 'random'],
      ],
      [
        'a data source a sibling file declares',
        'locals {\n  tag = data.external.digest.result.sha\n}',
        ['external'],
      ],
      [
        'a bare resource reference',
        'locals {\n  id = null_resource.ready.id\n}',
        ['null'],
      ],
    ])('should count %s as a use', (_, contents, expected) => {
      expect([...usedProviders(contents).keys()].sort()).toEqual(expected);
    });

    it('should not count a terraform built-in, which has no provider', () => {
      expect([
        ...usedProviders(
          'resource "terraform_data" "v" {\n  input = 1\n}',
        ).keys(),
      ]).toEqual([]);
    });
  });
});
