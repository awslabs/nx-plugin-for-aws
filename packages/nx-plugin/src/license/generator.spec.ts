/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { addProjectConfiguration, readNxJson, Tree } from '@nx/devkit';

import { LICENSE_GENERATOR_INFO, licenseGenerator } from './generator';
import { LicenseGeneratorSchema } from './schema';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from '../utils/config/utils';
import { SYNC_GENERATOR_NAME } from './sync/generator';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { expectHasMetricTags } from '../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../utils/test';

describe('license generator', () => {
  let tree: Tree;

  const options: LicenseGeneratorSchema = {
    license: 'Apache-2.0',
    copyrightHolder: 'Test Inc. or its affiliates',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should write default license config', async () => {
    await licenseGenerator(tree, options);

    expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBeTruthy();
    expect(tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')).toContain(
      'Copyright Test Inc. or its affiliates.',
    );
  });

  it('should register the sync generator', async () => {
    await licenseGenerator(tree, options);

    expect(readNxJson(tree).targetDefaults.lint.syncGenerators).toContain(
      SYNC_GENERATOR_NAME,
    );
  });

  it('should allow successive runs to change the license', async () => {
    await licenseGenerator(tree, {
      license: 'MIT',
      copyrightHolder: 'Foo',
    });

    expect((await readAwsNxPluginConfig(tree)).license!.source!.spdx).toBe(
      'MIT',
    );
    expect(
      (await readAwsNxPluginConfig(tree)).license!.source!.copyrightHolder,
    ).toBe('Foo');

    await licenseGenerator(tree, {
      license: 'MIT',
      copyrightHolder: 'Bar',
    });

    expect(
      (await readAwsNxPluginConfig(tree)).license!.source!.copyrightHolder,
    ).toBe('Bar');

    await licenseGenerator(tree, {
      license: 'ASL',
      copyrightHolder: 'Baz',
    });

    expect((await readAwsNxPluginConfig(tree)).license!.source!.spdx).toBe(
      'ASL',
    );
    expect(
      (await readAwsNxPluginConfig(tree)).license!.source!.copyrightHolder,
    ).toBe('Baz');
  });

  it('should add generator metric to app.ts', async () => {
    tree = createTreeUsingTsSolutionSetup();

    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    // Call the generator function
    await licenseGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, LICENSE_GENERATOR_INFO.metric);
  });

  describe('dependency check configuration', () => {
    it('should write root project.json with license-check target', async () => {
      tree.write('pnpm-lock.yaml', '');
      await licenseGenerator(tree, options);

      expect(tree.exists('project.json')).toBeTruthy();
      const projectJson = JSON.parse(tree.read('project.json', 'utf-8')!);
      expect(projectJson.targets['license-check']).toBeDefined();
      expect(projectJson.targets['license-check'].executor).toBe(
        '@aws/nx-plugin:license-check',
      );
      expect(projectJson.targets['license-check'].cache).toBe(true);
      expect(projectJson.targets['license-check'].inputs).toContain(
        '{workspaceRoot}/pnpm-lock.yaml',
      );
      expect(projectJson.targets['license-check'].inputs).toContain(
        '{workspaceRoot}/aws-nx-plugin.config.mts',
      );
    });

    it('should only include lockfiles that are present', async () => {
      tree.write('pnpm-lock.yaml', '');
      await licenseGenerator(tree, options);

      const inputs = JSON.parse(tree.read('project.json', 'utf-8')!).targets[
        'license-check'
      ].inputs;
      expect(inputs).toContain('{workspaceRoot}/pnpm-lock.yaml');
      // Other package managers' lockfiles are absent, so they're not listed.
      expect(inputs).not.toContain('{workspaceRoot}/yarn.lock');
      expect(inputs).not.toContain('{workspaceRoot}/package-lock.json');
      expect(inputs).not.toContain('{workspaceRoot}/bun.lockb');
      // No python project → no uv.lock input.
      expect(inputs).not.toContain('{workspaceRoot}/**/uv.lock');
    });

    it('should include uv.lock input when a python project exists', async () => {
      tree.write('pnpm-lock.yaml', '');
      addProjectConfiguration(tree, 'py-app', {
        root: 'packages/py_app',
        sourceRoot: 'packages/py_app/src',
      });
      tree.write(
        'packages/py_app/pyproject.toml',
        '[project]\nname = "py-app"\n',
      );

      await licenseGenerator(tree, options);

      const inputs = JSON.parse(tree.read('project.json', 'utf-8')!).targets[
        'license-check'
      ].inputs;
      expect(inputs).toContain('{workspaceRoot}/**/uv.lock');
    });

    it('should suppress root package.json script target inference', async () => {
      // The root package.json has `nx run-many` wrapper scripts (build, lint,
      // test). Adding a root project.json registers the root as a project, so
      // we must set includedScripts: [] to stop Nx inferring a recursive
      // `build` target from those scripts.
      tree.write(
        'package.json',
        JSON.stringify({
          name: '@test/source',
          scripts: { build: 'nx run-many --target build' },
        }),
      );

      await licenseGenerator(tree, options);

      const packageJson = JSON.parse(tree.read('package.json', 'utf-8')!);
      expect(packageJson.nx.includedScripts).toEqual([]);
      // The build wrapper script is preserved
      expect(packageJson.scripts.build).toBe('nx run-many --target build');
    });

    it('should not write license-check target when dependencyCheck is false', async () => {
      await licenseGenerator(tree, { ...options, dependencyCheck: false });

      if (tree.exists('project.json')) {
        const projectJson = JSON.parse(tree.read('project.json', 'utf-8')!);
        expect(projectJson.targets?.['license-check']).toBeUndefined();
      }
    });

    describe('lint depends on license-check', () => {
      const lintDependsOn = (config: any) =>
        config.targets?.lint?.dependsOn ?? [];

      it('wires existing projects lint targets to the root license-check', async () => {
        tree.write('package.json', JSON.stringify({ name: '@test/source' }));
        addProjectConfiguration(tree, '@test/with-lint', {
          root: 'packages/with-lint',
          targets: { lint: { executor: '@nx/eslint:lint' } },
        });
        addProjectConfiguration(tree, '@test/no-lint', {
          root: 'packages/no-lint',
          targets: { build: {} },
        });

        await licenseGenerator(tree, options);

        const { getProjects } = await import('@nx/devkit');
        const projects = getProjects(tree);
        // The linting project depends on the root license-check.
        expect(lintDependsOn(projects.get('@test/with-lint'))).toContainEqual({
          projects: ['@test/source'],
          target: 'license-check',
        });
        // A project with no lint target is left alone (no lint target created).
        expect(projects.get('@test/no-lint')!.targets?.lint).toBeUndefined();
      });

      it('does not make the license-check project depend on its own target', async () => {
        tree.write('package.json', JSON.stringify({ name: '@test/source' }));
        await licenseGenerator(tree, options);

        const { getProjects } = await import('@nx/devkit');
        const root = getProjects(tree).get('@test/source');
        expect(lintDependsOn(root)).not.toContainEqual({
          projects: ['@test/source'],
          target: 'license-check',
        });
      });

      it('is idempotent across re-runs', async () => {
        tree.write('package.json', JSON.stringify({ name: '@test/source' }));
        addProjectConfiguration(tree, '@test/lib', {
          root: 'packages/lib',
          targets: { lint: { executor: '@nx/eslint:lint' } },
        });

        await licenseGenerator(tree, options);
        await licenseGenerator(tree, options);

        const { getProjects } = await import('@nx/devkit');
        const deps = lintDependsOn(getProjects(tree).get('@test/lib')).filter(
          (d: any) => d?.target === 'license-check',
        );
        expect(deps).toHaveLength(1);
      });
    });

    it('should be idempotent - running twice produces same result', async () => {
      tree.write('pnpm-lock.yaml', '');
      await licenseGenerator(tree, options);
      const firstRun = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;

      await licenseGenerator(tree, options);
      const secondRun = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;

      expect(secondRun).toBe(firstRun);
    });

    it('should include npmCollector when no python projects exist', async () => {
      await licenseGenerator(tree, options);

      const config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('npmCollector');
      expect(config).not.toContain('pythonCollector');
    });

    it('should include pythonCollector when python projects exist (license after project)', async () => {
      addProjectConfiguration(tree, 'py-app', {
        root: 'packages/py_app',
        sourceRoot: 'packages/py_app/src',
      });
      tree.write(
        'packages/py_app/pyproject.toml',
        '[project]\nname = "py-app"\n',
      );

      await licenseGenerator(tree, options);

      const config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('npmCollector');
      expect(config).toContain('pythonCollector');
    });

    it('should add MCP exceptions when MCP server project exists (license after mcp)', async () => {
      addProjectConfiguration(tree, 'my-project', {
        root: 'packages/my-project',
        sourceRoot: 'packages/my-project/src',
        metadata: {
          components: [
            { generator: 'ts#mcp-server', path: 'src/mcp', name: 'my-mcp' },
          ],
        } as any,
      });

      await licenseGenerator(tree, options);

      const config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('@modelcontextprotocol/inspector');
    });

    it('should add AG-UI exceptions when py#agent with ag-ui protocol exists (license after agent)', async () => {
      addProjectConfiguration(tree, 'my-project', {
        root: 'packages/my-project',
        sourceRoot: 'packages/my-project/src',
        metadata: {
          components: [
            {
              generator: 'py#agent',
              path: 'src/agent',
              name: 'my-agent',
              protocol: 'ag-ui',
            },
          ],
        } as any,
      });

      await licenseGenerator(tree, options);

      const config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('ag_ui_strands');
    });

    it('should NOT add AG-UI exceptions for ts#agent (only py#agent uses ag_ui_strands)', async () => {
      addProjectConfiguration(tree, 'my-project', {
        root: 'packages/my-project',
        sourceRoot: 'packages/my-project/src',
        metadata: {
          components: [
            {
              generator: 'ts#agent',
              path: 'src/agent',
              name: 'my-agent',
              protocol: 'ag-ui',
            },
          ],
        } as any,
      });

      await licenseGenerator(tree, options);

      const config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).not.toContain('ag_ui_strands');
    });

    it('should not add exceptions when no MCP/AG-UI projects exist', async () => {
      addProjectConfiguration(tree, 'my-project', {
        root: 'packages/my-project',
        sourceRoot: 'packages/my-project/src',
        metadata: {
          components: [
            { generator: 'ts#trpc-api', path: 'src/api', name: 'my-api' },
          ],
        } as any,
      });

      await licenseGenerator(tree, options);

      const config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).not.toContain('@modelcontextprotocol/inspector');
      expect(config).not.toContain('ag_ui_strands');
    });

    it('should add pythonCollector when py#project runs after license generator', async () => {
      const { ensurePythonLicenseCollector } = await import('./config');

      tree.write('pnpm-lock.yaml', '');
      await licenseGenerator(tree, options);
      let config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).not.toContain('pythonCollector');
      // No uv.lock input yet — no python collector.
      expect(
        JSON.parse(tree.read('project.json', 'utf-8')!).targets['license-check']
          .inputs,
      ).not.toContain('{workspaceRoot}/**/uv.lock');

      await ensurePythonLicenseCollector(tree);
      config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('pythonCollector');
      // Adding the python collector also adds the uv.lock cache input, even
      // though it ran after the license generator.
      expect(
        JSON.parse(tree.read('project.json', 'utf-8')!).targets['license-check']
          .inputs,
      ).toContain('{workspaceRoot}/**/uv.lock');
    });

    it('should add MCP exceptions when mcp-server runs after license generator', async () => {
      const { ensureLicenseExceptions } = await import('./config');
      const { MCP_INSPECTOR_EXCEPTIONS } = await import('./known-exceptions');

      await licenseGenerator(tree, options);
      let config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).not.toContain('@modelcontextprotocol/inspector');

      await ensureLicenseExceptions(tree, MCP_INSPECTOR_EXCEPTIONS);
      config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('@modelcontextprotocol/inspector');
    });

    it('should add AG-UI exceptions when py#agent runs after license generator', async () => {
      const { ensureLicenseExceptions } = await import('./config');
      const { AG_UI_STRANDS_EXCEPTIONS } = await import('./known-exceptions');

      await licenseGenerator(tree, options);
      let config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).not.toContain('ag_ui_strands');

      await ensureLicenseExceptions(tree, AG_UI_STRANDS_EXCEPTIONS);
      config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('ag_ui_strands');
    });

    it('should be no-op when ensure functions run before license generator', async () => {
      const { ensurePythonLicenseCollector, ensureLicenseExceptions } =
        await import('./config');
      const { MCP_INSPECTOR_EXCEPTIONS } = await import('./known-exceptions');

      await ensurePythonLicenseCollector(tree);
      await ensureLicenseExceptions(tree, MCP_INSPECTOR_EXCEPTIONS);

      expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBeFalsy();
    });

    it('should handle running license generator before projects exist, then re-running after', async () => {
      // First run: no projects
      await licenseGenerator(tree, options);
      let config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).not.toContain('pythonCollector');
      expect(config).not.toContain('@modelcontextprotocol/inspector');

      // Add projects
      addProjectConfiguration(tree, 'py-app', {
        root: 'packages/py_app',
        sourceRoot: 'packages/py_app/src',
      });
      tree.write(
        'packages/py_app/pyproject.toml',
        '[project]\nname = "py-app"\n',
      );
      addProjectConfiguration(tree, 'ts-project', {
        root: 'packages/ts-project',
        sourceRoot: 'packages/ts-project/src',
        metadata: {
          components: [
            { generator: 'ts#mcp-server', path: 'src/mcp', name: 'my-mcp' },
          ],
        } as any,
      });

      // Second run: should now detect python + mcp
      await licenseGenerator(tree, options);
      config = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      expect(config).toContain('pythonCollector');
      expect(config).toContain('@modelcontextprotocol/inspector');
    });
  });
});
