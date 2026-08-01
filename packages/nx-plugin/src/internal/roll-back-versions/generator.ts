/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson, visitNotIgnoredFiles } from '@nx/devkit';
import yaml from 'js-yaml';
import { parse } from 'semver';
import { applyGritQL } from '../../utils/ast';
import {
  METRICS_ASPECT_FILE_PATH,
  TERRAFORM_METRICS_FILE_PATH,
} from '../../utils/metrics';
import { updateToml } from '../../utils/toml';
import { TERRAFORM_VERSIONS } from '../../utils/versions';

/**
 * Rolls a generated workspace's pinned versions below what this release vends,
 * so the version sync migration has something to upgrade.
 *
 * The version-sync smoke test needs a workspace that is *behind*. Publishing an
 * older plugin to do that would tie the test to whatever that release happened
 * to vend; rolling the versions back in place keeps it exercising the generators
 * as they are today, and every version it writes is derived from the vended one
 * so the test never hardcodes a version.
 *
 * Only exact pins are rewritten. A range resolves to the vended version already,
 * and the sync deliberately leaves those alone, so rolling one back would assert
 * the opposite of the intended behaviour.
 */

/** Marker version an unowned dependency is planted at, to prove scoping. */
export const UNOWNED_VERSION = '7.0.0';

/** A dependency no generator adds, so the sync must leave it untouched. */
export const UNOWNED_PACKAGE = 'rxjs';

/**
 * A version strictly below the given one, which the sync must raise back.
 *
 * Walks down the lowest non-zero identifier so the result is always a real
 * version and never negative. A prerelease is dropped, which is already a step
 * down from the release it precedes.
 */
const rollBack = (version: string): string | undefined => {
  const trimmed = version.trim();
  // Ranges, references and tags hold no exact version to roll back.
  if (/[\s|^~><*=]|\|\||:/.test(trimmed) || !/^\d/.test(trimmed)) {
    return undefined;
  }
  const parsed = parse(trimmed);
  if (!parsed) {
    return undefined;
  }
  const { major, minor, patch, prerelease } = parsed;
  if (prerelease.length > 0) {
    return `${major}.${minor}.${patch}`;
  }
  if (patch > 0) {
    return `${major}.${minor}.${patch - 1}`;
  }
  if (minor > 0) {
    return `${major}.${minor - 1}.0`;
  }
  return major > 0 ? `${major - 1}.0.0` : undefined;
};

/** Roll back every exact version in a name -> version map, in place. */
const rollBackMap = (versions: Record<string, unknown>): boolean => {
  let changed = false;
  for (const [name, declared] of Object.entries(versions)) {
    if (typeof declared !== 'string') {
      continue;
    }
    const rolled = rollBack(declared);
    if (rolled) {
      versions[name] = rolled;
      changed = true;
    }
  }
  return changed;
};

/**
 * Roll back an override tree, which npm may nest to scope a pin — so a value is
 * either the version or another tree.
 */
const rollBackOverrides = (overrides: unknown): boolean => {
  if (typeof overrides !== 'object' || overrides === null) {
    return false;
  }
  let changed = false;
  for (const [key, value] of Object.entries(
    overrides as Record<string, unknown>,
  )) {
    if (typeof value === 'object' && value !== null) {
      changed = rollBackOverrides(value) || changed;
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const rolled = rollBack(value);
    if (rolled) {
      (overrides as Record<string, unknown>)[key] = rolled;
      changed = true;
    }
  }
  return changed;
};

export const internalRollBackVersionsGenerator = async (
  tree: Tree,
): Promise<void> => {
  // Every package.json: direct pins, plus the override fields and bun catalogs
  // the root may carry.
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('package.json')) {
      return;
    }
    updateJson(tree, path, (json) => {
      for (const field of ['dependencies', 'devDependencies'] as const) {
        if (json[field]) {
          rollBackMap(json[field]);
        }
      }
      for (const field of ['overrides', 'resolutions'] as const) {
        if (json[field]) {
          rollBackOverrides(json[field]);
        }
      }
      if (json.pnpm?.overrides) {
        rollBackOverrides(json.pnpm.overrides);
      }
      // Bun keeps its catalogs in the root manifest.
      if (json.catalog) {
        rollBackMap(json.catalog);
      }
      for (const catalog of Object.values(json.catalogs ?? {})) {
        rollBackMap(catalog as Record<string, unknown>);
      }
      return json;
    });
  });

  // pnpm and yarn keep catalogs — and pnpm 11 its overrides — in a workspace file.
  for (const path of ['pnpm-workspace.yaml', '.yarnrc.yml']) {
    if (!tree.exists(path)) {
      continue;
    }
    const workspaceFile = (yaml.load(tree.read(path, 'utf-8') ?? '') ??
      {}) as Record<string, unknown>;
    const changed = [
      workspaceFile.catalog
        ? rollBackMap(workspaceFile.catalog as Record<string, unknown>)
        : false,
      ...Object.values(workspaceFile.catalogs ?? {}).map((catalog) =>
        rollBackMap(catalog as Record<string, unknown>),
      ),
      rollBackOverrides(workspaceFile.overrides),
    ].some(Boolean);
    if (changed) {
      tree.write(path, yaml.dump(workspaceFile, { quotingType: "'" }));
    }
  }

  // Python `==` pins, in dependencies and dependency groups alike.
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('pyproject.toml')) {
      return;
    }
    const rollBackRequirements = (requirements: unknown): unknown =>
      Array.isArray(requirements)
        ? requirements.map((requirement) => {
            if (typeof requirement !== 'string') {
              return requirement;
            }
            // `name[extras]==1.2.3` is the only shape the sync rewrites.
            const match = /^(.*)==(\d[^\s,;]*)$/.exec(requirement.trim());
            const rolled = match ? rollBack(match[2]) : undefined;
            return rolled ? `${match![1]}==${rolled}` : requirement;
          })
        : requirements;

    updateToml(tree, path, (toml) => {
      const project = toml.project as Record<string, unknown> | undefined;
      if (project?.dependencies) {
        project.dependencies = rollBackRequirements(
          project.dependencies,
        ) as never;
      }
      const groups = toml['dependency-groups'] as
        | Record<string, unknown>
        | undefined;
      for (const group of Object.keys(groups ?? {})) {
        groups![group] = rollBackRequirements(groups![group]) as never;
      }
      return toml;
    });
  });

  // Terraform provider versions, scoped by source so an alias can't match.
  const terraformFiles: string[] = [];
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('.tf')) {
      terraformFiles.push(path);
    }
  });
  for (const path of terraformFiles) {
    for (const [provider, vended] of Object.entries(TERRAFORM_VERSIONS)) {
      const rolled = rollBack(vended);
      if (!rolled) {
        continue;
      }
      await applyGritQL(
        tree,
        path,
        `language hcl\n\`version = "${vended}"\` => \`version = "${rolled}"\` where {` +
          ` $program <: contains \`{ source = "hashicorp/${provider}" $... }\` }`,
      );
    }
  }

  // The plugin version the metrics files report, which the sync also brings up
  // to date.
  const rolledPluginVersion = '0.0.1';
  if (tree.exists(METRICS_ASPECT_FILE_PATH)) {
    await applyGritQL(
      tree,
      METRICS_ASPECT_FILE_PATH,
      `\`const version = $old\` => \`const version = '${rolledPluginVersion}'\`` +
        ' where { $old <: within `class MetricsAspect implements $_ { $_ }` }',
    );
  }
  if (tree.exists(TERRAFORM_METRICS_FILE_PATH)) {
    await applyGritQL(
      tree,
      TERRAFORM_METRICS_FILE_PATH,
      `language hcl\n\`version = $old\` => \`version = "${rolledPluginVersion}"\`` +
        ' where { $old <: r"\\"[^\\"]*\\"" }',
    );
  }

  // A dependency no generator adds, so the sync must leave it exactly as is.
  updateJson(tree, 'package.json', (json) => {
    json.devDependencies = {
      ...json.devDependencies,
      [UNOWNED_PACKAGE]: UNOWNED_VERSION,
    };
    return json;
  });
};

export default internalRollBackVersionsGenerator;
