/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import type { OpenApiCodegenTarget } from '../../../open-api/codegen/executor-schema';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { normalizeTargetKeyOrder } from '../../../utils/nx.js';
import { OPEN_API_CODEGEN_EXECUTOR } from '../../../utils/open-api-codegen-target.js';

/**
 * Codegen targets ran `nx g @aws/nx-plugin:open-api#<generator>` through
 * `nx:run-commands`, paying a second full Nx bootstrap — project graph, plugin
 * resolution and schema validation — for every codegen step. They now use the
 * `open-api-codegen` executor, which runs the same generator in the Nx process
 * that is already running.
 *
 * Only the command shape the generators produced is rewritten. A target that has
 * been customised — an extra flag, a chained command, options beyond `commands` —
 * is the user's, so it is left as it is and reported.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

/** The generators the executor can run, by the collection name they had. */
const GENERATORS: Record<string, OpenApiCodegenTarget> = {
  'open-api#ts-client': 'ts-client',
  'open-api#ts-hooks': 'ts-hooks',
  'open-api#ts-metadata': 'ts-metadata',
  'open-api#json-metadata': 'json-metadata',
};

/**
 * Matches a whole generated codegen command, binding the generator name and its
 * two paths. Anchored, so a command carrying anything else does not match and is
 * reported instead of rewritten.
 */
const CODEGEN_COMMAND =
  /^nx g @aws\/nx-plugin:(?<generator>[\w#-]+) --openApiSpecPath="(?<specPath>[^"]+)" --outputPath="(?<outputPath>[^"]+)" --no-interactive$/;

interface CodegenOptions {
  readonly generator: OpenApiCodegenTarget;
  readonly openApiSpecPath: string;
  readonly outputPath: string;
}

/**
 * The command a target runs, when it is a single-command `nx:run-commands` — the
 * shape the generators produced. A target carrying several commands, or options
 * beyond `commands`, has diverged.
 */
const singleCommand = (target: TargetConfiguration): string | undefined => {
  if (target.executor !== 'nx:run-commands') return undefined;
  const options = target.options as Record<string, unknown> | undefined;
  if (!options || Object.keys(options).length !== 1) return undefined;
  const commands = options.commands;
  if (!Array.isArray(commands) || commands.length !== 1) return undefined;
  return typeof commands[0] === 'string' ? commands[0] : undefined;
};

/** Parses a generated codegen command, or undefined if it is not one. */
const parseCodegenCommand = (command: string): CodegenOptions | undefined => {
  const groups = CODEGEN_COMMAND.exec(command)?.groups;
  if (!groups) return undefined;
  const generator = GENERATORS[groups.generator];
  if (!generator) return undefined;
  return {
    generator,
    openApiSpecPath: groups.specPath,
    outputPath: groups.outputPath,
  };
};

/**
 * Whether a target invokes an OpenAPI generator without being the shape the
 * generators produced, so it must be reported rather than rewritten. The `watch`
 * targets that wrap `nx run <project>:<codegen target>` are excluded: they
 * invoke the codegen target rather than the generator, so they stay as they are.
 */
const hasCustomisedCodegenCommand = (target: TargetConfiguration): boolean =>
  target.executor === 'nx:run-commands' &&
  JSON.stringify(target.options ?? {}).includes('@aws/nx-plugin:open-api#');

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    let changed = false;

    for (const [targetName, target] of Object.entries(project.targets ?? {})) {
      const command = singleCommand(target);
      const options = command ? parseCodegenCommand(command) : undefined;

      if (!options) {
        if (hasCustomisedCodegenCommand(target)) {
          nextSteps.push(
            `${projectName}:${targetName} has diverged from the generated shape — left untouched. Switch it to the '${OPEN_API_CODEGEN_EXECUTOR}' executor to avoid a nested Nx invocation.`,
          );
        }
        continue;
      }

      project.targets[targetName] = normalizeTargetKeyOrder({
        ...target,
        executor: OPEN_API_CODEGEN_EXECUTOR,
        options,
      });
      changed = true;
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, project);
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
