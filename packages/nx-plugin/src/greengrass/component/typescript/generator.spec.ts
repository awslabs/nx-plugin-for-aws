/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addProjectConfiguration,
  logger,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { FsTree, flushChanges } from 'nx/src/generators/tree';
import { tsProjectGenerator } from '../../../ts/lib/generator.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import { sortObjectKeys } from '../../../utils/object.js';
import * as projectPaths from '../../../utils/paths.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import {
  expectTypeScriptToParse,
  TypeScriptVerifier,
} from '../../../utils/test/ts.spec.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { greengrassComponentGenerator } from '../generator.js';
import { GREENGRASS_COMPONENT_GENERATOR_INFO } from '../metadata.js';
import type { GreengrassComponentGeneratorSchema } from '../schema.js';

const sharedConstructsSeedDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

const seedTypeScriptProject = (tree: Tree) => {
  addProjectConfiguration(tree, 'test-project', {
    name: 'test-project',
    root: 'packages/test-project',
    sourceRoot: 'packages/test-project/src',
    targets: {
      compile: {
        executor: '@nx/js:tsc',
      },
    },
  });
  tree.write('packages/test-project/tsconfig.json', '{}');
  tree.write(
    'packages/test-project/package.json',
    JSON.stringify({ name: '@proj/test-project', type: 'module' }),
  );
  tree.write('packages/test-project/src/index.ts', 'export {};');
};

/**
 * Exercises the public unified generator with an explicit `language`.
 */
const generateTypeScript = (
  tree: Tree,
  options: Omit<GreengrassComponentGeneratorSchema, 'language'>,
) => greengrassComponentGenerator(tree, { ...options, language: 'typescript' });

describe('greengrass#component generator (typescript)', () => {
  let tree: Tree;
  // Only exercised against ipc=false: main.ts's ipc=true branch imports
  // aws-iot-device-sdk-v2, which is not installed in this workspace (it is
  // only ever vended into a generated user workspace, not consumed by the
  // plugin's own tests), so it cannot be loaded into the verifier's project.
  // That branch gets `expectTypeScriptToParse` instead.
  const verifier = new TypeScriptVerifier();

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a greengrass component with the correct structure', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    expect(
      tree.exists('packages/test-project/greengrass/my-component/recipe.yaml'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/test-project/greengrass/my-component/gdk-config.json',
      ),
    ).toBeFalsy();
    expect(
      tree.exists('packages/test-project/src/greengrass/my-component/main.ts'),
    ).toBeTruthy();
    // ipc defaults to false, so no Install lifecycle manifest is vended.
    expect(
      tree.exists('packages/test-project/greengrass/my-component/package.json'),
    ).toBeFalsy();

    const recipe = tree.read(
      'packages/test-project/greengrass/my-component/recipe.yaml',
      'utf-8',
    );
    expect(recipe).toContain("RecipeFormatVersion: '2020-01-25'");
    expect(recipe).toContain('ComponentName: com.proj.MyComponent');
    expect(recipe).toContain('ComponentVersion: 1.0.0');
    // The load-bearing invariant: the artifact Greengrass unarchives is named
    // after the zip `<c>-artifact` writes, which is what makes the
    // `{artifacts:decompressedPath}/<c>/` path in the Run script resolve.
    expect(recipe).toContain(
      'Run: node {artifacts:decompressedPath}/my-component/index.js',
    );
    expect(recipe).toContain(
      'Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
    );
    expect(recipe).toContain('Unarchive: ZIP');
    expect(recipe).not.toContain('accessControl');
    expect(recipe).not.toContain('Install:');
    expect(recipe).not.toContain('Setenv:');

    const mainTs = tree.read(
      'packages/test-project/src/greengrass/my-component/main.ts',
      'utf-8',
    );
    expect(mainTs).not.toContain('aws-iot-device-sdk-v2');
    verifier.expectTypeScriptToCompile(tree, [
      'packages/test-project/src/greengrass/my-component/main.ts',
    ]);
  });

  it('should wire the IPC client, accessControl block and vendored addon Setenv when ipc is true', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    const recipe = tree.read(
      'packages/test-project/greengrass/my-component/recipe.yaml',
      'utf-8',
    );
    expect(recipe).toContain('aws.greengrass.ipc.pubsub');
    expect(recipe).toContain('aws.greengrass#PublishToTopic');
    expect(recipe).toContain(
      'AWS_CRT_NODEJS_BINARY_RELATIVE_PATH: native/aws-crt/linux-arm64-glibc/aws-crt-nodejs.node',
    );
    expect(recipe).not.toContain('Install:');

    const mainTs = tree.read(
      'packages/test-project/src/greengrass/my-component/main.ts',
      'utf-8',
    );
    expect(mainTs).toContain(
      "import { greengrasscoreipc } from 'aws-iot-device-sdk-v2';",
    );
    expect(mainTs).toContain('greengrasscoreipc.createClient()');
    // Syntax only - aws-iot-device-sdk-v2 is never installed here, so the
    // verifier cannot type check this branch.
    expectTypeScriptToParse(tree, [
      'packages/test-project/src/greengrass/my-component/main.ts',
    ]);

    const projectPackageJson = JSON.parse(
      tree.read('packages/test-project/package.json', 'utf-8'),
    );
    expect(
      projectPackageJson.dependencies['aws-iot-device-sdk-v2'],
    ).toBeDefined();
  });

  it('should not vend a package.json beside the recipe when ipc is true', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    expect(
      tree.exists('packages/test-project/greengrass/my-component/package.json'),
    ).toBeFalsy();
  });

  it('should not add aws-iot-device-sdk-v2 to the project package.json when ipc is false', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    const projectPackageJson = JSON.parse(
      tree.read('packages/test-project/package.json', 'utf-8'),
    );
    expect(
      projectPackageJson.dependencies?.['aws-iot-device-sdk-v2'],
    ).toBeUndefined();
  });

  it('should wire the bundle target with rolldown, bundling aws-iot-device-sdk-v2 when ipc is true', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.bundle.options.command).toBe(
      'rolldown -c rolldown.config.ts',
    );

    const rolldownConfig = tree.read(
      'packages/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('src/greengrass/my-component/main.ts');
    expect(rolldownConfig).toContain(
      '../../dist/packages/test-project/bundle/greengrass/my-component/index.js',
    );
    expect(rolldownConfig).not.toContain('external:');
    expect(rolldownConfig).toContain("platform: 'node'");
  });

  it('should normalize Windows relative paths in bundle inputs and component metadata', async () => {
    seedTypeScriptProject(tree);
    const relativePath = vi
      .spyOn(projectPaths, 'toProjectRelativePath')
      .mockImplementation((project, absolutePath) =>
        path.win32.relative(project.root, absolutePath),
      );

    try {
      const options = {
        project: 'test-project',
        name: 'my-component',
        ipc: true,
        infra: 'none' as const,
      };
      await generateTypeScript(tree, options);
      await generateTypeScript(tree, options);

      expect(relativePath).toHaveReturnedWith(
        'src\\greengrass\\my-component\\main.ts',
      );
      const rolldownConfig = tree.read(
        'packages/test-project/rolldown.config.ts',
        'utf-8',
      );
      expect(rolldownConfig).toContain(
        "input: 'src/greengrass/my-component/main.ts'",
      );
      expect(
        rolldownConfig.match(/src\/greengrass\/my-component\/main\.ts/g),
      ).toHaveLength(1);
      const projectConfig = JSON.parse(
        tree.read('packages/test-project/project.json', 'utf-8'),
      );
      expect(projectConfig.metadata.components).toEqual([
        expect.objectContaining({
          name: 'my-component',
          path: 'src/greengrass/my-component/main.ts',
        }),
      ]);
    } finally {
      relativePath.mockRestore();
    }
  });

  it('should not mark anything external when ipc is false', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    const rolldownConfig = tree.read(
      'packages/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).not.toContain('external:');
  });

  it('should wire the artifact, deploy-local and logs targets with the correct dependencies', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const targets = projectConfig.targets;

    expect(targets['my-component-artifact']).toBeDefined();
    expect(targets['my-component-artifact'].dependsOn).toEqual(['bundle']);
    expect(targets['my-component-artifact'].options.command).toContain(
      'build-artifact.ts',
    );
    expect(targets['my-component-artifact'].options.command).toContain(
      'dist/{projectRoot}/bundle/greengrass/my-component',
    );
    // The vended scripts sit outside the project, so the cache key must
    // name them or a refreshed script would serve a stale cached artifact.
    expect(targets['my-component-artifact'].inputs).toContain(
      '{workspaceRoot}/packages/common/scripts/src/greengrass/**/*',
    );
    expect(targets['my-component-artifact'].outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/greengrass/my-component/greengrass-build',
    ]);

    expect(targets['my-component-deploy-local']).toBeDefined();
    expect(targets['my-component-deploy-local'].dependsOn).toEqual([
      'my-component-artifact',
    ]);
    expect(targets['my-component-deploy-local'].options.command).toContain(
      'deploy-local.ts',
    );

    expect(targets['my-component-logs']).toBeDefined();
    expect(targets['my-component-logs'].continuous).toBe(true);
    expect(targets['my-component-logs'].options.command).toContain(
      'component-logs.ts',
    );

    // The artifact is wired onto both build and assemble.
    expect(targets.build.dependsOn).toContain('my-component-artifact');
    expect(targets.assemble.dependsOn).toContain('my-component-artifact');

    // Never wired into the project dev target - deploy-local mutates a real device.
    expect(targets.dev).toBeUndefined();

    // No <c>-vendor target when ipc is false - nothing needs staging, so the
    // artifact target zips the bundle output directly.
    expect(targets['my-component-vendor']).toBeUndefined();
  });

  it("should wire a vendor target that stages the bundle and this architecture's addon when ipc is true", async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const vendorTarget = projectConfig.targets['my-component-vendor'];
    expect(vendorTarget).toBeDefined();
    expect(vendorTarget.dependsOn).toEqual(['bundle']);
    expect(vendorTarget.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/greengrass/my-component/stage',
    ]);
    expect(vendorTarget.inputs).toContainEqual({
      externalDependencies: ['aws-iot-device-sdk-v2'],
    });
    expect(vendorTarget.options.command).toBe(
      'tsx packages/common/scripts/src/greengrass/vendor-crt-addon.ts {projectRoot} dist/{projectRoot}/bundle/greengrass/my-component dist/{projectRoot}/greengrass/my-component/stage linux-arm64-glibc',
    );
  });

  it('should pass both architecture addon dirs to the vendor target for a multi-architecture component', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      platform: 'linux-amd64-arm64',
      ipc: true,
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(
      projectConfig.targets['my-component-vendor'].options.command,
    ).toContain('linux-x64-glibc,linux-arm64-glibc');
  });

  it('should point the artifact target at the staged tree and depend on the vendor target when ipc is true', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const artifactTarget = projectConfig.targets['my-component-artifact'];
    expect(artifactTarget.dependsOn).toEqual(['my-component-vendor']);
    expect(artifactTarget.options.command).toContain(
      'dist/{projectRoot}/greengrass/my-component/stage',
    );
    expect(artifactTarget.options.command).not.toContain(
      'dist/{projectRoot}/bundle/greengrass/my-component',
    );
  });

  it('should not add a vendor target when ipc is false', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['my-component-vendor']).toBeUndefined();
    expect(projectConfig.targets['my-component-artifact'].dependsOn).toEqual([
      'bundle',
    ]);
    expect(
      projectConfig.targets['my-component-artifact'].options.command,
    ).toContain('dist/{projectRoot}/bundle/greengrass/my-component');
  });

  it('should vend the vendor script only when ipc is true', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    expect(
      tree.exists('packages/common/scripts/src/greengrass/vendor-crt-addon.ts'),
    ).toBeFalsy();
  });

  it('vends the addon script into a workspace that has no shared scripts project yet', async () => {
    seedTypeScriptProject(tree);
    // The plain first-ever ipc=true path. ensureSharedScriptsProject creates
    // the shared scripts project and deletes the whole src tree it scaffolded,
    // so a script vended BEFORE that call disappears and the -vendor target
    // then dies with ERR_MODULE_NOT_FOUND on a real build. Reproduced on a
    // device before this test existed.
    expect(tree.exists('packages/common/scripts/project.json')).toBeFalsy();

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    expect(tree.exists('packages/common/scripts/project.json')).toBeTruthy();
    expect(
      tree.exists('packages/common/scripts/src/greengrass/vendor-crt-addon.ts'),
    ).toBeTruthy();
    // The script the -vendor target actually invokes must be the one on disk.
    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const vendorCommand =
      projectConfig.targets['my-component-vendor'].options.command;
    const scriptPath = vendorCommand.split(' ')[1];
    expect(tree.exists(scriptPath)).toBeTruthy();
  });

  it('records aws-crt as a deliberately unbuilt dependency when ipc is true', async () => {
    seedTypeScriptProject(tree);
    tree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    // pnpm 11 fails the whole install with ERR_PNPM_IGNORED_BUILDS unless every
    // dependency carrying an install script has an explicit decision. aws-crt
    // builds its native addon from source, and this component vendors the
    // prebuilt one instead, so the honest decision is false - reproduced in a
    // clean workspace, where `pnpm install` refused before this was recorded.
    const workspace = tree.read('pnpm-workspace.yaml', 'utf-8');
    expect(workspace).toContain('aws-crt');
    expect(workspace).toMatch(/aws-crt['"]?:\s*false/);
  });

  it('should not reference the vendor target from the dev target', async () => {
    seedTypeScriptProject(tree);
    // A pre-existing dev target, as a real project would have - the vendor
    // target must reach the artifact only through <c>-artifact's own
    // dependsOn, never by being appended here.
    updateJson(tree, 'packages/test-project/project.json', (projectConfig) => ({
      ...projectConfig,
      targets: {
        ...projectConfig.targets,
        dev: { executor: 'nx:run-commands', options: { command: 'echo dev' } },
      },
    }));

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      ipc: true,
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets.dev.dependsOn ?? []).not.toContain(
      'my-component-vendor',
    );
  });

  it('should preserve project configuration across host and component reruns', async () => {
    const hostOptions = {
      name: 'test-project',
      directory: 'packages',
    };
    await tsProjectGenerator(tree, hostOptions);
    const options = {
      project: '@proj/test-project',
      name: 'my-component',
      infra: 'none' as const,
    };
    await generateTypeScript(tree, options);
    const projectJsonPath = 'packages/test-project/project.json';
    const firstRun = tree.read(projectJsonPath, 'utf-8');

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gg-idempotency-'));
    try {
      flushChanges(tmpDir, tree.listChanges());
      const hostTree = new FsTree(tmpDir, false);
      await tsProjectGenerator(hostTree, hostOptions);
      expect(hostTree.read(projectJsonPath, 'utf-8')).toBe(firstRun);
      flushChanges(tmpDir, hostTree.listChanges());

      const componentTree = new FsTree(tmpDir, false);
      await generateTypeScript(componentTree, options);
      flushChanges(tmpDir, componentTree.listChanges());

      expect(readFileSync(path.join(tmpDir, projectJsonPath), 'utf-8')).toBe(
        firstRun,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should not duplicate component targets when re-run with the same options', async () => {
    seedTypeScriptProject(tree);

    const options = {
      project: 'test-project',
      name: 'my-component',
      infra: 'none' as const,
    };
    await generateTypeScript(tree, options);

    const recipePath =
      'packages/test-project/greengrass/my-component/recipe.yaml';
    const mainPath =
      'packages/test-project/src/greengrass/my-component/main.ts';

    // Simulate user edits to the user-owned recipe and entrypoint.
    const customRecipe = '# hand-edited recipe\n';
    const customMain = '// hand-edited handler\n';
    tree.write(recipePath, customRecipe);
    tree.write(mainPath, customMain);

    await generateTypeScript(tree, options);

    expect(tree.read(recipePath, 'utf-8')).toBe(customRecipe);
    expect(tree.read(mainPath, 'utf-8')).toBe(customMain);

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(
      Object.keys(projectConfig.targets).filter((t) =>
        t.startsWith('my-component-'),
      ),
    ).toHaveLength(3);
    // The targets are re-assigned on every run, so the dedupe helper is the only
    // thing keeping build/assemble from growing a second artifact dependency.
    expect(
      projectConfig.targets.build.dependsOn.filter(
        (d: string) => d === 'my-component-artifact',
      ),
    ).toHaveLength(1);
    expect(
      projectConfig.targets.assemble.dependsOn.filter(
        (d: string) => d === 'my-component-artifact',
      ),
    ).toHaveLength(1);
    // Re-running must not append a second rolldown entry for the same file.
    const rolldownConfig = tree.read(
      'packages/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(
      rolldownConfig.match(/src\/greengrass\/my-component\/main\.ts/g),
    ).toHaveLength(1);
  });

  it('should converge component targets while preserving user-owned files', async () => {
    seedTypeScriptProject(tree);

    const options = {
      project: 'test-project',
      name: 'my-component',
      infra: 'none' as const,
    };
    await generateTypeScript(tree, options);

    // A target left behind by an older version of this generator.
    updateJson(tree, 'packages/test-project/project.json', (projectConfig) => ({
      ...projectConfig,
      targets: {
        ...projectConfig.targets,
        'my-component-artifact': {
          ...projectConfig.targets['my-component-artifact'],
          options: { command: 'echo stale artifact command' },
        },
      },
    }));

    const recipePath =
      'packages/test-project/greengrass/my-component/recipe.yaml';
    const mainPath =
      'packages/test-project/src/greengrass/my-component/main.ts';
    const customRecipe = '# hand-edited recipe\n';
    const customMain = '// hand-edited handler\n';
    tree.write(recipePath, customRecipe);
    tree.write(mainPath, customMain);

    await generateTypeScript(tree, options);

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const artifactCommand =
      projectConfig.targets['my-component-artifact'].options.command;
    expect(artifactCommand).toContain('build-artifact.ts');
    expect(artifactCommand).not.toContain('stale artifact command');
    expect(tree.read(recipePath, 'utf-8')).toBe(customRecipe);
    expect(tree.read(mainPath, 'utf-8')).toBe(customMain);
  });

  it('should remove gdk-config.json and log when re-run without --gdkConfig', async () => {
    seedTypeScriptProject(tree);

    const options = {
      project: 'test-project',
      name: 'my-component',
      infra: 'none' as const,
      gdkConfig: true,
    };
    await generateTypeScript(tree, options);

    const gdkPath =
      'packages/test-project/greengrass/my-component/gdk-config.json';
    tree.write(gdkPath, '{ "hand-edited": true }');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    expect(tree.exists(gdkPath)).toBeFalsy();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      'Removed packages/test-project/greengrass/my-component/gdk-config.json; pass --gdkConfig to keep it.',
    );
  });

  it('should leave an existing component untouched when a second, differently-named component is added', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'first-component',
      infra: 'none',
    });

    const firstRecipePath =
      'packages/test-project/greengrass/first-component/recipe.yaml';
    const firstRecipeBefore = tree.read(firstRecipePath, 'utf-8');

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'second-component',
      infra: 'none',
    });

    expect(tree.read(firstRecipePath, 'utf-8')).toBe(firstRecipeBefore);
    expect(
      tree.exists(
        'packages/test-project/greengrass/second-component/recipe.yaml',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/test-project/src/greengrass/second-component/main.ts',
      ),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.components).toHaveLength(2);
    expect(projectConfig.targets['first-component-artifact']).toBeDefined();
    expect(projectConfig.targets['second-component-artifact']).toBeDefined();

    const rolldownConfig = tree.read(
      'packages/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('src/greengrass/first-component/main.ts');
    expect(rolldownConfig).toContain('src/greengrass/second-component/main.ts');
  });

  it('should record exact component metadata on project.json', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      componentVersion: '2.3.4',
      platform: 'linux-amd64',
      ipc: true,
      gdkConfig: true,
      infra: 'none',
    });

    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: GREENGRASS_COMPONENT_GENERATOR_INFO.id,
      path: 'src/greengrass/my-component/main.ts',
      name: 'my-component',
      language: 'typescript',
      componentName: 'com.proj.MyComponent',
      componentVersion: '2.3.4',
      platform: 'linux-amd64',
      ipc: true,
      gdkConfig: true,
    });
  });

  it('should vend gdk-config.json with NEXT_PATCH when --gdkConfig is set', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      componentVersion: 'NEXT_PATCH',
      gdkConfig: true,
      infra: 'none',
    });

    expect(
      tree.read(
        'packages/test-project/greengrass/my-component/recipe.yaml',
        'utf-8',
      ),
    ).toContain('ComponentVersion: NEXT_PATCH');
    expect(
      JSON.parse(
        tree.read(
          'packages/test-project/greengrass/my-component/gdk-config.json',
          'utf-8',
        ),
      ).component['com.proj.MyComponent'].version,
    ).toBe('NEXT_PATCH');
    expect(
      JSON.parse(tree.read('packages/test-project/project.json', 'utf-8'))
        .metadata.components[0].componentVersion,
    ).toBe('NEXT_PATCH');
  });

  describe('multi-architecture (platform: linux-amd64-arm64)', () => {
    it('should write one manifest per architecture over a single artifact for linux-amd64-arm64', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-amd64-arm64',
        infra: 'none',
      });

      const recipe = tree.read(
        'packages/test-project/greengrass/my-component/recipe.yaml',
        'utf-8',
      );
      expect(recipe).toContain('architecture: amd64');
      expect(recipe).toContain('architecture: aarch64');
      // A rolldown bundle is pure JavaScript: ONE artifact serves both
      // manifests, unlike the Python component's per-architecture zips.
      expect(recipe).toContain(
        'Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
      );
      expect(
        recipe.match(
          /Uri: s3:\/\/BUCKET_NAME\/COMPONENT_NAME\/COMPONENT_VERSION\/my-component\.zip/g,
        ),
      ).toHaveLength(2);
      expect(
        recipe.match(
          /Run: node \{artifacts:decompressedPath\}\/my-component\/index\.js/g,
        ),
      ).toHaveLength(2);
    });

    it('should render the addon Setenv in every manifest when ipc is true', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-amd64-arm64',
        ipc: true,
        infra: 'none',
      });

      const recipe = tree.read(
        'packages/test-project/greengrass/my-component/recipe.yaml',
        'utf-8',
      );
      expect(
        recipe.match(
          /Setenv:\n {8}AWS_CRT_NODEJS_BINARY_RELATIVE_PATH: native\/aws-crt\/linux-x64-glibc\/aws-crt-nodejs\.node/g,
        ),
      ).toHaveLength(1);
      expect(
        recipe.match(
          /Setenv:\n {8}AWS_CRT_NODEJS_BINARY_RELATIVE_PATH: native\/aws-crt\/linux-arm64-glibc\/aws-crt-nodejs\.node/g,
        ),
      ).toHaveLength(1);
    });

    it('should keep the artifact command free of --platforms for a multi-architecture typescript component', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-amd64-arm64',
        infra: 'none',
      });

      const projectConfig = JSON.parse(
        tree.read('packages/test-project/project.json', 'utf-8'),
      );
      expect(
        projectConfig.targets['my-component-artifact'].options.command,
      ).not.toContain('--platforms');
    });

    it('should throw when re-run with a different platform than the one recorded in metadata', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-arm64',
        infra: 'none',
      });

      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          platform: 'linux-amd64-arm64',
          infra: 'none',
        }),
      ).rejects.toThrow(/cannot change it to/);
    });

    it('should name the recorded platform to re-run with, since omitting the option is not neutral', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-amd64',
        infra: 'none',
      });

      // No `platform` at all: the option defaults to linux-arm64, so a re-run
      // that meant to change nothing asks to change the platform.
      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          infra: 'none',
        }),
      ).rejects.toThrow(/re-run with --platform=linux-amd64/);
    });

    it('should include the addon Setenv in the manifest block it tells the user to paste', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-arm64',
        ipc: true,
        infra: 'none',
      });

      // The Setenv block is part of a manifest's Lifecycle, so a preview
      // without it would drop the addon the on-device loader needs to find.
      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          platform: 'linux-amd64-arm64',
          ipc: true,
          infra: 'none',
        }),
      ).rejects.toThrow(
        /Setenv:\n {8}AWS_CRT_NODEJS_BINARY_RELATIVE_PATH: native\/aws-crt\/linux-arm64-glibc\/aws-crt-nodejs\.node/,
      );
    });

    it('should omit the Install step from the pasted manifest block when ipc is false', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-arm64',
        infra: 'none',
      });

      // Lifecycle: immediately followed by Run: node, with nothing in
      // between, is what proves neither Install nor Setenv leaked into an
      // ipc=false preview.
      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          platform: 'linux-amd64-arm64',
          infra: 'none',
        }),
      ).rejects.toThrow(/Lifecycle:\n {6}Run: node/);
    });

    it('should match snapshot for a multi-architecture component', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        platform: 'linux-amd64-arm64',
        infra: 'none',
      });

      const changes = sortObjectKeys(
        [
          'packages/test-project/greengrass/my-component/recipe.yaml',
          'packages/test-project/project.json',
          'packages/test-project/rolldown.config.ts',
          'packages/test-project/src/greengrass/my-component/main.ts',
        ].reduce<Record<string, string>>((acc, path) => {
          acc[path] = tree.read(path, 'utf-8');
          return acc;
        }, {}),
      );
      expect(changes).toMatchSnapshot('multi-arch-snapshot');
    });
  });

  it('should reject a componentName using the reserved aws.greengrass. prefix', async () => {
    seedTypeScriptProject(tree);

    await expect(
      generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        componentName: 'aws.greengrass.MyComponent',
      }),
    ).rejects.toThrow(/reserves/i);
  });

  it('should reject a componentName with invalid characters', async () => {
    seedTypeScriptProject(tree);

    await expect(
      generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        componentName: 'com/invalid name!',
      }),
    ).rejects.toThrow(/must match/i);
  });

  it('should reject a non-semver componentVersion', async () => {
    seedTypeScriptProject(tree);

    await expect(
      generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        componentVersion: 'not-a-version',
      }),
    ).rejects.toThrow(
      'ComponentVersion "not-a-version" must be a valid semantic version (eg. "1.0.0") or one of NEXT_PATCH, NEXT_MINOR, NEXT_MAJOR.',
    );
  });

  it('should use the explicit publisher option when set', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      publisher: 'Acme Corp',
      infra: 'none',
    });

    const recipe = tree.read(
      'packages/test-project/greengrass/my-component/recipe.yaml',
      'utf-8',
    );
    expect(recipe).toContain('ComponentPublisher: Acme Corp');
  });

  it('should fall back to the workspace npm scope for the publisher', async () => {
    updateJson(tree, 'package.json', (packageJson) => ({
      ...packageJson,
      name: '@my-scope/source',
    }));
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    const recipe = tree.read(
      'packages/test-project/greengrass/my-component/recipe.yaml',
      'utf-8',
    );
    expect(recipe).toContain('ComponentPublisher: my-scope');
    expect(recipe).toContain('ComponentName: com.my-scope.MyComponent');
  });

  it('should throw an actionable error when --language=typescript is explicit on a python host', async () => {
    tree.write(
      'apps/py_project/project.json',
      JSON.stringify({
        name: 'py-project',
        root: 'apps/py_project',
        sourceRoot: 'apps/py_project/py_project',
        targets: {},
      }),
    );
    tree.write('apps/py_project/pyproject.toml', '');

    await expect(
      generateTypeScript(tree, {
        project: 'py-project',
        name: 'my-component',
      }),
    ).rejects.toThrow(/requires tsconfig\.json/i);
  });

  it('should add the generator metric', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsSeedDeclaration,
    );
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    expectHasMetricTags(tree, GREENGRASS_COMPONENT_GENERATOR_INFO.metric);
  });

  it('should match snapshot', async () => {
    seedTypeScriptProject(tree);

    await generateTypeScript(tree, {
      project: 'test-project',
      name: 'my-component',
      infra: 'none',
    });

    const changes = sortObjectKeys(
      [
        'packages/test-project/greengrass/my-component/recipe.yaml',
        'packages/test-project/project.json',
        'packages/test-project/rolldown.config.ts',
        'packages/test-project/src/greengrass/my-component/main.ts',
      ].reduce<Record<string, string>>((acc, path) => {
        acc[path] = tree.read(path, 'utf-8');
        return acc;
      }, {}),
    );
    expect(changes).toMatchSnapshot('main-snapshot');
  });

  describe('infra escalation (--infra component-version)', () => {
    it('vends the per-component construct and registers the artifact dependency', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        iac: 'cdk',
      });

      const constructPath =
        'packages/common/constructs/src/app/greengrass/my-component.ts';
      expect(tree.exists(constructPath)).toBe(true);
      const construct = tree.read(constructPath, 'utf-8');
      expect(construct).toContain('extends GreengrassComponentVersion');
      expect(construct).toContain(
        'packages/test-project/greengrass/my-component/greengrass-build/recipes',
      );
      expect(construct).toContain(
        'packages/test-project/greengrass/my-component/greengrass-build/artifacts',
      );

      for (const file of [
        'artifact-bucket.ts',
        'component-version.ts',
        'deployment.ts',
        'recipe.ts',
      ]) {
        expect(
          tree.exists(`packages/common/constructs/src/core/greengrass/${file}`),
        ).toBe(true);
      }

      const sharedConstructsConfig = JSON.parse(
        tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
      );
      expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
        'test-project:build',
      );
      expect(sharedConstructsConfig.targets.assemble.dependsOn).toContain(
        'test-project:assemble',
      );
    });

    it('escalates cleanly from --infra none to --infra component-version, adding the construct exactly once', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        infra: 'none',
      });
      expect(tree.exists('packages/common/constructs')).toBe(false);

      const recipePath =
        'packages/test-project/greengrass/my-component/recipe.yaml';
      const recipeBefore = tree.read(recipePath, 'utf-8');

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        infra: 'component-version',
        iac: 'cdk',
      });

      const constructPath =
        'packages/common/constructs/src/app/greengrass/my-component.ts';
      expect(tree.exists(constructPath)).toBe(true);
      expect(tree.read(recipePath, 'utf-8')).toBe(recipeBefore);

      // Re-running again must not duplicate the star export or the artifact
      // dependency.
      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        infra: 'component-version',
        iac: 'cdk',
      });

      const appIndex = tree.read(
        'packages/common/constructs/src/app/greengrass/index.ts',
        'utf-8',
      );
      expect(appIndex?.match(/my-component\.js/g)).toHaveLength(1);

      const sharedConstructsConfig = JSON.parse(
        tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
      );
      expect(
        sharedConstructsConfig.targets.build.dependsOn.filter(
          (d: string) => d === 'test-project:build',
        ),
      ).toHaveLength(1);

      // The escalation has to record the iac on the entry its first run wrote,
      // which is the only thing the orphan guard reads.
      const projectConfig = JSON.parse(
        tree.read('packages/test-project/project.json', 'utf-8'),
      );
      expect(projectConfig.metadata.components[0].iac).toBe('cdk');
    });

    it('throws on --infra none after an escalation from --infra none provisioned infrastructure', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        infra: 'none',
      });
      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        infra: 'component-version',
        iac: 'cdk',
      });

      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          infra: 'none',
        }),
      ).rejects.toThrow(/would leave that infrastructure orphaned/);
    });

    it('is a stable no-op when re-run with --infra none both times', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        infra: 'none',
      });

      // Re-running with the same `--infra none` it already had must not throw
      // - this is the ordinary idempotency contract, not a downgrade attempt.
      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          infra: 'none',
        }),
      ).resolves.toBeDefined();
    });

    it('throws when re-run with --infra none after infrastructure was already provisioned', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        iac: 'cdk',
      });

      await expect(
        generateTypeScript(tree, {
          project: 'test-project',
          name: 'my-component',
          infra: 'none',
        }),
      ).rejects.toThrow(/would leave that infrastructure orphaned/);
    });

    it('vends the per-component terraform module for --iac terraform', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        iac: 'terraform',
      });

      const modulePath =
        'packages/common/terraform/src/app/greengrass-component/my-component/my-component.tf';
      expect(tree.exists(modulePath)).toBe(true);
      const module = tree.read(modulePath, 'utf-8');
      expect(module).toContain(
        'source = "../../../core/greengrass/component-version"',
      );

      for (const dir of [
        'artifact-bucket',
        'component-version',
        'deployment',
      ]) {
        expect(
          tree.exists(
            `packages/common/terraform/src/core/greengrass/${dir}/main.tf`,
          ),
        ).toBe(true);
      }

      const sharedTerraformConfig = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8') ?? '{}',
      );
      expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
        'test-project:build',
      );
    });

    it('records iac in component metadata', async () => {
      seedTypeScriptProject(tree);

      await generateTypeScript(tree, {
        project: 'test-project',
        name: 'my-component',
        iac: 'cdk',
      });

      const projectConfig = JSON.parse(
        tree.read('packages/test-project/project.json', 'utf-8'),
      );
      expect(projectConfig.metadata.components[0].iac).toBe('cdk');
    });
  });
});
