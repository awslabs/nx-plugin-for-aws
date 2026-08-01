/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import yaml from 'js-yaml';
import {
  METRICS_ASPECT_FILE_PATH,
  TERRAFORM_METRICS_FILE_PATH,
} from '../metrics';
import { getPackageVersion } from '../nx';
import { createTreeUsingTsSolutionSetup } from '../test';
import {
  NX_PACKAGES,
  PY_VERSIONS,
  TERRAFORM_VERSIONS,
  TS_VERSIONS,
} from '../versions';
import { syncVendedVersions } from './sync-vended-versions';

// Versions the plugin vends, read from the manifest so the tests track it.
const VENDED_ZOD = TS_VERSIONS.zod;
const VENDED_CDK_LIB = TS_VERSIONS['aws-cdk-lib'];
const VENDED_VITEST = TS_VERSIONS.vitest;
const VENDED_FASTAPI = PY_VERSIONS.fastapi.replace('==', '');
const VENDED_POWERTOOLS = PY_VERSIONS['aws-lambda-powertools'].replace(
  '==',
  '',
);
const VENDED_AWS_PROVIDER = TERRAFORM_VERSIONS.aws;

const readCatalog = (tree: Tree): Record<string, string> =>
  (
    yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as {
      catalog?: Record<string, string>;
    }
  ).catalog ?? {};

const writeCatalog = (tree: Tree, catalog: Record<string, string>): void => {
  const workspaceYaml =
    (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
      string,
      unknown
    >) ?? {};
  tree.write('pnpm-workspace.yaml', yaml.dump({ ...workspaceYaml, catalog }));
};

const readWorkspaceYaml = (tree: Tree): Record<string, unknown> =>
  (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
    string,
    unknown
  >) ?? {};

const writeWorkspaceYaml = (
  tree: Tree,
  entries: Record<string, unknown>,
): void =>
  tree.write(
    'pnpm-workspace.yaml',
    yaml.dump({ ...readWorkspaceYaml(tree), ...entries }),
  );

const requiredProviders = (awsVersion: string) => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${awsVersion}"
    }
  }
}
`;

describe('sync-vended-versions migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Only dependencies a generator declares are synced, so these tests need a
    // project recording the generators that own the packages under test.
    addProjectConfiguration(tree, 'owner', {
      root: 'packages/owner',
      metadata: {
        generator: 'ts#trpc-api',
        components: [
          { generator: 'py#project' },
          { generator: 'py#fast-api' },
          { generator: 'ts#project' },
          { generator: 'ts#infra' },
        ],
      } as never,
    });
  });

  it('should upgrade outdated catalog entries to the vended versions', async () => {
    writeCatalog(tree, { zod: '4.3.0', 'aws-cdk-lib': '2.200.0' });

    await syncVendedVersions(tree);

    expect(readCatalog(tree)).toEqual({
      zod: VENDED_ZOD,
      'aws-cdk-lib': VENDED_CDK_LIB,
    });
  });

  it('should upgrade direct version ranges in project package.json files', async () => {
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: '4.3.0' },
      devDependencies: { vitest: '4.0.0' },
    });

    await syncVendedVersions(tree);

    const packageJson = readJson(tree, 'packages/api/package.json');
    expect(packageJson.dependencies.zod).toBe(VENDED_ZOD);
    expect(packageJson.devDependencies.vitest).toBe(VENDED_VITEST);
  });

  it('should upgrade a catalog entry through the manifests referencing it', async () => {
    writeCatalog(tree, { zod: '4.3.0' });
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: 'catalog:' },
    });

    await syncVendedVersions(tree);

    // The version moves in the catalog only; the reference is the point of it.
    expect(readCatalog(tree).zod).toBe(VENDED_ZOD);
    expect(readJson(tree, 'packages/api/package.json').dependencies.zod).toBe(
      'catalog:',
    );
  });

  it('should upgrade a catalog entry no manifest references', async () => {
    // Left behind by a removed project, or seeded before anything adopted it.
    // Nothing points at it, so it is only reachable by writing the catalog.
    writeCatalog(tree, { zod: '4.3.0' });

    await syncVendedVersions(tree);

    expect(readCatalog(tree).zod).toBe(VENDED_ZOD);
  });

  // Generators pin a package under an override when a dependency's own range
  // would otherwise resolve a second, incompatible copy. Devkit does not manage
  // these fields, so without this the pin stays where it was generated.
  describe('overrides and resolutions', () => {
    it("should upgrade an owned package npm's overrides pins", async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { zod: '4.3.0' },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').overrides.zod).toBe(VENDED_ZOD);
    });

    it("should upgrade an owned package yarn's resolutions pins", async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        resolutions: { zod: '4.3.0' },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').resolutions.zod).toBe(VENDED_ZOD);
    });

    it("should upgrade an owned package pnpm 10's overrides pins", async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        pnpm: { overrides: { zod: '4.3.0' } },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').pnpm.overrides.zod).toBe(
        VENDED_ZOD,
      );
    });

    // pnpm 11 reads overrides from the workspace file rather than the manifest.
    it("should upgrade an owned package pnpm 11's workspace overrides pins", async () => {
      writeWorkspaceYaml(tree, { overrides: { zod: '4.3.0' } });

      await syncVendedVersions(tree);

      expect(readWorkspaceYaml(tree).overrides).toEqual({ zod: VENDED_ZOD });
    });

    // A key names the package in its last segment, with earlier segments the
    // parents it is scoped under — the form both rdb and mcp-server generate.
    // A scoped package keeps its `@`, so the boundary is only a `/` that isn't
    // starting one.
    it('should upgrade a package a scoped key pins', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        resolutions: {
          '**/@modelcontextprotocol/sdk/zod': '4.3.0',
          '@trpc/client/@trpc/server': '11.0.0',
        },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').resolutions).toEqual({
        '**/@modelcontextprotocol/sdk/zod': VENDED_ZOD,
        '@trpc/client/@trpc/server': TS_VERSIONS['@trpc/server'],
      });
    });

    // npm allows a trailing range on the key, scoping the override to the
    // versions it intersects. The package is the part before it.
    it('should upgrade a package a range-scoped key pins', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { 'zod@^4': '4.3.0', '@trpc/server@^11': '11.0.0' },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').overrides).toEqual({
        'zod@^4': VENDED_ZOD,
        '@trpc/server@^11': TS_VERSIONS['@trpc/server'],
      });
    });

    // npm nests an override to scope it, so the pin sits a level down.
    it('should upgrade a package a nested override pins', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { '@modelcontextprotocol/sdk': { zod: '4.3.0' } },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').overrides).toEqual({
        '@modelcontextprotocol/sdk': { zod: VENDED_ZOD },
      });
    });

    it('should leave a package no generator owns alone', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { rxjs: '7.0.0' },
        resolutions: { 'some-parent/rxjs': '7.0.0' },
      });

      await syncVendedVersions(tree);

      const packageJson = readJson(tree, 'package.json');
      expect(packageJson.overrides.rxjs).toBe('7.0.0');
      expect(packageJson.resolutions['some-parent/rxjs']).toBe('7.0.0');
    });

    it('should leave a range the user widened alone', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { zod: '^4.0.0' },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').overrides.zod).toBe('^4.0.0');
    });

    // nx moves through `packageJsonUpdates` so `nx migrate` collects Nx's own
    // migrations; rewriting it here would skip them.
    it('should leave an nx package alone', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { '@nx/devkit': '23.0.0' },
      });

      await syncVendedVersions(tree);

      expect(readJson(tree, 'package.json').overrides['@nx/devkit']).toBe(
        '23.0.0',
      );
    });

    it('should report the install a changed override needs', async () => {
      writeJson(tree, 'package.json', {
        name: '@org/root',
        overrides: { zod: '4.3.0' },
      });

      const { nextSteps } = await syncVendedVersions(tree);

      expect(nextSteps).toContainEqual(
        expect.stringContaining('TypeScript dependency versions were updated'),
      );
    });
  });

  it('should not add a vended package to a manifest that does not declare it', async () => {
    // A version bump must never introduce a dependency — handing the whole
    // vended list to devkit would add all of it to every manifest.
    writeJson(tree, 'packages/pyapp/package.json', { name: '@org/pyapp' });

    await syncVendedVersions(tree);

    expect(readJson(tree, 'packages/pyapp/package.json')).toEqual({
      name: '@org/pyapp',
    });
  });

  it('should leave a range that already permits the vended version alone', async () => {
    // `^4.3.0` resolves to the vended version already, so narrowing it to an
    // exact pin would discard the user's choice and change nothing.
    writeCatalog(tree, { zod: '^4.3.0' });
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: 'catalog:' },
      devDependencies: { vitest: `^${VENDED_VITEST}` },
    });

    await syncVendedVersions(tree);

    expect(readCatalog(tree).zod).toBe('^4.3.0');
    expect(
      readJson(tree, 'packages/api/package.json').devDependencies.vitest,
    ).toBe(`^${VENDED_VITEST}`);
  });

  it('should upgrade a range that does not reach the vended version', async () => {
    // `~4.3.0` cannot resolve 4.4.x, so it is genuinely behind.
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: '~4.3.0' },
    });

    await syncVendedVersions(tree);

    expect(readJson(tree, 'packages/api/package.json').dependencies.zod).toBe(
      VENDED_ZOD,
    );
  });

  it('should upgrade bun catalogs declared in the root package.json', async () => {
    writeJson(tree, 'package.json', {
      name: 'root',
      type: 'module',
      catalog: { zod: '4.3.0' },
      catalogs: { testing: { vitest: '4.0.0' } },
    });

    await syncVendedVersions(tree);

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.catalog.zod).toBe(VENDED_ZOD);
    expect(packageJson.catalogs.testing.vitest).toBe(VENDED_VITEST);
  });

  it('should upgrade python pins including extras, in dependencies and groups', async () => {
    tree.write(
      'packages/api/pyproject.toml',
      `[project]
name = "api"
dependencies = [
  "fastapi==0.130.0",
  "aws-lambda-powertools[tracer]==3.20.0"
]

[dependency-groups]
dev = [ "fastapi[standard]==0.130.0" ]
`,
    );

    await syncVendedVersions(tree);

    const pyProject = tree.read('packages/api/pyproject.toml', 'utf-8');
    expect(pyProject).toContain(`"fastapi==${VENDED_FASTAPI}"`);
    expect(pyProject).toContain(
      `"aws-lambda-powertools[tracer]==${VENDED_POWERTOOLS}"`,
    );
    expect(pyProject).toContain(`"fastapi[standard]==${VENDED_FASTAPI}"`);
  });

  it('should upgrade terraform provider versions', async () => {
    tree.write('packages/infra/src/providers.tf', requiredProviders('6.40.0'));

    await syncVendedVersions(tree);

    expect(tree.read('packages/infra/src/providers.tf', 'utf-8')).toContain(
      `version = "${VENDED_AWS_PROVIDER}"`,
    );
  });

  it('should update the tracked plugin version in the metrics files', async () => {
    tree.write(
      METRICS_ASPECT_FILE_PATH,
      `export class MetricsAspect implements IAspect {
  public visit(node: IConstruct): void {
    const id = 'uksb-4wk0bqpg5s';
    const version = '0.1.0';
    const tags: string[] = ['g1'];
  }
}
`,
    );
    tree.write(
      TERRAFORM_METRICS_FILE_PATH,
      `locals {
  metric_id = "uksb-4wk0bqpg5s"
  metric_version = "0.1.0"
  metric_tags = ["g1"]
}
`,
    );

    await syncVendedVersions(tree);

    const version = getPackageVersion();
    expect(tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8')).toContain(
      `const version = '${version}'`,
    );
    expect(tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')).toContain(
      `metric_version = "${version}"`,
    );
    // The metric id and tags are owned by the generators, not this migration.
    expect(tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8')).toContain(
      `const tags: string[] = ['g1']`,
    );
    expect(tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')).toContain(
      'metric_tags = ["g1"]',
    );
  });

  it('should leave versions the user raised above the vended version alone', async () => {
    writeCatalog(tree, { zod: '99.0.0' });
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { vitest: '99.0.0' },
    });

    await syncVendedVersions(tree);

    expect(readCatalog(tree).zod).toBe('99.0.0');
    expect(
      readJson(tree, 'packages/api/package.json').dependencies.vitest,
    ).toBe('99.0.0');
  });

  it('should leave ranges and protocol specifiers alone', async () => {
    writeCatalog(tree, { zod: '^4.3.0' });
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: 'catalog:', '@org/other': 'workspace:*' },
    });

    await syncVendedVersions(tree);

    expect(readCatalog(tree).zod).toBe('^4.3.0');
    const packageJson = readJson(tree, 'packages/api/package.json');
    expect(packageJson.dependencies.zod).toBe('catalog:');
    expect(packageJson.dependencies['@org/other']).toBe('workspace:*');
  });

  it('should leave inexact terraform provider constraints alone', async () => {
    tree.write('packages/infra/src/providers.tf', requiredProviders('~> 6.40'));

    await syncVendedVersions(tree);

    expect(tree.read('packages/infra/src/providers.tf', 'utf-8')).toContain(
      'version = "~> 6.40"',
    );
  });

  it('should scope each terraform provider to its own source', async () => {
    // Two providers in one block, plus a `required_version` and an unrelated
    // string that a looser match would clobber.
    tree.write(
      'packages/infra/src/providers.tf',
      `terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.40.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.5.0"
    }
    datadog = {
      source  = "DataDog/datadog"
      version = "1.0.0"
    }
  }
}

variable "some_version" {
  default = "0.0.1"
}
`,
    );

    await syncVendedVersions(tree);

    const synced = tree.read('packages/infra/src/providers.tf', 'utf-8')!;
    expect(synced).toContain(`version = "${VENDED_AWS_PROVIDER}"`);
    expect(synced).toContain(`version = "${TERRAFORM_VERSIONS.random}"`);
    // Not a provider the plugin vends, and not a provider version at all.
    expect(synced).toContain('version = "1.0.0"');
    expect(synced).toContain('required_version = ">= 1.0"');
    expect(synced).toContain('default = "0.0.1"');
  });

  it('should sync a provider declared under a renamed alias', async () => {
    // Scoping is by `source`, so the attribute name doesn't have to be the
    // provider name.
    tree.write(
      'packages/infra/src/aliased.tf',
      `terraform {
  required_providers {
    aws_primary = {
      source  = "hashicorp/aws"
      version = "6.40.0"
    }
  }
}
`,
    );

    await syncVendedVersions(tree);

    expect(tree.read('packages/infra/src/aliased.tf', 'utf-8')).toContain(
      `version = "${VENDED_AWS_PROVIDER}"`,
    );
  });

  it('should leave every nx package to packageJsonUpdates', async () => {
    // Bumping nx from a migration would stop `nx migrate` collecting Nx's own
    // migrations for the hop, so `packageJsonUpdates` owns these instead.
    const stale = '23.0.0';
    writeCatalog(
      tree,
      Object.fromEntries(NX_PACKAGES.map((name) => [name, stale])),
    );
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      devDependencies: Object.fromEntries(
        NX_PACKAGES.map((name) => [name, stale]),
      ),
    });

    await syncVendedVersions(tree);

    const catalog = readCatalog(tree);
    const projectDeps = readJson(tree, 'packages/api/package.json')
      .devDependencies as Record<string, string>;
    for (const name of NX_PACKAGES) {
      expect(catalog[name]).toBe(stale);
      expect(projectDeps[name]).toBe(stale);
    }
  });

  it('should leave dependencies the plugin does not vend alone', async () => {
    writeCatalog(tree, { 'some-other-package': '1.0.0' });
    tree.write(
      'packages/api/pyproject.toml',
      `[project]
dependencies = [ "some-other-package==1.0.0" ]
`,
    );

    await syncVendedVersions(tree);

    expect(readCatalog(tree)['some-other-package']).toBe('1.0.0');
    expect(tree.read('packages/api/pyproject.toml', 'utf-8')).toContain(
      '"some-other-package==1.0.0"',
    );
  });

  it('should not downgrade a terraform provider or rewrite an unvended one', async () => {
    tree.write('packages/infra/src/providers.tf', requiredProviders('99.0.0'));
    tree.write(
      'packages/infra/src/other.tf',
      `terraform {
  required_providers {
    datadog = {
      source  = "DataDog/datadog"
      version = "1.0.0"
    }
  }
}
`,
    );

    await syncVendedVersions(tree);

    expect(tree.read('packages/infra/src/providers.tf', 'utf-8')).toContain(
      'version = "99.0.0"',
    );
    expect(tree.read('packages/infra/src/other.tf', 'utf-8')).toContain(
      'version = "1.0.0"',
    );
  });

  it('should report next steps for the lock files it does not update', async () => {
    writeCatalog(tree, { zod: '4.3.0' });
    tree.write(
      'packages/api/pyproject.toml',
      `[project]
dependencies = [ "fastapi==0.130.0" ]
`,
    );
    tree.write('packages/infra/src/providers.tf', requiredProviders('6.40.0'));

    const { nextSteps } = await syncVendedVersions(tree);

    expect(nextSteps).toHaveLength(3);
    expect(nextSteps.join('\n')).toContain('package manager install');
    expect(nextSteps.join('\n')).toContain('uv sync');
    expect(nextSteps.join('\n')).toContain('terraform init -upgrade');
  });

  it('should report no next steps when everything is already up to date', async () => {
    writeCatalog(tree, { zod: VENDED_ZOD });

    const { nextSteps } = await syncVendedVersions(tree);

    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    writeCatalog(tree, { zod: '4.3.0' });
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { vitest: '4.0.0' },
    });
    tree.write(
      'packages/api/pyproject.toml',
      `[project]
dependencies = [ "fastapi==0.130.0" ]
`,
    );
    tree.write('packages/infra/src/providers.tf', requiredProviders('6.40.0'));

    await syncVendedVersions(tree);

    const afterFirstRun = {
      workspaceYaml: tree.read('pnpm-workspace.yaml', 'utf-8'),
      packageJson: tree.read('packages/api/package.json', 'utf-8'),
      pyProject: tree.read('packages/api/pyproject.toml', 'utf-8'),
      providers: tree.read('packages/infra/src/providers.tf', 'utf-8'),
    };

    const { nextSteps } = await syncVendedVersions(tree);

    expect({
      workspaceYaml: tree.read('pnpm-workspace.yaml', 'utf-8'),
      packageJson: tree.read('packages/api/package.json', 'utf-8'),
      pyProject: tree.read('packages/api/pyproject.toml', 'utf-8'),
      providers: tree.read('packages/infra/src/providers.tf', 'utf-8'),
    }).toEqual(afterFirstRun);
    expect(nextSteps).toEqual([]);
  });
});
