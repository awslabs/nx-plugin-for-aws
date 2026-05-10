/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';

// Create the RDS service-linked role required by RDS Proxy if it doesn't exist yet.
// https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html
export function ensureRdsServiceLinkedRole(): void {
  try {
    execSync(
      'aws iam create-service-linked-role --aws-service-name rds.amazonaws.com',
      { stdio: 'pipe' },
    );
  } catch (e: unknown) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
    if (stderr.includes('has been taken in this account')) {
      return;
    }
    throw e;
  }
}
