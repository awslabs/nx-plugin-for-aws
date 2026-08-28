/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson, visitNotIgnoredFiles } from '@nx/devkit';
import { updateToml } from '../toml.js';
import {
  LAMBDA_RUNTIME_VERSIONS,
  pyenvPythonVersion,
  pyprojectPythonDependency,
} from '../versions.js';
import { isVendedUpgrade } from './vended-upgrade.js';

/**
 * Sync the Python language version a generated workspace builds and lints against
 * to the Lambda Python runtime it deploys onto.
 *
 * These are workspace-wide rather than scoped to the infrastructure projects: uv
 * writes a `.python-version` per Python project wherever it sits, and a bundle
 * target lives in the project it belongs to.
 */

/**
 * Sync the interpreter a uv project pins to the Lambda Python runtime.
 *
 * `.python-version` holds the exact interpreter and `[project].requires-python`
 * its lower bound; Ruff's `target-version` is derived from the latter, so leaving
 * these behind lints against a different version than the function runs on. Only
 * moved forward, and only from a value this plugin vended.
 */
export const syncProjectPythonVersion = (tree: Tree): string[] => {
  const updated: string[] = [];
  const vendedInterpreter = pyenvPythonVersion();
  const vendedRequires = pyprojectPythonDependency();

  // Every `.python-version`, not just the root: uv writes one per project too,
  // and a project left behind resolves a different interpreter than it deploys on.
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path !== '.python-version' && !path.endsWith('/.python-version')) {
      return;
    }
    const declared = (tree.read(path, 'utf-8') ?? '').trim();
    if (declared && isVendedUpgrade(vendedInterpreter, declared)) {
      tree.write(path, `${vendedInterpreter}\n`);
      updated.push(path);
    }
  });

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('pyproject.toml')) {
      return;
    }
    let changed = false;
    updateToml(tree, path, (toml) => {
      const project = toml.project as Record<string, unknown> | undefined;
      const declared = project?.['requires-python'];
      if (typeof declared !== 'string') {
        return toml;
      }
      // Only the `>=<major>.<minor>` shape the generators write, so a specifier
      // the user tightened or widened is theirs to keep.
      const lower = /^>=\s*(\d+\.\d+)$/.exec(declared.trim());
      if (lower && isVendedUpgrade(LAMBDA_RUNTIME_VERSIONS.python, lower[1])) {
        project!['requires-python'] = vendedRequires;
        changed = true;
      }
      return toml;
    });
    if (changed) {
      updated.push(path);
    }
  });

  return updated;
};

/**
 * Sync the Python version a `bundle` target resolves wheels against.
 *
 * The target pins `--python-platform` but earlier releases pinned no
 * `--python-version`, so wheels resolved against whichever interpreter the build
 * machine had rather than the Lambda runtime. Both the missing flag and a stale
 * one are corrected, keyed on the `uv pip install` the generators write.
 */
export const syncPythonBundleVersion = (tree: Tree): string[] => {
  const updated: string[] = [];
  const vended = LAMBDA_RUNTIME_VERSIONS.python;

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('project.json')) {
      return;
    }
    let changed = false;
    updateJson(tree, path, (json) => {
      for (const target of Object.values(
        (json.targets ?? {}) as Record<string, { options?: unknown }>,
      )) {
        const options = target.options as { commands?: unknown[] } | undefined;
        if (!Array.isArray(options?.commands)) {
          continue;
        }
        options.commands = options.commands.map((command) => {
          if (
            typeof command !== 'string' ||
            !command.includes('uv pip install') ||
            !command.includes('--python-platform')
          ) {
            return command;
          }
          const declared = /--python-version (\S+)/.exec(command);
          if (!declared) {
            changed = true;
            return command.replace(
              /(--python-platform \S+)/,
              `$1 --python-version ${vended}`,
            );
          }
          if (isVendedUpgrade(vended, declared[1])) {
            changed = true;
            return command.replace(
              /--python-version \S+/,
              `--python-version ${vended}`,
            );
          }
          return command;
        });
      }
      return json;
    });
    if (changed) {
      updated.push(path);
    }
  });

  return updated;
};
