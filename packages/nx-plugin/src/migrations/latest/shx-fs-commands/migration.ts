/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  removeDependenciesFromPackageJson,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { TS_VERSIONS } from '../../../utils/versions.js';

/**
 * One `shx` replaces the four single purpose filesystem CLIs the targets ran.
 * Its `cp` is several times faster than `ncp` on a large tree, and a single
 * dependency covers every operation the generators vend.
 *
 * `shx cp -R` follows POSIX `cp`, which nests the source inside an existing
 * destination rather than merging into it, so a directory copy becomes
 * `shx cp -R <src>/. <dst>`. That form also copies dotfiles, which a `<src>/*`
 * glob would silently skip — `node_modules/.bin` depends on them. A file copy
 * needs neither, so it stays a plain `shx cp`.
 *
 * Whether an `ncp` copied a file or a directory is not recoverable from the
 * command, so each source is matched against the shapes the generators vend. A
 * command that matches none of them has been edited by the user, and is left
 * alone and reported: rewriting it with the wrong form would either nest a
 * directory a level too deep or fail outright.
 */

/** The four CLIs this replaces, dropped from the root manifest. */
const REPLACED_PACKAGES = ['ncp', 'rimraf', 'make-dir-cli', 'cpy-cli'];

/**
 * Sources the generators copy as a whole directory. Everything else they copy
 * names a single file, so an unmatched source is neither and is left untouched.
 *
 * - a Python bundle (`bundle-arm`/`bundle-x86`), copied into a package or an
 *   image build context
 * - a Python module tree, copied into a code package under its module name
 * - the generated Server SDK, copied into a Smithy API's `src/generated`
 * - `prisma` and Alembic `migrations`, copied into a migration bundle
 */
const DIRECTORY_SOURCE = [
  /(^|\/)bundle-(arm|x86)$/,
  /(^|\/)build\/ssdk$/,
  /(^|\/)prisma$/,
  /(^|\/)migrations$/,
];

/**
 * Files the generators copy whose name carries no extension, so the extension
 * test below would otherwise read them as directories. A `Dockerfile` variant is
 * renamed on the way in (`Dockerfile.migration` -> `Dockerfile`), so this matches
 * the source's leading segment rather than the whole name.
 */
const EXTENSIONLESS_FILE = /(^|\/)Dockerfile(\.[^/]+)?$/;

/**
 * A Python code package copies the project's source root in under the module
 * name, which is the same segment repeated — `.../src/my_agent my_agent`. The
 * source is a directory whose name is the project's, so it is recognised by the
 * destination repeating the source's last segment rather than by a fixed name.
 */
const isModuleTreeCopy = (src: string, dst: string): boolean => {
  const segment = src.split('/').pop();
  return (
    !!segment && !segment.includes('.') && dst.split('/').pop() === segment
  );
};

const isDirectorySource = (src: string, dst: string): boolean =>
  !EXTENSIONLESS_FILE.test(src) &&
  (DIRECTORY_SOURCE.some((p) => p.test(src)) || isModuleTreeCopy(src, dst));

/**
 * A copy naming a file on both sides, which every other vended `ncp` does. A
 * name carrying an extension is a file — as is a `Dockerfile`, which does not.
 */
const isFileCopy = (src: string, dst: string): boolean => {
  const [s, d] = [src.split('/').pop() ?? '', dst.split('/').pop() ?? ''];
  return (
    (s.includes('.') || EXTENSIONLESS_FILE.test(src)) &&
    (d.includes('.') || EXTENSIONLESS_FILE.test(dst))
  );
};

const NCP = /^ncp\s+(\S+)\s+(\S+)$/;
const RIMRAF = /^rimraf\s+(\S+)$/;
const MAKE_DIR = /^make-dir\s+(\S+)$/;
/** The one shape `cpGlobToFile` vends, whose glob is quoted and dest renamed. */
const CPY = /^cpy\s+"([^"]+)"\s+(\S+)\s+--flat\s+--rename=(\S+)$/;

/**
 * Rewrite one command, or return null to leave it alone. Anything already using
 * `shx` is returned unchanged so a re-run is a no-op.
 */
const rewrite = (command: string): string | null => {
  const trimmed = command.trim();

  const rimraf = RIMRAF.exec(trimmed);
  if (rimraf) return `shx rm -rf ${rimraf[1]}`;

  const makeDir = MAKE_DIR.exec(trimmed);
  if (makeDir) return `shx mkdir -p ${makeDir[1]}`;

  const cpy = CPY.exec(trimmed);
  if (cpy) {
    return `shx mkdir -p ${cpy[2]} && shx cp "${cpy[1]}" ${cpy[2]}/${cpy[3]}`;
  }

  const ncp = NCP.exec(trimmed);
  if (ncp) {
    const [, src, dst] = ncp;
    if (isDirectorySource(src, dst)) return `shx cp -R ${src}/. ${dst}`;
    if (isFileCopy(src, dst)) return `shx cp ${src} ${dst}`;
    return null;
  }

  return null;
};

/** Whether a command is one this migration is responsible for rewriting. */
const isReplacedCommand = (command: string): boolean =>
  /^(ncp|rimraf|make-dir|cpy)\s/.test(command.trim());

const divergedStep = (
  projectName: string,
  targetName: string,
  command: string,
) =>
  `${projectName}:${targetName}: left \`${command}\` untouched - it does not match a copy the generator produced, so whether it copies a file or a directory could not be determined. Replace it by hand with \`shx cp <src> <dst>\` for a file, or \`shx cp -R <src>/. <dst>\` for a directory (the trailing \`/.\` merges the contents instead of nesting the directory inside the destination).`;

/**
 * Rewrite every command a target runs, in place. Commands are either strings or
 * `{ command }` objects, and a target uses `command` for a single one.
 */
const migrateTarget = (
  projectName: string,
  targetName: string,
  target: TargetConfiguration,
  nextSteps: string[],
): boolean => {
  const options = target.options as
    | { command?: unknown; commands?: unknown }
    | undefined;
  if (!options) return false;

  let changed = false;

  const rewriteOne = (command: string): string => {
    if (!isReplacedCommand(command)) return command;
    const replacement = rewrite(command);
    if (replacement === null) {
      nextSteps.push(divergedStep(projectName, targetName, command.trim()));
      return command;
    }
    changed = true;
    return replacement;
  };

  if (typeof options.command === 'string') {
    options.command = rewriteOne(options.command);
  }

  if (Array.isArray(options.commands)) {
    options.commands = options.commands.map((entry) => {
      if (typeof entry === 'string') return rewriteOne(entry);
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { command?: unknown }).command === 'string'
      ) {
        const e = entry as { command: string };
        return { ...e, command: rewriteOne(e.command) };
      }
      return entry;
    });
  }

  return changed;
};

/** Every command every target in the workspace runs. */
const allCommands = (tree: Tree): string[] => {
  const commands: string[] = [];
  for (const [, project] of getProjects(tree)) {
    for (const target of Object.values(project.targets ?? {})) {
      const options = target.options as
        | { command?: unknown; commands?: unknown }
        | undefined;
      if (typeof options?.command === 'string') commands.push(options.command);
      if (Array.isArray(options?.commands)) {
        for (const entry of options.commands) {
          if (typeof entry === 'string') commands.push(entry);
          else if (
            typeof (entry as { command?: unknown })?.command === 'string'
          )
            commands.push((entry as { command: string }).command);
        }
      }
    }
  }
  return commands;
};

/** The CLI a package provides, as the rewritten commands would name it. */
const CLI_NAME: Record<string, string> = {
  ncp: 'ncp',
  rimraf: 'rimraf',
  'make-dir-cli': 'make-dir',
  'cpy-cli': 'cpy',
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    let changed = false;

    for (const [targetName, target] of Object.entries(project.targets ?? {})) {
      changed =
        migrateTarget(projectName, targetName, target, nextSteps) || changed;
    }

    if (changed) {
      updateProjectConfiguration(
        tree,
        projectName,
        project as ProjectConfiguration,
      );
    }
  }

  addDependenciesToPackageJson(tree, {}, { shx: TS_VERSIONS.shx });

  // Only the CLIs nothing runs any more: a command this migration declined to
  // rewrite, or one the user added, still needs the package it calls.
  const commands = allCommands(tree);
  const unused = REPLACED_PACKAGES.filter(
    (pkg) =>
      !commands.some((c) =>
        new RegExp(`(^|[^\\w-])${CLI_NAME[pkg]}\\s`).test(c),
      ),
  );
  removeDependenciesFromPackageJson(tree, unused, unused);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
