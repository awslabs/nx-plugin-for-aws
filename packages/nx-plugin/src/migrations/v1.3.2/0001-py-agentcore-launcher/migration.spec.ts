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
const OLD_TF_ENTRY =
  'entry_point = ["opentelemetry-instrument", var.code_entry_point]';

// The code configuration blocks v1.3.0 generated, including its comments.
const RELEASED_CDK_CODE = `\
    // The \`opentelemetry-instrument\` prefix auto-instruments with the AWS Distro
    // for OpenTelemetry packaged alongside the code.
    // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
    this.code = AgentRuntimeArtifact.fromCodeAsset({
      path: bundleDir,
      runtime: AgentCoreRuntime.PYTHON_3_14,
      entrypoint: ['opentelemetry-instrument', 'main.py'],
    });`;
const RELEASED_TF_CODE = `\
  code_configuration = {
    # The \`opentelemetry-instrument\` prefix auto-instruments with the AWS Distro
    # for OpenTelemetry packaged alongside the code.
    # https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
    entry_point = ["opentelemetry-instrument", var.code_entry_point]
    runtime     = var.code_runtime
    s3_bucket   = aws_s3_object.agent_core_code.bucket
    s3_key      = aws_s3_object.agent_core_code.key
  }`;
const toReleasedTerraformRuntime = (tree: Tree) => {
  tree.write(
    TF_RUNTIME,
    tree
      .read(TF_RUNTIME, 'utf-8')
      .replace(/ {2}code_configuration = \{[\s\S]*?\n {2}\}/, RELEASED_TF_CODE),
  );
  expect(tree.read(TF_RUNTIME, 'utf-8')).toContain(RELEASED_TF_CODE);
};
const files = (tree: Tree) =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE' && !c.path.startsWith('.grit/'))
      .map((c) => [c.path, tree.read(c.path, 'utf-8')]),
  );

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
  const expectedCoreOnlyChange = (before: Record<string, string>) =>
    iac === 'terraform'
      ? {
          ...before,
          [TF_RUNTIME]: before[TF_RUNTIME].replace(OLD_TF_ENTRY, TF_ENTRY),
        }
      : before;

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
            ? /code_entry_point = "agentcore_launcher.py"/
            : / {4}\/\/.*\n(?: {4}\/\/.*\n)* {4}this\.code = AgentRuntimeArtifact\.fromCodeAsset\(\{[\s\S]*?\n {4}\}\);/,
          iac === 'terraform'
            ? 'code_entry_point = "main.py"'
            : RELEASED_CDK_CODE,
        ),
    );
    expect(tree.read(infra, 'utf-8')).toContain(
      iac === 'terraform' ? 'code_entry_point = "main.py"' : RELEASED_CDK_CODE,
    );
    if (iac === 'terraform') {
      toReleasedTerraformRuntime(tree);
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
    const generated = files(tree);
    await toReleasedShape();
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files(tree)).toEqual(generated);
    const after = files(tree);
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files(tree)).toEqual(after);
  });

  it('does nothing to a freshly generated workspace', async () => {
    const before = files(tree);
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files(tree)).toEqual(before);
  });

  it('leaves customized entrypoints and packaging untouched and reports them', async () => {
    await toReleasedShape();
    tree.write(
      infra,
      tree.read(infra, 'utf-8').replaceAll('main.py', 'custom_main.py'),
    );
    await formatFilesInSubtree(tree);
    const before = files(tree);
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files(tree)).toEqual(expectedCoreOnlyChange(before));
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
    const before = files(tree);
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files(tree)).toEqual(expectedCoreOnlyChange(before));
    const after = files(tree);
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files(tree)).toEqual(after);
  });

  it('reports missing infrastructure without changing packaging', async () => {
    await toReleasedShape();
    tree.delete(infra);
    const before = files(tree);
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files(tree)).toEqual(expectedCoreOnlyChange(before));
  });

  it('preserves a conflicting custom launcher and reports it', async () => {
    await toReleasedShape();
    tree.write(launcher, 'print("custom launcher")\n');
    const before = files(tree);
    expect((await migration(tree)).nextSteps).toHaveLength(1);
    expect(files(tree)).toEqual(expectedCoreOnlyChange(before));
  });

  if (iac === 'terraform') {
    it('preserves a customized shared runtime and reports the Python component', async () => {
      await toReleasedShape();
      tree.write(
        TF_RUNTIME,
        tree
          .read(TF_RUNTIME, 'utf-8')
          .replace(
            OLD_TF_ENTRY,
            'entry_point = ["custom-instrument", var.code_entry_point]',
          ),
      );
      await formatFilesInSubtree(tree);
      const before = files(tree);
      expect((await migration(tree)).nextSteps).toHaveLength(1);
      expect(files(tree)).toEqual(before);
      expect(tree.exists(launcher)).toBe(false);
    });

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
      const after = files(tree);
      expect((await migration(tree)).nextSteps).toEqual(result.nextSteps);
      expect(files(tree)).toEqual(after);
    });
  }
});

describe('py-agentcore-launcher migration for a Node-first Terraform workspace', () => {
  it('migrates the shared runtime before Python is added and preserves the Node component', async () => {
    const tree = createTreeUsingTsSolutionSetup();
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
      iac: 'terraform',
      preferInstallDependencies: false,
    });
    const generated = files(tree);
    toReleasedTerraformRuntime(tree);
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files(tree)).toEqual(generated);
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files(tree)).toEqual(generated);

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
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'python-agent',
      infra: 'agentcore',
      iac: 'terraform',
      preferInstallDependencies: false,
    });
    expect(tree.read(TF_RUNTIME, 'utf-8')).toContain(TF_ENTRY);
    expect(
      tree.read(
        'packages/common/terraform/src/app/agents/python-agent/python-agent.tf',
        'utf-8',
      ),
    ).toContain('code_entry_point = "agentcore_launcher.py"');
    const nodeInfra =
      'packages/common/terraform/src/app/mcp-servers/node-mcp/node-mcp.tf';
    expect(tree.read(nodeInfra, 'utf-8')).toEqual(generated[nodeInfra]);
    const after = files(tree);
    expect(await migration(tree)).toEqual({ nextSteps: [] });
    expect(files(tree)).toEqual(after);
  });
});
