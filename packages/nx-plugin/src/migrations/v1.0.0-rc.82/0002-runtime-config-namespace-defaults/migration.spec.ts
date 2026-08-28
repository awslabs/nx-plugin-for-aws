/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const APPCONFIG_FILE =
  'packages/common/terraform/src/core/runtime-config/appconfig/appconfig.tf';
const APPCONFIG_DEPLOYMENT_FILE =
  'packages/common/terraform/src/core/runtime-config/appconfig-deployment/appconfig-deployment.tf';
const MAIN_TF = 'packages/infra/src/main.tf';

/** The vended appconfig module, before the namespace defaults were completed. */
const OLD_APPCONFIG = `resource "aws_appconfig_application" "runtime_config" {
  name = var.application_name
}

variable "namespaces" {
  description = "List of runtime-config namespaces this AppConfig application should expose (one Configuration Profile is created per namespace)."
  type        = list(string)
  default     = ["connection", "agentcore"]
}

resource "aws_appconfig_configuration_profile" "namespace" {
  for_each = toset(var.namespaces)

  application_id = aws_appconfig_application.runtime_config.id
  name           = each.key
}
`;

/** The vended appconfig-deployment module, carrying the same stale default. */
const OLD_APPCONFIG_DEPLOYMENT = `variable "namespaces" {
  description = "List of namespaces to aggregate + deploy. Must match the keys of \`configuration_profile_ids\`."
  type        = list(string)
  default     = ["connection", "agentcore"]
}

resource "aws_appconfig_deployment" "namespace" {
  for_each = toset(var.namespaces)
}
`;

const namespacesDefault = (contents: string): string[] => {
  const list = /default\s*=\s*\[([^\]]*)\]/.exec(contents)?.[1];
  if (list === undefined) {
    throw new Error('No `namespaces` default found');
  }
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

describe('runtime-config-namespace-defaults migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should complete the namespace defaults in both vended modules', async () => {
    tree.write(APPCONFIG_FILE, OLD_APPCONFIG);
    tree.write(APPCONFIG_DEPLOYMENT_FILE, OLD_APPCONFIG_DEPLOYMENT);

    const result = await migration(tree);

    for (const file of [APPCONFIG_FILE, APPCONFIG_DEPLOYMENT_FILE]) {
      expect(namespacesDefault(tree.read(file, 'utf-8')!)).toEqual([
        'connection',
        'agentcore',
        'database',
        'dynamodb',
      ]);
    }
    expect(result.nextSteps).toEqual([]);
  });

  it('should document the completed defaults on the vended variable', async () => {
    tree.write(APPCONFIG_FILE, OLD_APPCONFIG);

    await migration(tree);

    expect(tree.read(APPCONFIG_FILE, 'utf-8')).toContain(
      'The default covers every namespace the generated modules write to',
    );
  });

  it('should add only the namespaces that are missing', async () => {
    tree.write(
      APPCONFIG_FILE,
      OLD_APPCONFIG.replace(
        '["connection", "agentcore"]',
        '["connection", "agentcore", "database"]',
      ),
    );

    await migration(tree);

    expect(namespacesDefault(tree.read(APPCONFIG_FILE, 'utf-8')!)).toEqual([
      'connection',
      'agentcore',
      'database',
      'dynamodb',
    ]);
  });

  it('should preserve namespaces the user added', async () => {
    tree.write(
      APPCONFIG_FILE,
      OLD_APPCONFIG.replace(
        '["connection", "agentcore"]',
        '["connection", "agentcore", "tables"]',
      ),
    );

    await migration(tree);

    expect(namespacesDefault(tree.read(APPCONFIG_FILE, 'utf-8')!)).toEqual([
      'connection',
      'agentcore',
      'tables',
      'database',
      'dynamodb',
    ]);
  });

  // An explicit list overrides the vended default, so a root module passing one
  // needs the same additions.
  it('should complete an explicit namespaces argument in a root module', async () => {
    tree.write(APPCONFIG_FILE, OLD_APPCONFIG);
    tree.write(
      MAIN_TF,
      `module "runtime_config_appconfig" {
  source = "../../common/terraform/src/core/runtime-config/appconfig"

  application_name = "my-app-runtime-config"
  namespaces       = ["connection", "agentcore", "database"]
}

module "unrelated" {
  source     = "./unrelated"
  namespaces = ["mine"]
}
`,
    );

    const result = await migration(tree);

    const mainTf = tree.read(MAIN_TF, 'utf-8')!;
    expect(mainTf).toContain(
      '["connection", "agentcore", "database", "dynamodb"]',
    );
    // A `namespaces` argument on a module that isn't the vended appconfig one
    // belongs to the user.
    expect(mainTf).toContain('namespaces = ["mine"]');
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a root module that takes the defaults untouched', async () => {
    tree.write(APPCONFIG_FILE, OLD_APPCONFIG);
    const mainTf = `module "runtime_config_appconfig" {
  source = "../../common/terraform/src/core/runtime-config/appconfig"

  application_name = "my-app-runtime-config"
}
`;
    tree.write(MAIN_TF, mainTf);

    const result = await migration(tree);

    expect(tree.read(MAIN_TF, 'utf-8')).toBe(mainTf);
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a root module whose namespaces are not a literal list', async () => {
    tree.write(APPCONFIG_FILE, OLD_APPCONFIG);
    const mainTf = `module "runtime_config_appconfig" {
  source = "../../common/terraform/src/core/runtime-config/appconfig"

  application_name = "my-app-runtime-config"
  namespaces       = local.my_namespaces
}
`;
    tree.write(MAIN_TF, mainTf);

    const result = await migration(tree);

    expect(tree.read(MAIN_TF, 'utf-8')).toBe(mainTf);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(MAIN_TF);
  });

  it('should skip and report a customised namespaces variable', async () => {
    const customised = `variable "namespaces" {
  type    = list(string)
  default = local.my_namespaces
}
`;
    tree.write(APPCONFIG_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(APPCONFIG_FILE, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(APPCONFIG_FILE);
    expect(result.nextSteps?.[0]).toContain('"database" and "dynamodb"');
  });

  it('should do nothing in a workspace with no terraform runtime config', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(APPCONFIG_FILE)).toBe(false);
  });

  it('should be idempotent', async () => {
    tree.write(APPCONFIG_FILE, OLD_APPCONFIG);
    tree.write(APPCONFIG_DEPLOYMENT_FILE, OLD_APPCONFIG_DEPLOYMENT);
    tree.write(
      MAIN_TF,
      `module "runtime_config_appconfig" {
  source = "../../common/terraform/src/core/runtime-config/appconfig"

  application_name = "my-app-runtime-config"
  namespaces       = ["connection", "agentcore"]
}
`,
    );
    const files = [APPCONFIG_FILE, APPCONFIG_DEPLOYMENT_FILE, MAIN_TF];

    await migration(tree);
    const afterFirst = files.map((file) => tree.read(file, 'utf-8'));

    const result = await migration(tree);

    expect(files.map((file) => tree.read(file, 'utf-8'))).toEqual(afterFirst);
    expect(result.nextSteps).toEqual([]);
  });
});
