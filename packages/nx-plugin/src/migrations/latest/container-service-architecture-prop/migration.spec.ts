/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { joinPathFragments, type Tree } from '@nx/devkit';
import ts from 'typescript';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AddContainerServiceInfraOptions,
  containerHealthCheckCommand,
} from '../../../utils/container-constructs/container-constructs.js';
import { addContainerServiceCdkConstructs } from '../../../utils/container-constructs/container-constructs-cdk.js';
import { addContainerServiceTerraformModules } from '../../../utils/container-constructs/container-constructs-terraform.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DEPENDENCIES,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration, { CORE_FILES } from './migration.js';

const CONSTRUCTS_SRC = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
);
const ECS_SERVICE_TS = joinPathFragments(
  CONSTRUCTS_SRC,
  'core/container/ecs-service.ts',
);
const SUBCLASS_TS = joinPathFragments(CONSTRUCTS_SRC, 'app/services/orders.ts');
const TERRAFORM_CORE = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src/core/container/ecs-service',
);
const ECS_SERVICE_TF = joinPathFragments(TERRAFORM_CORE, 'ecs-service.tf');
const VARIABLES_TF = joinPathFragments(TERRAFORM_CORE, 'variables.tf');

/**
 * The files v1.7.0 actually vended, frozen beside this migration. They are the
 * migration's real input, so the anchors it matches on are tested against what
 * shipped rather than against something this spec derived.
 */
const shipped = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'files', name), 'utf-8');

const SHIPPED_ECS_SERVICE_TS = shipped('ecs-service.v1.7.0.ts.template');
const SHIPPED_ECS_SERVICE_TF = shipped('ecs-service.v1.7.0.tf.template');
const SHIPPED_VARIABLES_TF = shipped('variables.v1.7.0.tf.template');

const serviceOptions: AddContainerServiceInfraOptions = {
  nameClassName: 'Orders',
  nameKebabCase: 'orders',
  projectName: '@proj/shop',
  dockerImageTag: 'proj-orders:latest',
  dockerBuildContextDir: 'dist/apps/shop/bundle/container/orders',
  containerPort: 8080,
  healthCheckCommand: containerHealthCheckCommand('node'),
  architecture: 'ARM64',
  containers: 'docker',
};

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/** Every file under `dir` in the tree, depth first. */
const treeFilesUnder = (tree: Tree, dir: string): string[] =>
  tree.isFile(dir)
    ? [dir]
    : tree
        .children(dir)
        .flatMap((child) => treeFilesUnder(tree, `${dir}/${child}`));

describe('container-service-architecture-prop migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  /** A workspace holding the CDK core construct v1.7.0 vended. */
  const givenShippedCdkConstruct = async (
    contents = SHIPPED_ECS_SERVICE_TS,
  ): Promise<void> => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    tree.write(ECS_SERVICE_TS, contents);
  };

  /** A workspace holding the Terraform core module v1.7.0 vended. */
  const givenShippedTerraformModule = async (
    overrides: { module?: string; variables?: string } = {},
  ): Promise<void> => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'terraform' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    tree.write(ECS_SERVICE_TF, overrides.module ?? SHIPPED_ECS_SERVICE_TF);
    tree.write(VARIABLES_TF, overrides.variables ?? SHIPPED_VARIABLES_TF);
  };

  /**
   * The CDK core construct a workspace generated today holds, formatted the
   * way the generator leaves it.
   */
  const generatedCdkConstruct = async (): Promise<string> => {
    const fresh = createTreeUsingTsSolutionSetup();
    await sharedConstructsGenerator(
      fresh,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    await addContainerServiceCdkConstructs(fresh, serviceOptions);
    await formatFilesInSubtree(fresh);
    return read(fresh, ECS_SERVICE_TS);
  };

  describe('the CDK construct', () => {
    it('should give the shipped construct the architecture input', async () => {
      await givenShippedCdkConstruct();

      const { nextSteps } = await migration(tree);

      const migrated = read(tree, ECS_SERVICE_TS);
      expect(migrated).toContain(
        "export type EcsServiceArchitecture = 'ARM64' | 'X86_64';",
      );
      expect(migrated).toContain(
        'readonly architecture?: EcsServiceArchitecture;',
      );
      expect(migrated).toContain(
        "const architecture = ARCHITECTURES[props.architecture ?? 'ARM64'];",
      );
      expect(migrated).toContain('cpuArchitecture: architecture.cpu,');
      expect(migrated).toContain(
        'image: this.containerImage(props.image, architecture.platform),',
      );
      expect(migrated).toContain(
        'return ContainerImage.fromAsset(image.directory, { platform });',
      );
      // Nothing of the hard-coded architecture is left.
      expect(migrated).not.toContain('cpuArchitecture: CpuArchitecture.ARM64');
      expect(migrated).not.toContain(
        'platform: Platform.LINUX_ARM64,\n      });',
      );
      expect(nextSteps.join('\n')).toContain(ECS_SERVICE_TS);
    });

    // The migration's contract: an upgraded workspace ends up with the file a
    // freshly generated one gets, byte for byte. The generator formats what it
    // writes, so the comparison has to as well — the vended template holds one
    // line biome wraps.
    it('should converge on what the generator writes today', async () => {
      await givenShippedCdkConstruct();
      await migration(tree);
      const migrated = read(tree, ECS_SERVICE_TS);

      expect(migrated).toEqual(await generatedCdkConstruct());
    });

    it('should change nothing and report nothing on a second run', async () => {
      await givenShippedCdkConstruct();
      await migration(tree);
      const first = read(tree, ECS_SERVICE_TS);

      const { nextSteps } = await migration(tree);

      expect(read(tree, ECS_SERVICE_TS)).toEqual(first);
      expect(nextSteps).toEqual([]);
    });

    it('should leave a freshly generated construct alone', async () => {
      const generated = await generatedCdkConstruct();
      await givenShippedCdkConstruct(generated);

      const { nextSteps } = await migration(tree);

      expect(read(tree, ECS_SERVICE_TS)).toEqual(generated);
      expect(nextSteps).toEqual([]);
    });

    // One missing anchor means the rest of the file is not what this migration
    // was written against, so a partial rewrite could leave it uncompilable.
    it('should leave a diverged construct untouched and report it', async () => {
      const diverged = SHIPPED_ECS_SERVICE_TS.replace(
        '        cpuArchitecture: CpuArchitecture.ARM64,',
        '        cpuArchitecture: CpuArchitecture.X86_64,',
      );
      await givenShippedCdkConstruct(diverged);

      const { nextSteps } = await migration(tree);

      // Nothing of the architecture input was added, and the line the user
      // changed is still theirs. (`formatFilesInSubtree` runs either way, so
      // this is the behaviour to assert rather than byte equality.)
      const after = read(tree, ECS_SERVICE_TS);
      expect(after).not.toContain('EcsServiceArchitecture');
      expect(after).not.toContain('ARCHITECTURES');
      expect(after).toContain('cpuArchitecture: CpuArchitecture.X86_64,');
      expect(nextSteps).toHaveLength(1);
      expect(nextSteps[0]).toContain(ECS_SERVICE_TS);
      expect(nextSteps[0]).toContain('has diverged');
      expect(nextSteps[0]).toContain('architecture');
    });
  });

  describe('the Terraform module', () => {
    it('should give the shipped module the architecture variable', async () => {
      await givenShippedTerraformModule();

      const { nextSteps } = await migration(tree);

      expect(read(tree, ECS_SERVICE_TF)).toContain(
        'cpu_architecture        = var.cpu_architecture',
      );
      expect(read(tree, ECS_SERVICE_TF)).not.toContain(
        'cpu_architecture        = "ARM64"',
      );
      const variables = read(tree, VARIABLES_TF);
      expect(variables).toContain('variable "cpu_architecture" {');
      expect(variables).toContain('default     = "ARM64"');
      expect(variables).toContain('contains(["ARM64", "X86_64"]');
      expect(nextSteps.join('\n')).toContain(ECS_SERVICE_TF);
      expect(nextSteps.join('\n')).toContain(VARIABLES_TF);
    });

    // The shipped module interpolates provider versions, which another
    // migration owns, so convergence is checked against today's rendered
    // module with only this migration's own edits undone.
    it('should converge on what the generator writes today', async () => {
      const fresh = createTreeUsingTsSolutionSetup();
      await sharedConstructsGenerator(
        fresh,
        { iac: 'terraform' },
        declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
      );
      await addContainerServiceTerraformModules(fresh, serviceOptions);
      const generatedModule = read(fresh, ECS_SERVICE_TF);
      const generatedVariables = read(fresh, VARIABLES_TF);

      await givenShippedTerraformModule({
        module: generatedModule.replace(
          'cpu_architecture        = var.cpu_architecture',
          'cpu_architecture        = "ARM64"',
        ),
        variables: generatedVariables
          .replace(
            '# Inputs of the reusable ECS service module (AWS Fargate) in an existing VPC.\n# The module never creates a VPC.',
            '# Inputs of the reusable ECS service module (AWS Fargate, linux/arm64) in an\n# existing VPC. The module never creates a VPC.',
          )
          .replace(/variable "cpu_architecture" \{[\s\S]*?\n\}\n\n/, ''),
      });

      await migration(tree);

      expect(read(tree, ECS_SERVICE_TF)).toEqual(generatedModule);
      expect(read(tree, VARIABLES_TF)).toEqual(generatedVariables);
    });

    it('should change nothing and report nothing on a second run', async () => {
      await givenShippedTerraformModule();
      await migration(tree);
      const first = {
        module: read(tree, ECS_SERVICE_TF),
        variables: read(tree, VARIABLES_TF),
      };

      const { nextSteps } = await migration(tree);

      expect(read(tree, ECS_SERVICE_TF)).toEqual(first.module);
      expect(read(tree, VARIABLES_TF)).toEqual(first.variables);
      expect(nextSteps).toEqual([]);
    });

    it('should leave a diverged module untouched and report it', async () => {
      await givenShippedTerraformModule({
        module: SHIPPED_ECS_SERVICE_TF.replace(
          '    cpu_architecture        = "ARM64"',
          '    cpu_architecture = "ARM64"',
        ),
      });

      const { nextSteps } = await migration(tree);

      expect(read(tree, ECS_SERVICE_TF)).toContain(
        'cpu_architecture = "ARM64"',
      );
      const reported = nextSteps.filter((step) =>
        step.includes('has diverged'),
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain(ECS_SERVICE_TF);
      // variables.tf matched, so it was still migrated.
      expect(read(tree, VARIABLES_TF)).toContain('variable "cpu_architecture"');
    });
  });

  it('should do nothing in a workspace with no container service', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.exists(ECS_SERVICE_TS)).toBe(false);
    expect(tree.exists(ECS_SERVICE_TF)).toBe(false);
  });

  it('should migrate both providers in a workspace that vends both', async () => {
    await givenShippedCdkConstruct();
    await givenShippedTerraformModule();

    const { nextSteps } = await migration(tree);

    expect(read(tree, ECS_SERVICE_TS)).toContain('EcsServiceArchitecture');
    expect(read(tree, ECS_SERVICE_TF)).toContain('var.cpu_architecture');
    expect(read(tree, VARIABLES_TF)).toContain('variable "cpu_architecture"');
    // One line naming all three, plus nothing else.
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('defaults to ARM64');
  });

  /**
   * Every edit replaces its first match, so an anchor that appears twice would
   * rewrite the wrong one. Checked against the files that shipped, which are
   * the only input this migration is written for.
   */
  it('should anchor on text that appears exactly once in the shipped files', () => {
    const shippedContents: Record<string, string> = {
      [ECS_SERVICE_TS]: SHIPPED_ECS_SERVICE_TS,
      [ECS_SERVICE_TF]: SHIPPED_ECS_SERVICE_TF,
      [VARIABLES_TF]: SHIPPED_VARIABLES_TF,
    };

    for (const file of CORE_FILES) {
      const contents = shippedContents[file.path];
      expect(contents, `no shipped copy of ${file.path}`).toBeDefined();
      expect(file.edits.length).toBeGreaterThan(0);
      for (const edit of file.edits) {
        expect(
          contents.split(edit.from).length - 1,
          `${file.path}: ${edit.from.split('\n')[0]}`,
        ).toBe(1);
      }
      // And the marker that makes a second run a no-op is not there yet.
      expect(contents).not.toContain(file.migratedMarker);
    }
  });

  /**
   * The defect this migration exists for: an upgraded workspace that adds
   * another container service gets today's per-service subclass, which passes
   * `architecture` to the core construct. Against the version v1.7.0 vended
   * that does not compile, and the failure is in `common/constructs`, so
   * everything downstream of the shared constructs fails with it.
   */
  it('should let a service added after the upgrade compile', async () => {
    const compileDir = join(
      import.meta.dirname,
      `_tmp_architecture-migration-${process.pid}`,
    );
    /**
     * Type checks the shared constructs package as it stands in the tree. It is
     * written beside this spec so `aws-cdk-lib` and `constructs` resolve from
     * the workspace root `node_modules`; `_tmp_*` is git-ignored.
     */
    const diagnostics = (label: string): string[] => {
      const root = join(compileDir, label);
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      const rootNames = treeFilesUnder(tree, CONSTRUCTS_SRC).map((path) => {
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, read(tree, path));
        return target;
      });
      const program = ts.createProgram(rootNames, {
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        types: ['node'],
      });
      return ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    };

    try {
      await givenShippedCdkConstruct();
      // The subclass a newly added service gets, which passes `architecture`.
      await addContainerServiceCdkConstructs(tree, serviceOptions);
      expect(read(tree, SUBCLASS_TS)).toContain("architecture: 'ARM64',");
      expect(diagnostics('before')).toEqual([
        expect.stringContaining(
          "'architecture' does not exist in type 'EcsServiceProps'",
        ),
      ]);

      await migration(tree);

      expect(diagnostics('after')).toEqual([]);
    } finally {
      rmSync(compileDir, { recursive: true, force: true });
    }
  }, 120_000);
});
