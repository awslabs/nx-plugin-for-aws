/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildInstallCommand } from '../../../packages/nx-plugin/src/utils/commands';
import { getDungeonDiceDependencies, runCLI, runInstall } from '../utils';

const fixtureRoot = join(__dirname, '../files/dungeon-adventure/dice');
const copyFixture = (workspace: string, relativePath: string, name: string) =>
  writeFileSync(
    join(workspace, relativePath),
    readFileSync(join(fixtureRoot, name), 'utf8'),
  );

/** Compare the complete base tutorial file after its documented lint step. */
function expectBaseFixture(
  workspace: string,
  relativePath: string,
  fixture: string,
) {
  let expected = readFileSync(join(fixtureRoot, '..', fixture), 'utf8');
  const format = (command: string, args: string[]) =>
    execFileSync(command, args, {
      cwd: workspace,
      encoding: 'utf8',
      input: expected,
      env: { ...process.env, UV_PYTHON_PREFERENCE: 'system' },
    });
  if (relativePath.endsWith('.py')) {
    expected = format('uv', [
      'run',
      'ruff',
      'check',
      '--fix',
      '--stdin-filename',
      relativePath,
      '-',
    ]);
    expected = format('uv', [
      'run',
      'ruff',
      'format',
      '--stdin-filename',
      relativePath,
      '-',
    ]);
  } else {
    const biome = createRequire(join(workspace, 'package.json')).resolve(
      '@biomejs/biome/bin/biome',
    );
    expected = format(process.execPath, [
      biome,
      'check',
      '--write',
      '--stdin-file-path',
      relativePath,
    ]);
  }
  expect(
    readFileSync(join(workspace, relativePath), 'utf8'),
    `Base tutorial drift in ${relativePath}; update its fixture and the dice diff together.`,
  ).toEqual(expected);
}

function templates(directory: string): any[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return templates(path);
    return entry.name.endsWith('.template.json')
      ? [JSON.parse(readFileSync(path, 'utf8'))]
      : [];
  });
}

/** Apply the dice tutorial's additions to the completed base tutorial. */
export async function exerciseDungeonDice(workspace: string) {
  const opts = { cwd: workspace, env: { NX_DAEMON: 'false' } };
  await runCLI(
    'generate @aws/nx-plugin:py#project --name=edge --no-interactive',
    opts,
  );
  await runCLI(
    'generate @aws/nx-plugin:greengrass#component --project=edge --name=dice --language=python --componentName=com.example.DungeonDice --componentVersion=NEXT_PATCH --platform=linux-amd64 --ipc=true --infra=component-version --iac=cdk --no-interactive',
    opts,
  );
  await runCLI(
    buildInstallCommand(
      'pnpm',
      getDungeonDiceDependencies(),
      false,
      '@dungeon-adventure/inventory',
    ),
    { ...opts, prefixWithPackageManagerCmd: false },
  );
  copyFixture(
    workspace,
    'packages/edge/greengrass/dice/main.py',
    'main.py.template',
  );
  copyFixture(
    workspace,
    'packages/edge/tests/greengrass/test_dice.py',
    'test_dice.py.template',
  );
  writeFileSync(
    join(workspace, 'packages/edge/greengrass/dice/recipe.yaml'),
    readFileSync(join(fixtureRoot, 'recipe.yaml.template'), 'utf8').replaceAll(
      'REPLACE_WITH_CORE_THING_NAME',
      'gg-dungeon-dice-core',
    ),
  );
  for (const name of ['roll-dice', 'register-dice']) {
    copyFixture(
      workspace,
      `packages/inventory/src/mcp-server/${name}.ts`,
      `${name}.ts.template`,
    );
  }
  const edits = [
    {
      path: 'packages/inventory/src/mcp-server/server.ts',
      before: '2/mcp/server.ts.template',
      after: 'server.ts.template',
    },
    {
      path: 'packages/story/dungeon_adventure_story/agent/agent.py',
      before: '3/agent.py.template',
      after: 'agent.py.template',
    },
    {
      path: 'packages/infra/src/stacks/application-stack.ts',
      before: '2/stacks/application-stack.ts.template',
      after: 'application-stack.ts.template',
    },
  ];
  for (const edit of edits) {
    expectBaseFixture(workspace, edit.path, edit.before);
    copyFixture(workspace, edit.path, edit.after);
  }
  copyFixture(
    workspace,
    'packages/infra/src/dice-resources.ts',
    'dice-resources.ts.template',
  );
  await runCLI('sync', opts);
  await runInstall(opts);
  await runCLI('pnpm lint', {
    ...opts,
    prefixWithPackageManagerCmd: false,
  });
  await runCLI('run-many --target build --all --output-style=stream', opts);
  const all = templates(join(workspace, 'dist/packages/infra/cdk.out'));
  const app = all.find((template) =>
    Object.values<any>(template.Resources).some(
      (resource) => resource.Type === 'AWS::GreengrassV2::Deployment',
    ),
  );
  expect(app).toBeDefined();
  const resources = Object.entries<any>(app.Resources);
  const version = resources.find(
    ([, resource]) => resource.Type === 'AWS::GreengrassV2::ComponentVersion',
  );
  const deployment = resources.find(
    ([, resource]) => resource.Type === 'AWS::GreengrassV2::Deployment',
  );
  expect(version).toBeDefined();
  expect(
    deployment?.[1].Properties.Components['com.example.DungeonDice']
      .ComponentVersion,
  ).toEqual({ 'Fn::GetAtt': [version?.[0], 'ComponentVersion'] });
  expect([deployment?.[1].DependsOn ?? []].flat()).toContain(version?.[0]);
  expect(Object.keys(app.Parameters)).toEqual(
    expect.arrayContaining([
      'DiceThingName',
      'DiceEndpoint',
      'TokenExchangeRoleArn',
      'ThingGroupArn',
    ]),
  );
  expect(app.Parameters).not.toHaveProperty('DiceCertificateArn');
  expect(
    resources.filter(
      ([, resource]) =>
        resource.Type === 'AWS::IoT::Policy' ||
        resource.Type === 'AWS::IoT::PolicyPrincipalAttachment',
    ),
  ).toHaveLength(0);
  expect(
    resources.some(([, resource]) => resource.Type === 'AWS::DynamoDB::Table'),
  ).toBe(true);
  const statements = resources
    .filter(([, resource]) => resource.Type === 'AWS::IAM::Policy')
    .flatMap(([, resource]) => resource.Properties.PolicyDocument.Statement);
  const shadowPolicies = statements.filter((statement) =>
    [statement.Action]
      .flat()
      .some((action) =>
        ['iot:GetThingShadow', 'iot:UpdateThingShadow'].includes(action),
      ),
  );
  expect(shadowPolicies).toHaveLength(1);
  const shadowAccess = shadowPolicies[0];
  expect(shadowAccess.Action).toEqual([
    'iot:GetThingShadow',
    'iot:UpdateThingShadow',
  ]);
  const shadowResources = [shadowAccess.Resource].flat();
  expect(shadowResources).toHaveLength(1);
  const shadowArnParts = shadowResources[0]['Fn::Join'];
  expect(shadowArnParts[0]).toBe('');
  const shadowArn = shadowArnParts[1]
    .map((part: string | { Ref: string }) =>
      typeof part === 'string' ? part : `{${part.Ref}}`,
    )
    .join('');
  expect(shadowArn).toMatch(
    /^arn:(?:aws(?:-cn|-us-gov)?|\{AWS::Partition\}):iot:(?:[a-z0-9-]+|\{AWS::Region\}):(?:\d{12}|\{AWS::AccountId\}):thing\/\{DiceThingName\}\/dungeon-dice$/,
  );
  expect(JSON.stringify(shadowResources)).not.toContain('*');
  expect(
    statements.some(
      (statement) =>
        [statement.Action].flat().includes('s3:GetObject') &&
        JSON.stringify(statement.Resource).includes(
          'com.example.DungeonDice/*',
        ),
    ),
  ).toBe(true);
  expect(
    resources.some(
      ([, resource]) => resource.Type === 'AWS::Cognito::UserPool',
    ),
  ).toBe(true);
  expect(
    resources
      .filter(
        ([, resource]) => resource.Type === 'AWS::BedrockAgentCore::Runtime',
      )
      .some(
        ([, resource]) =>
          resource.Properties.EnvironmentVariables?.DICE_THING_NAME,
      ),
  ).toBe(true);

  // Cleanup begins with an empty deployment revision, while the game still exists.
  const diceResourcesPath = join(
    workspace,
    'packages/infra/src/dice-resources.ts',
  );
  const diceResources = readFileSync(diceResourcesPath, 'utf8');
  writeFileSync(
    diceResourcesPath,
    diceResources.replace('this.deployment.addComponent(component);', ''),
  );
  await runCLI(
    'run @dungeon-adventure/infra:synth --output-style=stream',
    opts,
  );
  const empty = templates(join(workspace, 'dist/packages/infra/cdk.out')).find(
    (template) =>
      Object.values<any>(template.Resources).some(
        (resource) => resource.Type === 'AWS::GreengrassV2::Deployment',
      ),
  );
  const emptyDeployment = Object.values<any>(empty.Resources).find(
    (resource) => resource.Type === 'AWS::GreengrassV2::Deployment',
  );
  expect(emptyDeployment.Properties.Components ?? {}).toEqual({});
  writeFileSync(diceResourcesPath, diceResources);
}
