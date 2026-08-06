/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { visitNotIgnoredFiles } from '@nx/devkit';
import { applyGritQL } from '../ast';
import {
  BASE_IMAGES,
  CONTAINER_REPOSITORIES,
  CONTAINER_VERSIONS,
  JAVA_ARTIFACTS,
  JAVA_VERSIONS,
  MISE_VERSIONS,
  PY_VERSIONS,
  TS_VERSIONS,
} from '../versions';
import { type OwnedDependencies, ownedForFile } from './owned-dependencies';
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
 * Occurrences of one pin a single rewrite will handle.
 *
 * GritQL rewrites each match separately, so its cost grows with how many a
 * pattern matches — ~10ms an occurrence, which a hand-authored file with hundreds
 * of `RUN npm install` lines turns into minutes of an unattended `nx migrate`.
 * Past this the file is left alone and reported, since a wrong version the user
 * can see and fix beats an upgrade that appears to hang.
 */
const MAX_OCCURRENCES_PER_PIN = 100;

/**
 * Apply the pins whose declared version this release moves forward.
 *
 * A single rewrite covers every occurrence of a pin in the file, so each pin is
 * applied once. Reports whether anything changed, and whether a pin was left
 * alone for exceeding {@link MAX_OCCURRENCES_PER_PIN}.
 */
const applyPins = async (
  tree: Tree,
  path: string,
  pins: readonly EmbeddedPin[],
): Promise<{ changed: boolean; skipped: boolean }> => {
  // Read once and re-read only after a rewrite: a rewrite parses the whole file,
  // and there is a pin per owned package, so re-reading per pin would scale the
  // cost of a large file with the size of the owned set.
  let contents = tree.read(path, 'utf-8') ?? '';
  let changed = false;
  let skipped = false;

  for (const { pattern, vended, kind = 'version' } of pins) {
    const declared = declaredVersions(contents, pattern);
    if (declared.length === 0) {
      continue;
    }
    if (declared.length > MAX_OCCURRENCES_PER_PIN) {
      skipped = true;
      continue;
    }
    const outOfDate =
      kind === 'tag'
        ? (tag: string) => tag !== vended
        : (version: string) => isVendedUpgrade(vended, version);
    // A rewrite replaces every occurrence at once, so this must hold for all of
    // them — a pin already at or beyond the vended version is left as it is.
    if (!declared.every(outOfDate)) {
      continue;
    }
    if (await applyGritQL(tree, path, rewriteCapture(pattern, vended))) {
      contents = tree.read(path, 'utf-8') ?? '';
      changed = true;
    }
  }

  return { changed, skipped };
};

/**
 * The version this release vends for a package, or undefined for one it doesn't
 * vend at all.
 *
 * Ownership is applied by the caller, which only ever passes a name drawn from
 * the owned set — so a package the user pinned themselves never reaches here and
 * keeps the version they chose.
 */
const vendedTsVersion = (name: string): string | undefined =>
  TS_VERSIONS[name as keyof typeof TS_VERSIONS];

/** `PY_VERSIONS` records the `==` operator; a pin holds the bare version. */
const vendedPyVersion = (name: string): string | undefined =>
  PY_VERSIONS[name as keyof typeof PY_VERSIONS]?.replace(/^==/, '');

/**
 * The ways a generated `Dockerfile` pins a TypeScript package's version, as
 * regex fragments taking the escaped package name.
 *
 * The name is required to run to its delimiter, so a package whose name merely
 * ends with another's — `some-npm` against `npm` — cannot match, and an
 * installed version must start with a digit so a `@latest` style tag is left
 * alone.
 */
const DOCKERFILE_PIN_SHAPES: readonly ((name: string) => string)[] = [
  // Installed by the image build. `install` and its `i` alias are both used, as
  // are `-g` and several packages in one command, so the name only has to follow
  // an `npm` subcommand rather than sit right after it. The whitespace before it
  // is matched rather than asserted, since GritQL's regex engine has no
  // lookbehind — which also keeps `some-npm` from matching `npm`, and unlike a
  // `\b` boundary still reaches a `@scope/name`.
  (name) =>
    `npm (?:install|i|add)[^\\n]*?\\s${name}@([0-9][^${VERSION_TERMINATORS}]*)`,
  // Held at a fixed version through an `npm pkg set` override, to clear a known
  // vulnerability in a transitive dependency.
  (name) => `overrides\\.${name}=([^${VERSION_TERMINATORS}]+)`,
];

/**
 * Every pin a generated `Dockerfile` may carry, for the packages owned where it
 * sits.
 *
 * Driven off the owned packages rather than a list of the ones that happen to be
 * pinned today: a pin added to a template in a later release is then covered
 * without this module changing, which is the whole point — the versions baked
 * into image builds are pinned precisely because they clear a known
 * vulnerability.
 *
 * A package the user pinned themselves is not owned, so it is never matched.
 */
const dockerfilePins = (owned: {
  readonly ts: ReadonlySet<string>;
}): EmbeddedPin[] => {
  const pins: EmbeddedPin[] = [];

  for (const name of owned.ts) {
    const vended = vendedTsVersion(name);
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
      // Only a `FROM` that is the whole instruction. A build stage names itself
      // — `FROM <repo>:24 AS builder` — and picks its tag for what that stage has
      // to run: the smithy builder needs curl and unzip, which the slim tag this
      // release vends for a runtime image does not carry. Rewriting it would
      // break the build, and the two share a repository, so the instruction
      // ending is what separates them.
      pattern: `FROM ${escapeRegExp(repository)}:([^\\s]+)\\n`,
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
 * Whether a file is a Dockerfile: exactly `Dockerfile`, or the `<name>.Dockerfile`
 * form the smithy templates vend as `build.Dockerfile`.
 *
 * Deliberately exact rather than a prefix match, which would also claim a
 * `Dockerfile.bak` or a `Dockerfile.md` the user keeps beside a real one.
 */
export const isDockerfile = (filePath: string): boolean => {
  const name = filePath.split('/').pop() ?? '';
  return name === 'Dockerfile' || name.endsWith('.Dockerfile');
};

/**
 * Sync the pins in every generated Dockerfile.
 *
 * Ownership is resolved per file, so a Dockerfile is only rewritten for the
 * packages the project it belongs to owns — a sibling project owning `prisma`
 * does not license rewriting a `prisma` pin here.
 */
const syncDockerfiles = async (
  tree: Tree,
  owned: OwnedDependencies,
): Promise<string[]> => {
  const dockerfiles: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (isDockerfile(path)) {
      dockerfiles.push(path);
    }
  });

  const skipped: string[] = [];
  for (const path of dockerfiles) {
    const result = await applyPins(
      tree,
      path,
      dockerfilePins(ownedForFile(owned, path)),
    );
    if (result.skipped) {
      skipped.push(path);
    }
  }
  return skipped;
};

/** The `uv run --with` pins to apply, for the Python packages owned where a file sits. */
const terraformScriptPins = (owned: {
  readonly py: ReadonlySet<string>;
}): EmbeddedPin[] =>
  [...owned.py].flatMap((name) => {
    const vended = vendedPyVersion(name);
    return vended
      ? [
          {
            pattern: `--with ${escapeRegExp(name)}==([^${VERSION_TERMINATORS}]+)`,
            vended,
          },
        ]
      : [];
  });

/**
 * Sync the Python pins a generated Terraform inline script runs through
 * `uv run --with <package>==<version>`.
 *
 * These are the plugin's own pins, in a file the Terraform provider sync already
 * visits but only reads `required_providers` from. Driven off the owned Python
 * packages, so a pin added to a template later is covered without a change here.
 *
 * Scoped per file like the Dockerfiles. The modules carrying these live in the
 * shared Terraform project, which no single generator owns — a file there belongs
 * to no project, so it takes the workspace-wide union, which is the set of
 * generators that legitimately write into it.
 */
const syncTerraformScriptPins = async (
  tree: Tree,
  owned: OwnedDependencies,
): Promise<string[]> => {
  const terraformFiles: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('.tf')) {
      terraformFiles.push(path);
    }
  });

  const skipped: string[] = [];
  for (const path of terraformFiles) {
    const result = await applyPins(
      tree,
      path,
      terraformScriptPins(ownedForFile(owned, path)),
    );
    if (result.skipped) {
      skipped.push(path);
    }
  }
  return skipped;
};

/**
 * The ways a `uvx` invocation pins a Python version: the tool it runs, and any
 * package it adds to that tool's environment.
 *
 * A command string is JSON here, so a quote ends a version too.
 */
const UVX_PIN_SHAPES: readonly ((name: string) => string)[] = [
  (name) => `uvx --from ${name}==`,
  (name) => `--with ${name}==`,
];

/**
 * Sync the pinned tools a `project.json` target command runs: a container image,
 * and the Python versions a `uvx` invocation pins.
 *
 * Both are built into the command string rather than declared as a dependency, so
 * nothing else reaches them. The images are driven off `CONTAINER_REPOSITORIES`
 * and the Python versions off `PY_VERSIONS`, so a tool pinned in a target command
 * later is covered without a change here — the same property the Dockerfile and
 * Terraform paths get from the owned set.
 *
 * Unscoped, unlike the file-body pins: a `uvx` invocation installs nothing into
 * the project, so there is no dependency for a generator to own. A version is only
 * rewritten where this release vends that exact package at a higher one.
 */
const syncTargetToolPins = async (tree: Tree): Promise<string[]> => {
  const projectJsons: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('project.json')) {
      projectJsons.push(path);
    }
  });

  const pins: EmbeddedPin[] = [
    ...Object.entries(CONTAINER_REPOSITORIES).map(([tool, repository]) => ({
      // A command string is JSON here, so a quote ends the reference too.
      pattern: `${escapeRegExp(repository)}:([^${VERSION_TERMINATORS}']+)`,
      vended: CONTAINER_VERSIONS[tool as keyof typeof CONTAINER_VERSIONS],
    })),
    // The Smithy CLI a Smithy project's compile target runs, and the `mise` that
    // resolves it. Neither is installed into the workspace — the target fetches
    // mise with `npx` — so this command is the only place either version sits.
    {
      pattern: `exec smithy@([^${VERSION_TERMINATORS}']+)`,
      vended: MISE_VERSIONS.smithy,
    },
    {
      pattern: `npx -y mise@([^${VERSION_TERMINATORS}']+)`,
      vended: TS_VERSIONS.mise,
    },
    ...Object.keys(PY_VERSIONS).flatMap((name) => {
      const vended = vendedPyVersion(name);
      return vended
        ? UVX_PIN_SHAPES.map((shape) => ({
            pattern: `${shape(escapeRegExp(name))}([^${VERSION_TERMINATORS}']+)`,
            vended,
          }))
        : [];
    }),
  ];

  const skipped: string[] = [];
  for (const path of projectJsons) {
    if ((await applyPins(tree, path, pins)).skipped) {
      skipped.push(path);
    }
  }
  return skipped;
};

/**
 * Sync the Maven coordinates a generated `smithy-build.json` resolves.
 *
 * These are Java artifacts the Smithy CLI downloads, so they appear in no
 * manifest the dependency sync reads — this file is the only place they sit. Each
 * is matched by its `group:artifact` prefix so only the version is rewritten,
 * leaving any coordinate the user added alone.
 *
 * Unscoped like the target tool pins: nothing is installed into the project, so
 * there is no dependency for a generator to own.
 */
const syncSmithyMavenPins = async (tree: Tree): Promise<string[]> => {
  const smithyBuilds: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('smithy-build.json')) {
      smithyBuilds.push(path);
    }
  });

  const pins: EmbeddedPin[] = JAVA_ARTIFACTS.map((artifact) => ({
    // A coordinate is a JSON string here, so a quote ends the version.
    pattern: `${escapeRegExp(artifact)}:([^${VERSION_TERMINATORS}']+)`,
    vended: JAVA_VERSIONS[artifact],
  }));

  const skipped: string[] = [];
  for (const path of smithyBuilds) {
    if ((await applyPins(tree, path, pins)).skipped) {
      skipped.push(path);
    }
  }
  return skipped;
};

/**
 * Sync the vended versions baked into generated file bodies: `Dockerfile` pins,
 * the Python pins in Terraform inline scripts, the tooling `project.json` target
 * commands run, and the Maven coordinates a `smithy-build.json` resolves.
 *
 * Reports only the files left for the user: a pin that takes effect the next time
 * the thing holding it runs needs no follow-up, but one this skipped for holding
 * more occurrences than it will rewrite at once does.
 *
 * @returns paths whose pins were left as they were
 */
export const syncEmbeddedVersions = async (
  tree: Tree,
  owned: OwnedDependencies,
): Promise<string[]> => [
  ...(await syncDockerfiles(tree, owned)),
  ...(await syncTerraformScriptPins(tree, owned)),
  ...(await syncTargetToolPins(tree)),
  ...(await syncSmithyMavenPins(tree)),
];
