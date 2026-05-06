/**
 * Resolves the current AWS account ID + region using the standard
 * AWS SDK credential + config chain (same chain CDK uses).
 */
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
  NODE_REGION_CONFIG_FILE_OPTIONS,
  NODE_REGION_CONFIG_OPTIONS,
} from '@smithy/config-resolver';
import { loadConfig } from '@smithy/node-config-provider';

export interface AwsConfig {
  accountId: string;
  region: string;
}

export async function resolveAwsConfig(): Promise<AwsConfig> {
  const region = await loadConfig(
    NODE_REGION_CONFIG_OPTIONS,
    NODE_REGION_CONFIG_FILE_OPTIONS,
  )();
  if (!region) {
    throw new Error(
      'Unable to resolve AWS region. Set the `AWS_REGION` environment variable or configure a default region via `aws configure`.',
    );
  }

  const sts = new STSClient({
    region,
    credentials: fromNodeProviderChain(),
  });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Account) {
    throw new Error(
      'Unable to resolve AWS account ID — no credentials found in the default provider chain.',
    );
  }

  return { accountId: identity.Account, region };
}
