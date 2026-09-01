/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const START_CONTAINER_FILE =
  'packages/common/scripts/src/dynamodb/start-container.ts';

const oldStartContainerFile = ({
  tail = "    '-port', `${port}`,\n    '-optimizeDbBeforeStartup',\n  ];",
} = {}) =>
  `import { spawn, spawnSync } from 'child_process';

const { containerEngine, containerName, image, port } = JSON.parse(
  require('fs').readFileSync('config.json', 'utf-8'),
).localDev;

const runArgs = [
    'run',
    ...(containerEngine === 'docker' ? ['--rm'] : []),
    '--name', containerName,
    '-u', 'root',
    '-w', '/home/dynamodblocal',
    \`-p\`, \`\${port}:\${port}\`,
    '-v', \`\${containerName}-data:/home/dynamodblocal/data\`,
    '-d', image,
    '-jar', 'DynamoDBLocal.jar',
    '-sharedDb',
    '-dbPath', './data',
${tail}
const create = spawnSync(containerEngine, runArgs, { stdio: 'pipe' });
`;

const OLD_START_CONTAINER_FILE = oldStartContainerFile();

describe('dynamodb-local-remove-optimize-flag migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the shared dynamodb scripts do not exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(START_CONTAINER_FILE)).toBeFalsy();
  });

  it('should drop -optimizeDbBeforeStartup from the container args', async () => {
    tree.write(START_CONTAINER_FILE, OLD_START_CONTAINER_FILE);

    const result = await migration(tree);

    const contents = tree.read(START_CONTAINER_FILE, 'utf-8') ?? '';
    expect(contents).not.toContain('-optimizeDbBeforeStartup');
    // The rest of the args are preserved.
    expect(contents).toContain("'-port'");
    expect(contents).toContain('`${port}`');
    expect(contents).toContain("'-sharedDb'");
    // A successful automatic fix needs no manual action, so nothing is reported.
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a diverged file', async () => {
    const diverged = oldStartContainerFile({
      tail: "    '-port', `${port}`,\n    '-optimizeDbBeforeStartup',\n    '-extraCustomFlag',\n  ];",
    });
    tree.write(START_CONTAINER_FILE, diverged);

    const result = await migration(tree);

    const contents = tree.read(START_CONTAINER_FILE, 'utf-8') ?? '';
    expect(contents).toContain('-optimizeDbBeforeStartup');
    expect(
      result.nextSteps.some((s) => s.includes(START_CONTAINER_FILE)),
    ).toBeTruthy();
  });

  it('should be a no-op when the flag is already absent', async () => {
    const alreadyFixed = oldStartContainerFile({
      tail: "    '-port', `${port}`,\n  ];",
    });
    tree.write(START_CONTAINER_FILE, alreadyFixed);

    const result = await migration(tree);

    expect(tree.read(START_CONTAINER_FILE, 'utf-8')).toEqual(alreadyFixed);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(START_CONTAINER_FILE, OLD_START_CONTAINER_FILE);

    await migration(tree);
    const afterFirst = tree.read(START_CONTAINER_FILE, 'utf-8');

    const secondResult = await migration(tree);

    expect(tree.read(START_CONTAINER_FILE, 'utf-8')).toEqual(afterFirst);
    expect(secondResult.nextSteps).toEqual([]);
  });
});
