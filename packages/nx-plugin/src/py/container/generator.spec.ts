/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse } from '@iarna/toml';
import {
  addProjectConfiguration,
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils.js';
import { CONTAINER_PORT } from '../../utils/container-constructs/container-constructs.js';
import { addContainerServiceCdkConstructs } from '../../utils/container-constructs/container-constructs-cdk.js';
import { addContainerServiceTerraformModules } from '../../utils/container-constructs/container-constructs-terraform.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import type { UVPyprojectToml } from '../../utils/nxlv-python.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import { BASE_IMAGES, PY_VERSIONS } from '../../utils/versions.js';
import { pyProjectGenerator } from '../project/generator.js';
import {
  PY_CONTAINER_GENERATOR_INFO,
  pyContainerGenerator,
} from './generator.js';

// Wrap the real dispatcher bodies so calls can be asserted while the real code
// still runs.
vi.mock(
  '../../utils/container-constructs/container-constructs-cdk.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../utils/container-constructs/container-constructs-cdk.js')
      >();
    return {
      ...actual,
      addContainerServiceCdkConstructs: vi.fn(
        actual.addContainerServiceCdkConstructs,
      ),
    };
  },
);
vi.mock(
  '../../utils/container-constructs/container-constructs-terraform.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../utils/container-constructs/container-constructs-terraform.js')
      >();
    return {
      ...actual,
      addContainerServiceTerraformModules: vi.fn(
        actual.addContainerServiceTerraformModules,
      ),
    };
  },
);

const PROJECT = 'proj.my_proj';
const ROOT = 'packages/my_proj';
const SRC = `${ROOT}/proj_my_proj`;

const allPaths = (tree: Tree, dir = ''): string[] =>
  tree
    .children(dir)
    .flatMap((child) => {
      const path = dir ? joinPathFragments(dir, child) : child;
      return tree.isFile(path) ? [path] : allPaths(tree, path);
    })
    .sort();

const allContents = (tree: Tree) =>
  Object.fromEntries(allPaths(tree).map((p) => [p, tree.read(p, 'utf-8')]));

const readProject = (tree: Tree) => readProjectConfiguration(tree, PROJECT);

const components = (tree: Tree) =>
  (readProject(tree).metadata as any).components as any[];

describe('py#container generator', () => {
  let tree: Tree;

  beforeEach(async () => {
    vi.clearAllMocks();
    tree = createTreeUsingTsSolutionSetup();
    await pyProjectGenerator(tree, {
      name: 'my-proj',
      type: 'application',
      directory: 'packages',
      preferInstallDependencies: false,
    });
  });

  describe('snapshots', () => {
    it('should vend the service with infra=none', async () => {
      await pyContainerGenerator(tree, {
        project: PROJECT,
        infra: 'none',
        iac: 'inherit',
      });

      snapshotTreeDir(tree, ROOT);
      expect(allPaths(tree)).toMatchSnapshot();
      expect(tree.exists('packages/common/constructs')).toBe(false);
      expect(addContainerServiceCdkConstructs).not.toHaveBeenCalled();
      expect(addContainerServiceTerraformModules).not.toHaveBeenCalled();
    });

    it.each([
      ['cdk', 'packages/common/constructs/project.json'],
      ['terraform', 'packages/common/terraform/project.json'],
    ] as const)(
      'should vend the service with infra=ecs and iac=%s',
      async (iac, infraProjectJson) => {
        await pyContainerGenerator(tree, { project: PROJECT, iac });

        snapshotTreeDir(tree, ROOT);
        expect(allPaths(tree)).toMatchSnapshot();

        const infraProject = JSON.parse(tree.read(infraProjectJson, 'utf-8'));
        expect(
          infraProject.targets.build.dependsOn.filter(
            (d: string) => d === `${PROJECT}:build`,
          ),
        ).toHaveLength(1);

        // The dispatcher bodies are stubs at the contract and write no files;
        // these assertions change when the CDK and Terraform bodies land.
        expect(
          allPaths(tree).filter(
            (p) => p.includes('core/container') || p.includes('app/services'),
          ),
        ).toEqual([]);
      },
    );
  });

  it('should vend the server, Dockerfile and .dockerignore', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    const main = tree.read(`${SRC}/service/main.py`, 'utf-8');
    expect(main).toContain('@app.get("/health")');
    expect(main).toContain('@app.get("/echo")');
    expect(main).toContain('os.environ.get("PORT", "8080")');
    expect(tree.exists(`${SRC}/service/__init__.py`)).toBe(true);

    const dockerfile = tree.read(`${SRC}/service/Dockerfile`, 'utf-8');
    expect(dockerfile).toContain(`FROM ${BASE_IMAGES.python}`);
    expect(dockerfile).toContain('pip uninstall -y pip');
    expect(dockerfile).toContain('USER 10001');
    expect(dockerfile).toContain(`EXPOSE ${CONTAINER_PORT}`);
    expect(dockerfile).toContain(
      'CMD ["python", "-m", "proj_my_proj.service.main"]',
    );
    expect(tree.exists(`${SRC}/service/.dockerignore`)).toBe(true);
  });

  it('should add the serve, bundle, docker and trivy targets', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
    const { targets } = readProject(tree);

    expect(targets['service-serve']).toEqual({
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: ['uv run python -m proj_my_proj.service.main'],
        cwd: '{projectRoot}',
        env: { PORT: '8081' },
      },
    });

    expect(targets['bundle-arm']).toBeDefined();
    expect(targets.bundle.dependsOn).toContain('bundle-arm');

    const ctx = 'dist/packages/my_proj/docker/my-proj-service';
    expect(targets['service-docker'].options.commands).toEqual([
      `shx rm -rf ${ctx}`,
      `shx mkdir -p ${ctx}`,
      `shx cp -R dist/packages/my_proj/bundle-arm/. ${ctx}`,
      `shx cp ${SRC}/service/Dockerfile ${ctx}/Dockerfile`,
      `shx cp ${SRC}/service/.dockerignore ${ctx}/.dockerignore`,
      `docker build --platform linux/arm64 -t proj-my-proj-service:latest ${ctx}`,
    ]);
    expect(targets['service-docker'].cache).toBe(false);
    expect(targets['service-docker'].options.parallel).toBe(false);
    expect(targets['service-docker'].dependsOn).toEqual(['bundle-arm']);

    expect(targets.docker.dependsOn).toContain('service-docker');
    expect(targets.build.dependsOn).toContain('docker');
    expect(targets.build.dependsOn).not.toContain('trivy');

    expect(targets['service-trivy'].cache).toBe(false);
    expect(targets['service-trivy'].dependsOn).toEqual(['service-docker']);
    expect(targets.trivy.dependsOn).toContain('service-trivy');
  });

  it('should use the service name for a named service', async () => {
    await pyContainerGenerator(tree, {
      project: PROJECT,
      name: 'orders',
      iac: 'cdk',
    });
    const { targets } = readProject(tree);

    expect(tree.exists(`${SRC}/orders/main.py`)).toBe(true);
    expect(targets['orders-serve']).toBeDefined();
    expect(targets['orders-trivy']).toBeDefined();
    expect(targets['orders-docker'].options.commands.at(-1)).toBe(
      'docker build --platform linux/arm64 -t proj-orders:latest dist/packages/my_proj/docker/orders',
    );
    expect(components(tree)).toEqual([
      expect.objectContaining({
        generator: PY_CONTAINER_GENERATOR_INFO.id,
        path: 'proj_my_proj/orders',
        name: 'orders',
        rc: 'Orders',
      }),
    ]);
  });

  it('should add fastapi and uvicorn to pyproject.toml', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    const pyproject = parse(
      tree.read(`${ROOT}/pyproject.toml`, 'utf-8'),
    ) as UVPyprojectToml;
    expect(pyproject.project.dependencies).toEqual(
      expect.arrayContaining([
        `fastapi${PY_VERSIONS.fastapi}`,
        `uvicorn${PY_VERSIONS.uvicorn}`,
      ]),
    );
  });

  it('should change nothing when re-run with the same options', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
    const first = allContents(tree);
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    expect(allContents(tree)).toEqual(first);
    const metadata = readProject(tree).metadata as any;
    expect(metadata.ports).toHaveLength(1);
    expect(metadata.components).toHaveLength(1);
  });

  it('should assign distinct ports to two services in one project', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
    await pyContainerGenerator(tree, {
      project: PROJECT,
      name: 'orders',
      iac: 'cdk',
    });

    const project = readProject(tree);
    expect((project.metadata as any).ports).toEqual([8081, 8082]);
    expect(components(tree).map((c) => c.port)).toEqual([8081, 8082]);
    expect(project.targets['orders-serve'].options.env.PORT).toBe('8082');
  });

  it('should add the infrastructure when re-run with infra=ecs after infra=none', async () => {
    await pyContainerGenerator(tree, {
      project: PROJECT,
      infra: 'none',
      iac: 'cdk',
    });
    expect(addContainerServiceCdkConstructs).not.toHaveBeenCalled();

    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    expect(addContainerServiceCdkConstructs).toHaveBeenCalledTimes(1);
    const constructs = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8'),
    );
    expect(constructs.targets.build.dependsOn).toContain(`${PROJECT}:build`);
    expect(components(tree)).toEqual([
      expect.objectContaining({
        infra: 'ecs',
        ingress: 'http-api',
        auth: 'iam',
        iac: 'cdk',
      }),
    ]);
  });

  describe('dispatcher options', () => {
    const expected = {
      nameClassName: 'MyProjService',
      nameKebabCase: 'my-proj-service',
      projectName: PROJECT,
      dockerImageTag: 'proj-my-proj-service:latest',
      dockerBuildContextDir: 'dist/packages/my_proj/docker/my-proj-service',
      containerPort: CONTAINER_PORT,
      ingress: 'http-api',
      auth: 'iam',
      containers: 'docker',
    };

    it('should pass the service options to the CDK constructs', async () => {
      await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
      expect(addContainerServiceCdkConstructs).toHaveBeenCalledWith(tree, {
        ...expected,
        iac: 'cdk',
      });
    });

    it('should pass auth none for a private service', async () => {
      await pyContainerGenerator(tree, {
        project: PROJECT,
        ingress: 'private',
        iac: 'cdk',
      });
      expect(addContainerServiceCdkConstructs).toHaveBeenCalledWith(tree, {
        ...expected,
        ingress: 'private',
        auth: 'none',
        iac: 'cdk',
      });
    });

    it('should pass cognito auth', async () => {
      await pyContainerGenerator(tree, {
        project: PROJECT,
        auth: 'cognito',
        iac: 'cdk',
      });
      expect(addContainerServiceCdkConstructs).toHaveBeenCalledWith(tree, {
        ...expected,
        auth: 'cognito',
        iac: 'cdk',
      });
    });

    it('should pass the service options to the Terraform modules', async () => {
      await pyContainerGenerator(tree, { project: PROJECT, iac: 'terraform' });
      expect(addContainerServiceTerraformModules).toHaveBeenCalledWith(tree, {
        ...expected,
        iac: 'terraform',
      });
      expect(addContainerServiceCdkConstructs).not.toHaveBeenCalled();
    });
  });

  it('should use finch when configured', async () => {
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { containers: { engine: 'finch' } });

    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
    const { targets } = readProject(tree);

    expect(targets['service-docker'].options.commands.at(-1)).toMatch(
      /^finch build --platform linux\/arm64 /,
    );
    const trivy: string[] = targets['service-trivy'].options.commands;
    expect(trivy.some((c) => c.startsWith('finch save '))).toBe(true);
    expect(trivy.some((c) => c.startsWith('finch run '))).toBe(true);
    expect(addContainerServiceCdkConstructs).toHaveBeenCalledWith(
      tree,
      expect.objectContaining({ containers: 'finch' }),
    );
  });

  it('should throw for a project without a pyproject.toml', async () => {
    addProjectConfiguration(tree, 'ts-proj', {
      root: 'packages/ts-proj',
      sourceRoot: 'packages/ts-proj/src',
    });
    await expect(
      pyContainerGenerator(tree, { project: 'ts-proj', iac: 'cdk' }),
    ).rejects.toThrow(/Expected a Python project/);
  });

  it('should throw for a project without a source root', async () => {
    const { sourceRoot: _, ...project } = readProject(tree);
    updateProjectConfiguration(tree, PROJECT, project);
    await expect(
      pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' }),
    ).rejects.toThrow(/source root/);
  });

  it('should drop ingress and auth with infra=none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await pyContainerGenerator(tree, {
      project: PROJECT,
      infra: 'none',
      ingress: 'private',
      auth: 'cognito',
      iac: 'cdk',
    });

    expect(warn).toHaveBeenCalled();
    const [component] = components(tree);
    expect(component).not.toHaveProperty('ingress');
    expect(component).not.toHaveProperty('auth');
    expect(component).not.toHaveProperty('iac');
    expect(addContainerServiceCdkConstructs).not.toHaveBeenCalled();
    expect(addContainerServiceTerraformModules).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('should drop auth with ingress=private', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await pyContainerGenerator(tree, {
      project: PROJECT,
      ingress: 'private',
      auth: 'cognito',
      iac: 'cdk',
    });

    expect(warn).toHaveBeenCalled();
    const [component] = components(tree);
    expect(component.ingress).toBe('private');
    expect(component).not.toHaveProperty('auth');
    warn.mockRestore();
  });

  it('should record the contract metadata and metric', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    expect(components(tree)).toEqual([
      {
        generator: PY_CONTAINER_GENERATOR_INFO.id,
        path: 'proj_my_proj/service',
        name: 'service',
        infra: 'ecs',
        ingress: 'http-api',
        auth: 'iam',
        port: 8081,
        rc: 'MyProjService',
        iac: 'cdk',
      },
    ]);
    expectHasMetricTags(tree, PY_CONTAINER_GENERATOR_INFO.metric);
  });
});
