/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeSecurityGroupsCommand,
  type DescribeSecurityGroupsCommandOutput,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  DescribeServicesCommand,
  type DescribeServicesCommandOutput,
  DescribeTasksCommand,
  type DescribeTasksCommandOutput,
  ECSClient,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import { getRegion } from './deploy-invocations';

/**
 * Checks the container-deploy test makes on its deployed container services.
 * A service has no load balancer and its security group admits nothing, so
 * the test cannot call it. Instead each service runs its own data connection
 * checks at startup and logs one `E2E_CHECK {...}` line per check, and the
 * test reads those lines from the service's log group. The test also checks,
 * with read-only describe calls, that the service is running, private and
 * healthy.
 */

/** What the test reads from a deployed stack for one container service. */
export interface DeployedContainerService {
  /** Name used in failure messages, for example `TsService`. */
  label: string;
  clusterArn: string;
  serviceName: string;
  securityGroupId: string;
  logGroupName: string;
  /** The `check` values the service must log `ok: true` for. */
  expectedChecks: string[];
}

/** One `E2E_CHECK {...}` line a service logs. */
export interface E2eCheckLine {
  check: string;
  token: string;
  ok: boolean;
  detail?: string;
}

/** Poll timing; the defaults suit a real deploy. */
export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const E2E_CHECK_PREFIX = 'E2E_CHECK ';

/** The check a log message holds, or `undefined` for any other message. */
export function parseE2eCheckLine(message: string): E2eCheckLine | undefined {
  const start = message.indexOf(E2E_CHECK_PREFIX);
  if (start < 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(
      message.slice(start + E2E_CHECK_PREFIX.length),
    ) as Partial<E2eCheckLine>;
    if (
      typeof parsed.check !== 'string' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.ok !== 'boolean'
    ) {
      return undefined;
    }
    return {
      check: parsed.check,
      token: parsed.token,
      ok: parsed.ok,
      ...(typeof parsed.detail === 'string' ? { detail: parsed.detail } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * What is wrong with a service's posture: it must run at least one task,
 * have no load balancer and no public IP, and its security group must have
 * no inbound permissions.
 */
export function servicePostureProblems(
  service: DeployedContainerService,
  services: Pick<DescribeServicesCommandOutput, 'services' | 'failures'>,
  securityGroups: Pick<DescribeSecurityGroupsCommandOutput, 'SecurityGroups'>,
): string[] {
  const problems: string[] = [];
  const ecsService = services.services?.find(
    (s) => s.serviceName === service.serviceName,
  );
  if (!ecsService) {
    const reasons = (services.failures ?? [])
      .map((f) => f.reason)
      .filter(Boolean)
      .join(', ');
    problems.push(
      `service ${service.serviceName} not found${reasons ? ` (${reasons})` : ''}`,
    );
  } else {
    if ((ecsService.runningCount ?? 0) < 1) {
      problems.push(
        `running count is ${ecsService.runningCount ?? 0}, expected at least 1`,
      );
    }
    const loadBalancers = ecsService.loadBalancers ?? [];
    if (loadBalancers.length > 0) {
      problems.push(
        `has ${loadBalancers.length} load balancer(s): ${loadBalancers
          .map((lb) => lb.targetGroupArn ?? lb.loadBalancerName)
          .join(', ')}`,
      );
    }
    const assignPublicIp =
      ecsService.networkConfiguration?.awsvpcConfiguration?.assignPublicIp;
    if (assignPublicIp !== 'DISABLED') {
      problems.push(`assignPublicIp is ${assignPublicIp}, expected DISABLED`);
    }
  }
  const group = securityGroups.SecurityGroups?.find(
    (g) => g.GroupId === service.securityGroupId,
  );
  if (!group) {
    problems.push(`security group ${service.securityGroupId} not found`);
  } else if ((group.IpPermissions ?? []).length > 0) {
    problems.push(
      `security group ${service.securityGroupId} has inbound permissions: ${JSON.stringify(group.IpPermissions)}`,
    );
  }
  return problems;
}

/** What is wrong with a service's tasks: every container must be `HEALTHY`. */
export function taskHealthProblems(
  tasks: Pick<DescribeTasksCommandOutput, 'tasks'>,
): string[] {
  if (!tasks.tasks?.length) {
    return ['no running task'];
  }
  return tasks.tasks.flatMap((task) =>
    (task.containers ?? [])
      .filter((container) => container.healthStatus !== 'HEALTHY')
      .map(
        (container) =>
          `task ${task.taskArn} container ${container.name} is ${container.healthStatus}`,
      ),
  );
}

/**
 * Compares a service's `E2E_CHECK` lines with the checks it must pass. Only
 * lines with this run's token count. A check with an `ok: false` line has
 * failed; a check with no `ok: true` line is missing.
 */
export function e2eCheckProblems(
  lines: E2eCheckLine[],
  expectedChecks: string[],
  token: string,
): { failed: string[]; missing: string[] } {
  const thisRun = lines.filter((line) => line.token === token);
  return {
    failed: thisRun
      .filter((line) => !line.ok)
      .map((line) => `${line.check}: ${line.detail ?? 'no detail'}`),
    missing: expectedChecks.filter(
      (check) => !thisRun.some((line) => line.ok && line.check === check),
    ),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls `attempt` until it returns no problem or `timeoutMs` passes, and
 * returns the last attempt's problems.
 */
async function poll(
  attempt: () => Promise<string[]>,
  { timeoutMs, intervalMs }: Required<WaitOptions>,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const problems = await attempt();
    if (problems.length === 0 || Date.now() + intervalMs > deadline) {
      return problems;
    }
    await sleep(intervalMs);
  }
}

const describeName = (service: DeployedContainerService) =>
  `${service.label} (${service.serviceName})`;

const fail = (
  service: DeployedContainerService,
  what: string,
  problems: string[],
): never => {
  throw new Error(
    `${describeName(service)} ${what}:\n- ${problems.join('\n- ')}`,
  );
};

/**
 * Waits up to 5 minutes for the service to run a task, then checks it has
 * no load balancer, no public IP and no inbound rule on its security group.
 */
export async function assertContainerServiceIsPrivate(
  service: DeployedContainerService,
  { timeoutMs = 5 * 60_000, intervalMs = 15_000 }: WaitOptions = {},
): Promise<void> {
  const ecs = new ECSClient({ region: getRegion() });
  const ec2 = new EC2Client({ region: getRegion() });
  let services: DescribeServicesCommandOutput | undefined;
  await poll(
    async () => {
      services = await ecs.send(
        new DescribeServicesCommand({
          cluster: service.clusterArn,
          services: [service.serviceName],
        }),
      );
      const running = services.services?.find(
        (s) => s.serviceName === service.serviceName,
      )?.runningCount;
      return (running ?? 0) >= 1 ? [] : ['no running task yet'];
    },
    { timeoutMs, intervalMs },
  );
  const securityGroups = await ec2.send(
    new DescribeSecurityGroupsCommand({ GroupIds: [service.securityGroupId] }),
  );
  const problems = servicePostureProblems(
    service,
    services ?? {},
    securityGroups,
  );
  if (problems.length > 0) {
    fail(service, 'is not a running private service', problems);
  }
  console.log(
    `${describeName(service)} runs privately: no load balancer, no public IP, no inbound rule`,
  );
}

/** Waits up to 5 minutes for every container of every running task to be `HEALTHY`. */
export async function waitForHealthyTasks(
  service: DeployedContainerService,
  { timeoutMs = 5 * 60_000, intervalMs = 15_000 }: WaitOptions = {},
): Promise<void> {
  const ecs = new ECSClient({ region: getRegion() });
  const problems = await poll(
    async () => {
      const { taskArns } = await ecs.send(
        new ListTasksCommand({
          cluster: service.clusterArn,
          serviceName: service.serviceName,
          desiredStatus: 'RUNNING',
        }),
      );
      if (!taskArns?.length) {
        return taskHealthProblems({ tasks: [] });
      }
      return taskHealthProblems(
        await ecs.send(
          new DescribeTasksCommand({
            cluster: service.clusterArn,
            tasks: taskArns,
          }),
        ),
      );
    },
    { timeoutMs, intervalMs },
  );
  if (problems.length > 0) {
    fail(service, 'tasks are not healthy', problems);
  }
  console.log(`${describeName(service)} tasks are healthy`);
}

/** Every `E2E_CHECK` line in the log group since `sinceMs`. */
async function readE2eCheckLines(
  logs: CloudWatchLogsClient,
  logGroupName: string,
  sinceMs: number,
): Promise<E2eCheckLine[]> {
  const lines: E2eCheckLine[] = [];
  let nextToken: string | undefined;
  do {
    const page = await logs.send(
      new FilterLogEventsCommand({
        logGroupName,
        filterPattern: '"E2E_CHECK"',
        startTime: sinceMs,
        nextToken,
      }),
    );
    for (const event of page.events ?? []) {
      const line = parseE2eCheckLine(event.message ?? '');
      if (line) {
        lines.push(line);
      }
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return lines;
}

/**
 * Waits up to 10 minutes for the service to log an `ok: true` line with this
 * run's token for every expected check. Fails at once on an `ok: false`
 * line, with the detail the service logged.
 */
export async function waitForE2eChecks(
  service: DeployedContainerService,
  token: string,
  sinceMs: number,
  { timeoutMs = 10 * 60_000, intervalMs = 20_000 }: WaitOptions = {},
): Promise<void> {
  const logs = new CloudWatchLogsClient({ region: getRegion() });
  let failed: string[] = [];
  const missing = await poll(
    async () => {
      const result = e2eCheckProblems(
        await readE2eCheckLines(logs, service.logGroupName, sinceMs),
        service.expectedChecks,
        token,
      );
      failed = result.failed;
      // A failed check ends the wait.
      return failed.length > 0 ? [] : result.missing;
    },
    { timeoutMs, intervalMs },
  );
  if (failed.length > 0) {
    fail(service, 'startup checks failed', failed);
  }
  if (missing.length > 0) {
    throw new Error(
      `${describeName(service)} logged no passing startup check with this run's token for: ${missing.join(', ')}`,
    );
  }
  console.log(
    `${describeName(service)} passed its startup checks: ${service.expectedChecks.join(', ')}`,
  );
}
