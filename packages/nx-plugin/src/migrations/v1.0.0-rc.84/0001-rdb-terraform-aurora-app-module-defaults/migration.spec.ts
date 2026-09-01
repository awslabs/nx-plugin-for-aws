/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const DB_FILE = 'packages/common/terraform/src/app/dbs/my-db/my-db.tf';

/** The pre-change shape of the vended per-database Terraform app module. */
const BEFORE = `variable "enable_credential_rotation" {
  description = "Whether to enable automatic credential rotation for the admin secret."
  type        = bool
  default     = true
}

variable "enable_cloudwatch_logs" {
  description = "Whether to export Aurora engine logs to CloudWatch. PostgreSQL also enables verbose statement logging."
  type        = bool
  default     = false
}

variable "enable_performance_insights" {
  description = "Whether to enable Performance Insights on Aurora cluster instances."
  type        = bool
  default     = true
}

variable "enable_backup" {
  description = "Whether to provision an AWS Backup plan for the Aurora cluster."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}

module "aurora" {
  source = "../../../core/rdb/aurora"

  name                        = "my-db"
  engine                      = "aurora-postgresql"
  enable_credential_rotation  = var.enable_credential_rotation
  enable_cloudwatch_logs      = var.enable_cloudwatch_logs
  enable_performance_insights = var.enable_performance_insights
  enable_backup               = var.enable_backup
  tags                        = var.tags
}
`;

describe('rdb-terraform-aurora-app-module-defaults migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should align the app module defaults with the core module', async () => {
    tree.write(DB_FILE, BEFORE);

    const result = await migration(tree);

    const content = tree.read(DB_FILE, 'utf-8');

    // Matches the core module and the CDK construct, so engine logs are
    // exported and the cluster parameter group that configures them is created.
    expect(content).toMatch(
      /variable "enable_cloudwatch_logs"[\s\S]*?default\s+= true/,
    );
    expect(content).not.toContain(
      'PostgreSQL also enables verbose statement logging',
    );
    expect(content).toContain('log_statement=ddl');

    // The core module's key rotation variable becomes reachable from a root
    // configuration.
    expect(content).toMatch(
      /variable "enable_key_rotation"[\s\S]*?default\s+= true/,
    );
    expect(content).toContain('enable_key_rotation = var.enable_key_rotation');

    // Everything else is left as the user had it.
    expect(content).toContain(
      'enable_backup               = var.enable_backup',
    );
    expect(content).toMatch(
      /variable "enable_backup"[\s\S]*?default\s+= false/,
    );
    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('should migrate every database module in the workspace', async () => {
    tree.write(DB_FILE, BEFORE);
    tree.write(
      'packages/common/terraform/src/app/dbs/other-db/other-db.tf',
      BEFORE.replace(/my-db/g, 'other-db'),
    );

    const result = await migration(tree);

    for (const path of [
      DB_FILE,
      'packages/common/terraform/src/app/dbs/other-db/other-db.tf',
    ]) {
      expect(tree.read(path, 'utf-8')).toContain(
        'enable_key_rotation = var.enable_key_rotation',
      );
    }
    expect(result.nextSteps).toEqual([]);
  });

  it('should do nothing when the workspace has no terraform database modules', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(DB_FILE)).toBe(false);
  });

  it('should skip and report a customised file', async () => {
    const customised = `module "my_own_aurora" {
  source = "../../../core/rdb/aurora"
  name   = "custom"
}
`;
    tree.write(DB_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(DB_FILE, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(DB_FILE);
    expect(result.nextSteps[0]).toContain('enable_cloudwatch_logs');
  });

  it('should preserve a deliberately disabled log export', async () => {
    // A user who turned log export off keeps that choice; only the missing
    // variable is added.
    tree.write(
      DB_FILE,
      BEFORE.replace(
        `variable "enable_cloudwatch_logs" {
  description = "Whether to export Aurora engine logs to CloudWatch. PostgreSQL also enables verbose statement logging."
  type        = bool
  default     = false
}`,
        `variable "enable_cloudwatch_logs" {
  description = "Logging is handled by our central platform account."
  type        = bool
  default     = false
}`,
      ),
    );

    const result = await migration(tree);

    const content = tree.read(DB_FILE, 'utf-8');
    expect(content).toContain(
      'Logging is handled by our central platform account.',
    );
    expect(content).toContain('enable_key_rotation = var.enable_key_rotation');
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(DB_FILE, BEFORE);

    await migration(tree);
    const afterFirst = tree.read(DB_FILE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(DB_FILE, 'utf-8')).toBe(afterFirst);
    expect(result.nextSteps).toEqual([]);

    // Exactly one declaration and one forwarded value, not a second copy.
    expect(afterFirst.match(/variable "enable_key_rotation"/g)).toHaveLength(1);
    expect(
      afterFirst.match(/enable_key_rotation = var\.enable_key_rotation/g),
    ).toHaveLength(1);
  });
});
