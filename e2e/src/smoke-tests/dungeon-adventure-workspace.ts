/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { buildInstallCommand } from '../../../packages/nx-plugin/src/utils/commands';
import {
  buildPackageManagerShortCommand,
  createTestWorkspace,
  getDungeonAdventureElectroDbDependencies,
  runCLI,
  runInstall,
} from '../utils';

const isUpdateSnapshot = () =>
  (globalThis as any).__vitest_worker__?.config?.snapshotOptions
    ?.updateSnapshot === 'all';

/**
 * Asserts that the generated file matches the expected "old" template.
 * When vitest is run with `-u`, the old template is overwritten with the
 * actual generated content so the templates stay up-to-date automatically.
 */
const expectFileMatchesOldTemplate = (
  generatedFilePath: string,
  oldTemplatePath: string,
) => {
  const actual = readFileSync(generatedFilePath, 'utf-8');
  if (isUpdateSnapshot()) {
    const existing = readFileSync(oldTemplatePath, 'utf-8');
    if (actual !== existing) {
      console.log(`Updating template: ${oldTemplatePath}`);
      writeFileSync(oldTemplatePath, actual);
    }
  } else {
    expect(actual).toEqual(readFileSync(oldTemplatePath, 'utf-8'));
  }
};

const dungeonFile = (...segments: string[]) =>
  join(__dirname, '../files/dungeon-adventure', ...segments);

const writeFromTemplate = (
  destination: string,
  ...templateSegments: string[]
) =>
  writeFileSync(
    destination,
    readFileSync(dungeonFile(...templateSegments), 'utf-8'),
  );

/** Generate and build the four documented Dungeon Adventure modules. */
export async function createDungeonAdventureWorkspace(
  targetDir: string,
): Promise<string> {
  const pkgMgr = 'pnpm';
  const projectRoot = join(targetDir, 'dungeon-adventure');
  const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };
  // 1. Monorepo Setup

  await createTestWorkspace(pkgMgr, targetDir, 'dungeon-adventure', 'cdk');

  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=GameApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=story --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=story --auth=cognito --protocol=ag-ui --no-interactive`,
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
  // The DynamoDB table backing the game's state, with local development
  // support via DynamoDB Local
  await runCLI(
    `generate @aws/nx-plugin:ts#dynamodb --name=DungeonDb --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=GameUI --ux=shadcn --no-interactive`,
    opts,
  );
  // No need to allow signup for the e2e tests
  await runCLI(
    `generate @aws/nx-plugin:ts#website#auth --cognitoDomain=game-ui --project=@dungeon-adventure/game-ui --no-interactive --allowSignup=false`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/game-ui --targetProject=@dungeon-adventure/game-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=story --targetProject=inventory --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/game-ui --targetProject=story --no-interactive`,
    opts,
  );
  // Wire the Game API and the Inventory MCP server to the DynamoDB table so
  // their dev targets boot DynamoDB Local automatically
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/game-api --targetProject=@dungeon-adventure/dungeon-db --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/inventory --targetProject=@dungeon-adventure/dungeon-db --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
    opts,
  );

  // Check application stack matches application-stack.ts.original.template
  const applicationStackPath = `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`;
  expectFileMatchesOldTemplate(
    applicationStackPath,
    dungeonFile('1/application-stack.ts.original.template'),
  );

  writeFromTemplate(applicationStackPath, '1/application-stack.ts.template');
  // Module 1 Task 4's documented sequence: sync, then lint, then build. The
  // `lint` step applies biome's fixes (notably import ordering), so running it
  // here is what makes the Module 2 "before" templates below match the state a
  // reader following the guide actually has on disk.
  await runCLI(`sync --verbose`, opts);
  await runInstall(opts);
  await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
    ...opts,
    prefixWithPackageManagerCmd: false,
  });
  await runCLI(
    `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --skip-nx-cache --verbose`,
    { ...opts, prefixWithPackageManagerCmd: false },
  );

  // 2. Game API and Inventory MCP Server

  await runCLI(
    buildInstallCommand(
      pkgMgr,
      getDungeonAdventureElectroDbDependencies(),
      false,
      '@dungeon-adventure/game-api',
    ),
    {
      ...opts,
      prefixWithPackageManagerCmd: false,
      retry: true,
    },
  );

  // Model the Game and Inventory entities in the DynamoDB project
  writeFromTemplate(
    `${opts.cwd}/packages/dungeon-db/src/entities/index.ts`,
    '2/dungeon-db/entities/index.ts.template',
  );
  rmSync(`${opts.cwd}/packages/dungeon-db/src/entities/example.ts`);

  // Game API schema
  ensureDirSync(`${opts.cwd}/packages/game-api/src/schema`);
  writeFromTemplate(
    `${opts.cwd}/packages/game-api/src/schema/index.ts`,
    '2/schema/index.ts.template',
  );

  writeFromTemplate(
    `${opts.cwd}/packages/game-api/src/procedures/actions.ts`,
    '2/procedures/actions.ts.template',
  );
  writeFromTemplate(
    `${opts.cwd}/packages/game-api/src/procedures/games.ts`,
    '2/procedures/games.ts.template',
  );
  writeFromTemplate(
    `${opts.cwd}/packages/game-api/src/procedures/inventory.ts`,
    '2/procedures/inventory.ts.template',
  );
  rmSync(`${opts.cwd}/packages/game-api/src/procedures/echo.ts`);

  // Check router.ts matches router.ts.old.template before modification
  const routerPath = `${opts.cwd}/packages/game-api/src/router.ts`;
  expectFileMatchesOldTemplate(
    routerPath,
    dungeonFile('2/router.ts.old.template'),
  );
  writeFromTemplate(routerPath, '2/router.ts.template');

  // Check mcp server.ts matches server.ts.old.template before modification
  const mcpServerPath = `${opts.cwd}/packages/inventory/src/mcp-server/server.ts`;
  expectFileMatchesOldTemplate(
    mcpServerPath,
    dungeonFile('2/mcp/server.ts.old.template'),
  );
  writeFromTemplate(mcpServerPath, '2/mcp/server.ts.template');

  rmSync(`${opts.cwd}/packages/inventory/src/mcp-server/tools`, {
    recursive: true,
    force: true,
  });
  rmSync(`${opts.cwd}/packages/inventory/src/mcp-server/resources`, {
    recursive: true,
    force: true,
  });

  // Check story-agent.ts matches story-agent.ts.old.template before modification
  const storyAgentConstructPath = `${opts.cwd}/packages/common/constructs/src/app/agents/story-agent/story-agent.ts`;
  expectFileMatchesOldTemplate(
    storyAgentConstructPath,
    dungeonFile('2/agents/story-agent.ts.old.template'),
  );
  writeFromTemplate(
    storyAgentConstructPath,
    '2/agents/story-agent.ts.template',
  );

  writeFromTemplate(
    `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
    '2/stacks/application-stack.ts.template',
  );

  await runCLI(`sync --verbose`, opts);
  await runInstall(opts);
  await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
    ...opts,
    prefixWithPackageManagerCmd: false,
  });
  // Skip intermediate build to reduce test time on Windows
  if (process.platform !== 'win32') {
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );
  }

  // Module 3: Story Agent

  // Check agent.py matches agent.py.old.template before modification
  const agentPyPath = `${opts.cwd}/packages/story/dungeon_adventure_story/agent/agent.py`;
  expectFileMatchesOldTemplate(
    agentPyPath,
    dungeonFile('3/agent.py.old.template'),
  );
  writeFromTemplate(agentPyPath, '3/agent.py.template');

  await runCLI(`sync --verbose`, opts);
  await runInstall(opts);
  await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
    ...opts,
    prefixWithPackageManagerCmd: false,
  });
  // Skip intermediate build to reduce test time on Windows
  if (process.platform !== 'win32') {
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );
  }

  // Module 4: UI

  // Single global styles file - dungeon theme + CopilotKit colour reset
  writeFromTemplate(
    `${opts.cwd}/packages/game-ui/src/styles.css`,
    '4/styles.css.template',
  );

  // Game route: CopilotChat for the AG-UI agent with deterministic threadId
  ensureDirSync(`${opts.cwd}/packages/game-ui/src/routes/game`);
  writeFromTemplate(
    `${opts.cwd}/packages/game-ui/src/routes/game/$playerName.tsx`,
    '4/routes/game/$playerName.tsx.template',
  );

  // Root route: new-game picker + continue list
  const routesIndexPath = `${opts.cwd}/packages/game-ui/src/routes/index.tsx`;
  expectFileMatchesOldTemplate(
    routesIndexPath,
    dungeonFile('4/routes/index.tsx.old.template'),
  );
  writeFromTemplate(routesIndexPath, '4/routes/index.tsx.template');

  await runCLI(`sync --verbose`, opts);
  await runInstall(opts);
  await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
    ...opts,
    prefixWithPackageManagerCmd: false,
  });
  await runCLI(
    `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --verbose`,
    { ...opts, prefixWithPackageManagerCmd: false },
  );

  return projectRoot;
}
