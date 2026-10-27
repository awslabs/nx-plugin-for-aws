/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { pinAwsScopeToLocalRegistry, tmpProjPath } from '../utils';
import { createDungeonAdventureWorkspace } from './dungeon-adventure-workspace';
import { exerciseDungeonDice } from './dungeon-dice';

describe('smoke test - dungeon-dice', () => {
  const targetDir = `${tmpProjPath()}/dungeon-dice-pnpm`;

  beforeEach(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    ensureDirSync(targetDir);
    pinAwsScopeToLocalRegistry(targetDir);
  });

  it('builds the documented dice extension and synthesizes its deployment and cleanup', async () => {
    const workspace = await createDungeonAdventureWorkspace(targetDir);
    await exerciseDungeonDice(workspace);
  });
});
