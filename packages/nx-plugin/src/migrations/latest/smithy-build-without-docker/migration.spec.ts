/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import {
  SMITHY_PROJECT_GENERATOR_INFO,
  smithyProjectGenerator,
} from '../../../smithy/project/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { SMITHY_VERSIONS } from '../../../utils/versions';
import migration from './migration';

/**
 * The `build.Dockerfile` a v1.0.0-rc.58 service project holds, and the
 * `docker build` its compile target ran.
 *
 * Snapshots of that release rather than the generator's output: the generator now
 * vends neither, so there is nothing to render. This migration only ever runs
 * against a workspace still on the container build, whose files are fixed.
 */
const RC58_BUILD_DOCKERFILE = readFileSync(
  join(
    import.meta.dirname,
    '..',
    'smithy-ssdk-bundle-pins',
    'rc57-service.Dockerfile.fixture',
  ),
  'utf-8',
);

const dockerBuildCommand = (engine: 'docker' | 'finch' = 'docker') =>
  `${engine} build -f {projectRoot}/build.Dockerfile --build-context workspace=. --target export --output type=local,dest=dist/{projectRoot}/build {projectRoot}`;

const RC58_COMPILE_COMMANDS = [
  'rimraf dist/{projectRoot}/build',
  'make-dir dist/{projectRoot}/build',
  dockerBuildCommand(),
];

/**
 * A Smithy project as a container-building release left it: generated fresh, then
 * wound back to that release's Dockerfile and compile target.
 */
const generateOldWorkspace = async (
  tree: Tree,
  options: {
    name: string;
    type?: 'service' | 'shapes';
    engine?: 'docker' | 'finch';
  } = {
    name: 'test-api',
  },
): Promise<string> => {
  const { name, type = 'service', engine = 'docker' } = options;
  await smithyProjectGenerator(tree, { name, type });

  tree.write(`${name}/build.Dockerfile`, RC58_BUILD_DOCKERFILE);
  tree.delete(`${name}/ssdk.rolldown.config.mjs`);

  const projectJson = readJson(tree, `${name}/project.json`);
  projectJson.targets.compile.options.commands = [
    ...RC58_COMPILE_COMMANDS.slice(0, -1),
    dockerBuildCommand(engine),
  ];
  tree.write(`${name}/project.json`, JSON.stringify(projectJson, null, 2));
  return name;
};

describe('smithy-build-without-docker migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should build a service with the smithy cli rather than a container', async () => {
    await generateOldWorkspace(tree);

    const { nextSteps } = await migration(tree);

    const { targets } = readJson(tree, 'test-api/project.json');
    const commands: string[] = targets.compile.options.commands;
    expect(commands).toContain(
      `mise exec smithy@${SMITHY_VERSIONS.cli} -- smithy build -c {projectRoot}/smithy-build.json --output dist/{projectRoot}/smithy`,
    );
    expect(commands.join('\n')).not.toContain('docker');
    expect(commands.join('\n')).not.toContain('build.Dockerfile');
    expect(nextSteps).toEqual([]);
  });

  it('should delete the build.Dockerfile it no longer needs', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);

    expect(tree.exists('test-api/build.Dockerfile')).toBeFalsy();
  });

  it('should write the bundle config a service now builds its sdk with', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);

    expect(tree.exists('test-api/ssdk.rolldown.config.mjs')).toBeTruthy();
    expect(tree.read('test-api/ssdk.rolldown.config.mjs', 'utf-8')).toContain(
      'rolldown-plugin-dts',
    );
  });

  it('should add the dependencies the build now runs on the machine', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);

    const { devDependencies } = readJson(tree, 'package.json');
    // Resolves the pinned CLI the target invokes.
    expect(devDependencies).toHaveProperty('mise');
    // Bundles the generated server SDK, which the image used to do.
    expect(devDependencies).toHaveProperty('rolldown');
    expect(devDependencies).toHaveProperty('rolldown-plugin-dts');
  });

  it('should migrate a shape library with no sdk to bundle', async () => {
    await generateOldWorkspace(tree, { name: 'test-shapes', type: 'shapes' });

    const { nextSteps } = await migration(tree);

    const { targets } = readJson(tree, 'test-shapes/project.json');
    const commands: string[] = targets.compile.options.commands;
    expect(commands.join('\n')).not.toContain('docker');
    expect(commands.at(-1)).toContain('model.json');
    // A shape library generates no server SDK
    expect(commands.join('\n')).not.toContain('rolldown');
    expect(tree.exists('test-shapes/ssdk.rolldown.config.mjs')).toBeFalsy();
    expect(nextSteps).toEqual([]);
  });

  // The engine is whichever the workspace configured, so both forms must be
  // recognised as generated rather than user-edited.
  it('should migrate a project built with finch', async () => {
    await generateOldWorkspace(tree, { name: 'test-api', engine: 'finch' });

    const { nextSteps } = await migration(tree);

    const { targets } = readJson(tree, 'test-api/project.json');
    expect(targets.compile.options.commands.join('\n')).not.toContain('finch');
    expect(nextSteps).toEqual([]);
  });

  /**
   * Replacing an edited target discards the user's work, so it is reported
   * instead — the whole point of the check.
   */
  it('should leave a customised compile target alone and report it', async () => {
    await generateOldWorkspace(tree);
    const projectJson = readJson(tree, 'test-api/project.json');
    projectJson.targets.compile.options.commands.push(
      'docker build -f {projectRoot}/build.Dockerfile --target lint .',
    );
    tree.write('test-api/project.json', JSON.stringify(projectJson, null, 2));

    const { nextSteps } = await migration(tree);

    expect(readJson(tree, 'test-api/project.json').targets.compile).toEqual(
      projectJson.targets.compile,
    );
    expect(tree.exists('test-api/build.Dockerfile')).toBeTruthy();
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('test-api');
  });

  /**
   * A shape library was consumed through a build-context copy into the image.
   * With the build on the machine, `imports` reaches the built model directly, so
   * the copy has to become an import or the consumer stops resolving its shapes.
   */
  it('should carry a dockerfile shape library copy over to imports', async () => {
    await generateOldWorkspace(tree, { name: 'test-api' });
    tree.write(
      'test-api/build.Dockerfile',
      `${RC58_BUILD_DOCKERFILE}\nCOPY --from=workspace dist/packages/my-shapes/build/model/model.json deps/my-shapes.json\n`,
    );

    await migration(tree);

    const smithyBuild = readJson(tree, 'test-api/smithy-build.json');
    expect(smithyBuild.imports).toEqual([
      '../dist/packages/my-shapes/build/model/model.json',
    ]);
  });

  it('should keep imports the user already declared', async () => {
    await generateOldWorkspace(tree, { name: 'test-api' });
    const smithyBuild = readJson(tree, 'test-api/smithy-build.json');
    smithyBuild.imports = ['theirs.json'];
    tree.write('test-api/smithy-build.json', JSON.stringify(smithyBuild));
    tree.write(
      'test-api/build.Dockerfile',
      `${RC58_BUILD_DOCKERFILE}\nCOPY --from=workspace dist/packages/my-shapes/build/model/model.json deps/my-shapes.json\n`,
    );

    await migration(tree);

    expect(readJson(tree, 'test-api/smithy-build.json').imports).toEqual([
      'theirs.json',
      '../dist/packages/my-shapes/build/model/model.json',
    ]);
  });

  it('should be idempotent', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);
    const afterFirst = tree.read('test-api/project.json', 'utf-8');
    const { nextSteps } = await migration(tree);

    expect(tree.read('test-api/project.json', 'utf-8')).toEqual(afterFirst);
    expect(nextSteps).toEqual([]);
  });

  it('should leave a project already on the cli build untouched', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });
    const before = tree.read('test-api/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read('test-api/project.json', 'utf-8')).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  // Scoped by the recorded generator id, so a Dockerfile a user wrote themselves
  // is not touched.
  it('should leave a build.Dockerfile outside a smithy project alone', async () => {
    addProjectConfiguration(tree, 'other', { root: 'packages/other' });
    const theirs = 'FROM node:24\nRUN echo mine\n';
    tree.write('packages/other/build.Dockerfile', theirs);

    await migration(tree);

    expect(tree.read('packages/other/build.Dockerfile', 'utf-8')).toEqual(
      theirs,
    );
  });

  it('should do nothing in a workspace with no smithy project', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
  });

  // A project generated before the type was recorded is a service.
  it('should treat a project with no recorded type as a service', async () => {
    await generateOldWorkspace(tree);
    const projectJson = readJson(tree, 'test-api/project.json');
    projectJson.metadata = {
      generator: SMITHY_PROJECT_GENERATOR_INFO.id,
    };
    tree.write('test-api/project.json', JSON.stringify(projectJson, null, 2));

    await migration(tree);

    expect(tree.exists('test-api/ssdk.rolldown.config.mjs')).toBeTruthy();
  });
});
