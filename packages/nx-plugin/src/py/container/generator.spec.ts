/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse } from '@iarna/toml';
import {
  addProjectConfiguration,
  joinPathFragments,
  logger,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils.js';
import type { ContainerArchitecture } from '../../utils/container-constructs/container-constructs.js';
import { CONTAINER_PORT } from '../../utils/container-constructs/container-constructs.js';
import { addContainerServiceCdkConstructs } from '../../utils/container-constructs/container-constructs-cdk.js';
import { addContainerServiceTerraformModules } from '../../utils/container-constructs/container-constructs-terraform.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import type { UVPyprojectToml } from '../../utils/nxlv-python.js';
import {
  createTreeUsingTsSolutionSetup,
  onHostArch,
  snapshotTreeDir,
  stubHostArch,
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
  let restoreHostArch: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Pinned so the architecture the generator writes, and every snapshot
    // below, is the same wherever these tests run. The tests that cover host
    // detection itself pin it to the architecture they are about.
    restoreHostArch = stubHostArch('arm64');
    tree = createTreeUsingTsSolutionSetup();
    await pyProjectGenerator(tree, {
      name: 'my-proj',
      type: 'application',
      directory: 'packages',
      preferInstallDependencies: false,
    });
  });

  afterEach(() => {
    restoreHostArch();
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
      [
        'cdk',
        'packages/common/constructs/project.json',
        [
          'packages/common/constructs/src/app/services/index.ts',
          'packages/common/constructs/src/app/services/my-proj-container.ts',
          'packages/common/constructs/src/core/container/ecs-service.ts',
        ],
      ],
      [
        'terraform',
        'packages/common/terraform/project.json',
        [
          'packages/common/terraform/src/app/services/my-proj-container/my-proj-container.tf',
          'packages/common/terraform/src/core/container/ecs-service/ecs-service.tf',
          'packages/common/terraform/src/core/container/ecs-service/outputs.tf',
          'packages/common/terraform/src/core/container/ecs-service/variables.tf',
        ],
      ],
    ] as const)(
      'should vend the service with infra=ecs and iac=%s',
      async (iac, infraProjectJson, infraFiles) => {
        await pyContainerGenerator(tree, { project: PROJECT, iac });

        snapshotTreeDir(tree, ROOT);
        expect(allPaths(tree)).toMatchSnapshot();

        const infraProject = JSON.parse(tree.read(infraProjectJson, 'utf-8'));
        expect(
          infraProject.targets.build.dependsOn.filter(
            (d: string) => d === `${PROJECT}:build`,
          ),
        ).toHaveLength(1);

        // The shared ECS service construct or module and the per-service file
        // that the infra dispatcher vends for the chosen IaC provider.
        expect(
          allPaths(tree).filter(
            (p) => p.includes('core/container') || p.includes('app/services'),
          ),
        ).toEqual(infraFiles);
      },
    );
  });

  it('should vend the server, Dockerfile and .dockerignore', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    const main = tree.read(`${SRC}/container/main.py`, 'utf-8');
    expect(main).toContain('@app.get("/health")');
    expect(main).toContain('@app.get("/echo")');
    expect(main).toContain('os.environ.get("PORT", "8080")');
    expect(tree.exists(`${SRC}/container/__init__.py`)).toBe(true);

    const dockerfile = tree.read(`${SRC}/container/Dockerfile`, 'utf-8');
    expect(dockerfile).toContain(`FROM ${BASE_IMAGES.python}`);
    expect(dockerfile).toContain('pip uninstall -y pip');
    // The image's user must be the uid the ECS task definition sets: EcsService
    // defaults `user` to '1000' and the Terraform module `container_user` to
    // '1000:1000'. Another uid would run the task as a user the image lacks.
    expect(dockerfile).toContain('--gid 1000 app');
    expect(dockerfile).toContain('--uid 1000 --gid app');
    expect(dockerfile).toContain('USER 1000:1000');
    expect(dockerfile).toContain(`EXPOSE ${CONTAINER_PORT}`);
    expect(dockerfile).toContain(
      'CMD ["python", "-m", "proj_my_proj.container.main"]',
    );
    expect(tree.exists(`${SRC}/container/.dockerignore`)).toBe(true);
  });

  it('should add the serve, bundle, docker, trivy and dev targets', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
    const { targets } = readProject(tree);

    expect(targets['container-serve']).toEqual({
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: ['uv run python -m proj_my_proj.container.main'],
        cwd: '{projectRoot}',
        env: { PORT: '8081', LOCAL_DEV: 'true' },
      },
    });

    expect(targets['bundle-arm']).toBeDefined();
    expect(targets.bundle.dependsOn).toContain('bundle-arm');

    const ctx = 'dist/packages/my_proj/docker/my-proj-container';
    expect(targets['container-docker'].options.commands).toEqual([
      `shx rm -rf ${ctx}`,
      `shx mkdir -p ${ctx}`,
      `shx cp -R dist/packages/my_proj/bundle-arm/. ${ctx}`,
      `shx cp ${SRC}/container/Dockerfile ${ctx}/Dockerfile`,
      `shx cp ${SRC}/container/.dockerignore ${ctx}/.dockerignore`,
      `docker build --platform linux/arm64 -t proj-my-proj-container:latest ${ctx}`,
    ]);
    expect(targets['container-docker'].cache).toBe(false);
    expect(targets['container-docker'].options.parallel).toBe(false);
    expect(targets['container-docker'].dependsOn).toEqual(['bundle-arm']);

    expect(targets.docker.dependsOn).toContain('container-docker');
    expect(targets.build.dependsOn).toContain('docker');
    expect(targets.build.dependsOn).not.toContain('trivy');

    expect(targets['container-trivy'].cache).toBe(false);
    expect(targets['container-trivy'].dependsOn).toEqual(['container-docker']);
    expect(targets.trivy.dependsOn).toContain('container-trivy');

    expect(targets.dev).toEqual({
      continuous: true,
      dependsOn: ['container-serve'],
    });
  });

  // `nx dev <project>` must start the container service, as it does for every
  // other component generator that vends a continuous runner.
  it('should aggregate the serve target under the project dev target', async () => {
    await pyContainerGenerator(tree, {
      project: PROJECT,
      name: 'orders',
      iac: 'cdk',
    });
    expect(readProject(tree).targets.dev).toEqual({
      continuous: true,
      dependsOn: ['orders-serve'],
    });

    // A re-run must not duplicate the entry.
    await pyContainerGenerator(tree, {
      project: PROJECT,
      name: 'orders',
      iac: 'cdk',
    });
    expect(readProject(tree).targets.dev.dependsOn).toEqual(['orders-serve']);
  });

  // The clients the connection generators vend branch on LOCAL_DEV, so
  // without it the served service resolves against AWS instead of the local
  // database the serve target starts.
  it('should set LOCAL_DEV in the serve target', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    expect(readProject(tree).targets['container-serve'].options.env).toEqual(
      expect.objectContaining({ LOCAL_DEV: 'true' }),
    );
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

  /**
   * The wheels in the bundle, the image the `docker` target builds and the
   * deployed task definition all have to be for the same CPU, and the default
   * has to be buildable on the machine the user is sitting at.
   */
  describe('architecture', () => {
    const dockerCommands = (): string[] =>
      readProject(tree).targets['container-docker'].options.commands;

    const architectureOf = (): string => components(tree)[0].architecture;

    it.each<[string, string, string, string]>([
      ['arm64', 'ARM64', 'linux/arm64', 'aarch64-manylinux_2_28'],
      ['x64', 'X86_64', 'linux/amd64', 'x86_64-manylinux_2_28'],
    ])(
      'should bundle and build for the host architecture (%s) when none is given',
      async (hostArch, expected, platform, pythonPlatform) => {
        await onHostArch(hostArch, () =>
          pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' }),
        );

        const { targets } = readProject(tree);
        const bundleTarget = expected === 'ARM64' ? 'bundle-arm' : 'bundle-x86';
        expect(architectureOf()).toBe(expected);
        expect(targets[bundleTarget]).toBeDefined();
        expect(targets[bundleTarget].options.commands[1]).toContain(
          `--python-platform ${pythonPlatform} `,
        );
        expect(targets['container-docker'].dependsOn).toEqual([bundleTarget]);
        expect(dockerCommands().at(-1)).toContain(`--platform ${platform} `);
        // The bundle the image copies in is the one built for this CPU.
        expect(dockerCommands()[2]).toContain(
          `dist/packages/my_proj/${bundleTarget}/.`,
        );
      },
    );

    it.each<[ContainerArchitecture, string, string]>([
      ['ARM64', 'x64', 'bundle-arm'],
      ['X86_64', 'arm64', 'bundle-x86'],
    ])(
      'should bundle and build for %s when it is asked for, whatever the host is',
      async (architecture, hostArch, bundleTarget) => {
        await onHostArch(hostArch, () =>
          pyContainerGenerator(tree, {
            project: PROJECT,
            iac: 'cdk',
            architecture,
          }),
        );

        expect(architectureOf()).toBe(architecture);
        expect(readProject(tree).targets[bundleTarget]).toBeDefined();
      },
    );

    // A re-run that re-detected would add a second bundle target beside the
    // first, and build an image whose wheels are for the other CPU.
    it('should keep the architecture of the first run when re-run on another host', async () => {
      await onHostArch('x64', () =>
        pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' }),
      );

      await onHostArch('arm64', () =>
        pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' }),
      );

      const { targets } = readProject(tree);
      expect(architectureOf()).toBe('X86_64');
      expect(targets['bundle-x86']).toBeDefined();
      expect(targets['bundle-arm']).toBeUndefined();
      expect(targets.bundle.dependsOn).toEqual(['bundle-x86']);
      expect(dockerCommands().at(-1)).toContain('--platform linux/amd64 ');
    });

    // A service generated before this option existed recorded no architecture
    // and was vended ARM64-only, and its vended code stays on disk.
    it('should keep ARM64 for a service recorded without an architecture', async () => {
      await pyContainerGenerator(tree, {
        project: PROJECT,
        iac: 'cdk',
        architecture: 'ARM64',
      });
      const project = readProject(tree);
      delete (project.metadata as any).components[0].architecture;
      updateProjectConfiguration(tree, PROJECT, project);

      await onHostArch('x64', () =>
        pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' }),
      );

      const { targets } = readProject(tree);
      expect(targets['bundle-x86']).toBeUndefined();
      expect(dockerCommands().at(-1)).toContain('--platform linux/arm64 ');
    });

    // Only `project.json` is rewritten on a re-run: the vended module is
    // written KeepExisting, and `addPythonBundleTarget` only adds, so a switch
    // leaves two things behind that the warning has to name.
    describe('switching an existing service', () => {
      const switchTo = async (
        architecture: ContainerArchitecture,
      ): Promise<string> => {
        const warn = vi
          .spyOn(logger, 'warn')
          .mockImplementation(() => undefined);
        try {
          await pyContainerGenerator(tree, {
            project: PROJECT,
            iac: 'terraform',
            architecture,
          });
          return warn.mock.calls.map(([message]) => String(message)).join('\n');
        } finally {
          warn.mockRestore();
        }
      };

      it('should warn, naming the Terraform module and the stale bundle target', async () => {
        await pyContainerGenerator(tree, {
          project: PROJECT,
          iac: 'terraform',
          architecture: 'ARM64',
        });

        const message = await switchTo('X86_64');

        expect(message).toContain(
          'generated for ARM64 and is now set to X86_64',
        );
        expect(message).toContain(
          'packages/common/terraform/src/app/services/my-proj-container/my-proj-container.tf: set cpu_architecture = "X86_64"',
        );
        expect(message).toContain('bundle-arm');
        // Left in place on purpose: other components in the project may bundle
        // for ARM64 too.
        expect(readProject(tree).targets['bundle-arm']).toBeDefined();
      });

      it('should record the new architecture so a later re-run keeps it', async () => {
        await pyContainerGenerator(tree, {
          project: PROJECT,
          iac: 'terraform',
          architecture: 'ARM64',
        });
        await switchTo('X86_64');

        await onHostArch('arm64', () =>
          pyContainerGenerator(tree, { project: PROJECT, iac: 'terraform' }),
        );

        expect(architectureOf()).toBe('X86_64');
        expect(dockerCommands().at(-1)).toContain('--platform linux/amd64 ');
        expect(dockerCommands()[2]).toContain(
          'dist/packages/my_proj/bundle-x86/.',
        );
      });

      // Escalating from infra=none vends the module for the first time, so it
      // already carries this run's architecture. The bundle target the switch
      // left behind is still real, and still named.
      it('should name the stale bundle target but no file when this run vended the module', async () => {
        await pyContainerGenerator(tree, {
          project: PROJECT,
          infra: 'none',
          iac: 'terraform',
          architecture: 'ARM64',
        });

        const message = await switchTo('X86_64');

        expect(message).toContain('bundle-arm');
        expect(message).not.toContain('app/services/');
        expect(message).not.toContain('does not change the infrastructure');
      });
    });

    it('should pass the architecture to the vended infrastructure', async () => {
      await pyContainerGenerator(tree, {
        project: PROJECT,
        iac: 'cdk',
        architecture: 'X86_64',
      });

      expect(addContainerServiceCdkConstructs).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ architecture: 'X86_64' }),
      );
    });
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
        iac: 'cdk',
      }),
    ]);
    expect(components(tree)[0]).not.toHaveProperty('ingress');
    expect(components(tree)[0]).not.toHaveProperty('auth');
  });

  // The constructs a first run vended stay on disk, and the connection
  // generators refuse a service whose recorded infra is not ecs.
  it('should keep infra=ecs when re-run with infra=none', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    await pyContainerGenerator(tree, {
      project: PROJECT,
      infra: 'none',
      iac: 'cdk',
    });

    expect(components(tree)).toEqual([
      expect.objectContaining({ infra: 'ecs', iac: 'cdk' }),
    ]);
  });

  describe('dispatcher options', () => {
    const expected = {
      nameClassName: 'MyProjContainer',
      nameKebabCase: 'my-proj-container',
      projectName: PROJECT,
      dockerImageTag: 'proj-my-proj-container:latest',
      dockerBuildContextDir: 'dist/packages/my_proj/docker/my-proj-container',
      containerPort: CONTAINER_PORT,
      healthCheckCommand: [
        'CMD',
        'python',
        '-c',
        "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8080') + '/health', timeout=3)",
      ],
      containers: 'docker',
      architecture: 'ARM64',
    };

    it('should pass the service options to the CDK constructs', async () => {
      await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });
      expect(addContainerServiceCdkConstructs).toHaveBeenCalledWith(tree, {
        ...expected,
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

    expect(targets['container-docker'].options.commands.at(-1)).toMatch(
      /^finch build --platform linux\/arm64 /,
    );
    const trivy: string[] = targets['container-trivy'].options.commands;
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

  it('should vend no infrastructure with infra=none', async () => {
    await pyContainerGenerator(tree, {
      project: PROJECT,
      infra: 'none',
      iac: 'cdk',
    });

    const [component] = components(tree);
    expect(component).not.toHaveProperty('iac');
    expect(addContainerServiceCdkConstructs).not.toHaveBeenCalled();
    expect(addContainerServiceTerraformModules).not.toHaveBeenCalled();
    expect(
      tree
        .listChanges()
        .map((change) => change.path)
        .filter((path) => path.startsWith('packages/common/')),
    ).toEqual([]);
  });

  it('should record the contract metadata and metric', async () => {
    await pyContainerGenerator(tree, { project: PROJECT, iac: 'cdk' });

    expect(components(tree)).toEqual([
      {
        generator: PY_CONTAINER_GENERATOR_INFO.id,
        path: 'proj_my_proj/container',
        name: 'container',
        infra: 'ecs',
        port: 8081,
        rc: 'MyProjContainer',
        architecture: 'ARM64',
        iac: 'cdk',
      },
    ]);
    expectHasMetricTags(tree, PY_CONTAINER_GENERATOR_INFO.metric);
  });
});
