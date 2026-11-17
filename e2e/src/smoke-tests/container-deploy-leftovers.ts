/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CloudFormation,
  paginateListStackResources,
  paginateListStacks,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { createAwsClient, getRegion } from './deploy-invocations';

/**
 * Checks, after a deploy test's destroy, that nothing the test created is
 * still in the account. A destroy that fails, or skips a resource, otherwise
 * goes unnoticed: the test only logs the failure, and the resource keeps
 * costing money and counting towards quotas until someone deletes it by hand.
 *
 * Every check only reads (describe, get, list and `terraform state list`);
 * deleting what is found is left to a person, who can see why it was left.
 *
 * Each `find*` function returns one line per resource still present, or per
 * resource whose deletion could not be confirmed. An empty list means the
 * account is clean.
 */

/**
 * Resources whose deletion the checks confirm with the owning service, by id.
 * The CloudFormation and Terraform checks below cover everything else the
 * test deploys (VPC, ECS clusters and services, roles, log groups, security
 * groups, ...).
 */
export interface DeployedResourceIds {
  tableNames: string[];
  bucketNames: string[];
  appConfigApplicationIds: string[];
  /** Identifiers or ARNs of Aurora clusters. */
  dbClusterIds: string[];
  /** ARNs of Secrets Manager secrets (the Aurora admin secret). */
  secretIds: string[];
}

export const emptyResourceIds = (): DeployedResourceIds => ({
  tableNames: [],
  bucketNames: [],
  appConfigApplicationIds: [],
  dbClusterIds: [],
  secretIds: [],
});

/** The CloudFormation resource types whose physical id goes in each list. */
const CFN_RESOURCE_TYPES: Record<string, keyof DeployedResourceIds> = {
  'AWS::DynamoDB::Table': 'tableNames',
  'AWS::DynamoDB::GlobalTable': 'tableNames',
  'AWS::S3::Bucket': 'bucketNames',
  'AWS::AppConfig::Application': 'appConfigApplicationIds',
  'AWS::RDS::DBCluster': 'dbClusterIds',
  'AWS::SecretsManager::Secret': 'secretIds',
};

const listCfnStackResources = async (cfn: CloudFormation, stackId: string) => {
  const resources = [];
  for await (const page of paginateListStackResources(
    { client: cfn },
    { StackName: stackId },
  )) {
    resources.push(...(page.StackResourceSummaries ?? []));
  }
  return resources;
};

/** Stacks that are not deleted and whose name starts with `stageName`. */
const listLiveCdkStacks = async (cfn: CloudFormation, stageName: string) => {
  const stacks = [];
  for await (const page of paginateListStacks(
    { client: cfn },
    {
      StackStatusFilter: Object.values(StackStatus).filter(
        (s) => s !== StackStatus.DELETE_COMPLETE,
      ),
    },
  )) {
    stacks.push(
      ...(page.StackSummaries ?? []).filter((s) =>
        s.StackName?.startsWith(stageName),
      ),
    );
  }
  return stacks;
};

/**
 * The ids of a CDK stage's stacks, and of the resources in them that
 * `findLeftoverResources` checks. Call it before destroy: a deleted stack can
 * only be looked up by its id.
 */
export async function describeCdkStage(stageName: string): Promise<{
  stackIds: string[];
  resourceIds: DeployedResourceIds;
}> {
  const cfn = new CloudFormation({ region: getRegion() });
  const stackIds: string[] = [];
  const resourceIds = emptyResourceIds();
  for (const stack of await listLiveCdkStacks(cfn, stageName)) {
    if (!stack.StackId) {
      continue;
    }
    stackIds.push(stack.StackId);
    for (const resource of await listCfnStackResources(cfn, stack.StackId)) {
      const list = CFN_RESOURCE_TYPES[resource.ResourceType ?? ''];
      if (list && resource.PhysicalResourceId) {
        resourceIds[list].push(resource.PhysicalResourceId);
      }
    }
  }
  return { stackIds, resourceIds };
}

/**
 * CloudFormation leftovers of a CDK deploy: any stack whose name starts with
 * the stage name and is not deleted, and any resource of a deleted stack that
 * is not `DELETE_COMPLETE` (for example `DELETE_SKIPPED`, which a retain
 * removal policy leaves behind).
 */
export async function findLeftoverCdkStacks(
  stageName: string,
  stackIds: string[],
): Promise<string[]> {
  const cfn = new CloudFormation({ region: getRegion() });
  const leftovers = (await listLiveCdkStacks(cfn, stageName)).map(
    (stack) => `CloudFormation stack ${stack.StackName} (${stack.StackStatus})`,
  );
  for (const stackId of stackIds) {
    for (const resource of await listCfnStackResources(cfn, stackId)) {
      if (resource.ResourceStatus !== 'DELETE_COMPLETE') {
        leftovers.push(
          `${resource.ResourceType} ${resource.PhysicalResourceId ?? resource.LogicalResourceId} in stack ${stackId} (${resource.ResourceStatus})`,
        );
      }
    }
  }
  return leftovers;
}

/**
 * Terraform leftovers: every resource still in the state of the root module
 * in `infraSrcDir`, from `terraform state list`. Skipped when the module was
 * never initialised, since then nothing was applied.
 */
export function findLeftoverTerraformState(infraSrcDir: string): string[] {
  if (!existsSync(join(infraSrcDir, '.terraform'))) {
    return [];
  }
  try {
    return execSync('terraform state list', {
      cwd: infraSrcDir,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((address) => `Terraform state still holds ${address}`);
  } catch (e) {
    return [`Could not read the Terraform state in ${infraSrcDir}: ${e}`];
  }
}

/** Whether a resource still exists, from the owning service's answer. */
type Existence = 'exists' | 'deleted' | `unknown: ${string}`;

/**
 * Calls an AWS JSON-protocol `Describe*` action with SigV4. `ResourceNotFound`
 * means deleted; `isDeleting` lets a resource that is being deleted count as
 * deleted.
 */
const describeJson = async (
  service: string,
  target: string,
  contentType: string,
  body: Record<string, string>,
  isDeleting: (body: unknown) => boolean = () => false,
): Promise<Existence> => {
  const aws = await createAwsClient(service);
  const response = await aws.fetch(
    `https://${service}.${getRegion()}.amazonaws.com/`,
    {
      method: 'POST',
      headers: { 'X-Amz-Target': target, 'Content-Type': contentType },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  if (response.status === 200) {
    return isDeleting(JSON.parse(text)) ? 'deleted' : 'exists';
  }
  if (response.status === 400 && text.includes('ResourceNotFoundException')) {
    return 'deleted';
  }
  return `unknown: HTTP ${response.status} ${text.slice(0, 200)}`;
};

/** Calls an AWS REST-protocol read with SigV4. 404 means deleted. */
const describeRest = async (
  signingService: string,
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
  isDeleting: (body: unknown) => boolean = () => false,
): Promise<Existence> => {
  const aws = await createAwsClient(signingService);
  const response = await aws.fetch(url, { method });
  const text = method === 'HEAD' ? '' : await response.text();
  if (response.status === 404) {
    return 'deleted';
  }
  if (response.status === 200) {
    return text && isDeleting(JSON.parse(text)) ? 'deleted' : 'exists';
  }
  // S3 answers 403 or 301 for a bucket that exists but is not readable here.
  if (method === 'HEAD' && [301, 403].includes(response.status)) {
    return 'exists';
  }
  return `unknown: HTTP ${response.status} ${text.slice(0, 200)}`;
};

/**
 * Asks RDS, a query-protocol API, whether an Aurora cluster exists.
 * `DBClusterNotFoundFault` means deleted, and so does a cluster that is being
 * deleted.
 */
const describeDbCluster = async (idOrArn: string): Promise<Existence> => {
  const aws = await createAwsClient('rds');
  const query = new URLSearchParams({
    Action: 'DescribeDBClusters',
    DBClusterIdentifier: idOrArn,
    Version: '2014-10-31',
  });
  const response = await aws.fetch(
    `https://rds.${getRegion()}.amazonaws.com/?${query}`,
  );
  const text = await response.text();
  if (response.status === 200) {
    return /<Status>deleting<\/Status>/.test(text) ? 'deleted' : 'exists';
  }
  if (response.status === 404 && text.includes('DBClusterNotFoundFault')) {
    return 'deleted';
  }
  return `unknown: HTTP ${response.status} ${text.slice(0, 200)}`;
};

/** One check per resource id, labelled for the failure message. */
const probes = (ids: DeployedResourceIds) => {
  const region = getRegion();
  return [
    ...ids.tableNames.map((name) => ({
      label: `DynamoDB table ${name}`,
      check: () =>
        describeJson(
          'dynamodb',
          'DynamoDB_20120810.DescribeTable',
          'application/x-amz-json-1.0',
          { TableName: name },
          (body) =>
            (body as { Table?: { TableStatus?: string } }).Table
              ?.TableStatus === 'DELETING',
        ),
    })),
    ...ids.bucketNames.map((name) => ({
      label: `S3 bucket ${name}`,
      check: () =>
        describeRest(
          's3',
          `https://${name}.s3.${region}.amazonaws.com/`,
          'HEAD',
        ),
    })),
    ...ids.appConfigApplicationIds.map((id) => ({
      label: `AppConfig application ${id}`,
      check: () =>
        describeRest(
          'appconfig',
          `https://appconfig.${region}.amazonaws.com/applications/${encodeURIComponent(id)}`,
        ),
    })),
    ...ids.dbClusterIds.map((id) => ({
      label: `Aurora cluster ${id}`,
      check: () => describeDbCluster(id),
    })),
    // A deleted secret stays describable, with a DeletedDate, until its
    // recovery window ends.
    ...ids.secretIds.map((id) => ({
      label: `Secrets Manager secret ${id}`,
      check: () =>
        describeJson(
          'secretsmanager',
          'secretsmanager.DescribeSecret',
          'application/x-amz-json-1.1',
          { SecretId: id },
          (body) => (body as { DeletedDate?: unknown }).DeletedDate != null,
        ),
    })),
  ];
};

/**
 * Asks each resource's own service whether it still exists. A resource the
 * service still reports is checked twice more, 20 seconds apart, since a
 * deletion can take a moment to show in describe calls.
 */
export async function findLeftoverResources(
  ids: DeployedResourceIds,
): Promise<string[]> {
  const leftovers: string[] = [];
  for (const { label, check } of probes(ids)) {
    let result: Existence = await check();
    for (let attempt = 2; attempt <= 3 && result !== 'deleted'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      result = await check();
    }
    if (result === 'exists') {
      leftovers.push(`${label} still exists`);
    } else if (result !== 'deleted') {
      leftovers.push(`${label}: could not confirm it was deleted (${result})`);
    }
  }
  return leftovers;
}

/**
 * Fails the test when anything was left behind. When the test had already
 * failed, that error is named in the message (and kept as its cause), so the
 * leftover failure does not hide why the test failed.
 */
export function assertNoLeftovers(leftovers: string[], testError?: unknown) {
  if (leftovers.length === 0) {
    console.log('No resources left behind after destroy');
    return;
  }
  const earlier = testError
    ? `\n\nThe test had already failed before destroy: ${testError}`
    : '';
  throw new Error(
    `Resources left behind after destroy; delete them by hand:\n- ${leftovers.join('\n- ')}${earlier}`,
    { cause: testError },
  );
}
