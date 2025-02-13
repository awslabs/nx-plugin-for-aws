import { AwsClient } from 'aws4fetch';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const credentialProvider = fromNodeProviderChain();

export const sigv4Fetch = (async (...args) => {
  const client = new AwsClient(await credentialProvider());
  return client.fetch(...args);
}) satisfies AwsClient['fetch'];
