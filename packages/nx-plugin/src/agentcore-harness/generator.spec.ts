/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  getProjects,
  readJson,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { formatFilesInSubtree } from '../utils/format';
import { installDependencies } from '../utils/install';
import {
  expectHasMetricTags,
  expectHasTerraformMetricTags,
} from '../utils/metrics.spec';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { TS_VERSIONS } from '../utils/versions';
import {
  AGENTCORE_HARNESS_GENERATOR_INFO,
  agentcoreHarnessGenerator,
} from './generator';
import {
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
} from './resolve-options';

// The install callback is never something a unit test should really run (it
// spawns the package manager), so replace it with a spy the tests can assert
// against and reject from.
vi.mock('../utils/install', () => ({
  installDependencies: vi.fn().mockResolvedValue(undefined),
}));

// Wrap (not replace) repository formatting so every test formats generated
// files exactly as a real run would, while individual tests can inject a
// one-shot failure to verify propagation.
vi.mock('../utils/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/format')>();
  return {
    ...actual,
    formatFilesInSubtree: vi.fn(actual.formatFilesInSubtree),
  };
});

const PROJECT_ROOT = 'packages/my-harness';
const PROJECT_NAME = '@proj/my-harness';
const CDK_CONSTRUCT_PATH =
  'packages/common/constructs/src/app/harnesses/my-harness/my-harness.ts';
const CDK_HARNESSES_INDEX_PATH =
  'packages/common/constructs/src/app/harnesses/index.ts';
const CDK_APP_INDEX_PATH = 'packages/common/constructs/src/app/index.ts';
const TF_MODULE_PATH =
  'packages/common/terraform/src/app/harnesses/my-harness/my-harness.tf';

/** Exact reserved target contract owned by the generator. */
const INVOKE_TARGET_CONTRACT = {
  executor: 'nx:run-commands',
  options: {
    command: 'tsx invoke.ts',
    cwd: '{projectRoot}',
  },
};
const BUILD_TARGET_CONTRACT = {
  executor: 'nx:run-commands',
  options: {
    command: 'tsc --noEmit --project tsconfig.json',
    cwd: '{projectRoot}',
  },
};

/**
 * Serialize the tree's full change set so a test can assert a failed run
 * left the entire tree byte-for-byte unchanged.
 */
const snapshotTreeChanges = (tree: Tree) =>
  tree.listChanges().map((change) => ({
    path: change.path,
    type: change.type,
    content: change.content?.toString('utf-8'),
  }));

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

/** Extract the raw `default = ...` expression of one Terraform variable. */
const tfVariableDefault = (module: string, variable: string): string => {
  const match = module.match(
    new RegExp(`variable "${variable}" \\{[\\s\\S]*?default\\s*=\\s*(.+)`),
  );
  return match?.[1]?.trim() ?? '';
};

describe('agentcore-harness generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.clearAllMocks();
  });

  describe('common behaviour', () => {
    it('scaffolds a standalone application project with the exact reserved target contract', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      expect(tree.exists(`${PROJECT_ROOT}/project.json`)).toBe(true);
      expect(tree.exists(`${PROJECT_ROOT}/invoke.ts`)).toBe(true);
      expect(tree.exists(`${PROJECT_ROOT}/invoke-harness.ts`)).toBe(true);
      expect(tree.exists(`${PROJECT_ROOT}/README.md`)).toBe(true);
      expect(tree.exists(`${PROJECT_ROOT}/tsconfig.json`)).toBe(true);

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(config.name).toBe(PROJECT_NAME);
      expect(config.root).toBe(PROJECT_ROOT);
      expect(config.projectType).toBe('application');
      expect(Object.keys(config.targets ?? {}).sort()).toEqual([
        'build',
        'invoke',
      ]);
      expect(config.targets?.invoke).toEqual(INVOKE_TARGET_CONTRACT);
      expect(config.targets?.build).toEqual(BUILD_TARGET_CONTRACT);
    });

    it('records the complete Generator-owned metadata, omitting unsupplied execution limits', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(config.metadata as any).toEqual({
        generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
        name: 'my-harness',
        rc: 'MyHarness',
        runtimeConfigPath: 'agentcore.harnesses.MyHarness',
        modelId: DEFAULT_HARNESS_MODEL_ID,
        systemPrompt: DEFAULT_HARNESS_SYSTEM_PROMPT,
        allowedTools: ['@builtin'],
        auth: 'iam',
      });
      // Omitted limits must be absent keys, not null/undefined values.
      expect('maxIterations' in (config.metadata as any)).toBe(false);
      expect('maxTokens' in (config.metadata as any)).toBe(false);
      expect('timeoutSeconds' in (config.metadata as any)).toBe(false);
    });

    it('templates the Invocation Client and README against the project identity', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      // The thin CLI performs the deterministic argument join/trim and
      // delegates every behavior to the implementation module.
      const invoke = tree.read(`${PROJECT_ROOT}/invoke.ts`, 'utf-8')!;
      expect(invoke).toContain("from './invoke-harness'");
      expect(invoke).toContain('runHarnessCli');

      // Runtime Configuration lookup and usage guidance are wired to the
      // project identity inside the implementation module.
      const invokeHarness = tree.read(
        `${PROJECT_ROOT}/invoke-harness.ts`,
        'utf-8',
      )!;
      expect(invokeHarness).toContain("'MyHarness'");
      expect(invokeHarness).toContain('@proj/my-harness:invoke');

      const readme = tree.read(`${PROJECT_ROOT}/README.md`, 'utf-8')!;
      expect(readme).toContain('# MyHarness');
      expect(readme).toContain('nx run @proj/my-harness:invoke');

      // The generated type-check target compiles both files.
      const tsconfig = tree.read(`${PROJECT_ROOT}/tsconfig.json`, 'utf-8')!;
      expect(tsconfig).toContain('invoke.ts');
      expect(tsconfig).toContain('invoke-harness.ts');
      expect(tsconfig).toContain('"noEmit": true');
    });

    it('flows custom options into persisted metadata and the CDK construct', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
        modelId: 'custom.model-id',
        systemPrompt: 'Custom harness prompt.',
        allowedTools: ['tool-one', 'tool-two'],
        maxIterations: 7,
        maxTokens: 2048,
        timeoutSeconds: 120,
      });

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(config.metadata as any).toEqual({
        generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
        name: 'my-harness',
        rc: 'MyHarness',
        runtimeConfigPath: 'agentcore.harnesses.MyHarness',
        modelId: 'custom.model-id',
        systemPrompt: 'Custom harness prompt.',
        allowedTools: ['tool-one', 'tool-two'],
        maxIterations: 7,
        maxTokens: 2048,
        timeoutSeconds: 120,
        auth: 'iam',
      });

      const construct = tree.read(CDK_CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain("modelId: 'custom.model-id'");
      expect(construct).toContain('Custom harness prompt.');
      expect(construct).toContain("'tool-one', 'tool-two'");
      expect(construct).toContain('maxIterations: 7');
      expect(construct).toContain('maxTokens: 2048');
      expect(construct).toContain('timeoutSeconds: 120');
    });

    it('normalizes mixed-case names and applies the workspace npm scope', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'ShopFront Harness',
        infra: 'none',
      });

      const config = readProjectConfiguration(tree, '@proj/shop-front-harness');
      expect(config.root).toBe('packages/shop-front-harness');
      const metadata = config.metadata as any;
      expect(metadata.name).toBe('shop-front-harness');
      expect(metadata.rc).toBe('ShopFrontHarness');
      expect(metadata.runtimeConfigPath).toBe(
        'agentcore.harnesses.ShopFrontHarness',
      );
    });

    it('adds the generator metric tag to the CDK metrics aspect', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });
      expectHasMetricTags(tree, AGENTCORE_HARNESS_GENERATOR_INFO.metric);
    });
  });

  describe('placement', () => {
    it('defaults the project root to packages/<kebab-case-name>', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });
      expect(readProjectConfiguration(tree, PROJECT_NAME).root).toBe(
        PROJECT_ROOT,
      );
    });

    it('honours custom directory and subDirectory placement', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        directory: 'apps',
        subDirectory: 'harnesses/mine',
        infra: 'none',
      });

      expect(tree.exists('apps/harnesses/mine/project.json')).toBe(true);
      expect(tree.exists('apps/harnesses/mine/invoke.ts')).toBe(true);
      expect(readProjectConfiguration(tree, PROJECT_NAME).root).toBe(
        'apps/harnesses/mine',
      );
      expect(tree.exists(PROJECT_ROOT)).toBe(false);
    });
  });

  describe('reserved targets and reruns', () => {
    it('preserves unrelated user targets and re-adds a missing reserved target on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      config.targets!['docs'] = {
        executor: 'nx:run-commands',
        options: { command: 'echo docs' },
      };
      delete config.targets!.build;
      updateProjectConfiguration(tree, PROJECT_NAME, config);

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const rerun = readProjectConfiguration(tree, PROJECT_NAME);
      // The user-defined target is untouched.
      expect(rerun.targets?.['docs']).toEqual({
        executor: 'nx:run-commands',
        options: { command: 'echo docs' },
      });
      // The missing reserved target is re-added exactly per contract, and
      // the compatible reserved target is retained.
      expect(rerun.targets?.build).toEqual(BUILD_TARGET_CONTRACT);
      expect(rerun.targets?.invoke).toEqual(INVOKE_TARGET_CONTRACT);
    });

    it('reruns with equivalent options leave project.json byte-for-byte unchanged', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });
      const firstRun = tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8')!;

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      // Compatible reserved targets are retained byte-for-byte and the
      // metadata merge is a no-op, so nothing is reserialized.
      expect(tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8')).toBe(firstRun);
    });
  });

  describe('metadata and dependencies', () => {
    it('preserves unrelated metadata and fills only missing owned fields on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      (config.metadata as any).custom = 'user-value';
      // Simulate metadata written before an owned field existed.
      delete (config.metadata as any).modelId;
      updateProjectConfiguration(tree, PROJECT_NAME, config);

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const metadata = readProjectConfiguration(tree, PROJECT_NAME)
        .metadata as any;
      expect(metadata.custom).toBe('user-value');
      expect(metadata.modelId).toBe(DEFAULT_HARNESS_MODEL_ID);
      expect(metadata.systemPrompt).toBe(DEFAULT_HARNESS_SYSTEM_PROMPT);
      expect(metadata.generator).toBe(AGENTCORE_HARNESS_GENERATOR_INFO.id);
    });

    it('adds exact-pinned dependencies split across runtime and development', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const packageJson = readJson(tree, 'package.json');
      // pnpm catalogs are enabled by default in the test tree: the version
      // is recorded in the workspace catalog and package.json is left with
      // a `catalog:` reference, so resolve it back to the recorded range.
      const catalog: Record<string, string> = tree.exists('pnpm-workspace.yaml')
        ? ((
            yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as {
              catalog?: Record<string, string>;
            }
          ).catalog ?? {})
        : {};
      const resolveVersion = (
        section: Record<string, string>,
        pkg: string,
      ): string | undefined =>
        section[pkg] === 'catalog:' ? catalog[pkg] : section[pkg];

      const runtimeDependencies = {
        '@aws-sdk/client-bedrock-agentcore':
          TS_VERSIONS['@aws-sdk/client-bedrock-agentcore'],
        '@aws-sdk/client-appconfigdata':
          TS_VERSIONS['@aws-sdk/client-appconfigdata'],
        '@aws-lambda-powertools/parameters':
          TS_VERSIONS['@aws-lambda-powertools/parameters'],
      };
      const devDependencies = {
        '@types/node': TS_VERSIONS['@types/node'],
        tsx: TS_VERSIONS.tsx,
        typescript: TS_VERSIONS.typescript,
      };
      for (const [pkg, expected] of Object.entries(runtimeDependencies)) {
        expect(resolveVersion(packageJson.dependencies, pkg)).toBe(expected);
      }
      for (const [pkg, expected] of Object.entries(devDependencies)) {
        expect(resolveVersion(packageJson.devDependencies, pkg)).toBe(expected);
      }

      // Runtime and development dependencies must not bleed into each other.
      for (const pkg of Object.keys(devDependencies)) {
        expect(packageJson.dependencies[pkg]).toBeUndefined();
      }
      for (const pkg of Object.keys(runtimeDependencies)) {
        expect(packageJson.devDependencies[pkg]).toBeUndefined();
      }
      // Every added version is an exact pin with no range operator.
      for (const [pkg, section] of [
        ...Object.keys(runtimeDependencies).map(
          (pkg) => [pkg, packageJson.dependencies] as const,
        ),
        ...Object.keys(devDependencies).map(
          (pkg) => [pkg, packageJson.devDependencies] as const,
        ),
      ]) {
        const version = resolveVersion(section, pkg);
        expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
      }
    });

    it('rerunning with equivalent options leaves metadata unchanged', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
        maxTokens: 1024,
      });
      const firstMetadata = readProjectConfiguration(tree, PROJECT_NAME)
        .metadata as any;

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      expect(readProjectConfiguration(tree, PROJECT_NAME).metadata).toEqual(
        firstMetadata,
      );
    });
  });

  describe('infrastructure provider routing', () => {
    it('cdk: emits the CDK construct and exports without any Terraform output', async () => {
      // infra omitted resolves to the 'agentcore' default.
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      expect(tree.exists(CDK_CONSTRUCT_PATH)).toBe(true);
      expect(tree.exists(CDK_HARNESSES_INDEX_PATH)).toBe(true);
      expect(tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')).toContain(
        "export * from './my-harness/my-harness.js'",
      );
      expect(tree.read(CDK_APP_INDEX_PATH, 'utf-8')).toContain(
        "export * from './harnesses/index.js'",
      );
      expect(tree.exists('packages/common/terraform')).toBe(false);
    });

    it('cdk: renders the creation defaults and runtime configuration registration', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      const construct = tree.read(CDK_CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain(`modelId: '${DEFAULT_HARNESS_MODEL_ID}'`);
      expect(construct).toContain(DEFAULT_HARNESS_SYSTEM_PROMPT);
      expect(construct).toContain("allowedTools: ['@builtin']");
      // Omitted execution limits are omitted resource properties.
      expect(construct).not.toContain('maxIterations');
      expect(construct).not.toContain('maxTokens');
      expect(construct).not.toContain('timeoutSeconds');
      // Runtime Configuration merge under agentcore.harnesses.<ClassName>.
      expect(construct).toContain("rc.set('agentcore', 'harnesses'");
      expect(construct).toContain('MyHarness: this.harness.attrArn');
    });

    it('terraform: emits the Terraform module without any CDK harness output', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
      });

      expect(tree.exists(TF_MODULE_PATH)).toBe(true);
      expect(tree.exists('packages/common/constructs')).toBe(false);
      expectHasTerraformMetricTags(
        tree,
        AGENTCORE_HARNESS_GENERATOR_INFO.metric,
      );
    });

    it('terraform: renders the creation defaults with null omitted limits', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
      });

      const module = tree.read(TF_MODULE_PATH, 'utf-8')!;
      expect(tfVariableDefault(module, 'model_id')).toBe(
        `"${DEFAULT_HARNESS_MODEL_ID}"`,
      );
      expect(tfVariableDefault(module, 'system_prompt')).toBe(
        `"${DEFAULT_HARNESS_SYSTEM_PROMPT}"`,
      );
      expect(tfVariableDefault(module, 'allowed_tools')).toBe('["@builtin"]');
      expect(tfVariableDefault(module, 'max_iterations')).toBe('null');
      expect(tfVariableDefault(module, 'max_tokens')).toBe('null');
      expect(tfVariableDefault(module, 'timeout_seconds')).toBe('null');
      expect(module).toContain('resource "aws_bedrockagentcore_harness"');
      expect(module).toContain(
        '"MyHarness" = aws_bedrockagentcore_harness.this.arn',
      );
    });

    it('terraform: flows custom options into module variable defaults', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
        modelId: 'custom.model-id',
        systemPrompt: 'Custom harness prompt.',
        allowedTools: ['tool-one', 'tool-two'],
        maxIterations: 7,
        maxTokens: 2048,
        timeoutSeconds: 120,
      });

      const module = tree.read(TF_MODULE_PATH, 'utf-8')!;
      expect(tfVariableDefault(module, 'model_id')).toBe('"custom.model-id"');
      expect(tfVariableDefault(module, 'system_prompt')).toBe(
        '"Custom harness prompt."',
      );
      // Canonical `terraform fmt` list style: `", "`-separated entries.
      expect(tfVariableDefault(module, 'allowed_tools')).toBe(
        '["tool-one", "tool-two"]',
      );
      expect(tfVariableDefault(module, 'max_iterations')).toBe('7');
      expect(tfVariableDefault(module, 'max_tokens')).toBe('2048');
      expect(tfVariableDefault(module, 'timeout_seconds')).toBe('120');
    });

    it('infra none: emits neither Shared Infrastructure Project nor harness infrastructure', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      expect(tree.exists(`${PROJECT_ROOT}/invoke.ts`)).toBe(true);
      expect(tree.exists('packages/common/constructs')).toBe(false);
      expect(tree.exists('packages/common/terraform')).toBe(false);
    });
  });

  describe('infra: none -> agentcore upgrade', () => {
    it('adds absent infrastructure from persisted creation defaults while preserving user edits byte-for-byte', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
        modelId: 'custom.upgrade-model',
      });

      // Representative user edit to a User-Owned File between runs. The
      // content is already formatter-stable so byte comparison is exact.
      const userEditedInvoke =
        "// user-edited invocation client\nexport const userEdit = 'preserved';\n";
      tree.write(`${PROJECT_ROOT}/invoke.ts`, userEditedInvoke);

      // Upgrade run: infra agentcore, omitted modelId resolves from the
      // metadata persisted at creation rather than the built-in default.
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'agentcore',
        iac: 'cdk',
      });

      expect(tree.exists(CDK_CONSTRUCT_PATH)).toBe(true);
      const construct = tree.read(CDK_CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain("modelId: 'custom.upgrade-model'");
      expect(construct).not.toContain(DEFAULT_HARNESS_MODEL_ID);

      // The user edit is preserved byte-for-byte through the upgrade.
      expect(tree.read(`${PROJECT_ROOT}/invoke.ts`, 'utf-8')).toBe(
        userEditedInvoke,
      );

      // Metadata still records the original creation defaults.
      const metadata = readProjectConfiguration(tree, PROJECT_NAME)
        .metadata as any;
      expect(metadata.modelId).toBe('custom.upgrade-model');
    });
  });

  describe('integration conflicts', () => {
    it('rejects a project owned by a different generator and leaves the tree unchanged', async () => {
      addProjectConfiguration(tree, PROJECT_NAME, {
        root: PROJECT_ROOT,
        projectType: 'application',
        targets: {},
        metadata: { generator: 'ts#project' } as any,
      });
      const before = snapshotTreeChanges(tree);

      await expect(
        agentcoreHarnessGenerator(tree, { name: 'my-harness', infra: 'none' }),
      ).rejects.toThrow(
        /^Integration conflict: project '@proj\/my-harness' already exists but is owned by the 'ts#project' generator/,
      );

      expect(snapshotTreeChanges(tree)).toEqual(before);
    });

    it('rejects a project without generator metadata, not labelled as a schema error', async () => {
      addProjectConfiguration(tree, PROJECT_NAME, {
        root: PROJECT_ROOT,
        projectType: 'application',
        targets: {},
      });

      const failure = await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      }).then(
        () => undefined,
        (error: Error) => error,
      );

      expect(failure?.message).toMatch(/^Integration conflict: /);
      expect(failure?.message).toContain(
        'another tool (it has no generator metadata)',
      );
      // Project conflicts must not masquerade as schema-validation errors.
      expect(failure?.message).not.toContain('Invalid option');
    });

    it('rejects an existing Generator-owned project at an incompatible root, naming both roots', async () => {
      addProjectConfiguration(tree, PROJECT_NAME, {
        root: 'apps/elsewhere',
        projectType: 'application',
        targets: {},
        metadata: { generator: AGENTCORE_HARNESS_GENERATOR_INFO.id } as any,
      });
      const before = snapshotTreeChanges(tree);

      await expect(
        agentcoreHarnessGenerator(tree, { name: 'my-harness', infra: 'none' }),
      ).rejects.toThrow(
        /^Integration conflict: .*'apps\/elsewhere'.*'packages\/my-harness'/,
      );

      expect(snapshotTreeChanges(tree)).toEqual(before);
    });

    it.each(['invoke', 'build'] as const)(
      'rejects an incompatible reserved %s target on rerun, naming the target',
      async (targetName) => {
        await agentcoreHarnessGenerator(tree, {
          name: 'my-harness',
          infra: 'none',
        });

        const config = readProjectConfiguration(tree, PROJECT_NAME);
        config.targets![targetName] = {
          ...config.targets![targetName],
          options: { command: 'echo user-conflict', cwd: '{projectRoot}' },
        };
        updateProjectConfiguration(tree, PROJECT_NAME, config);
        const projectJson = tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8');

        await expect(
          agentcoreHarnessGenerator(tree, {
            name: 'my-harness',
            infra: 'none',
          }),
        ).rejects.toThrow(
          new RegExp(
            `^Integration conflict: .*reserved '${targetName}' target that differs from the agentcore-harness target contract`,
          ),
        );

        // The conflicting project is untouched by the failed run.
        expect(tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8')).toBe(
          projectJson,
        );
      },
    );

    it('rejects an explicit creation option that conflicts with persisted metadata, naming option and both values', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const failure = await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
        modelId: 'different.model',
      }).then(
        () => undefined,
        (error: Error) => error,
      );

      expect(failure?.message).toMatch(/^Integration conflict: /);
      expect(failure?.message).toContain("option 'modelId'");
      expect(failure?.message).toContain('different.model');
      expect(failure?.message).toContain(DEFAULT_HARNESS_MODEL_ID);
    });

    it('rejects explicitly changed allowedTools on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
        allowedTools: ['tool-a'],
      });

      await expect(
        agentcoreHarnessGenerator(tree, {
          name: 'my-harness',
          infra: 'none',
          allowedTools: ['tool-a', 'tool-b'],
        }),
      ).rejects.toThrow(/^Integration conflict: option 'allowedTools'/);
    });

    it('accepts re-supplying values identical to the persisted creation defaults', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
        allowedTools: ['tool-a'],
      });

      await expect(
        agentcoreHarnessGenerator(tree, {
          name: 'my-harness',
          infra: 'none',
          modelId: DEFAULT_HARNESS_MODEL_ID,
          allowedTools: ['tool-a'],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects explicit cdk against an existing Terraform Shared Infrastructure Project, naming both providers, with the entire tree unchanged', async () => {
      await sharedConstructsGenerator(tree, { iac: 'terraform' });
      const before = snapshotTreeChanges(tree);

      await expect(
        agentcoreHarnessGenerator(tree, { name: 'my-harness', iac: 'cdk' }),
      ).rejects.toThrow(
        /^Integration conflict: the explicitly selected IaC provider 'cdk' differs from the existing 'terraform' Shared Infrastructure Project/,
      );

      expect(snapshotTreeChanges(tree)).toEqual(before);
    });

    it('rejects explicit terraform against an existing CDK Shared Infrastructure Project, naming both providers, with the entire tree unchanged', async () => {
      await sharedConstructsGenerator(tree, { iac: 'cdk' });
      const before = snapshotTreeChanges(tree);

      await expect(
        agentcoreHarnessGenerator(tree, {
          name: 'my-harness',
          iac: 'terraform',
        }),
      ).rejects.toThrow(
        /^Integration conflict: the explicitly selected IaC provider 'terraform' differs from the existing 'cdk' Shared Infrastructure Project/,
      );

      expect(snapshotTreeChanges(tree)).toEqual(before);
    });

    it('reports the explicit-provider remediation when inherit cannot resolve', async () => {
      // No aws-nx-plugin config exists, so `iac: inherit` (the default)
      // cannot resolve a provider for infra: agentcore.
      await expect(
        agentcoreHarnessGenerator(tree, { name: 'my-harness' }),
      ).rejects.toThrow(/--iac=cdk or --iac=terraform/);
    });
  });

  describe('error propagation', () => {
    // Missing centralized dependency versions (requirement 11.4) are covered
    // by schema.spec.ts, which asserts withVersions throws for unregistered
    // packages.

    it('propagates a formatting failure', async () => {
      vi.mocked(formatFilesInSubtree).mockRejectedValueOnce(
        new Error('formatting failed'),
      );

      await expect(
        agentcoreHarnessGenerator(tree, { name: 'my-harness', infra: 'none' }),
      ).rejects.toThrow('formatting failed');
    });

    it('returns a callback that installs dependencies with the resolved preference', async () => {
      const callback = await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });
      expect(installDependencies).not.toHaveBeenCalled();

      await callback();
      expect(installDependencies).toHaveBeenCalledExactlyOnceWith(tree, true, {
        languages: ['typescript'],
      });
    });

    it('forwards preferInstallDependencies false to the install callback', async () => {
      const callback = await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
        preferInstallDependencies: false,
      });

      await callback();
      expect(installDependencies).toHaveBeenCalledExactlyOnceWith(tree, false, {
        languages: ['typescript'],
      });
    });

    it('propagates a dependency-installation failure from the callback', async () => {
      const callback = await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      vi.mocked(installDependencies).mockRejectedValueOnce(
        new Error('install failed'),
      );
      await expect(callback()).rejects.toThrow('install failed');
    });
  });

  // User-Owned File byte preservation uses its own fixtures and assertions,
  // deliberately separate from the Generator-Owned Wiring deduplication
  // cases below (requirement 14.3): passing deduplication is never treated
  // as preservation evidence, and vice versa.
  describe('User-Owned File preservation', () => {
    // Formatter-stable file contents: reruns format changed files, so the
    // fixtures are already in repository format to keep the comparison
    // byte-exact (as it is for on-disk files in a real workspace).
    const USER_EDITED_TS =
      "// user-edited\nexport const userEdit = 'preserved';\n";
    const USER_EDITED_JSON = '{\n  "userEdited": true\n}\n';
    const USER_EDITED_MD = '# user-edited readme\n';
    const USER_EDITED_TF = '# user-edited terraform module\n';

    it('preserves edited project files byte-for-byte on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      tree.write(`${PROJECT_ROOT}/invoke.ts`, USER_EDITED_TS);
      tree.write(`${PROJECT_ROOT}/README.md`, USER_EDITED_MD);
      tree.write(`${PROJECT_ROOT}/tsconfig.json`, USER_EDITED_JSON);

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      expect(tree.read(`${PROJECT_ROOT}/invoke.ts`, 'utf-8')).toBe(
        USER_EDITED_TS,
      );
      expect(tree.read(`${PROJECT_ROOT}/README.md`, 'utf-8')).toBe(
        USER_EDITED_MD,
      );
      expect(tree.read(`${PROJECT_ROOT}/tsconfig.json`, 'utf-8')).toBe(
        USER_EDITED_JSON,
      );
    });

    it('preserves an edited CDK construct file byte-for-byte on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      tree.write(CDK_CONSTRUCT_PATH, USER_EDITED_TS);

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      expect(tree.read(CDK_CONSTRUCT_PATH, 'utf-8')).toBe(USER_EDITED_TS);
    });

    it('preserves an edited Terraform module file byte-for-byte on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
      });

      tree.write(TF_MODULE_PATH, USER_EDITED_TF);

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
      });

      expect(tree.read(TF_MODULE_PATH, 'utf-8')).toBe(USER_EDITED_TF);
    });
  });

  describe('Generator-Owned Wiring deduplication', () => {
    const HARNESS_EXPORT = "export * from './my-harness/my-harness.js'";
    const APP_EXPORT = "export * from './harnesses/index.js'";

    it('reruns keep exactly one semantic copy of each CDK export and one project configuration', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      expect(
        countOccurrences(
          tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')!,
          HARNESS_EXPORT,
        ),
      ).toBe(1);
      expect(
        countOccurrences(tree.read(CDK_APP_INDEX_PATH, 'utf-8')!, APP_EXPORT),
      ).toBe(1);

      // A single project configuration exists for the harness.
      const projectNames = [...getProjects(tree).keys()].filter(
        (name) => name === PROJECT_NAME,
      );
      expect(projectNames).toHaveLength(1);
    });

    it('does not grow duplicated equivalent wiring on rerun', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      // Duplicate the generator-owned export (eg. from a hand merge).
      tree.write(
        CDK_HARNESSES_INDEX_PATH,
        `${HARNESS_EXPORT};\n${HARNESS_EXPORT};\n`,
      );

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      // The rerun recognises the equivalent wiring and adds no third copy.
      expect(
        countOccurrences(
          tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')!,
          HARNESS_EXPORT,
        ),
      ).toBe(2);
    });
  });
});
