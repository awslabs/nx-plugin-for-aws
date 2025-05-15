/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
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
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'dungeon-adventure')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/dungeon-adventure`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:ts#trpc-api --apiName=GameApi --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#fast-api --name=StoryApi --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#cloudscape-website --name=GameUI --no-interactive`,
      opts,
    );
    // No need to allow signup for the e2e tests
    await runCLI(
      `generate @aws/nx-plugin:ts#cloudscape-website#auth --cognitoDomain=game-ui --project=@dungeon-adventure/game-ui --no-interactive --allowSignup=false`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:api-connection --sourceProject=@dungeon-adventure/game-ui --targetProject=dungeon_adventure.story_api --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:api-connection --sourceProject=@dungeon-adventure/game-ui --targetProject=@dungeon-adventure/game-api-backend --no-interactive`,
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

    // 2. Game API

    await runCLI(
      `${getPackageManagerCommand(pkgMgr).add} electrodb @aws-sdk/client-dynamodb`,
      {
        ...opts,
        prefixWithPackageManagerCmd: false,
        retry: true,
      },
    );

    ensureDirSync(`${opts.cwd}/packages/game-api/schema/src/types`);

    writeFileSync(
      `${opts.cwd}/packages/game-api/schema/src/types/action.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/schema/types/action.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/schema/src/types/common.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/schema/types/common.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/schema/src/types/game.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/schema/types/game.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/schema/src/index.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/schema/index.ts.template',
        ),
      ),
    );

    ensureDirSync(`${opts.cwd}/packages/game-api/backend/src/entities`);

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/entities/action.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/entities/action.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/entities/game.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/entities/game.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/middleware/dynamodb.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/middleware/dynamodb.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/middleware/index.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/middleware/index.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/init.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/2/init.ts.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/procedures/query-actions.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/query-actions.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/procedures/query-games.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/query-games.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/procedures/save-action.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/save-action.ts.template',
        ),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/procedures/save-game.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/2/procedures/save-game.ts.template',
        ),
      ),
    );

    rmSync(`${opts.cwd}/packages/game-api/backend/src/procedures/echo.ts`);

    writeFileSync(
      `${opts.cwd}/packages/game-api/backend/src/router.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/2/router.ts.template'),
      ),
    );

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

    // Module 3: Story API

    await runCLI(
      `run dungeon_adventure.story_api:add --args boto3 uvicorn`,
      opts,
    );
    await runCLI(`${getPackageManagerCommand(pkgMgr).addDev} copyfiles`, {
      ...opts,
      prefixWithPackageManagerCmd: false,
      retry: true,
    });

    // Update the story_api files
    writeFileSync(
      `${opts.cwd}/packages/story_api/story_api/main.py`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/3/main.py.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/story_api/story_api/init.py`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/3/init.py.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/story_api/run.sh`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/3/run.sh.template'),
      ),
    );

    // Update project.json
    const storyApiProjectJson = JSON.parse(
      readFileSync(`${opts.cwd}/packages/story_api/project.json`, 'utf-8'),
    );
    storyApiProjectJson.targets.bundle.options.commands.push(
      'copyfiles -f packages/story_api/run.sh dist/packages/story_api/bundle',
    );
    writeFileSync(
      `${opts.cwd}/packages/story_api/project.json`,
      JSON.stringify(storyApiProjectJson),
    );

    // Update the infrastructure files
    writeFileSync(
      `${opts.cwd}/packages/common/constructs/src/app/apis/story-api.ts`,
      readFileSync(
        join(__dirname, '../files/dungeon-adventure/3/story-api.ts.template'),
      ),
    );

    writeFileSync(
      `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/dungeon-adventure/3/application-stack.ts.template',
        ),
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
