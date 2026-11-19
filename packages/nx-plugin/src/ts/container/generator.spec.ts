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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils.js';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import { TypeScriptVerifier } from '../../utils/test/ts.spec.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import { BASE_IMAGES } from '../../utils/versions.js';
import { injectRdsCaBundleIntoDockerfile } from '../rdb/utils.js';
import {
  TS_CONTAINER_GENERATOR_INFO,
  tsContainerGenerator,
} from './generator.js';
import type { TsContainerGeneratorSchema } from './schema';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

const PROJECT_ROOT = 'apps/test-project';
const CONTAINER_DIR = `${PROJECT_ROOT}/src/container`;
const CONSTRUCTS_SRC = 'packages/common/constructs/src';
const SERVICE_FILE = `${CONSTRUCTS_SRC}/app/services/test-project-container.ts`;
const BUNDLE_DIR =
  'dist/apps/test-project/bundle/container/test-project-container';

const readProject = (tree: Tree, root = PROJECT_ROOT) =>
  readJson(tree, `${root}/project.json`);

const componentsOf = (tree: Tree) => readProject(tree).metadata.components;

const allFiles = (tree: Tree): Record<string, string | null> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((change) => change.type !== 'DELETE')
      .map((change) => [change.path, tree.read(change.path, 'utf-8')]),
  );

describe('ts#container generator', () => {
  let tree: Tree;

  const run = (options: Partial<TsContainerGeneratorSchema> = {}) =>
    tsContainerGenerator(tree, {
      project: 'test-project',
      iac: 'cdk',
      ...options,
    });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'test-project', {
      root: PROJECT_ROOT,
      sourceRoot: `${PROJECT_ROOT}/src`,
      targets: {
        build: {
          executor: '@nx/js:tsc',
          options: { outputPath: 'dist/apps/test-project' },
        },
      },
    });
    writeJson(tree, `${PROJECT_ROOT}/tsconfig.json`, {});
    writeJson(tree, `${PROJECT_ROOT}/package.json`, {
      name: 'test-project',
      version: '1.0.0',
    });
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[string, Partial<TsContainerGeneratorSchema>]>([
    ['ecs', {}],
    ['infra none', { infra: 'none' }],
  ])('should match the generated files snapshot (%s)', async (_, options) => {
    await run(options);

    snapshotTreeDir(tree, PROJECT_ROOT);
    if (options.infra !== 'none') {
      snapshotTreeDir(tree, `${CONSTRUCTS_SRC}/app`);
      expect(
        tree.read(`${CONSTRUCTS_SRC}/core/index.ts`, 'utf-8'),
      ).toMatchSnapshot('core-index.ts');
    }
  });

  it('should vend the server, Dockerfile, .dockerignore, bundle entry and trivy ignore file', async () => {
    await run();

    for (const file of [
      'index.ts',
      'server.ts',
      'Dockerfile',
      '.dockerignore',
    ]) {
      expect(tree.exists(`${CONTAINER_DIR}/${file}`)).toBe(true);
    }
    expect(tree.exists(`${PROJECT_ROOT}/.trivyignore`)).toBe(true);
    const rolldownConfig = tree.read(
      `${PROJECT_ROOT}/rolldown.config.ts`,
      'utf-8',
    );
    expect(rolldownConfig).toContain("input: 'src/container/index.ts'");
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/container/test-project-container/index.js',
    );
    expect(tree.read(`${CONTAINER_DIR}/.dockerignore`, 'utf-8')).toBe(
      '*\n!index.js\n',
    );
  });

  it('should vend a server that compiles', async () => {
    await run();

    new TypeScriptVerifier(['@types/node']).expectTypeScriptToCompile(tree, [
      `${CONTAINER_DIR}/server.ts`,
      `${CONTAINER_DIR}/index.ts`,
    ]);
  });

  it('should vend a hardened Dockerfile', async () => {
    await run();

    const dockerfile = tree.read(`${CONTAINER_DIR}/Dockerfile`, 'utf-8');
    expect(dockerfile).toMatch(new RegExp(`^FROM ${BASE_IMAGES.node}\n`));
    expect(dockerfile).toContain('apt-get upgrade');
    expect(dockerfile).toContain('npm uninstall -g npm');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerfile).toContain('COPY index.js');
  });

  // ts#rdb#container-connection inserts its root-only RDS CA install step
  // right before the first EXPOSE line, so USER must come after EXPOSE.
  it('should keep the steps a connection inserts before EXPOSE running as root', async () => {
    await run();

    const dockerfile = tree.read(`${CONTAINER_DIR}/Dockerfile`, 'utf-8') ?? '';
    injectRdsCaBundleIntoDockerfile(tree, `${CONTAINER_DIR}/Dockerfile`);
    const injected = tree.read(`${CONTAINER_DIR}/Dockerfile`, 'utf-8') ?? '';

    expect(dockerfile.indexOf('EXPOSE 8080')).toBeLessThan(
      dockerfile.indexOf('USER node'),
    );
    expect(injected.indexOf('update-ca-certificates')).toBeGreaterThan(-1);
    expect(injected.indexOf('update-ca-certificates')).toBeLessThan(
      injected.indexOf('USER node'),
    );
  });

  it('should add the bundle, docker, trivy, serve and dev targets', async () => {
    await run();

    const { targets, metadata } = readProject(tree);
    expect(targets.bundle.dependsOn).toEqual(['compile']);
    expect(targets['container-docker']).toEqual(
      expect.objectContaining({
        cache: false,
        dependsOn: ['bundle'],
      }),
    );
    const commands: string[] = targets['container-docker'].options.commands;
    expect(commands).toHaveLength(3);
    expect(commands[0]).toContain(`${CONTAINER_DIR}/Dockerfile`);
    expect(commands[1]).toContain(`${CONTAINER_DIR}/.dockerignore`);
    expect(commands[2]).toBe(
      `docker build --platform linux/arm64 -t proj-test-project-container:latest ${BUNDLE_DIR}`,
    );
    expect(targets.docker.dependsOn).toContain('container-docker');
    expect(targets.build.dependsOn).toContain('docker');
    expect(targets['container-trivy'].dependsOn).toEqual(['container-docker']);
    expect(targets.trivy.dependsOn).toContain('container-trivy');

    const [component] = metadata.components;
    expect(targets['container-serve']).toEqual({
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: ['tsx --watch ./src/container/index.ts'],
        cwd: '{projectRoot}',
        env: { PORT: `${component.port}`, LOCAL_DEV: 'true' },
      },
    });
    expect(targets.dev).toEqual({
      continuous: true,
      dependsOn: ['container-serve'],
    });
  });

  // The clients the connection generators vend branch on LOCAL_DEV, so
  // without it the served service resolves against AWS instead of the local
  // database the serve target starts.
  it('should set LOCAL_DEV in the serve target', async () => {
    await run();

    expect(readProject(tree).targets['container-serve'].options.env).toEqual(
      expect.objectContaining({ LOCAL_DEV: 'true' }),
    );
  });

  it('should name everything after a named service', async () => {
    await run({ name: 'orders' });

    const { targets } = readProject(tree);
    for (const target of ['orders-docker', 'orders-trivy', 'orders-serve']) {
      expect(targets[target]).toBeDefined();
    }
    expect(targets['container-docker']).toBeUndefined();
    expect(tree.exists(`${PROJECT_ROOT}/src/orders/index.ts`)).toBe(true);
    expect(
      tree.read(`${CONSTRUCTS_SRC}/app/services/orders.ts`, 'utf-8'),
    ).toContain('export class Orders extends EcsService');
  });

  it('should build and scan with finch when configured', async () => {
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { containers: { engine: 'finch' } });

    await run();

    const { targets } = readProject(tree);
    expect(targets['container-docker'].options.commands[2]).toMatch(
      /^finch build --platform linux\/arm64 /,
    );
    expect(targets['container-trivy'].options.commands.join('\n')).toContain(
      'finch save',
    );
  });

  it('should vend the CDK service and build the shared constructs after the project', async () => {
    await run();

    expect(tree.exists(SERVICE_FILE)).toBe(true);
    expect(
      readProject(tree, 'packages/common/constructs').targets.build.dependsOn,
    ).toContainEqual(expect.stringMatching(/test-project:build$/));
  });

  it('should vend a private CDK service with a node health check', async () => {
    await run();

    const serviceFile = tree.read(SERVICE_FILE, 'utf-8') ?? '';
    expect(serviceFile).toMatch(
      /command: \[\s*['"]CMD['"],\s*['"]node['"],\s*['"]-e['"],/,
    );
    expect(serviceFile).toContain('Duration.seconds(30)');
    for (const text of ['ingress', 'auth:', 'loadBalancer']) {
      expect(serviceFile).not.toContain(text);
    }
    const core =
      tree.read(`${CONSTRUCTS_SRC}/core/container/ecs-service.ts`, 'utf-8') ??
      '';
    for (const text of [
      'ApplicationLoadBalancer',
      'HttpApi',
      'VpcLink',
      "'connection', 'services'",
    ]) {
      expect(core).not.toContain(text);
    }
  });

  it('should vend a private Terraform service with a node health check', async () => {
    await run({ iac: 'terraform' });

    const terraformSrc = 'packages/common/terraform/src';
    const appModule =
      tree.read(
        `${terraformSrc}/app/services/test-project-container/test-project-container.tf`,
        'utf-8',
      ) ?? '';
    expect(appModule).toMatch(
      /^\s*health_check_command\s*=\s*\["CMD", "node", "-e", /m,
    );
    const core =
      tree.read(
        `${terraformSrc}/core/container/ecs-service/ecs-service.tf`,
        'utf-8',
      ) ?? '';
    expect(core).not.toBe('');
    expect(core).not.toContain('aws_lb');
    expect(core).not.toContain('aws_apigatewayv2');
  });

  it('should add the Terraform artifact dependency for iac=terraform', async () => {
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'terraform' } });

    await run({ iac: 'inherit' });

    expect(tree.exists(SERVICE_FILE)).toBe(false);
    expect(
      readProject(tree, 'packages/common/terraform').targets.build.dependsOn,
    ).toContainEqual(expect.stringMatching(/test-project:build$/));
    expect(componentsOf(tree)[0].iac).toBe('terraform');
  });

  it('should vend the image but no infrastructure with infra=none', async () => {
    await run({ infra: 'none' });

    expect(tree.exists(SERVICE_FILE)).toBe(false);
    expect(tree.exists('packages/common/constructs/project.json')).toBe(false);
    expect(tree.exists(`${CONTAINER_DIR}/Dockerfile`)).toBe(true);
    expect(readProject(tree).targets['container-docker']).toBeDefined();
    const [component] = componentsOf(tree);
    expect(component.infra).toBe('none');
    expect(component).not.toHaveProperty('ingress');
    expect(component).not.toHaveProperty('auth');
    expect(component).not.toHaveProperty('iac');
    expect(
      tree
        .listChanges()
        .map((change) => change.path)
        .filter((path) => path.startsWith('packages/common/')),
    ).toEqual([]);
  });

  it('should add the infrastructure when infra=none is re-run with infra=ecs', async () => {
    await run({ infra: 'none' });
    const [before] = componentsOf(tree);

    await run({ infra: 'ecs' });

    expect(tree.exists(SERVICE_FILE)).toBe(true);
    const components = componentsOf(tree);
    expect(components).toHaveLength(1);
    expect(components[0]).toEqual(
      expect.objectContaining({
        infra: 'ecs',
        iac: 'cdk',
        port: before.port,
      }),
    );
    expect(components[0]).not.toHaveProperty('ingress');
    expect(components[0]).not.toHaveProperty('auth');
    expect(tree.read(`${CONSTRUCTS_SRC}/app/services/index.ts`, 'utf-8')).toBe(
      "export * from './test-project-container.js';\n",
    );
  });

  // The constructs a first run vended stay on disk, and the connection
  // generators refuse a service whose recorded infra is not ecs.
  it('should keep infra=ecs when re-run with infra=none', async () => {
    await run({ infra: 'ecs' });

    await run({ infra: 'none' });

    expect(componentsOf(tree)).toEqual([
      expect.objectContaining({ infra: 'ecs', iac: 'cdk' }),
    ]);
  });

  it('should change nothing when re-run with the same options', async () => {
    await run();
    const before = allFiles(tree);

    await run();

    expect(allFiles(tree)).toEqual(before);
    const { targets } = readProject(tree);
    expect(
      targets.docker.dependsOn.filter((t: string) => t === 'container-docker'),
    ).toHaveLength(1);
    expect(
      tree
        .read(`${PROJECT_ROOT}/rolldown.config.ts`, 'utf-8')
        ?.split("input: 'src/container/index.ts'"),
    ).toHaveLength(2);
  });

  it('should keep a user edit to the server on re-run', async () => {
    await run();
    tree.write(`${CONTAINER_DIR}/server.ts`, '// edited by the user\n');

    await run();

    expect(tree.read(`${CONTAINER_DIR}/server.ts`, 'utf-8')).toBe(
      '// edited by the user\n',
    );
  });

  it('should leave the first service alone when adding a second one', async () => {
    await run();
    const firstServiceFile = tree.read(SERVICE_FILE, 'utf-8');

    await run({ name: 'orders' });

    expect(tree.read(SERVICE_FILE, 'utf-8')).toBe(firstServiceFile);
    const components = componentsOf(tree);
    expect(components.map((c: { name: string }) => c.name)).toEqual([
      'container',
      'orders',
    ]);
    expect(components.map((c: { port: number }) => c.port)).toEqual([
      8081, 8082,
    ]);
    expect(readProject(tree).targets.dev.dependsOn).toEqual([
      'container-serve',
      'orders-serve',
    ]);
  });

  it('should reject a project that is not TypeScript', async () => {
    tree.delete(`${PROJECT_ROOT}/tsconfig.json`);

    await expect(run()).rejects.toThrow(/Unsupported project test-project/);
  });

  it('should add the generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );

    await run({ infra: 'none' });

    expectHasMetricTags(tree, TS_CONTAINER_GENERATOR_INFO.metric);
  });

  it('should add the dependencies the server and targets use', async () => {
    await run();

    expect(
      readJson(tree, `${PROJECT_ROOT}/package.json`).devDependencies,
    ).toHaveProperty('@types/node');
    const rootPackageJson = readJson(tree, 'package.json');
    const rootDependencies = {
      ...rootPackageJson.dependencies,
      ...rootPackageJson.devDependencies,
    };
    expect(rootDependencies).toHaveProperty('tsx');
    expect(rootDependencies).toHaveProperty('rolldown');
  });
});
