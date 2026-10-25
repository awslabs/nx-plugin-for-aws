/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readJson,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { pyAgentGenerator } from '../../../py/agent/generator.js';
import { pyMcpServerGenerator } from '../../../py/mcp-server/generator.js';
import { tsMcpServerGenerator } from '../../../ts/mcp-server/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const ROOT = 'apps/test-project';
const TF_RUNTIME =
  'packages/common/terraform/src/core/agent-core-code/runtime.tf';
const TF_ENTRY =
  'entry_point = var.code_entry_point == "agentcore_launcher.py" ? [var.code_entry_point] : ["opentelemetry-instrument", var.code_entry_point]';

describe.each([
  ['agent', 'cdk'],
  ['agent', 'terraform'],
  ['mcp', 'cdk'],
  ['mcp', 'terraform'],
] as const)('py-agentcore-launcher migration for %s/%s', (kind, iac) => {
  let tree: Tree;
  const launcher = `${ROOT}/package/custom_name/agentcore_launcher.py`;
  const main = `${ROOT}/package/custom_name/main.py`;
  const infra =
    iac === 'terraform'
      ? `packages/common/terraform/src/app/${kind === 'agent' ? 'agents' : 'mcp-servers'}/custom-name/custom-name.tf`
      : `packages/common/constructs/src/app/${kind === 'agent' ? 'agents' : 'mcp-servers'}/custom-name/custom-name.ts`;
  const files = () =>
    Object.fromEntries(
      tree
        .listChanges()
        .filter((c) => c.type !== 'DELETE' && !c.path.startsWith('.grit/'))
        .map((c) => [c.path, tree.read(c.path, 'utf-8')]),
    );

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'test-project', {
      root: ROOT,
      sourceRoot: `${ROOT}/proj_test_project`,
      targets: {
        build: {
          executor: '@nxlv/python:build',
          options: { outputPath: `dist/${ROOT}` },
        },
      },
    });
    tree.write(
      `${ROOT}/pyproject.toml`,
      '[project]\nname = "proj.test_project"\nversion = "0.1.0"\ndependencies = []\n',
    );
    await (kind === 'agent' ? pyAgentGenerator : pyMcpServerGenerator)(tree, {
      project: 'test-project',
      name: 'custom-name',
      infra: 'agentcore',
      iac,
      preferInstallDependencies: false,
    });
  });

  const toReleasedShape = async () => {
    tree.delete(launcher);
    updateJson(tree, `${ROOT}/project.json`, (config) => {
      config.targets['custom-name-package'].options.commands.pop();
      return config;
    });
    tree.write(
      infra,
      tree
        .read(infra, 'utf-8')
        .replace(
          iac === 'terraform'
            ? 'code_entry_point = "agentcore_launcher.py"'
            : "entrypoint: ['agentcore_launcher.py']",
          iac === 'terraform'
            ? 'code_entry_point = "main.py"'
            : "entrypoint: ['opentelemetry-instrument', 'main.py']",
        ),
    );
    if (iac === 'terraform') {
      tree.write(
        TF_RUNTIME,
        tree
          .read(TF_RUNTIME, 'utf-8')
          .replace(
            TF_ENTRY,
            'entry_point = ["opentelemetry-instrument", var.code_entry_point]',
          ),
      );
    }
    await formatFilesInSubtree(tree);
  };

  it('converges on the fresh generator and preserves custom main and application code', async () => {
    tree.write(main, '# Custom startup\nprint("custom")\n');
    tree.write(
      `${ROOT}/proj_test_project/custom_name/custom.py`,
      'CUSTOM_VALUE = 42\n',
    );
    await formatFilesInSubtree(tree);
    const generated = files();
    await toReleasedShape();
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files()).toEqual(generated);
    const after = files();
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files()).toEqual(after);
  });

  it('does nothing to a freshly generated workspace', async () => {
    const before = files();
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files()).toEqual(before);
  });

  it('leaves customized entrypoints and packaging untouched and reports them', async () => {
    await toReleasedShape();
    tree.write(
      infra,
      tree.read(infra, 'utf-8').replaceAll('main.py', 'custom_main.py'),
    );
    await formatFilesInSubtree(tree);
    const before = files();
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files()).toEqual(before);
    expect(tree.exists(launcher)).toBe(false);
    expect(
      readJson(tree, `${ROOT}/project.json`).targets['custom-name-package']
        .options.commands,
    ).toHaveLength(5);
  });

  it('leaves customized packaging untouched and reports it', async () => {
    await toReleasedShape();
    updateJson(tree, `${ROOT}/project.json`, (config) => {
      config.targets['custom-name-package'].options.commands[2] =
        'custom-bundle-command';
      return config;
    });
    await formatFilesInSubtree(tree);
    const before = files();
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files()).toEqual(before);
  });

  it('reports missing infrastructure without changing packaging', async () => {
    await toReleasedShape();
    tree.delete(infra);
    const before = files();
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files()).toEqual(before);
  });

  it('preserves a conflicting custom launcher and reports it', async () => {
    await toReleasedShape();
    tree.write(launcher, 'print("custom launcher")\n');
    const before = files();
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files()).toEqual(before);
  });

  if (iac === 'terraform') {
    it('migrates recognized Python components without switching a customized Python component or Node', async () => {
      await pyMcpServerGenerator(tree, {
        project: 'test-project',
        name: 'customized-mcp',
        infra: 'agentcore',
        iac,
        preferInstallDependencies: false,
      });
      const customInfra =
        'packages/common/terraform/src/app/mcp-servers/customized-mcp/customized-mcp.tf';
      const customLauncher = `${ROOT}/package/customized_mcp/agentcore_launcher.py`;
      tree.delete(customLauncher);
      updateJson(tree, `${ROOT}/project.json`, (config) => {
        config.targets['customized-mcp-package'].options.commands.pop();
        config.targets['customized-mcp-package'].options.commands[2] =
          'custom-bundle-command';
        return config;
      });
      tree.write(
        customInfra,
        tree
          .read(customInfra, 'utf-8')
          .replace(
            'code_entry_point = "agentcore_launcher.py"',
            'code_entry_point = "main.py"',
          ),
      );
      addProjectConfiguration(tree, 'node-project', {
        root: 'apps/node-project',
        sourceRoot: 'apps/node-project/src',
        targets: {
          build: {
            executor: '@nx/js:tsc',
            options: { outputPath: 'dist/apps/node-project' },
          },
        },
      });
      writeJson(tree, 'apps/node-project/package.json', {
        name: '@proj/node-project',
        type: 'module',
      });
      writeJson(tree, 'apps/node-project/tsconfig.json', {});
      await tsMcpServerGenerator(tree, {
        project: 'node-project',
        name: 'node-mcp',
        infra: 'agentcore',
        iac,
        preferInstallDependencies: false,
      });
      await toReleasedShape();
      const customBefore = tree.read(customInfra, 'utf-8');
      const nodeInfra =
        'packages/common/terraform/src/app/mcp-servers/node-mcp/node-mcp.tf';
      const nodeBefore = tree.read(nodeInfra, 'utf-8');
      const result = await migration(tree);
      expect(result.nextSteps).toHaveLength(1);
      expect(tree.read(infra, 'utf-8')).toContain(
        'code_entry_point = "agentcore_launcher.py"',
      );
      expect(tree.exists(launcher)).toBe(true);
      expect(tree.read(TF_RUNTIME, 'utf-8')).toContain(TF_ENTRY);
      expect(tree.read(customInfra, 'utf-8')).toEqual(customBefore);
      expect(tree.exists(customLauncher)).toBe(false);
      expect(tree.read(nodeInfra, 'utf-8')).toEqual(nodeBefore);
      expect(nodeBefore).toContain('code_entry_point = "index.js"');
      const after = files();
      expect((await migration(tree)).nextSteps).toEqual(result.nextSteps);
      expect(files()).toEqual(after);
    });
  }
});
