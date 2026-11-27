/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@iarna/toml';
import {
  joinPathFragments,
  logger,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import type { UVPyprojectToml } from '../../utils/nxlv-python.js';
import { sortObjectKeys } from '../../utils/object.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants.js';
import {
  createTreeUsingTsSolutionSetup,
  onHostArch,
  snapshotTreeDir,
  stubHostArch,
} from '../../utils/test.js';
import {
  FAST_API_GENERATOR_INFO,
  pyFastApiProjectGenerator,
} from './generator.js';
import type { PyFastApiProjectGeneratorSchema } from './schema';

describe('fastapi project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a FastAPI project with correct structure', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify project structure
    expect(tree.exists('apps/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/proj_test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/proj_test_api/main.py')).toBeTruthy();
    expect(tree.exists('apps/test_api/tests/test_main.py')).toBeTruthy();

    // Verify default files are removed
    expect(tree.exists('apps/test_api/proj_test_api/hello.py')).toBeFalsy();
    expect(tree.exists('apps/test_api/tests/test_hello.py')).toBeFalsy();
  });

  it('should generate a FastAPI project with custom module name', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      moduleName: 'my_module',
      iac: 'cdk',
    });

    // Verify project structure
    expect(tree.exists('apps/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/my_module')).toBeTruthy();
    expect(tree.exists('apps/test_api/my_module/main.py')).toBeTruthy();
  });

  it('should set up project configuration with FastAPI targets', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_api/project.json', 'utf-8'),
    );

    // Verify FastAPI-specific targets
    expect(projectConfig.targets['bundle-x86']).toBeDefined();
    expect(projectConfig.targets['bundle-x86'].outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/bundle-x86',
    ]);
    expect(projectConfig.targets['bundle-x86'].options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project {projectRoot} --package proj.test_api -o dist/{projectRoot}/bundle-x86/requirements.txt',
    );

    // Verify openapi spec is generated
    expect(projectConfig.targets.openapi).toBeDefined();
    expect(projectConfig.targets.openapi.options.commands).toContain(
      'uv run python {projectRoot}/scripts/generate_open_api.py "dist/{projectRoot}/openapi/openapi.json"',
    );
    // The spec serialises models a dependency may own, and this target has no
    // `dependsOn` for `default`'s transitive `dependentTasksOutputFiles` to
    // resolve against — so `^production` is the only edge to the dependency, and
    // without it a dependency's model change serves a stale spec.
    expect(projectConfig.targets.openapi.inputs).toEqual([
      'production',
      '^production',
    ]);

    // Verify start target for development
    expect(projectConfig.targets.serve).toBeDefined();
    expect(projectConfig.targets.serve.executor).toBe(
      '@nxlv/python:run-commands',
    );
    expect(projectConfig.targets.serve.options.command).toBe(
      'uv run fastapi dev proj_test_api/main.py --port 8000',
    );
    expect(projectConfig.targets['dev']).toBeDefined();
    expect(projectConfig.targets['dev'].executor).toBe(
      '@nxlv/python:run-commands',
    );
    expect(projectConfig.targets['dev'].options.command).toBe(
      'uv run fastapi dev proj_test_api/main.py --port 8000',
    );
    expect(projectConfig.targets['dev'].options.env).toEqual({
      LOCAL_DEV: 'true',
    });

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.build.dependsOn).toContain('openapi');
  });

  it('should configure FastAPI dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const pyprojectToml = parse(
      tree.read('apps/test_api/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    // Verify FastAPI dependencies
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('fastapi=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('uvicorn=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml['dependency-groups'].dev.some((dep) =>
        dep.startsWith('fastapi[standard]=='),
      ),
    ).toBe(true);
  });

  it('should set up shared constructs for http', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/app/apis/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();

    expect(
      tree.read('packages/common/constructs/src/app/apis/index.ts', 'utf-8'),
    ).toContain("export * from './test-api.js'");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './apis/index.js'");
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toMatchSnapshot('test-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/http-api.ts', 'utf-8'),
    ).toMatchSnapshot('http-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/utils.ts', 'utf-8'),
    ).toMatchSnapshot('utils.ts');
    expect(
      tree.exists('packages/common/constructs/src/core/api/trpc-utils.ts'),
    ).toBeFalsy();

    expect(
      tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
    ).toBeFalsy();

    // Check handler is set to run.sh for Lambda Web Adapter
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("handler: 'run.sh'");
  });

  it('should generate a shared router lambda for REST APIs when using the shared integration pattern', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'rest-lambda',
      integrationPattern: 'shared',
      auth: 'iam',
      iac: 'cdk',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );

    expect(appApiContent).toContain("pattern: 'shared'");
    expect(appApiContent).toContain('scopePermissionToMethod: false');
    expect(appApiContent).toContain(
      'responseTransferMode: ResponseTransferMode.STREAM',
    );
    expect(appApiContent).toContain("handler: 'run.sh'");
  });

  it('should generate a shared router lambda for HTTP APIs when using the shared integration pattern', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      integrationPattern: 'shared',
      auth: 'iam',
      iac: 'cdk',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );

    expect(appApiContent).toContain("pattern: 'shared'");
    expect(appApiContent).toContain('scopePermissionToRoute: false');
    expect(appApiContent).toContain('`TestApiRouter${op}Integration`');
    expect(appApiContent).toContain("handler: 'run.sh'");
  });

  it('should set up shared constructs for rest', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      infra: 'rest-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/app/apis/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();

    expect(
      tree.read('packages/common/constructs/src/app/apis/index.ts', 'utf-8'),
    ).toContain("export * from './test-api.js'");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './apis/index.js'");
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toMatchSnapshot('test-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/rest-api.ts', 'utf-8'),
    ).toMatchSnapshot('rest-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/utils.ts', 'utf-8'),
    ).toMatchSnapshot('utils.ts');
    expect(
      tree.exists('packages/common/constructs/src/core/api/trpc-utils.ts'),
    ).toBeFalsy();

    expect(
      tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
    ).toBeFalsy();

    // Check handler is set to run.sh for Lambda Web Adapter
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("handler: 'run.sh'");
  });

  it('should update shared constructs build dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8',
      ),
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'proj.test_api:build',
    );
    expect(sharedConstructsConfig.targets.compile.dependsOn).toContain(
      'generate:test-api-metadata',
    );
  });

  it('should handle custom directory path', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('apps/nested/path/test_api')).toBeTruthy();
    expect(
      tree.exists('apps/nested/path/test_api/proj_test_api/main.py'),
    ).toBeTruthy();
  });

  it('should set project metadata', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const config = JSON.parse(tree.read('apps/test_api/project.json', 'utf-8'));
    // Verify project metadata
    expect(config.metadata).toEqual({
      apiName: 'test-api',
      apiType: 'fast-api',
      auth: 'iam',
      generator: FAST_API_GENERATOR_INFO.id,
      ports: [8000],
      // Recorded so the version sync can tell a CDK project from a Terraform one.
      iac: 'cdk',
    });
  });

  it('should match snapshot', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const appChanges = sortObjectKeys(
      tree
        .listChanges()
        .filter((f) => f.path.endsWith('.py'))
        .reduce((acc, curr) => {
          acc[curr.path] = tree.read(curr.path, 'utf-8');
          return acc;
        }, {}),
    );
    // Verify project metadata
    expect(appChanges).toMatchSnapshot('main-snapshot');
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, FAST_API_GENERATOR_INFO.metric);
  });

  it.each(['rest-lambda', 'http-lambda'])(
    'should include CORS middleware in init.py when using %s infra',
    async (infra: 'rest-lambda' | 'http-lambda') => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra,
        auth: 'iam',
        iac: 'cdk',
      });

      // Read the generated init.py file
      const initPyContent = tree.read(
        'apps/test_api/proj_test_api/init.py',
        'utf-8',
      );

      // Verify CORS origin is configured
      expect(initPyContent).toContain(
        'response.headers["Access-Control-Allow-Origin"] = cors_origin',
      );
    },
  );

  it('should increment ports when running generator multiple times', async () => {
    // Generate first API
    await pyFastApiProjectGenerator(tree, {
      name: 'first-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Generate second API
    await pyFastApiProjectGenerator(tree, {
      name: 'second-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Generate third API
    await pyFastApiProjectGenerator(tree, {
      name: 'third-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Check metadata ports
    const firstApiConfig = JSON.parse(
      tree.read('apps/first_api/project.json', 'utf-8'),
    );
    const secondApiConfig = JSON.parse(
      tree.read('apps/second_api/project.json', 'utf-8'),
    );
    const thirdApiConfig = JSON.parse(
      tree.read('apps/third_api/project.json', 'utf-8'),
    );

    expect(firstApiConfig.metadata.ports).toEqual([8000]);
    expect(secondApiConfig.metadata.ports).toEqual([8001]);
    expect(thirdApiConfig.metadata.ports).toEqual([8002]);

    // Check serve target --port arguments
    expect(firstApiConfig.targets.serve.options.command).toContain(
      '--port 8000',
    );
    expect(secondApiConfig.targets.serve.options.command).toContain(
      '--port 8001',
    );
    expect(thirdApiConfig.targets.serve.options.command).toContain(
      '--port 8002',
    );
  });

  it('should be idempotent when re-run with same options', async () => {
    const options = {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda' as const,
      auth: 'iam' as const,
      iac: 'cdk' as const,
    };
    await pyFastApiProjectGenerator(tree, options);
    const firstProjectJson = tree.read('apps/test_api/project.json', 'utf-8');
    const firstInitPy = tree.read(
      'apps/test_api/proj_test_api/init.py',
      'utf-8',
    );
    const firstGenerateOpenApi = tree.read(
      'apps/test_api/scripts/generate_open_api.py',
      'utf-8',
    );

    await pyFastApiProjectGenerator(tree, options);
    const secondProjectJson = tree.read('apps/test_api/project.json', 'utf-8');

    const projectConfig = JSON.parse(secondProjectJson);

    // Port metadata should not grow on re-run
    expect(projectConfig.metadata.ports).toHaveLength(1);

    // The run.sh copy command should appear exactly once
    const bundleCommands = projectConfig.targets['bundle-x86'].options
      .commands as string[];
    expect(bundleCommands.filter((c) => c.includes('run.sh'))).toHaveLength(1);

    expect(secondProjectJson).toEqual(firstProjectJson);

    // User-owned and generated Python files must be byte-identical on re-run
    expect(tree.read('apps/test_api/proj_test_api/init.py', 'utf-8')).toEqual(
      firstInitPy,
    );
    expect(
      tree.read('apps/test_api/scripts/generate_open_api.py', 'utf-8'),
    ).toEqual(firstGenerateOpenApi);
  });

  it('should inherit iac from config when set to Inherit', async () => {
    // Set up config with CDK provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'cdk',
      },
    });

    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'inherit',
    });

    // Verify CDK constructs are created (not terraform)
    expect(tree.exists('packages/common/constructs')).toBeTruthy();
    expect(tree.exists('packages/common/terraform')).toBeFalsy();
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();
  });

  it('should place project in subDirectory when provided', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'packages',
      subDirectory: 'apis',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });
    expect(tree.exists('packages/apis')).toBeTruthy();
    expect(tree.exists('packages/apis/pyproject.toml')).toBeTruthy();
  });

  it('should generate with infra=none then upgrade to infra=rest-lambda', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'upgrade-api',
      directory: 'apps',
      infra: 'none',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/upgrade_api/proj_upgrade_api/main.py'),
    ).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    await pyFastApiProjectGenerator(tree, {
      name: 'upgrade-api',
      directory: 'apps',
      infra: 'rest-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });

  describe('infra=http-ecs', () => {
    let restoreHostArch: () => void;

    // Pinned so the architecture the container is generated for, and so the
    // bundle target it builds, is the same wherever these tests run. The
    // architecture tests pin it to the architecture they are about.
    beforeEach(() => {
      restoreHostArch = stubHostArch('arm64');
    });

    afterEach(() => {
      restoreHostArch();
    });

    const ecsOptions = (
      auth: PyFastApiProjectGeneratorSchema['auth'],
    ): PyFastApiProjectGeneratorSchema => ({
      name: 'test-api',
      directory: 'apps',
      infra: 'http-ecs',
      integrationPattern: 'shared',
      auth,
      iac: 'cdk',
    });

    it.each<PyFastApiProjectGeneratorSchema['auth']>([
      'iam',
      'cognito',
      'custom',
    ])(
      'should vend the HTTP API and the container service for %s auth',
      async (auth) => {
        await pyFastApiProjectGenerator(tree, ecsOptions(auth));

        expect(
          tree.read(
            'packages/common/constructs/src/app/apis/test-api.ts',
            'utf-8',
          ),
        ).toMatchSnapshot(`test-api.ts-${auth}`);
        expect(
          tree.exists(
            'packages/common/constructs/src/app/services/test-api-container.ts',
          ),
        ).toBe(true);
        expect(
          tree.exists(
            'packages/common/constructs/src/core/container/ecs-service.ts',
          ),
        ).toBe(true);
        // The ECS variant fronts the service with the same core HTTP API
        // construct as the Lambda variant, and never a REST API.
        expect(
          tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
        ).toBe(true);
        expect(
          tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
        ).toBe(false);
      },
    );

    it('should reach the service through the shared core endpoint construct', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      expect(
        tree.exists(
          'packages/common/constructs/src/core/api/ecs-http-endpoint.ts',
        ),
      ).toBe(true);

      // The API's own construct names its service and nothing else about the
      // request path: the tRPC and FastAPI variants share one definition of it.
      const api = tree.read(
        'packages/common/constructs/src/app/apis/test-api.ts',
        'utf-8',
      );
      expect(api).toContain(
        "import { EcsHttpEndpoint } from '../../core/api/ecs-http-endpoint.js'",
      );
      expect(api).toContain('TestApiContainer');
      expect(api).not.toContain('ApplicationLoadBalancer');
      expect(api).not.toContain('VpcLink');
    });

    it('should route every operation to the one container service', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      const api =
        tree.read(
          'packages/common/constructs/src/app/apis/test-api.ts',
          'utf-8',
        ) ?? '';
      // Operations come from the OpenAPI spec, as they do for the Lambda
      // variants, rather than from a tRPC router.
      expect(api).toContain(
        "import {\n  OPERATION_DETAILS,\n  Operations,\n} from '../../generated/test-api/metadata.gen.js'",
      );
      expect(api).toContain("pattern: 'shared'");
      expect(api).not.toContain('routerToOperations');
    });

    it('should serve the FastAPI app from the container entry point', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      snapshotTreeDir(tree, 'apps/test_api/proj_test_api/test_api_container');

      const entry = tree.read(
        'apps/test_api/proj_test_api/test_api_container/main.py',
        'utf-8',
      );
      // The API's own app answers every operation.
      expect(entry).toContain('from ..main import app');
      // The health check is not an API operation, so it stays out of the
      // OpenAPI spec and out of the API Gateway routes.
      expect(entry).toContain('HEALTH_CHECK_PATH = "/health"');
      expect(entry).toContain(
        '@app.get(HEALTH_CHECK_PATH, include_in_schema=False)',
      );
      // Nor is it an API request: the target group calls it every 15 seconds,
      // and counting it would bury real traffic in health checks.
      expect(entry).toContain('metrics_excluded_paths.add(HEALTH_CHECK_PATH)');
      // This server lives across requests, so it writes out the metrics the
      // API's middleware collects; in Lambda the handler does that.
      expect(entry).toContain('metrics.flush_metrics()');
    });

    it('should bind the container entry point to loopback unless HOST is set', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      const entry =
        tree.read(
          'apps/test_api/proj_test_api/test_api_container/main.py',
          'utf-8',
        ) ?? '';
      expect(entry).toContain('host=os.environ.get("HOST", "127.0.0.1")');
      expect(entry).toContain('port=int(os.environ.get("PORT", "8080"))');
    });

    it('should drop the Lambda Web Adapter entry point', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      expect(tree.exists('apps/test_api/run.sh')).toBe(false);
      // The API's own module is untouched.
      expect(tree.exists('apps/test_api/proj_test_api/main.py')).toBe(true);
      expect(tree.exists('apps/test_api/proj_test_api/init.py')).toBe(true);
    });

    describe('architecture', () => {
      const SERVICE_FILE =
        'packages/common/constructs/src/app/services/test-api-container.ts';

      const targets = () =>
        readProjectConfiguration(tree, 'proj.test_api').targets ?? {};

      it.each<[string, string, string, string, string]>([
        [
          'arm64',
          'ARM64',
          'bundle-arm',
          'aarch64-manylinux_2_28',
          'linux/arm64',
        ],
        ['x64', 'X86_64', 'bundle-x86', 'x86_64-manylinux_2_28', 'linux/amd64'],
      ])(
        'should bundle and build for the host architecture (%s) when none is given',
        async (hostArch, expected, bundleTarget, pythonPlatform, platform) => {
          await onHostArch(hostArch, () =>
            pyFastApiProjectGenerator(tree, ecsOptions('iam')),
          );

          expect(targets()[bundleTarget].options.commands[1]).toContain(
            `--python-platform ${pythonPlatform} `,
          );
          expect(
            targets()['test-api-container-docker'].options.commands.at(-1),
          ).toContain(`--platform ${platform} `);
          expect(tree.read(SERVICE_FILE, 'utf-8')).toContain(
            `architecture: '${expected}',`,
          );
        },
      );

      it('should use the requested architecture over the host', async () => {
        await onHostArch('arm64', () =>
          pyFastApiProjectGenerator(tree, {
            ...ecsOptions('iam'),
            architecture: 'X86_64',
          }),
        );

        expect(targets()['bundle-x86'].options.commands[1]).toContain(
          '--python-platform x86_64-manylinux_2_28 ',
        );
        expect(targets()['bundle-arm']).toBeUndefined();
        expect(tree.read(SERVICE_FILE, 'utf-8')).toContain(
          "architecture: 'X86_64',",
        );
      });

      it('should keep the recorded architecture when re-run on another host', async () => {
        await onHostArch('x64', () =>
          pyFastApiProjectGenerator(tree, ecsOptions('iam')),
        );

        await onHostArch('arm64', () =>
          pyFastApiProjectGenerator(tree, ecsOptions('iam')),
        );

        expect(tree.read(SERVICE_FILE, 'utf-8')).toContain(
          "architecture: 'X86_64',",
        );
        expect(
          targets()['test-api-container-docker'].options.commands.at(-1),
        ).toContain('--platform linux/amd64 ');
        expect(targets()['bundle-arm']).toBeUndefined();
      });
    });

    it('should bundle for Lambda only when a Lambda still runs', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));
      const iamTargets = readProjectConfiguration(
        tree,
        'proj.test_api',
      ).targets;
      // Nothing runs in Lambda, so only the image's bundle is built.
      expect(iamTargets['bundle-x86']).toBeUndefined();
      expect(iamTargets['bundle-arm']).toBeDefined();

      tree = createTreeUsingTsSolutionSetup();
      await pyFastApiProjectGenerator(tree, ecsOptions('custom'));
      const customTargets = readProjectConfiguration(
        tree,
        'proj.test_api',
      ).targets;
      // The custom authorizer handler is a Lambda function, and its code comes
      // from the Lambda-platform bundle.
      expect(customTargets['bundle-x86']).toBeDefined();
      expect(customTargets['bundle-arm']).toBeDefined();
      // run.sh belongs to the API running under the Lambda Web Adapter, which
      // the ECS variant never does.
      expect(
        JSON.stringify(customTargets['bundle-x86'].options.commands),
      ).not.toContain('run.sh');
      expect(tree.exists('apps/test_api/proj_test_api/authorizer.py')).toBe(
        true,
      );
    });

    it('should take the HTTP API authorizer event for custom auth', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('custom'));

      const authorizer =
        tree.read('apps/test_api/proj_test_api/authorizer.py', 'utf-8') ?? '';
      // The REST authorizer returns a policy document; the HTTP one answers
      // with a simple response.
      expect(authorizer).not.toContain('policyDocument');
    });

    it('should run the container entry point from a single serve target', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      const projectConfig = readProjectConfiguration(tree, 'proj.test_api');
      expect(projectConfig.targets.serve.options.command).toBe(
        'uv run python -m proj_test_api.test_api_container.main',
      );
      expect(projectConfig.targets.serve.options.env).toEqual({ PORT: '8000' });
      expect(projectConfig.targets.dev.options.env).toEqual({
        PORT: '8000',
        LOCAL_DEV: 'true',
      });
      // py#container's own serve target would start a second copy of the same
      // server, so only the project's serve target is kept.
      expect(projectConfig.targets['test-api-container-serve']).toBeUndefined();
      expect(projectConfig.targets.dev.dependsOn).toBeUndefined();
      // The image build targets py#container vends are kept.
      expect(projectConfig.targets['test-api-container-docker']).toBeDefined();
      expect(projectConfig.targets['test-api-container-trivy']).toBeDefined();
    });

    it('should keep generating the OpenAPI spec the routes come from', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      // The API Gateway routes are derived from the spec, so the spec is still
      // built and still a deployable artifact.
      const projectConfig = readProjectConfiguration(tree, 'proj.test_api');
      expect(projectConfig.targets.openapi).toBeDefined();
      expect(projectConfig.targets.assemble.dependsOn).toContain('openapi');
    });

    it('should warn and fall back to shared for the isolated integration pattern', async () => {
      const warn = vi.spyOn(logger, 'warn');

      await pyFastApiProjectGenerator(tree, {
        ...ecsOptions('iam'),
        integrationPattern: 'isolated',
      });

      // The option is reported as ignored rather than rejected.
      expect(
        warn.mock.calls
          .map((call) => String(call[0]))
          .filter((message) =>
            message.includes(
              `integrationPattern 'isolated' is ignored and 'shared' is used instead`,
            ),
          ),
      ).toHaveLength(1);

      // The same output as asking for shared: one container service behind the
      // shared HTTP endpoint, with one integration for every operation.
      expect(
        tree.exists(
          'packages/common/constructs/src/app/services/test-api-container.ts',
        ),
      ).toBe(true);
      expect(
        tree.read(
          'packages/common/constructs/src/app/apis/test-api.ts',
          'utf-8',
        ),
      ).toContain("pattern: 'shared'");
    });

    it('should default the integration pattern to shared', async () => {
      // What `--infra=http-ecs` on its own gives. The schema has no default for
      // `integrationPattern`, so the option arrives undefined and the generator
      // resolves it from the infra.
      const { integrationPattern: _unset, ...withoutPattern } =
        ecsOptions('iam');
      await pyFastApiProjectGenerator(tree, withoutPattern);

      expect(
        tree.exists(
          'packages/common/constructs/src/core/api/ecs-http-endpoint.ts',
        ),
      ).toBe(true);
      expect(
        tree.exists(
          'packages/common/constructs/src/app/services/test-api-container.ts',
        ),
      ).toBe(true);
      // One integration for every operation, not one per operation.
      expect(
        tree.read(
          'packages/common/constructs/src/app/apis/test-api.ts',
          'utf-8',
        ),
      ).toContain("pattern: 'shared'");
    });

    it('should reject terraform', async () => {
      await expect(
        pyFastApiProjectGenerator(tree, {
          ...ecsOptions('iam'),
          iac: 'terraform',
        }),
      ).rejects.toThrow(/only implemented for the cdk IaC provider/);
    });

    it('should be idempotent when re-run with same options', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));
      const first = tree.read('apps/test_api/project.json', 'utf-8');
      const firstApi = tree.read(
        'packages/common/constructs/src/app/apis/test-api.ts',
        'utf-8',
      );

      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      expect(tree.read('apps/test_api/project.json', 'utf-8')).toEqual(first);
      expect(
        tree.read(
          'packages/common/constructs/src/app/apis/test-api.ts',
          'utf-8',
        ),
      ).toEqual(firstApi);
    });

    it('should preserve a user edit to the container server on re-run', async () => {
      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));
      tree.write(
        'apps/test_api/proj_test_api/test_api_container/main.py',
        '# MY CUSTOM SERVER\n',
      );

      await pyFastApiProjectGenerator(tree, ecsOptions('iam'));

      expect(
        tree.read(
          'apps/test_api/proj_test_api/test_api_container/main.py',
          'utf-8',
        ),
      ).toBe('# MY CUSTOM SERVER\n');
    });
  });

  // The reserved name follows the infrastructure, not the framework: a REST API
  // named `rest-api` collides where an HTTP one named `http-api` does.
  describe.each([
    { name: 'http-api', infra: 'http-lambda' as const, coreClass: 'HttpApi' },
    { name: 'rest-api', infra: 'rest-lambda' as const, coreClass: 'RestApi' },
  ])(
    'a project named $name, colliding with the core $coreClass',
    ({ name, infra, coreClass }) => {
      it('extends the aliased core construct rather than itself', async () => {
        await pyFastApiProjectGenerator(tree, {
          name,
          directory: 'apps',
          infra,
          auth: 'iam',
          iac: 'cdk',
        });

        const construct =
          tree.read(
            `packages/common/constructs/src/app/apis/${name}.ts`,
            'utf-8',
          ) ?? '';

        expect(construct).toContain(`${coreClass} as Core${coreClass}`);
        expect(construct).toContain(`extends Core${coreClass}<`);
        expect(construct).toContain(`export class ${coreClass}<`);
        expect(construct).not.toContain(`extends ${coreClass}<`);
      });

      it('leaves the import unaliased for a name that does not collide', async () => {
        await pyFastApiProjectGenerator(tree, {
          name: 'test-api',
          directory: 'apps',
          infra,
          auth: 'iam',
          iac: 'cdk',
        });

        const construct =
          tree.read(
            'packages/common/constructs/src/app/apis/test-api.ts',
            'utf-8',
          ) ?? '';

        expect(construct).toContain(`extends ${coreClass}<`);
        expect(construct).not.toContain(`Core${coreClass}`);
      });
    },
  );
});
