/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { AwsClient } from 'aws4fetch';
import { createAwsClient, getRegion } from './deploy-invocations';
import type { CognitoLogin } from './website-integration';

/**
 * Calls the container-deploy test makes to its deployed container services,
 * and to the agents that call them. Each call checks a value that only the
 * connected resource can produce, so a 200 alone never passes.
 */

const normalizeUrl = (url: string): string => url.replace(/\/$/, '');

/**
 * Calls a `ts#container` or `py#container` service through its HTTP API with
 * a SigV4 client (`auth: iam`). Retries only 503 and 504, which API Gateway
 * returns while the VPC link or target group is still settling, and returns
 * the first other response.
 */
async function fetchContainerService(
  aws: AwsClient,
  url: string,
  serviceName: string,
  init?: RequestInit,
): Promise<Response> {
  const maxAttempts = 8;
  console.log(`Testing ${serviceName} at ${url}`);
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    const response = await aws.fetch(url, init);
    if (![503, 504].includes(response.status)) {
      return response;
    }
    console.log(
      `${serviceName} returned ${response.status}; retrying in 15s (attempt ${attempt} of ${maxAttempts})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  return aws.fetch(url, init);
}

/** Calls `path` on a service and returns the parsed JSON body of a 200. */
async function callContainerService(
  aws: AwsClient,
  serviceUrl: string,
  path: string,
  label: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchContainerService(
    aws,
    `${normalizeUrl(serviceUrl)}${path}`,
    label,
    init,
  );
  const body = await response.text();
  console.log(`${label} response:`, response.status, body);
  expect(response.status, `${label} status`).toBe(200);
  return JSON.parse(body);
}

/** A fresh value per call, so a check never passes on an earlier write. */
const uniqueToken = (): string =>
  `e2e-${Math.random().toString(36).substring(2, 10)}`;

/**
 * A SigV4 client holding a signed-in website user's AWS credentials, obtained
 * the way the website's vended `useSigV4` hook obtains them: the user's ID
 * token is exchanged at the identity pool for the authenticated role's
 * credentials. The test signs in with the user's password instead of the
 * hosted UI, so no browser is needed. Requests it signs are allowed only what
 * the authenticated role is granted.
 */
export const createWebsiteUserAwsClient = async (
  login: CognitoLogin,
  identityPoolId: string,
): Promise<AwsClient> => {
  const region = getRegion();
  const client = new CognitoIdentityProviderClient({ region });
  const { AuthenticationResult } = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: login.userPoolWebClientId,
      AuthParameters: { USERNAME: login.username, PASSWORD: login.password },
    }),
  );
  if (!AuthenticationResult?.IdToken) {
    throw new Error(
      `Cognito sign-in for ${login.username} returned no ID token`,
    );
  }
  const credentials = await fromCognitoIdentityPool({
    clientConfig: { region },
    identityPoolId,
    logins: {
      [`cognito-idp.${region}.amazonaws.com/${login.userPoolId}`]:
        AuthenticationResult.IdToken,
    },
  })();
  // As in useSigV4, the service and region are taken from each request's URL.
  return new AwsClient(credentials);
};

/**
 * The request the website's vended `use<Service>` hook makes for an `iam`
 * service, signed with a website user's credentials: `GET /hello?name=` on a
 * `ts#container` service or `GET /echo?message=` on a `py#container` service.
 * The reply must hold the value sent, and a 200 shows the stack granted the
 * identity pool's authenticated role invoke access to the service.
 */
export async function invokeContainerAsWebsiteUser(
  serviceUrl: string,
  serviceName: string,
  websiteUser: AwsClient,
  language: 'ts' | 'py',
): Promise<void> {
  const token = uniqueToken();
  const body = await callContainerService(
    websiteUser,
    serviceUrl,
    language === 'ts' ? `/hello?name=${token}` : `/echo?message=${token}`,
    `${serviceName} (as a website user)`,
  );
  expect(body).toEqual(
    language === 'ts' ? { message: `Hello, ${token}!` } : { message: token },
  );
}

/**
 * `PUT /items/<id>` on a container service, whose route the test adds: it
 * writes one item with that id to the connected DynamoDB table and reads it
 * back. A reply with the same id shows the task role may write and read the
 * table, and that the service found the table's name in runtime
 * configuration.
 */
export async function invokeContainerDynamoDBItem(
  serviceUrl: string,
  serviceName: string,
): Promise<void> {
  const id = uniqueToken();
  const body = await callContainerService(
    await createAwsClient(),
    serviceUrl,
    `/items/${id}`,
    `${serviceName} (DynamoDB item)`,
    { method: 'PUT' },
  );
  expect(body).toMatchObject({ id });
}

/**
 * `PUT /rows/<value>` on a container service, whose route the test adds: it
 * inserts one row holding that value into the connected Aurora PostgreSQL
 * database through the vended client, then selects it by its new primary
 * key. A reply with the same value and a numeric id shows the service
 * reached the cluster, signed in as the database's IAM runtime user and that
 * the deploy-time migration created the table.
 */
export async function invokeContainerDatabaseRow(
  serviceUrl: string,
  serviceName: string,
): Promise<void> {
  const value = uniqueToken();
  const body = await callContainerService(
    await createAwsClient(),
    serviceUrl,
    `/rows/${value}`,
    `${serviceName} (database row)`,
    { method: 'PUT' },
  );
  expect(body).toMatchObject({ id: expect.any(Number), value });
}

/**
 * Asks a deployed agent to use one of its container tools, which calls
 * `GET /digest?message=` on a container service with the agent's own role.
 * The service returns the first 12 hex characters of the SHA-256 of a random
 * message, which the model cannot produce without the tool, so an answer
 * containing it shows the agent reached the service. A model may still
 * answer without using the tool, so each attempt uses a new session and the
 * check is retried.
 *
 * `invoke` sends one prompt in the given session and returns the answer, so
 * the same check serves HTTP (`py#agent`) and tRPC (`ts#agent`) agents.
 */
export async function invokeAgentCallingContainer(
  agentName: string,
  toolName: string,
  invoke: (prompt: string, sessionId: string) => Promise<string>,
): Promise<void> {
  const maxAttempts = 3;
  let answer = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const message = uniqueToken();
    const digest = createHash('sha256')
      .update(message)
      .digest('hex')
      .slice(0, 12);
    answer = await invoke(
      `Use your ${toolName} tool to get the digest of the message "${message}". Reply with only the digest.`,
      randomUUID(),
    );
    if (answer.includes(digest)) {
      console.log(`${agentName} returned the digest from ${toolName}`);
      return;
    }
    console.log(
      `${agentName} attempt ${attempt}/${maxAttempts} answered ${JSON.stringify(answer)} without the digest ${digest}`,
    );
  }
  throw new Error(
    `${agentName} never returned the digest from ${toolName}. Last answer: ${answer}`,
  );
}
