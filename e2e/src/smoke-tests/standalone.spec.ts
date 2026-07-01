/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { describe, it } from 'vitest';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * Verifies that every generator builds in isolation, so a project generator
 * that forgets a dependency is caught here rather than being masked by another
 * generator happening to add it in a shared workspace.
 *
 * Cases are derived from `generators.json`, so new generators are picked up
 * automatically. Each runs with default arguments, supplying only the required
 * `name` / `project` we control. Generators with other unsatisfiable required
 * arguments (e.g. `connection`, which needs a source and target project) are
 * skipped.
 */

const PLUGIN_ROOT = join(__dirname, '../../../packages/nx-plugin');

// Required arguments this test supplies itself; any other required argument
// must have a schema default for the generator to be exercised here.
const SATISFIABLE_ARGS = new Set(['name', 'project']);

// Component generators that attach to a specific kind of project rather than a
// plain ts#project / py#project.
const COMPONENT_BASE_OVERRIDES: Record<string, string> = {
  'ts#website#auth': 'ts#website',
};

interface GeneratorCase {
  generator: string;
  hasName: boolean;
}

const readSchema = (
  schemaPath: string,
): {
  required?: string[];
  properties?: Record<string, { default?: unknown }>;
} => JSON.parse(readFileSync(join(PLUGIN_ROOT, schemaPath), 'utf-8'));

const categorizeGenerators = () => {
  const { generators } = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, 'generators.json'), 'utf-8'),
  ) as {
    generators: Record<string, { schema: string; hidden?: boolean }>;
  };

  const standalone: GeneratorCase[] = [];
  const components: GeneratorCase[] = [];

  for (const [generator, config] of Object.entries(generators)) {
    if (config.hidden) {
      continue;
    }
    const schema = readSchema(config.schema);
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    // Skip generators with required arguments we can neither supply nor
    // default (e.g. connection generators needing existing projects).
    const hasUnsatisfiableArgs = required.some(
      (arg) =>
        !SATISFIABLE_ARGS.has(arg) && !('default' in (properties[arg] ?? {})),
    );
    if (hasUnsatisfiableArgs) {
      continue;
    }

    const generatorCase: GeneratorCase = {
      generator,
      hasName: 'name' in properties,
    };
    (required.includes('project') ? components : standalone).push(
      generatorCase,
    );
  }

  return { standalone, components };
};

const { standalone, components } = categorizeGenerators();

const freshWorkspace = async (generator: string): Promise<string> => {
  const targetDir = join(
    tmpProjPath(),
    `standalone-${generator.replace(/[^a-z0-9]+/gi, '-')}`,
  );
  console.log(`Cleaning target directory ${targetDir}`);
  if (existsSync(targetDir)) {
    rmSync(targetDir, { force: true, recursive: true });
  }
  ensureDirSync(targetDir);
  return createTestWorkspace('pnpm', targetDir, 'proj', 'cdk');
};

const syncAndBuild = async (cwd: string) => {
  const opts = { cwd, env: { NX_DAEMON: 'false' } };
  await runCLI(`sync --verbose`, opts);
  await runCLI(
    `run-many --target build --all --output-style=stream --verbose`,
    opts,
  );
};

// Each generator runs in its own isolated workspace and keeps the default
// dependency install, so the build still verifies each generator declares the
// dependencies it needs. Because the workspaces are fully isolated, the cases
// run concurrently (bounded by `maxConcurrency` in the vitest config).
describe.concurrent('smoke test - standalone projects', () => {
  it.each(
    standalone,
  )('should generate and build $generator in isolation', async ({
    generator,
    hasName,
  }) => {
    const cwd = await freshWorkspace(generator);
    await runCLI(
      `generate @aws/nx-plugin:${generator} ${hasName ? '--name=test' : ''} --no-interactive`,
      { cwd, env: { NX_DAEMON: 'false' } },
    );
    await syncAndBuild(cwd);
  });
});

describe.concurrent('smoke test - standalone components', () => {
  it.each(
    components,
  )('should generate and build $generator on its own project', async ({
    generator,
    hasName,
  }) => {
    const cwd = await freshWorkspace(generator);
    const opts = { cwd, env: { NX_DAEMON: 'false' } };

    const baseGenerator =
      COMPONENT_BASE_OVERRIDES[generator] ??
      (generator.startsWith('py') ? 'py#project' : 'ts#project');

    await runCLI(
      `generate @aws/nx-plugin:${baseGenerator} --name=base --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:${generator} --project=base ${hasName ? '--name=test' : ''} --no-interactive`,
      opts,
    );
    await syncAndBuild(cwd);
  });
});
