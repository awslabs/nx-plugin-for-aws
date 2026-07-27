/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * Exercises the `ts#nx-plugin`, `ts#nx-generator` and `ts#nx-migration`
 * generators end-to-end and, crucially, *runs* the generated generator.
 *
 * The generated plugin is `"type": "module"`, so Nx 23 loads its unbuilt `.ts`
 * generators as ESM via Node's native type stripping — no swc/ts-node
 * transpiler. This test regresses if the vended generator stops being valid
 * ESM (e.g. `__dirname` instead of `import.meta.dirname`, or a relative import
 * missing its `.js` extension), since loading the generator below would fail.
 */
describe('smoke test - nx-plugin', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/nx-plugin-${pkgMgr}`;
  let projectRoot: string;

  beforeAll(
    async () => {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
      projectRoot = await createTestWorkspace(
        pkgMgr,
        targetDir,
        'nx-plugin-test',
        'cdk',
      );
    },
    15 * 60 * 1000,
  );

  afterAll(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
  });

  it(
    'should generate a plugin and run its custom generator',
    async () => {
      const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

      // Generate the Nx plugin and a custom generator within it.
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-plugin --name=plugin --directory=tools --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-generator --project=@nx-plugin-test/plugin --name=my#generator --no-interactive`,
        opts,
      );

      // Run the generated generator. Nx loads the unbuilt `.ts` source as ESM
      // via Node's native type stripping (the plugin is `type: module`).
      await runCLI(
        `generate @nx-plugin-test/plugin:my#generator --exampleOption=test --no-interactive`,
        opts,
      );

      // The sample generator writes hello.ts into target/dir.
      expect(existsSync(join(projectRoot, 'target/dir/hello.ts'))).toBe(true);
    },
    15 * 60 * 1000,
  );

  it(
    'should compile and run a generator that imports from the @aws/nx-plugin SDK',
    async () => {
      const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

      // Add a second generator to the plugin (the plugin already depends on
      // @aws/nx-plugin, added by ts#nx-plugin).
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-generator --project=@nx-plugin-test/plugin --name=sdk-consumer --no-interactive`,
        opts,
      );

      // Replace its implementation so it imports a generator from the SDK and
      // delegates to it. Exercises a vended ESM generator depending on the
      // published @aws/nx-plugin SDK (ESM interop + native strip-types).
      const generatorPath = join(
        projectRoot,
        'tools/plugin/src/sdk-consumer/generator.ts',
      );
      writeFileSync(
        generatorPath,
        [
          `import { type Tree } from '@nx/devkit';`,
          `import { tsProjectGenerator } from '@aws/nx-plugin/sdk/ts';`,
          `import type { SdkConsumerGeneratorSchema } from './schema.js';`,
          ``,
          `export const sdkConsumerGenerator = async (`,
          `  tree: Tree,`,
          `  options: SdkConsumerGeneratorSchema,`,
          `) => {`,
          `  await tsProjectGenerator(tree, { name: 'sdk-consumed-lib' });`,
          `};`,
          ``,
          `export default sdkConsumerGenerator;`,
          ``,
        ].join('\n'),
        'utf-8',
      );

      // It must type-check / compile (plugin `package` target uses tsc under
      // moduleResolution: nodenext against the installed @aws/nx-plugin types).
      await runCLI(`run @nx-plugin-test/plugin:compile`, opts);

      // And it must run: Nx loads it via native strip-types, it imports the
      // SDK generator and delegates to it, which scaffolds a TS project.
      await runCLI(
        `generate @nx-plugin-test/plugin:sdk-consumer --exampleOption=test --no-interactive`,
        opts,
      );

      expect(
        existsSync(join(projectRoot, 'sdk-consumed-lib/src/index.ts')),
      ).toBe(true);
    },
    15 * 60 * 1000,
  );

  it(
    'should scaffold migrations of each kind and compile them',
    async () => {
      const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };
      const project = '@nx-plugin-test/plugin';
      // New migrations land in `latest` until a release claims them
      const migration = (name: string, file: string) =>
        join(projectRoot, 'tools/plugin/src/migrations/latest', name, file);

      // Deterministic (default) — the plugin has no migrations.json yet, so
      // this run must create it and wire up the nx-migrations field.
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-migration --project=${project} --name=rename-foo-target --description="Rename the foo target to bar" --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-migration --project=${project} --name=migrate-custom-handlers --description="Update custom handlers" --kind=agentic --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-migration --project=${project} --name=upgrade-framework --description="Upgrade the framework" --kind=hybrid --no-interactive`,
        opts,
      );

      // Each kind scaffolds only the files it uses
      expect(existsSync(migration('rename-foo-target', 'migration.ts'))).toBe(
        true,
      );
      expect(existsSync(migration('rename-foo-target', 'prompt.md'))).toBe(
        false,
      );
      expect(
        existsSync(migration('migrate-custom-handlers', 'prompt.md')),
      ).toBe(true);
      expect(
        existsSync(migration('migrate-custom-handlers', 'migration.ts')),
      ).toBe(false);
      expect(existsSync(migration('upgrade-framework', 'migration.ts'))).toBe(
        true,
      );
      expect(existsSync(migration('upgrade-framework', 'prompt.md'))).toBe(
        true,
      );

      // migrations.json is created and registers each kind's fields, with no
      // version (the plugin author stamps versions at release time).
      const migrationsJson = JSON.parse(
        readFileSync(
          join(projectRoot, 'tools/plugin/migrations.json'),
          'utf-8',
        ),
      );
      expect(migrationsJson.generators['rename-foo-target']).toEqual({
        description: 'Rename the foo target to bar',
        implementation: `./src/migrations/latest/rename-foo-target/migration`,
      });
      expect(migrationsJson.generators['migrate-custom-handlers']).toEqual({
        description: 'Update custom handlers',
        prompt: `./src/migrations/latest/migrate-custom-handlers/prompt.md`,
      });
      expect(migrationsJson.generators['upgrade-framework']).toEqual({
        description: 'Upgrade the framework',
        implementation: `./src/migrations/latest/upgrade-framework/migration`,
        prompt: `./src/migrations/latest/upgrade-framework/prompt.md`,
      });

      // The plugin's package.json points nx migrate at the manifest
      const pluginPackageJson = JSON.parse(
        readFileSync(join(projectRoot, 'tools/plugin/package.json'), 'utf-8'),
      );
      expect(pluginPackageJson['nx-migrations']).toEqual({
        migrations: './migrations.json',
      });

      // The scaffolded codemods must type-check against @nx/devkit
      await runCLI(`run ${project}:compile`, opts);
    },
    15 * 60 * 1000,
  );
});
