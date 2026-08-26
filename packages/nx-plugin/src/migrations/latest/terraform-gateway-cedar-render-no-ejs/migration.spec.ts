/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const SCRIPT_PATH =
  'packages/common/terraform/src/app/gateways/my-gateway/render-cedar.cjs';
const MANIFEST_PATH = 'packages/my-gateway/package.json';

// The shape shipped before this migration.
const OLD_SCRIPT = `// Renders a Cedar policy EJS template for the MyGateway Terraform
// module. Invoked by the \`external\` data source with JSON on stdin:
//   { "template": "<path>", "gatewayArn": "...", "accountId": "..." }
const ejs = require('ejs');
const fs = require('fs');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const { template, ...vars } = JSON.parse(input);
  const rendered = ejs.render(fs.readFileSync(template, 'utf-8'), vars);
  process.stdout.write(JSON.stringify({ rendered }));
});
`;

describe('terraform-gateway-cedar-render-no-ejs migration', () => {
  let tree: Tree;

  const addGateway = (
    options: { script?: string; manifest?: Record<string, unknown> } = {},
  ) => {
    addProjectConfiguration(tree, '@proj/my-gateway', {
      root: 'packages/my-gateway',
      metadata: {
        generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
        name: 'my-gateway',
        rc: 'MyGateway',
        iac: 'terraform',
      } as never,
    });
    tree.write(
      MANIFEST_PATH,
      JSON.stringify(
        options.manifest ?? {
          name: '@proj/my-gateway',
          dependencies: { express: 'catalog:' },
          devDependencies: { ejs: 'catalog:', '@types/ejs': 'catalog:' },
        },
        null,
        2,
      ),
    );
    if (options.script !== undefined) {
      tree.write(SCRIPT_PATH, options.script);
    }
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('replaces the ejs render script and renders policies without it', async () => {
    addGateway({ script: OLD_SCRIPT });

    const result = await migration(tree);

    const migrated = tree.read(SCRIPT_PATH, 'utf-8')!;
    expect(migrated).not.toContain("require('ejs')");
    expect(migrated).toContain('MyGateway');
    expect(result.nextSteps).toEqual([]);

    // Executed the way `terraform apply` does — from a directory with no
    // node_modules above it — so a leftover third-party require would fail.
    const dir = mkdtempSync(join(tmpdir(), 'render-cedar-migration-'));
    const scriptPath = join(dir, 'render-cedar.cjs');
    const policyPath = join(dir, 'permit-all.cedar');
    writeFileSync(scriptPath, migrated);
    writeFileSync(
      policyPath,
      'permit (principal, action, resource == AgentCore::Gateway::"<%= gatewayArn %>");\n',
    );
    const run = spawnSync(process.execPath, [scriptPath], {
      cwd: dir,
      input: JSON.stringify({
        template: policyPath,
        gatewayArn:
          'arn:aws:bedrock-agentcore:us-west-2:123456789012:gateway/g',
        accountId: '123456789012',
      }),
      encoding: 'utf-8',
      env: { ...process.env, NODE_PATH: '' },
    });
    expect(run.stderr).not.toContain('Cannot find module');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).rendered).toContain(
      'AgentCore::Gateway::"arn:aws:bedrock-agentcore:us-west-2:123456789012:gateway/g"',
    );
  });

  it('drops the now-unused ejs dependencies from the gateway manifest', async () => {
    addGateway({ script: OLD_SCRIPT });

    await migration(tree);

    const manifest = JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!);
    expect(manifest.devDependencies).not.toHaveProperty('ejs');
    expect(manifest.devDependencies).not.toHaveProperty('@types/ejs');
    // Everything else the gateway declares is untouched.
    expect(manifest.dependencies).toEqual({ express: 'catalog:' });
  });

  it('keeps an ejs version the user pinned themselves', async () => {
    addGateway({
      script: OLD_SCRIPT,
      manifest: {
        name: '@proj/my-gateway',
        devDependencies: { ejs: '^3.1.0' },
      },
    });

    await migration(tree);

    expect(
      JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!).devDependencies.ejs,
    ).toBe('^3.1.0');
  });

  it('skips and reports a customised render script', async () => {
    const customised = `const fs = require('fs');\n// hand-written renderer\n`;
    addGateway({ script: customised });

    const result = await migration(tree);

    expect(tree.read(SCRIPT_PATH, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(SCRIPT_PATH);
  });

  it('leaves a CDK gateway alone, which vends no render script', async () => {
    addGateway();

    const result = await migration(tree);

    expect(tree.exists(SCRIPT_PATH)).toBe(false);
    expect(result.nextSteps).toEqual([]);
  });

  it('is idempotent', async () => {
    addGateway({ script: OLD_SCRIPT });

    await migration(tree);
    const afterFirst = {
      script: tree.read(SCRIPT_PATH, 'utf-8'),
      manifest: tree.read(MANIFEST_PATH, 'utf-8'),
    };
    const result = await migration(tree);

    expect(tree.read(SCRIPT_PATH, 'utf-8')).toBe(afterFirst.script);
    expect(tree.read(MANIFEST_PATH, 'utf-8')).toBe(afterFirst.manifest);
    expect(result.nextSteps).toEqual([]);
  });
});
