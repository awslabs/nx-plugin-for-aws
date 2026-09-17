/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type RunCmdOpts, runCLI } from '../utils';

/**
 * Marker written to the log whenever `applyInfra` retries. Grep CI output for
 * it to see how often the race below is still being hit.
 */
export const APPLY_RETRY_MARKER = '[terraform-apply-retry]';

/**
 * CloudWatch Logs serialises changes to an account's delivery configuration.
 * The deploy stacks create a delivery source per agent, website and asset
 * bucket, all in parallel, and whichever `PutDeliverySource` call loses the
 * race is rejected with this error. The AWS provider does not retry it
 * (unlike `aws_cloudwatch_log_delivery`, fixed upstream in v6.52.0), so the
 * apply fails with most of the stack already created.
 */
const CONFLICT_PATTERN =
  /CloudWatch Logs: PutDeliverySource[\s\S]{0,400}?ConflictException: Requested resource is currently being updated/;

/**
 * True when an apply failure is the transient delivery-source race, which a
 * second apply resolves because Terraform only creates what is still missing.
 */
export const isTransientApplyFailure = (output: string): boolean =>
  CONFLICT_PATTERN.test(output);

const outputOf = (e: unknown): string => {
  const err = e as { stdout?: string; stderr?: string; message?: string };
  return `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`;
};

/**
 * Runs `nx apply infra`, re-running it when the failure is the transient
 * delivery-source race. Any other failure is rethrown immediately.
 */
export const applyInfra = async (
  opts: RunCmdOpts,
  maxAttempts = 3,
): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await runCLI('apply infra --output-style=stream', opts);
      return;
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientApplyFailure(outputOf(e))) {
        throw e;
      }
      console.log(
        `${APPLY_RETRY_MARKER} apply attempt ${attempt} of ${maxAttempts} hit the CloudWatch Logs delivery-source ConflictException; re-running apply`,
      );
    }
  }
};
