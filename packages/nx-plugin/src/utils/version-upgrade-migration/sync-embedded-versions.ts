/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { visitNotIgnoredFiles } from '@nx/devkit';
import { applyGritQL } from '../ast';
import {
  BASE_IMAGES,
  CONTAINER_VERSIONS,
  PY_VERSIONS,
  TS_VERSIONS,
} from '../versions';
import type { OwnedDependencies } from './owned-dependencies';
import { isVendedUpgrade } from './vended-upgrade';

/**
 * Sync the vended versions generators bake into the body of a file rather than
 * into a manifest: the container image pins in a `Dockerfile`, the Python pins
 * in a Terraform inline script, and the tooling images a `project.json` target
 * command runs.
 *
 * Every version here is pinned to clear a known HIGH/CRITICAL vulnerability, or
 * to keep a generated image reproducible, so leaving them behind strands a
 * workspace on exactly the versions most in need of an upgrade.
 *
 * These sit inside shell commands, which GritQL has no grammar for — so instead
 * of pattern-matching the surrounding syntax, each pin is located by an anchored
 * regex whose single capture group is the version, and only that capture is
 * rewritten. The file's own text around it is never reconstructed, so a
 * reformatted or hand-edited file syncs the same way a freshly generated one
 * does.
 */

/** A pin found in a file body, and the version this release vends for it. */
interface EmbeddedPin {
  /** Regex matching the pin, with the version as its only capture group. */
  readonly pattern: string;
  readonly vended: string;
  /**
   * Whether the declared value is a version to move forward, or a tag to replace
   * whenever it differs. A tag — `lts-slim`, say — has no ordering to compare, so
   * one that isn't what this release vends is simply out of date.
   */
  readonly kind?: 'version' | 'tag';
}

/** Escape a package name or image reference for use inside a regex. */
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Characters that end a pinned version: whitespace, the backslash continuing a
 * shell line, and the quote closing the string the pin sits in.
 *
 * The quote is escaped because the pattern is itself a double-quoted GritQL
 * regex literal, which a bare quote would terminate.
 */
const VERSION_TERMINATORS = '\\s\\\\\\"';

/**
 * Rewrite the capture group of an anchored regex to the vended version.
 *
 * The leading and trailing `[\s\S]*` anchor the match to the whole file, which
 * is what lets a capture group be rewritten on its own: GritQL binds the group
 * to a node it can replace, leaving every other byte untouched. Without the
 * anchors nothing matches.
 */
const rewriteCapture = (pattern: string, vended: string): string =>
  `r"[\\s\\S]*${pattern}[\\s\\S]*"($version) where { $version => \`${vended}\` }`;

/**
 * Versions a pin's regex currently matches in the file.
 *
 * Read before rewriting so a version the user raised past what this release
 * vends is left alone, matching how every other surface behaves.
 */
const declaredVersions = (contents: string, pattern: string): string[] => {
  const matches = contents.matchAll(new RegExp(pattern, 'g'));
  return [...matches].flatMap((match) => (match[1] ? [match[1]] : []));
};

/**
 * Apply the pins whose declared version this release moves forward.
 *
 * A single rewrite covers every occurrence of a pin in the file, so each pin is
 * applied once.
 */
const applyPins = async (
  tree: Tree,
  path: string,
  pins: readonly EmbeddedPin[],
): Promise<boolean> => {
  let changed = false;
  for (const { pattern, vended, kind = 'version' } of pins) {
    const contents = tree.read(path, 'utf-8') ?? '';
    const declared = declaredVersions(contents, pattern);
    const outOfDate =
      kind === 'tag'
        ? (tag: string) => tag !== vended
        : (version: string) => isVendedUpgrade(vended, version);
    // Rewriting replaces every occurrence at once, so this must hold for all of
    // them — a pin already at or beyond the vended version is left as it is.
    if (declared.length === 0 || !declared.every(outOfDate)) {
      continue;
    }
    changed =
      (await applyGritQL(tree, path, rewriteCapture(pattern, vended))) ||
      changed;
  }
  return changed;
};

/**
 * A version this release vends for a package the workspace's generators own, or
 * undefined for one they don't — a package the user pinned themselves keeps the
 * version they chose.
 */
const ownedTsVersion = (
  owned: OwnedDependencies,
  name: string,
): string | undefined =>
  owned.ts.has(name)
    ? TS_VERSIONS[name as keyof typeof TS_VERSIONS]
    : undefined;

/** `PY_VERSIONS` records the `==` operator; a pin holds the bare version. */
const ownedPyVersion = (
  owned: OwnedDependencies,
  name: string,
): string | undefined =>
  owned.py.has(name)
    ? PY_VERSIONS[name as keyof typeof PY_VERSIONS]?.replace(/^==/, '')
    : undefined;

/**
 * The ways a generated `Dockerfile` pins a TypeScript package's version, as
 * regex fragments taking the escaped package name.
 *
 * `npm install -g npm@x` and `npm install prisma@x` share a shape, so one
 * pattern covers both. The name is required to run to its delimiter, so a
 * package whose name merely ends with another's — `some-npm` against `npm` —
 * cannot match, and an installed version must start with a digit so a `@latest`
 * style tag is left alone.
 */
const DOCKERFILE_PIN_SHAPES: readonly ((name: string) => string)[] = [
  // Installed directly by the image build.
  (name) => `npm install (?:-g )?${name}@([0-9][^${VERSION_TERMINATORS}]*)`,
  // Held at a fixed version through an `npm pkg set` override, to clear a known
  // vulnerability in a transitive dependency.
  (name) => `overrides\\.${name}=([^${VERSION_TERMINATORS}]+)`,
];

/**
 * Every pin a generated `Dockerfile` may carry.
 *
 * Driven off the packages this workspace's generators own rather than a list of
 * the ones that happen to be pinned today: a pin added to a template in a later
 * release is then covered without this module changing, which is the whole point
 * — the versions baked into image builds are pinned precisely because they clear
 * a known vulnerability.
 *
 * A package the user pinned themselves is not owned, so it is never matched.
 */
const dockerfilePins = (owned: OwnedDependencies): EmbeddedPin[] => {
  const pins: EmbeddedPin[] = [];

  for (const name of owned.ts) {
    const vended = ownedTsVersion(owned, name);
    if (!vended) {
      continue;
    }
    for (const shape of DOCKERFILE_PIN_SHAPES) {
      pins.push({ pattern: shape(escapeRegExp(name)), vended });
    }
  }

  for (const image of Object.values(BASE_IMAGES)) {
    const [repository, tag] = splitImageReference(image);
    pins.push({
      pattern: `FROM ${escapeRegExp(repository)}:(\\S+)`,
      vended: tag,
      kind: 'tag',
    });
  }

  return pins;
};

/**
 * The repository and tag of a pinned image reference. The tag is the part after
 * the last `:`, which a registry port would otherwise be mistaken for — every
 * reference here carries one.
 */
const splitImageReference = (image: string): [string, string] => {
  const at = image.lastIndexOf(':');
  return [image.slice(0, at), image.slice(at + 1)];
};

/**
 * Sync the pins in every generated `Dockerfile`.
 *
 * Matched on the file name so a per-variant Dockerfile — `Dockerfile.bundle`,
 * say — is covered alongside the plain one.
 */
const syncDockerfiles = async (
  tree: Tree,
  owned: OwnedDependencies,
): Promise<void> => {
  const dockerfiles: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.split('/').pop()?.startsWith('Dockerfile')) {
      dockerfiles.push(path);
    }
  });

  const pins = dockerfilePins(owned);
  for (const path of dockerfiles) {
    await applyPins(tree, path, pins);
  }
};

/**
 * Sync the Python pins a generated Terraform inline script runs through
 * `uv run --with <package>==<version>`.
 *
 * These are the plugin's own pins, in a file the Terraform provider sync already
 * visits but only reads `required_providers` from. Driven off the owned Python
 * packages, so a pin added to a template later is covered without a change here.
 */
const syncTerraformScriptPins = async (
  tree: Tree,
  owned: OwnedDependencies,
): Promise<void> => {
  const terraformFiles: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('.tf')) {
      terraformFiles.push(path);
    }
  });

  const pins = [...owned.py].flatMap((name) => {
    const vended = ownedPyVersion(owned, name);
    return vended
      ? [
          {
            pattern: `--with ${escapeRegExp(name)}==([^${VERSION_TERMINATORS}]+)`,
            vended,
          },
        ]
      : [];
  });

  for (const path of terraformFiles) {
    await applyPins(tree, path, pins);
  }
};

/**
 * Sync the pinned tooling images a `project.json` target command runs.
 *
 * The image reference is built into the command string rather than declared as a
 * dependency, so nothing else reaches it.
 */
const syncTargetToolImages = async (tree: Tree): Promise<void> => {
  const projectJsons: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('project.json')) {
      projectJsons.push(path);
    }
  });

  const pins: EmbeddedPin[] = [
    {
      pattern: `public\\.ecr\\.aws/aquasecurity/trivy:([^${VERSION_TERMINATORS}']+)`,
      vended: CONTAINER_VERSIONS.trivy,
    },
  ];

  for (const path of projectJsons) {
    await applyPins(tree, path, pins);
  }
};

/**
 * Sync the vended versions baked into generated file bodies: `Dockerfile` pins,
 * the Python pins in Terraform inline scripts, and the tooling images
 * `project.json` target commands run.
 *
 * Reports nothing: each of these is read the next time the thing holding it runs,
 * so there is no lock file to reconcile and no follow-up left for the user.
 */
export const syncEmbeddedVersions = async (
  tree: Tree,
  owned: OwnedDependencies,
): Promise<void> => {
  await syncDockerfiles(tree, owned);
  await syncTerraformScriptPins(tree, owned);
  await syncTargetToolImages(tree);
};
