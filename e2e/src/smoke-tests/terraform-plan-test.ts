/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCLI } from '../utils';

/**
 * Validates the generated Terraform with a credential-free `terraform test`.
 *
 * `terraform validate` cannot catch plan-time graph errors (for example a
 * `for_each` over a value only known after apply), and a real `terraform plan`
 * of the generated stacks needs AWS credentials because the modules read
 * `data.aws_caller_identity`/`aws_region` (live STS calls). Terraform's native
 * test framework closes that gap: with every provider mocked, no network calls
 * are made and no credentials are required, yet `command = plan` still expands
 * the full module graph — so a plan-time error fails the test.
 *
 * The wiring is the same `main.tf` the terraform-deploy smoke test applies, so
 * this exercises the identical module graph without deploying anything.
 */
export const runTerraformPlanTest = async (opts: {
  cwd: string;
  env: Record<string, string>;
}) => {
  const infraSrc = join(opts.cwd, 'packages/infra/src');
  const rawOpts = {
    cwd: infraSrc,
    env: opts.env,
    prefixWithPackageManagerCmd: false,
  };

  // Wire every generated module together using the terraform-deploy template
  // (the maintained source of truth for module wiring). Plan never runs the
  // resources, so the TEST_RUN_ID placeholder just needs a static value.
  const mainTf = readFileSync(
    join(__dirname, '../files/terraform-deploy/main.tf.template'),
    'utf-8',
  ).replace(/<% TEST_RUN_ID %>/g, 'plantest');
  writeFileSync(join(infraSrc, 'main.tf'), mainTf);

  // `-backend=false` so `terraform init` doesn't try to configure the S3
  // backend (which would need credentials); the test framework keeps state
  // in memory anyway.
  await runCLI('terraform init -backend=false -no-color', rawOpts);

  // Mock exactly the providers this configuration requires — mocking a
  // provider the config doesn't require is an error, so read the set Terraform
  // resolved into the lock file rather than hardcoding it.
  const lock = readFileSync(join(infraSrc, '.terraform.lock.hcl'), 'utf-8');
  const providers = [
    ...new Set(
      [
        ...lock.matchAll(/provider "registry\.terraform\.io\/[^/]+\/([^"]+)"/g),
      ].map((m) => m[1]),
    ),
  ];

  // The aws mock is defined explicitly (both the default and the us-east-1
  // alias the website module needs for the CloudFront WAF). Pin the region,
  // account id and partition data sources to realistic values — an unmocked
  // provider returns random strings for these, which makes the ARNs built from
  // them (e.g. Lambda layer ARNs `arn:<partition>:lambda:<region>:...`) fail
  // plan-time ARN validation.
  const awsMockBody = `  mock_data "aws_region" {
    defaults = {
      id     = "us-east-1"
      region = "us-east-1"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }
  mock_data "aws_partition" {
    defaults = {
      partition      = "aws"
      dns_suffix     = "amazonaws.com"
      reverse_dns_prefix = "com.amazonaws"
    }
  }`;
  const mocks = [
    `mock_provider "aws" {\n${awsMockBody}\n}`,
    `mock_provider "aws" {\n  alias = "us_east_1"\n${awsMockBody}\n}`,
    ...providers
      .filter((p) => p !== 'aws')
      .map((p) => `mock_provider "${p}" {}`),
  ].join('\n');
  writeFileSync(
    join(infraSrc, 'plan.tftest.hcl'),
    `${mocks}\n\nvariables {\n  environment = "test"\n  aws_region  = "us-east-1"\n}\n\nrun "plan" {\n  command = plan\n}\n`,
  );

  await runCLI('terraform test -no-color', {
    ...rawOpts,
    redirectStderr: true,
  });
};
