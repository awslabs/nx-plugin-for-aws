/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree, writeJson } from '@nx/devkit';
import { nxGeneratorGenerator, NX_GENERATOR_GENERATOR_INFO } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import NxPluginForAwsPackageJson from '../../../package.json';
import NxPluginForAwsProjectJson from '../../../project.json';
import * as fs from 'fs';
import * as path from 'path';

describe('nx-generator generator', () => {
  describe('within @aws/nx-plugin', () => {
    let tree: Tree;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();

      const pathToRoot = path.resolve(__dirname, '../../../../..');

      // Copy relevant files from this repo into the tree
      [
        'package.json',
        'packages/nx-plugin/project.json',
        'packages/nx-plugin/package.json',
        'packages/nx-plugin/tsconfig.json',
        'docs/astro.config.mjs',
      ].forEach((file) => {
        tree.write(file, fs.readFileSync(path.join(pathToRoot, file)));
      });

      writeJson(tree, 'packages/nx-plugin/generators.json', {
        generators: {
          existing: {
            factory: './some/generator',
            schema: './some/schema.json',
            description: 'existing generator',
            metric: 'g40',
          },
          another: {
            factory: './some/other/generator',
            schema: './some/other/schema.json',
            description: 'other existing generator',
            metric: 'g41',
          },
        },
      });
    });

    it('should work when description is omitted', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'no#description',
      });

      // Check that the files exist
      const generatorDir = 'packages/nx-plugin/src/no-description';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Check generators.json was updated with empty description
      const generatorsJson = JSON.parse(
        tree.read('packages/nx-plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['no#description']).toBeDefined();
      expect(generatorsJson.generators['no#description'].description).toBe(
        'TODO: Add short description of the generator',
      );
    });

    it('should generate an example schema, generator and test', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'foo#bar',
        description: 'Some description',
      });

      // Check that the files exist
      const generatorDir = 'packages/nx-plugin/src/foo-bar';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Snapshot the files
      expect(tree.read(`${generatorDir}/schema.json`, 'utf-8')).toMatchSnapshot(
        'schema.json',
      );
      expect(tree.read(`${generatorDir}/schema.d.ts`, 'utf-8')).toMatchSnapshot(
        'schema.d.ts',
      );
      expect(
        tree.read(`${generatorDir}/generator.ts`, 'utf-8'),
      ).toMatchSnapshot('generator.ts');
      expect(
        tree.read(`${generatorDir}/generator.spec.ts`, 'utf-8'),
      ).toMatchSnapshot('generator.spec.ts');
    });

    it('should add guide page to docs', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'foo#bar',
        description: 'Some description',
      });

      // Check that the guide page exists
      const guidePath = 'docs/src/content/docs/en/guides/foo-bar.mdx';
      expect(tree.exists(guidePath)).toBeTruthy();

      // Snapshot the guide page
      expect(tree.read(guidePath, 'utf-8')).toMatchSnapshot('guide-page.mdx');

      // Check that the link was added to astro.config.mjs
      const astroConfig = tree.read('docs/astro.config.mjs', 'utf-8');
      expect(astroConfig).toContain("label: 'foo#bar'");
      expect(astroConfig).toContain("link: '/guides/foo-bar'");
    });

    it('should update generators.json', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'foo#bar',
        description: 'Some description',
      });

      // Check generators.json was updated
      const generatorsJson = JSON.parse(
        tree.read('packages/nx-plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['foo#bar']).toBeDefined();
      expect(generatorsJson.generators['foo#bar'].factory).toBe(
        './src/foo-bar/generator',
      );
      expect(generatorsJson.generators['foo#bar'].schema).toBe(
        './src/foo-bar/schema.json',
      );
      expect(generatorsJson.generators['foo#bar'].metric).toBe('g42');

      // Snapshot generators.json
      expect(
        tree.read('packages/nx-plugin/generators.json', 'utf-8'),
      ).toMatchSnapshot('generators.json');

      // Check package.json has generators entry
      const packageJson = JSON.parse(
        tree.read('packages/nx-plugin/package.json', 'utf-8'),
      );
      expect(packageJson.generators).toBe('./generators.json');
    });

    it('should update generators.json with out of order metric', async () => {
      writeJson(tree, 'packages/nx-plugin/generators.json', {
        generators: {
          existing: {
            factory: './some/generator',
            schema: './some/schema.json',
            description: 'existing generator',
            metric: 'g51',
          },
          another: {
            factory: './some/other/generator',
            schema: './some/other/schema.json',
            description: 'other existing generator',
            metric: 'g3',
          },
        },
      });

      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'foo#bar',
        description: 'Some description',
      });

      // Check generators.json was updated
      const generatorsJson = JSON.parse(
        tree.read('packages/nx-plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['foo#bar'].metric).toBe('g52');
    });

    it('should handle an empty list of existing generators', async () => {
      // Reset generators.json to have an empty generators object
      writeJson(tree, 'packages/nx-plugin/generators.json', {
        generators: {},
      });

      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'empty#test',
        description: 'Some description',
      });

      // Check that the metric is g1
      const generatorsJson = JSON.parse(
        tree.read('packages/nx-plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['empty#test'].metric).toBe('g1');
    });

    it('should support a nested directory', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: NxPluginForAwsProjectJson.name,
        name: 'nested#test',
        directory: 'nested/dir',
        description: 'Some description',
      });

      // Check that the files exist in the nested directory
      const generatorDir = 'packages/nx-plugin/src/nested/dir';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Check generators.json was updated with correct paths
      const generatorsJson = JSON.parse(
        tree.read('packages/nx-plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['nested#test']).toBeDefined();
      expect(generatorsJson.generators['nested#test'].factory).toBe(
        './src/nested/dir/generator',
      );
      expect(generatorsJson.generators['nested#test'].schema).toBe(
        './src/nested/dir/schema.json',
      );
    });

    it('should throw if given a project that is not @aws/nx-plugin', async () => {
      // Add a different project configuration
      addProjectConfiguration(tree, 'other-project', {
        root: 'packages/other-project',
        sourceRoot: 'packages/other-project/src',
      });
      tree.write('packages/other-project/tsconfig.json', '{}');

      // Expect the generator to throw an error
      await expect(
        nxGeneratorGenerator(tree, {
          pluginProject: 'other-project',
          name: 'should#fail',
          description: 'Some description',
        }),
      ).rejects.toThrow(
        `Generators should be added to the ${NxPluginForAwsPackageJson.name} project.`,
      );
    });
  });

  describe('within another workspace', () => {
    let tree: Tree;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();

      writeJson(tree, 'package.json', {
        name: '@myorg/monorepo',
        type: 'module',
      });

      writeJson(tree, 'tools/plugin/tsconfig.json', {});

      addProjectConfiguration(tree, '@test/plugin', {
        root: 'tools/plugin',
        sourceRoot: 'tools/plugin/src',
      });
    });

    it('should throw an error when the project has no tsconfig', async () => {
      // Create a new project without a tsconfig
      addProjectConfiguration(tree, '@test/no-tsconfig', {
        root: 'tools/no-tsconfig',
        sourceRoot: 'tools/no-tsconfig/src',
      });

      // Expect the generator to throw an error
      await expect(
        nxGeneratorGenerator(tree, {
          pluginProject: '@test/no-tsconfig',
          name: 'should#fail',
          description: 'Some description',
        }),
      ).rejects.toThrow(
        'Selected plugin project @test/no-tsconfig is not a TypeScript project',
      );
    });

    it('should throw when there is no root package.json', async () => {
      // Remove the root package.json
      tree.delete('package.json');

      await expect(
        nxGeneratorGenerator(tree, {
          pluginProject: '@test/plugin',
          name: 'no#root#pkg',
          description: 'Generator with no root package.json',
        }),
      ).rejects.toThrow();
    });

    it('should work when generators.json is empty', async () => {
      // Create an empty generators.json
      writeJson(tree, 'tools/plugin/generators.json', {});

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'empty#generators',
        description: 'Generator with empty generators.json',
      });

      // Check that the files exist
      const generatorDir = 'tools/plugin/src/empty-generators';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Check generators.json was updated correctly
      const generatorsJson = JSON.parse(
        tree.read('tools/plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators).toBeDefined();
      expect(generatorsJson.generators['empty#generators']).toBeDefined();
      expect(generatorsJson.generators['empty#generators'].factory).toBe(
        './src/empty-generators/generator',
      );
      expect(generatorsJson.generators['empty#generators'].schema).toBe(
        './src/empty-generators/schema.json',
      );
      expect(generatorsJson.generators['empty#generators'].description).toBe(
        'Generator with empty generators.json',
      );
    });

    it('should work when description is omitted', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'no#description',
      });

      // Check that the files exist
      const generatorDir = 'tools/plugin/src/no-description';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Check generators.json was updated with empty description
      const generatorsJson = JSON.parse(
        tree.read('tools/plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['no#description']).toBeDefined();
      expect(generatorsJson.generators['no#description'].description).toBe(
        'TODO: Add short description of the generator',
      );
    });

    it('should generate an example schema, generator and test', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'foo#bar',
        description: 'Some description',
      });

      // Check that the files exist
      const generatorDir = 'tools/plugin/src/foo-bar';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Snapshot the files
      expect(tree.read(`${generatorDir}/schema.json`, 'utf-8')).toMatchSnapshot(
        'local-schema.json',
      );
      expect(tree.read(`${generatorDir}/schema.d.ts`, 'utf-8')).toMatchSnapshot(
        'local-schema.d.ts',
      );
      expect(
        tree.read(`${generatorDir}/generator.ts`, 'utf-8'),
      ).toMatchSnapshot('local-generator.ts');
      expect(
        tree.read(`${generatorDir}/generator.spec.ts`, 'utf-8'),
      ).toMatchSnapshot('local-generator.spec.ts');
    });

    it('should support a nested directory', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'nested#test',
        directory: 'nested/dir',
        description: 'Some description',
      });

      // Check that the files exist in the nested directory
      const generatorDir = 'tools/plugin/src/nested/dir';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();

      // Check generators.json was updated with correct paths
      const generatorsJson = JSON.parse(
        tree.read('tools/plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['nested#test']).toBeDefined();
      expect(generatorsJson.generators['nested#test'].factory).toBe(
        './src/nested/dir/generator',
      );
      expect(generatorsJson.generators['nested#test'].schema).toBe(
        './src/nested/dir/schema.json',
      );
    });

    it('should update generators.json', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'foo#bar',
        description: 'Some description',
      });

      // Check generators.json was updated
      const generatorsJson = JSON.parse(
        tree.read('tools/plugin/generators.json', 'utf-8'),
      );
      expect(generatorsJson.generators['foo#bar']).toBeDefined();
      expect(generatorsJson.generators['foo#bar'].factory).toBe(
        './src/foo-bar/generator',
      );
      expect(generatorsJson.generators['foo#bar'].schema).toBe(
        './src/foo-bar/schema.json',
      );
      expect(generatorsJson.generators['foo#bar'].metric).toBeUndefined(); // No metric in non-AWS plugin

      // Snapshot generators.json
      expect(
        tree.read('tools/plugin/generators.json', 'utf-8'),
      ).toMatchSnapshot('local-generators.json');
    });

    it('should create package.json if it does not exist', async () => {
      // Ensure package.json doesn't exist
      expect(tree.exists('tools/plugin/package.json')).toBeFalsy();

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'create#pkg',
      });

      // Check package.json was created with the correct content
      expect(tree.exists('tools/plugin/package.json')).toBeTruthy();
      const packageJson = JSON.parse(
        tree.read('tools/plugin/package.json', 'utf-8'),
      );
      expect(packageJson.name).toBe('@test/plugin');
      expect(packageJson.generators).toBe('./generators.json');
    });

    it('should update package.json if it exists but does not have generators entry', async () => {
      // Create package.json without generators entry
      writeJson(tree, 'tools/plugin/package.json', {
        name: '@test/plugin',
        version: '1.0.0',
      });

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'update#pkg',
      });

      // Check package.json was updated with generators entry
      const packageJson = JSON.parse(
        tree.read('tools/plugin/package.json', 'utf-8'),
      );
      expect(packageJson.name).toBe('@test/plugin');
      expect(packageJson.version).toBe('1.0.0');
      expect(packageJson.generators).toBe('./generators.json');
    });

    it('should not modify existing generators entry in package.json', async () => {
      // Create package.json with custom generators entry
      writeJson(tree, 'tools/plugin/package.json', {
        name: '@test/plugin',
        version: '1.0.0',
        generators: './custom-generators.json',
      });

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'preserve#generators',
      });

      // Check package.json still has the original generators entry
      const packageJson = JSON.parse(
        tree.read('tools/plugin/package.json', 'utf-8'),
      );
      expect(packageJson.generators).toBe('./custom-generators.json');
    });

    it('should generate an example template file', async () => {
      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'template#test',
        description: 'Some description',
      });

      // Check that the template file exists
      const templatePath =
        'tools/plugin/src/template-test/files/hello.ts.template';
      expect(tree.exists(templatePath)).toBeTruthy();

      // Snapshot the template file
      expect(tree.read(templatePath, 'utf-8')).toMatchSnapshot(
        'hello.ts.template',
      );
    });

    it('should set module to commonjs in tsconfig.json', async () => {
      // Set up a tsconfig.json without module set
      writeJson(tree, 'tools/plugin/tsconfig.json', {});

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'module#test',
        description: 'Test module setting',
      });

      // Check that module is set to commonjs in tsconfig.json
      const tsConfig = JSON.parse(
        tree.read('tools/plugin/tsconfig.json', 'utf-8'),
      );
      expect(tsConfig.compilerOptions.module).toBe('commonjs');
    });

    it('should work when there is no sourceRoot', async () => {
      // Create a project configuration without sourceRoot
      addProjectConfiguration(tree, '@test/no-source-root', {
        root: 'tools/no-source-root',
      });

      // Create tsconfig.json for the project
      writeJson(tree, 'tools/no-source-root/tsconfig.json', {});

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/no-source-root',
        name: 'no#source#root',
        description: 'Generator in project without sourceRoot',
      });

      // Check that the files exist in the default src directory
      const generatorDir = 'tools/no-source-root/src/no-source-root';
      expect(tree.exists(`${generatorDir}/schema.json`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/schema.d.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.ts`)).toBeTruthy();
      expect(tree.exists(`${generatorDir}/generator.spec.ts`)).toBeTruthy();
    });

    it('should add an export declaration to index.ts', async () => {
      // Create an index.ts file in the source root
      tree.write('tools/plugin/src/index.ts', '// This is the index file');

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'export#test',
        description: 'Generator with export test',
      });

      // Check that the export was added to index.ts
      const indexContent = tree.read('tools/plugin/src/index.ts', 'utf-8');
      expect(indexContent).toContain(
        "export * from './export-test/generator';",
      );
    });

    it('should add generator metric to app.ts', async () => {
      await sharedConstructsGenerator(tree);

      await nxGeneratorGenerator(tree, {
        pluginProject: '@test/plugin',
        name: 'foo#bar-baz',
      });

      expectHasMetricTags(tree, NX_GENERATOR_GENERATOR_INFO.metric);
    });
  });
});
