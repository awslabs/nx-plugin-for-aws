/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  DescribeSecurityGroupsCommand,
  type DescribeSecurityGroupsCommandOutput,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  DescribeServicesCommand,
  type DescribeServicesCommandOutput,
  ECSClient,
} from '@aws-sdk/client-ecs';
import {
  DescribeLoadBalancersCommand,
  type DescribeLoadBalancersCommandOutput,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { getRegion } from './deploy-invocations';

/**
 * The private-network checks the api-ecs-deploy test makes on each deployed
 * ECS-hosted API, with read-only describe calls.
 *
 * The two invocations the test makes both go to the API Gateway URL, so they
 * pass whether or not the load balancer is internet-facing, whether or not the
 * tasks have a public IP, and whatever the service's security group admits.
 * Those three properties are asserted at synth time in the plugin's own specs;
 * these checks assert them against what CloudFormation actually created.
 *
 * `container-deploy`'s `assertContainerServiceIsPrivate` cannot be reused:
 * it requires the service to have no load balancer and no inbound rule, and an
 * ECS-hosted API has one of each by design. The shape of the checks, and the
 * polling that waits for a running task, follow it.
 */

/** What the test reads from a deployed stack for one ECS-hosted API. */
export interface DeployedEcsHostedApi {
  /** Name used in failure messages, for example `MyApi`. */
  label: string;
  loadBalancerArn: string;
  clusterArn: string;
  serviceName: string;
  /** The security group on the API's Fargate tasks. */
  serviceSecurityGroupId: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What is wrong with the deployed request path. Pure, so the shape of each
 * check is readable without a deployed stack.
 *
 * Three things must hold: the load balancer has no public address, the tasks
 * have no public IP, and the only way into a task is from the load balancer.
 */
export function privateRequestPathProblems(
  api: DeployedEcsHostedApi,
  loadBalancers: Pick<DescribeLoadBalancersCommandOutput, 'LoadBalancers'>,
  services: Pick<DescribeServicesCommandOutput, 'services' | 'failures'>,
  securityGroups: Pick<DescribeSecurityGroupsCommandOutput, 'SecurityGroups'>,
): string[] {
  const problems: string[] = [];

  const loadBalancer = (loadBalancers.LoadBalancers ?? []).find(
    (lb) => lb.LoadBalancerArn === api.loadBalancerArn,
  );
  if (!loadBalancer) {
    problems.push(`load balancer ${api.loadBalancerArn} not found`);
  } else if (loadBalancer.Scheme !== 'internal') {
    problems.push(
      `load balancer scheme is ${loadBalancer.Scheme}, expected internal`,
    );
  }

  const ecsService = (services.services ?? []).find(
    (s) => s.serviceName === api.serviceName,
  );
  if (!ecsService) {
    const reasons = (services.failures ?? [])
      .map((f) => f.reason)
      .filter(Boolean)
      .join(', ');
    problems.push(
      `service ${api.serviceName} not found${reasons ? ` (${reasons})` : ''}`,
    );
  } else {
    if ((ecsService.runningCount ?? 0) < 1) {
      problems.push(
        `running count is ${ecsService.runningCount ?? 0}, expected at least 1`,
      );
    }
    const assignPublicIp =
      ecsService.networkConfiguration?.awsvpcConfiguration?.assignPublicIp;
    if (assignPublicIp !== 'DISABLED') {
      problems.push(`assignPublicIp is ${assignPublicIp}, expected DISABLED`);
    }
  }

  const group = (securityGroups.SecurityGroups ?? []).find(
    (g) => g.GroupId === api.serviceSecurityGroupId,
  );
  if (!group) {
    problems.push(`security group ${api.serviceSecurityGroupId} not found`);
  } else {
    const inbound = group.IpPermissions ?? [];
    if (inbound.length !== 1) {
      problems.push(
        `service security group has ${inbound.length} inbound rules, expected 1: ${JSON.stringify(inbound)}`,
      );
    }
    // The one rule names the load balancer's security group and nothing else.
    // An address range here would make the tasks reachable from more of the
    // VPC than the request path needs.
    for (const rule of inbound) {
      const sources = (rule.UserIdGroupPairs ?? []).flatMap((pair) =>
        pair.GroupId ? [pair.GroupId] : [],
      );
      const loadBalancerGroups = loadBalancer?.SecurityGroups ?? [];
      if (sources.length !== 1 || !loadBalancerGroups.includes(sources[0])) {
        problems.push(
          `inbound rule sources are ${JSON.stringify(sources)}, expected one of the load balancer's groups ${JSON.stringify(loadBalancerGroups)}`,
        );
      }
      if ((rule.IpRanges ?? []).length > 0) {
        problems.push(
          `inbound rule allows IPv4 ranges: ${JSON.stringify(rule.IpRanges)}`,
        );
      }
      if ((rule.Ipv6Ranges ?? []).length > 0) {
        problems.push(
          `inbound rule allows IPv6 ranges: ${JSON.stringify(rule.Ipv6Ranges)}`,
        );
      }
    }
  }

  return problems;
}

/**
 * Waits up to 5 minutes for the service to run a task, then checks the
 * deployed request path is private: the load balancer is `internal`, the
 * tasks get no public IP, and the service's security group has exactly one
 * inbound rule, from the load balancer's own security group.
 */
export async function assertEcsHostedApiPathIsPrivate(
  api: DeployedEcsHostedApi,
  { timeoutMs = 5 * 60_000, intervalMs = 15_000 }: WaitOptions = {},
): Promise<void> {
  const region = getRegion();
  const ecs = new ECSClient({ region });
  const ec2 = new EC2Client({ region });
  const elbv2 = new ElasticLoadBalancingV2Client({ region });

  const describeServices = () =>
    ecs.send(
      new DescribeServicesCommand({
        cluster: api.clusterArn,
        services: [api.serviceName],
      }),
    );

  let services = await describeServices();
  const deadline = Date.now() + timeoutMs;
  while (
    (services.services?.find((s) => s.serviceName === api.serviceName)
      ?.runningCount ?? 0) < 1 &&
    Date.now() + intervalMs <= deadline
  ) {
    await sleep(intervalMs);
    services = await describeServices();
  }

  const [loadBalancers, securityGroups] = await Promise.all([
    elbv2.send(
      new DescribeLoadBalancersCommand({
        LoadBalancerArns: [api.loadBalancerArn],
      }),
    ),
    ec2.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: [api.serviceSecurityGroupId],
      }),
    ),
  ]);

  const problems = privateRequestPathProblems(
    api,
    loadBalancers,
    services,
    securityGroups,
  );
  if (problems.length > 0) {
    throw new Error(
      `${api.label} (${api.serviceName}) request path is not private:\n- ${problems.join('\n- ')}`,
    );
  }
  console.log(
    `${api.label} (${api.serviceName}) request path is private: internal load balancer, no public task IP, one inbound rule from the load balancer`,
  );
}
