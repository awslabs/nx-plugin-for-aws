/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, readJson, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';
import { declareDependencies } from '../../utils/declared-dependencies';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { SMITHY_VERSIONS, smithyMavenDependency } from '../../utils/versions';
import {
  SMITHY_PROJECT_GENERATOR_INFO,
  smithyProjectGenerator,
} from './generator';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

describe('smithyProjectGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate smithy project with default options', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    // Verify directory structure
    expect(tree.exists('test-api/src/main.smithy')).toBeTruthy();
    expect(tree.exists('test-api/src/operations/echo.smithy')).toBeTruthy();
    expect(tree.exists('test-api/ssdk.rolldown.config.mjs')).toBeTruthy();
    expect(tree.exists('test-api/smithy-build.json')).toBeTruthy();
    expect(tree.exists('test-api/project.json')).toBeTruthy();
    // Builds on the machine, so no image build is involved
    expect(tree.exists('test-api/build.Dockerfile')).toBeFalsy();

    // Verify project configuration
    const projectConfig = readJson(tree, 'test-api/project.json');
    expect(projectConfig.name).toBe('@proj/test-api');
    expect(projectConfig.projectType).toBe('library');
    expect(projectConfig.sourceRoot).toBe('test-api/src');
    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.compile).toBeDefined();

    // Verify compile target configuration
    expect(projectConfig.targets.compile.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.compile.options.commands).toEqual([
      'rimraf dist/{projectRoot}/build',
      'rimraf dist/{projectRoot}/smithy',
      'make-dir dist/{projectRoot}/build',
      `mise exec smithy@${SMITHY_VERSIONS.cli} -- smithy build -c {projectRoot}/smithy-build.json --output dist/{projectRoot}/smithy`,
      'cpy "dist/{projectRoot}/smithy/source/openapi/*.openapi.json" dist/{projectRoot}/build/openapi --flat --rename=openapi.json',
      'npm install --prefix dist/{projectRoot}/smithy/source/typescript-ssdk-codegen --ignore-scripts --no-audit --no-fund',
      'rolldown -c {projectRoot}/ssdk.rolldown.config.mjs',
    ]);
    expect(projectConfig.targets.compile.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/build',
    ]);
    expect(projectConfig.targets.build.dependsOn).toEqual(['compile']);

    // Create snapshots of generated files
    expect(tree.read('test-api/src/main.smithy', 'utf-8')).toMatchSnapshot(
      'main.smithy',
    );
    expect(
      tree.read('test-api/src/operations/echo.smithy', 'utf-8'),
    ).toMatchSnapshot('echo.smithy');
    expect(
      tree.read('test-api/ssdk.rolldown.config.mjs', 'utf-8'),
    ).toMatchSnapshot('ssdk.rolldown.config.mjs');
    expect(tree.read('test-api/smithy-build.json', 'utf-8')).toMatchSnapshot(
      'smithy-build.json',
    );
    expect(tree.read('test-api/project.json', 'utf-8')).toMatchSnapshot(
      'project.json',
    );
  });

  it('should generate smithy project with custom service name', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      serviceName: 'CustomService',
    });

    const mainSmithy = tree.read('test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service CustomService');
    expect(mainSmithy).toContain('@title("CustomService")');
    expect(mainSmithy).toMatchSnapshot('custom-service-main.smithy');
  });

  it('should generate smithy project with custom namespace', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      namespace: 'com.example.custom',
    });

    const mainSmithy = tree.read('test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace com.example.custom');
    expect(mainSmithy).toMatchSnapshot('custom-namespace-main.smithy');
  });

  it('should generate smithy project with custom directory', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apis',
    });

    // Verify directory structure
    expect(tree.exists('apis/test-api')).toBeTruthy();
    expect(tree.exists('apis/test-api/src')).toBeTruthy();
    expect(tree.exists('apis/test-api/src/main.smithy')).toBeTruthy();
    expect(tree.exists('apis/test-api/project.json')).toBeTruthy();

    // Verify project configuration
    const projectConfig = readJson(tree, 'apis/test-api/project.json');
    expect(projectConfig.sourceRoot).toBe('apis/test-api/src');
    expect(tree.read('apis/test-api/project.json', 'utf-8')).toMatchSnapshot(
      'custom-dir-project.json',
    );
  });

  it('should generate smithy project with subdirectory', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      directory: 'services',
      subDirectory: 'model',
    });

    // Verify directory structure
    expect(tree.exists('services/model')).toBeTruthy();
    expect(tree.exists('services/model/src')).toBeTruthy();
    expect(tree.exists('services/model/src/main.smithy')).toBeTruthy();
    expect(tree.exists('services/model/project.json')).toBeTruthy();

    // Verify project configuration
    const projectConfig = readJson(tree, 'services/model/project.json');
    expect(projectConfig.sourceRoot).toBe('services/model/src');
    expect(tree.read('services/model/project.json', 'utf-8')).toMatchSnapshot(
      'subdir-project.json',
    );
  });

  it('should generate smithy project with all custom options', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      serviceName: 'MyCustomService',
      namespace: 'com.mycompany.api',
      directory: 'backend',
      subDirectory: 'model',
    });

    // Verify directory structure
    expect(tree.exists('backend/model')).toBeTruthy();
    expect(tree.exists('backend/model/src/main.smithy')).toBeTruthy();

    const mainSmithy = tree.read('backend/model/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace com.mycompany.api');
    expect(mainSmithy).toContain('service MyCustomService');
    expect(mainSmithy).toContain('@title("MyCustomService")');

    const projectConfig = readJson(tree, 'backend/model/project.json');
    expect(projectConfig.sourceRoot).toBe('backend/model/src');

    expect(mainSmithy).toMatchSnapshot('all-custom-main.smithy');
    expect(tree.read('backend/model/project.json', 'utf-8')).toMatchSnapshot(
      'all-custom-project.json',
    );
  });

  it('should use npm scope for default namespace', async () => {
    // Set up npm scope in package.json
    const packageJson = readJson(tree, 'package.json');
    packageJson.name = '@myorg/workspace';
    tree.write('package.json', JSON.stringify(packageJson, null, 2));

    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const mainSmithy = tree.read('test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace myorg');
    expect(mainSmithy).toMatchSnapshot('npm-scope-main.smithy');
  });

  it('should add generator metadata to project configuration', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const projectConfig = readJson(tree, 'test-api/project.json');
    expect(projectConfig.metadata).toHaveProperty(
      'generator',
      SMITHY_PROJECT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata).toHaveProperty('apiName', 'test-api');
  });

  it('should add generator metric to app.ts when shared constructs exist', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );

    // Call the generator function
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, SMITHY_PROJECT_GENERATOR_INFO.metric);
  });

  it('should handle kebab-case conversion for service names', async () => {
    await smithyProjectGenerator(tree, {
      name: 'my-test-api',
      serviceName: 'MyTestService',
    });

    const mainSmithy = tree.read('my-test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service MyTestService');
    expect(mainSmithy).toMatchSnapshot('kebab-case-main.smithy');

    const smithyBuild = tree.read('my-test-api/smithy-build.json', 'utf-8');
    expect(smithyBuild).toMatchSnapshot('kebab-case-smithy-build.json');
  });

  it('should build with the pinned smithy cli rather than a container', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const projectConfig = readJson(tree, 'test-api/project.json');
    const commands: string[] = projectConfig.targets.compile.options.commands;

    // The CLI version travels in the command, which is what the version sync
    // reaches to move it forward.
    expect(commands).toContain(
      `mise exec smithy@${SMITHY_VERSIONS.cli} -- smithy build -c {projectRoot}/smithy-build.json --output dist/{projectRoot}/smithy`,
    );
    expect(commands.join('\n')).not.toContain('docker');

    // Every path the build writes to is under `dist`, so a build leaves the
    // project's own directory untouched. `{projectRoot}` is only ever read from —
    // the config and model the CLI is pointed at.
    expect(projectConfig.targets.compile.options.cwd).toBe('{workspaceRoot}');
    const written = commands.flatMap((command) =>
      [
        ...command.matchAll(
          /(?:^|\s)(?!dist\/)([^\s"]*\{projectRoot\}[^\s"]*)/g,
        ),
      ].map(([, path]) => path),
    );
    expect(written).toEqual([
      '{projectRoot}/smithy-build.json',
      '{projectRoot}/ssdk.rolldown.config.mjs',
    ]);
  });

  it('should pin the smithy maven dependencies it vends', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const smithyBuild = readJson(tree, 'test-api/smithy-build.json');
    expect(smithyBuild.maven.dependencies).toEqual([
      smithyMavenDependency('software.amazon.smithy:smithy-model'),
      smithyMavenDependency('software.amazon.smithy:smithy-aws-traits'),
      smithyMavenDependency('software.amazon.smithy:smithy-validation-model'),
      smithyMavenDependency('software.amazon.smithy:smithy-openapi'),
      smithyMavenDependency(
        'software.amazon.smithy.typescript:smithy-aws-typescript-codegen',
      ),
    ]);
  });

  // `mise` fetches its own binary in a `preinstall`, and pnpm 11 fails the whole
  // install for a build script it skipped — so generating a Smithy project has to
  // allow it, rather than every workspace carrying the entry up front.
  it('should allow the mise build script it needs', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });

    const workspace = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8')!,
    ) as Record<string, any>;
    expect(workspace.allowBuilds.mise).toBe(true);
    expect(workspace.onlyBuiltDependencies).toContain('mise');
  });

  it('should configure proper build dependencies', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const projectConfig = readJson(tree, 'test-api/project.json');
    expect(projectConfig.targets.build.dependsOn).toContain('compile');
    expect(projectConfig.targets.compile.cache).toBe(true);
  });

  it('should handle empty service name by using project name', async () => {
    await smithyProjectGenerator(tree, {
      name: 'my-service',
      serviceName: undefined,
    });

    const mainSmithy = tree.read('my-service/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service MyService');
    expect(mainSmithy).toContain('@title("MyService")');
    expect(mainSmithy).toMatchSnapshot('default-service-name-main.smithy');
  });

  it('should be idempotent when re-run with same options', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });

    const projectCountAfterFirstRun = getProjects(tree).size;
    const mainSmithyAfterFirstRun = tree.read(
      'test-api/src/main.smithy',
      'utf-8',
    );

    await expect(
      smithyProjectGenerator(tree, { name: 'test-api' }),
    ).resolves.toBeDefined();

    expect(getProjects(tree).size).toBe(projectCountAfterFirstRun);
    expect(tree.read('test-api/src/main.smithy', 'utf-8')).toEqual(
      mainSmithyAfterFirstRun,
    );
  });

  it('should create an independent project when run with a different name', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });
    await smithyProjectGenerator(tree, { name: 'other-api' });

    expect(readJson(tree, 'test-api/project.json').name).toBe('@proj/test-api');
    expect(readJson(tree, 'other-api/project.json').name).toBe(
      '@proj/other-api',
    );
  });

  it('should preserve user edits to smithy models when re-run', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });

    tree.write(
      'test-api/src/main.smithy',
      '$version: "2.0"\n\nnamespace com.custom\n\nstructure Edited {}\n',
    );

    await smithyProjectGenerator(tree, { name: 'test-api' });

    expect(tree.read('test-api/src/main.smithy', 'utf-8')).toContain(
      'structure Edited',
    );
  });

  describe('shape libraries', () => {
    it('should generate a shape library without a service', async () => {
      await smithyProjectGenerator(tree, {
        name: 'test-shapes',
        type: 'shapes',
      });

      expect(tree.exists('test-shapes/src/main.smithy')).toBeTruthy();
      expect(tree.exists('test-shapes/smithy-build.json')).toBeTruthy();
      expect(tree.exists('test-shapes/build.Dockerfile')).toBeFalsy();
      // A shape library generates no server SDK, so it has nothing to bundle
      expect(tree.exists('test-shapes/ssdk.rolldown.config.mjs')).toBeFalsy();

      // A shape library defines no service and no operations
      expect(tree.exists('test-shapes/src/operations/echo.smithy')).toBeFalsy();
      const mainSmithy = tree.read('test-shapes/src/main.smithy', 'utf-8');
      expect(mainSmithy).not.toContain('service ');
      expect(mainSmithy).toContain('structure ExampleShape');

      expect(mainSmithy).toMatchSnapshot('shapes-main.smithy');
      expect(
        tree.read('test-shapes/smithy-build.json', 'utf-8'),
      ).toMatchSnapshot('shapes-smithy-build.json');
      expect(tree.read('test-shapes/project.json', 'utf-8')).toMatchSnapshot(
        'shapes-project.json',
      );
    });

    it('should not configure service-only codegen plugins for a shape library', async () => {
      await smithyProjectGenerator(tree, {
        name: 'test-shapes',
        type: 'shapes',
      });

      // The openapi and ssdk codegen plugins both require a service shape
      const smithyBuild = readJson(tree, 'test-shapes/smithy-build.json');
      expect(smithyBuild.plugins).toBeUndefined();
      expect(smithyBuild.sources).toEqual(['src/']);
    });

    it('should record the shape library type and namespace in metadata', async () => {
      await smithyProjectGenerator(tree, {
        name: 'test-shapes',
        type: 'shapes',
        namespace: 'com.example.shared',
      });

      const { metadata } = readJson(tree, 'test-shapes/project.json');
      expect(metadata).toHaveProperty(
        'generator',
        SMITHY_PROJECT_GENERATOR_INFO.id,
      );
      expect(metadata).toHaveProperty('smithyType', 'shapes');
      expect(metadata).toHaveProperty('namespace', 'com.example.shared');
      // A shape library is not an API
      expect(metadata).not.toHaveProperty('apiName');
    });

    it('should use the given namespace for the shape library', async () => {
      await smithyProjectGenerator(tree, {
        name: 'test-shapes',
        type: 'shapes',
        namespace: 'com.example.shared',
      });

      expect(tree.read('test-shapes/src/main.smithy', 'utf-8')).toContain(
        'namespace com.example.shared',
      );
    });

    it('should assemble the model and stop, with no server SDK to bundle', async () => {
      await smithyProjectGenerator(tree, {
        name: 'test-shapes',
        type: 'shapes',
      });

      const projectConfig = readJson(tree, 'test-shapes/project.json');
      expect(projectConfig.targets.build.dependsOn).toEqual(['compile']);
      expect(projectConfig.targets.compile.options.commands).toEqual([
        'rimraf dist/{projectRoot}/build',
        'rimraf dist/{projectRoot}/smithy',
        'make-dir dist/{projectRoot}/build',
        `mise exec smithy@${SMITHY_VERSIONS.cli} -- smithy build -c {projectRoot}/smithy-build.json --output dist/{projectRoot}/smithy`,
        'ncp dist/{projectRoot}/smithy/source/model/model.json dist/{projectRoot}/build/model.json',
      ]);
    });

    it('should be idempotent when re-run with same options', async () => {
      await smithyProjectGenerator(tree, {
        name: 'test-shapes',
        type: 'shapes',
      });

      const projectCountAfterFirstRun = getProjects(tree).size;
      const mainSmithyAfterFirstRun = tree.read(
        'test-shapes/src/main.smithy',
        'utf-8',
      );

      await expect(
        smithyProjectGenerator(tree, { name: 'test-shapes', type: 'shapes' }),
      ).resolves.toBeDefined();

      expect(getProjects(tree).size).toBe(projectCountAfterFirstRun);
      expect(tree.read('test-shapes/src/main.smithy', 'utf-8')).toEqual(
        mainSmithyAfterFirstRun,
      );
    });
  });
});
