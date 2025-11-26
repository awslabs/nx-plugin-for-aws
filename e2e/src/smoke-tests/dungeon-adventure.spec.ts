/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import {
  buildCreateNxWorkspaceCommand,
  getDungeonAdventureElectroDbDependencies,
  runCLI,
  tmpProjPath,
} from '../utils';
import { getPackageManagerCommand } from '@nx/devkit';
import { join } from 'path';

/**
 * This test runs through the dungeon adventure tutorial from the docs
 */
describe('smoke test - dungeon-adventure', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/dungeon-adventure-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    // 1. Monorepo Setup

    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'dungeon-adventure', 'CDK', true)} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/dungeon-adventure`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:ts#trpc-api --name=GameApi --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=story --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#strands-agent --project=story --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=inventory --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#mcp-server --project=inventory --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#react-website --name=GameUI --no-interactive`,
      opts,
    );
    // No need to allow signup for the e2e tests
    await runCLI(
      `generate @aws/nx-plugin:ts#react-website#auth --cognitoDomain=game-ui --project=@dungeon-adventure/game-ui --no-interactive --allowSignup=false`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:api-connection --sourceProject=@dungeon-adventure/game-ui --targetProject=@dungeon-adventure/game-api --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );

    writeFileSync(
      `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/1/application-stack.ts.template',
        ),
      ),
    );
    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --skip-nx-cache --verbose`,
      opts,
    );

    // 2. Game API and Inventory MCP Server

    await runCLI(
      `${getPackageManagerCommand(pkgMgr).add} ${getDungeonAdventureElectroDbDependencies()}`,
      {
        ...opts,
        prefixWithPackageManagerCmd: false,
        retry: true,
      },
    );

    ensureDirSync(`${opts.cwd}/packages/game-api/src/schema`);

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/schema/index.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/schema/index.ts.template',
        ),
      ),
    );

    ensureDirSync(`${opts.cwd}/packages/game-api/src/entities`);

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/entities/index.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/entities/index.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/procedures/actions.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/actions.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/procedures/games.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/games.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/procedures/inventory.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/inventory.ts.template',
        ),
      ),
    );

    rmSync(`${opts.cwd}/packages/game-api/src/procedures/echo.ts`);

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/router.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/2/router.ts.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/src/index.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/2/index.ts.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/inventory/src/mcp-server/server.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/2/mcp/server.ts.template'),
      ),
    );

    rmSync(`${opts.cwd}/packages/inventory/src/mcp-server/tools`, {
      recursive: true,
      force: true,
    });
    rmSync(`${opts.cwd}/packages/inventory/src/mcp-server/resources`, {
      recursive: true,
      force: true,
    });

    ensureDirSync(`${opts.cwd}/packages/infra/src/constructs`);

    writeFileSync(
      `${opts.cwd}/packages/infra/src/constructs/electrodb-table.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/constructs/electrodb-table.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/stacks/application-stack.ts.template',
        ),
      ),
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(`run-many --target lint --configuration=fix --all`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --verbose`,
      opts,
    );

    // TODO: consider deploy!

    // Module 3: Story Agent

    // Update the files
    writeFileSync(
      `${opts.cwd}/packages/story/dungeon_adventure_story/agent/main.py`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/3/main.py.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/story/dungeon_adventure_story/agent/agent.py`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/3/agent.py.template'),
      ),
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(`run-many --target lint --configuration=fix --all`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --verbose`,
      opts,
    );

    // Module 4: UI

    // Update the config.ts file
    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/config.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/4/config.ts.template'),
      ),
    );

    // Update the AppLayout
    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/components/AppLayout/index.tsx`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/4/AppLayout/index.tsx.template',
        ),
      ),
    );

    // Delete unused files
    rmSync(
      `${opts.cwd}/packages/game-ui/src/components/AppLayout/navitems.ts`,
      { force: true },
    );
    rmSync(`${opts.cwd}/packages/game-ui/src/hooks/useAppLayout.tsx`, {
      force: true,
    });

    // Update styles.css
    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/styles.css`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/4/styles.css.template'),
      ),
    );

    // Add hook
    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/hooks/useStoryAgent.tsx`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/4/hooks/useStoryAgent.tsx.template',
        ),
      ),
    );

    // Create game routes
    ensureDirSync(`${opts.cwd}/packages/game-ui/src/routes/game`);

    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/routes/game/index.tsx`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/4/routes/game/index.tsx.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/routes/game/$playerName.tsx`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/4/routes/game/$playerName.tsx.template',
        ),
      ),
    );

    // Update root route
    writeFileSync(
      `${opts.cwd}/packages/game-ui/src/routes/index.tsx`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/4/routes/index.tsx.template',
        ),
      ),
    );

    // Delete welcome route
    rmSync(`${opts.cwd}/packages/game-ui/src/routes/welcome`, {
      force: true,
      recursive: true,
    });

    await runCLI(`sync --verbose`, opts);
    await runCLI(`run-many --target lint --configuration=fix --all`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --verbose`,
      opts,
    );
  });
});
