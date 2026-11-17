/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  CreateManagedLoginBrandingCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  CreateUserPoolDomainCommand,
  DeleteUserPoolCommand,
  DeleteUserPoolDomainCommand,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
  DescribeUserPoolDomainCommand,
  ListUserPoolsCommand,
  TagResourceCommand as TagUserPoolCommand,
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  SecretsManagerClient,
  TagResourceCommand as TagSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import type { IdpPlaceholderValues } from './idp-placeholders';

/**
 * An external OpenID Connect identity provider for the deploy smoke tests.
 *
 * The identity provider is a second Cognito user pool with one user. The
 * deployed main user pool registers it as `E2eIdp`, so the smoke test can sign
 * in to the website through it and check that federation works end to end.
 * Every resource is tagged, so `sweepTestIdps` can delete what a killed run
 * left behind.
 */

/** Provider name the wiring templates register on the main user pool. */
export const IDP_PROVIDER_NAME = 'E2eIdp';

/** Prefix of every identity provider pool, domain, client and secret name. */
const NAME_PREFIX = 'e2e-idp-';

/** Tag that marks a resource as created by this helper. */
const TAG_KEY = 'nx-plugin-e2e';
const TAG_VALUE = 'external-idp';

/**
 * Tag that holds the time, as an ISO 8601 string, until which `sweepTestIdps`
 * must keep a resource. `keepTestIdp` writes it when a destroy failed and the
 * identity provider has to survive for a retry.
 */
export const KEEP_UNTIL_TAG = 'keep-until';

/** How long `keepTestIdp` keeps a resource out of the sweep. */
const DEFAULT_KEEP_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * The longest a `keep-until` tag is honoured, with room for a retry that
 * writes a fresh deadline before the previous one expires.
 */
const MAX_KEEP_FOR_MS = 2 * DEFAULT_KEEP_FOR_MS;

/** OAuth scopes the main user pool requests from the identity provider. */
const OAUTH_SCOPES = ['openid', 'email', 'profile'];

/** Resources older than this are left over from an earlier run. */
const DEFAULT_SWEEP_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** Names of the identity provider resources of one test run. */
export interface TestIdpNames {
  userPoolName: string;
  domainPrefix: string;
  clientName: string;
  secretName: string;
}

/** The identity provider of one test run. Fields fill in as each resource is created. */
export interface TestIdp {
  testRunId: string;
  region: string;
  names: TestIdpNames;
  userPoolId?: string;
  /** Set before the domain is requested, so cleanup also runs when the request fails part-way. */
  domainCreated?: boolean;
  clientId?: string;
  /** Client secret of the identity provider app client. Never log it. */
  clientSecret?: string;
  secretArn?: string;
  issuerUrl?: string;
  /** Sign-in name of the identity provider user, which is its email. */
  username: string;
  password: string;
  email: string;
  givenName: string;
  familyName: string;
}

/** Options for the domain poll in `createTestIdp`. Tests pass a fake sleep. */
export interface DomainPollOptions {
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
}

/** Waits for the given time. */
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cognito client that retries throttling with the SDK standard retry. */
const cognitoClient = (region: string) =>
  new CognitoIdentityProviderClient({ region, maxAttempts: 8 });

/** Secrets Manager client that retries throttling with the SDK standard retry. */
const secretsClient = (region: string) =>
  new SecretsManagerClient({ region, maxAttempts: 8 });

/** True when the error means the resource does not exist. */
const isNotFound = (e: unknown): boolean =>
  (e as { name?: string })?.name === 'ResourceNotFoundException';

/** Error name and message only, so no request or response data is logged. */
const describeError = (e: unknown): string => {
  const err = e as { name?: string; message?: string };
  return `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`;
};

/** Tags of every resource of the given test run. */
const tagsFor = (testRunId: string): Record<string, string> => ({
  [TAG_KEY]: TAG_VALUE,
  'e2e-run': testRunId,
  'created-at': new Date().toISOString(),
});

/** Deterministic resource names of the given test run. */
export const testIdpNames = (testRunId: string): TestIdpNames => {
  const base = `${NAME_PREFIX}${testRunId}`;
  return {
    userPoolName: base,
    domainPrefix: base.toLowerCase(),
    clientName: base,
    secretName: `${base}-client-secret`,
  };
};

/**
 * A random password that meets the identity provider's password policy:
 * at least 16 characters with upper case, lower case, a digit and a symbol.
 */
const generatePassword = (): string =>
  `${randomBytes(18).toString('base64url')}Aa1!`;

/** A handle for the identity provider of a test run. Creates nothing yet. */
export const newTestIdp = (testRunId: string, region: string): TestIdp => {
  const names = testIdpNames(testRunId);
  const email = `${names.userPoolName}@example.com`;
  return {
    testRunId,
    region,
    names,
    username: email,
    password: generatePassword(),
    email,
    givenName: 'E2e',
    familyName: 'Federated',
  };
};

/** The template values that register this identity provider on the main user pool. */
export const testIdpPlaceholderValues = (
  idp: TestIdp,
): IdpPlaceholderValues => {
  if (!idp.issuerUrl || !idp.clientId) {
    throw new Error('The test identity provider has not been created');
  }
  return {
    issuerUrl: idp.issuerUrl,
    clientId: idp.clientId,
    clientSecretName: idp.names.secretName,
  };
};

/** Polls the identity provider domain until Cognito reports it active. */
const waitForDomainActive = async (
  client: CognitoIdentityProviderClient,
  domain: string,
  { sleep = defaultSleep, intervalMs = 10_000, timeoutMs = 600_000 } = {},
): Promise<void> => {
  const attempts = Math.ceil(timeoutMs / intervalMs);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { DomainDescription } = await client.send(
      new DescribeUserPoolDomainCommand({ Domain: domain }),
    );
    const status = DomainDescription?.Status;
    if (status === 'ACTIVE') {
      return;
    }
    if (status === 'FAILED') {
      throw new Error(`Identity provider domain ${domain} failed to create`);
    }
    console.log(
      `Waiting for identity provider domain ${domain} (status ${status ?? 'unknown'})`,
    );
    await sleep(intervalMs);
  }
  throw new Error(
    `Identity provider domain ${domain} was not active after ${timeoutMs / 1000}s`,
  );
};

/**
 * Creates the identity provider: a user pool with an app client, a managed
 * login domain and one confirmed user, plus the Secrets Manager secret that
 * holds the client secret. The app client has no OAuth flows yet, because the
 * main user pool's redirect URI is known only after deploy; see
 * `registerIdpCallback`. Fills `idp` as each resource is created, so
 * `deleteTestIdp` can clean up after a failure.
 */
export const createTestIdp = async (
  idp: TestIdp,
  poll: DomainPollOptions = {},
): Promise<void> => {
  const cognito = cognitoClient(idp.region);
  const tags = tagsFor(idp.testRunId);

  const { UserPool } = await cognito.send(
    new CreateUserPoolCommand({
      PoolName: idp.names.userPoolName,
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      MfaConfiguration: 'OFF',
      DeletionProtection: 'INACTIVE',
      Policies: {
        PasswordPolicy: {
          MinimumLength: 16,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 1,
        },
      },
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UserPoolTags: tags,
    }),
  );
  if (!UserPool?.Id) {
    throw new Error('CreateUserPool returned no user pool id');
  }
  idp.userPoolId = UserPool.Id;
  idp.issuerUrl = `https://cognito-idp.${idp.region}.amazonaws.com/${UserPool.Id}`;
  console.log(`Created identity provider user pool ${idp.userPoolId}`);

  const { UserPoolClient } = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: idp.userPoolId,
      ClientName: idp.names.clientName,
      GenerateSecret: true,
    }),
  );
  if (!UserPoolClient?.ClientId || !UserPoolClient.ClientSecret) {
    throw new Error('CreateUserPoolClient returned no client id or secret');
  }
  idp.clientId = UserPoolClient.ClientId;
  idp.clientSecret = UserPoolClient.ClientSecret;

  idp.domainCreated = true;
  await cognito.send(
    new CreateUserPoolDomainCommand({
      Domain: idp.names.domainPrefix,
      UserPoolId: idp.userPoolId,
      ManagedLoginVersion: 2,
    }),
  );

  // Managed login v2 shows an error page for a client without a style.
  await cognito.send(
    new CreateManagedLoginBrandingCommand({
      UserPoolId: idp.userPoolId,
      ClientId: idp.clientId,
      UseCognitoProvidedValues: true,
    }),
  );

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: idp.userPoolId,
      Username: idp.username,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: idp.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: idp.givenName },
        { Name: 'family_name', Value: idp.familyName },
      ],
    }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: idp.userPoolId,
      Username: idp.username,
      Password: idp.password,
      Permanent: true,
    }),
  );

  // The main user pool reads the whole SecretString as the client secret.
  const { ARN } = await secretsClient(idp.region).send(
    new CreateSecretCommand({
      Name: idp.names.secretName,
      SecretString: idp.clientSecret,
      Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
    }),
  );
  idp.secretArn = ARN;

  await waitForDomainActive(cognito, idp.names.domainPrefix, poll);
};

/**
 * Lets the identity provider app client redirect to the main user pool.
 * UpdateUserPoolClient resets every field it is not given, so this passes
 * them all again.
 */
export const registerIdpCallback = async (
  idp: TestIdp,
  redirectUri: string,
): Promise<void> => {
  await cognitoClient(idp.region).send(
    new UpdateUserPoolClientCommand({
      UserPoolId: idp.userPoolId,
      ClientId: idp.clientId,
      ClientName: idp.names.clientName,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: OAUTH_SCOPES,
      CallbackURLs: [redirectUri],
      SupportedIdentityProviders: ['COGNITO'],
    }),
  );
};

/**
 * Checks that the deployed main user pool registers the identity provider
 * with the values the vended CDK construct and Terraform module set, and that
 * the website's app client offers it. Compares one field at a time, so a
 * failure never prints the client secret in ProviderDetails.
 */
export const checkFederation = async (options: {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  idp: TestIdp;
}): Promise<void> => {
  const { region, userPoolId, userPoolClientId, idp } = options;
  const cognito = cognitoClient(region);

  const { IdentityProvider } = await cognito.send(
    new DescribeIdentityProviderCommand({
      UserPoolId: userPoolId,
      ProviderName: IDP_PROVIDER_NAME,
    }),
  );
  const details = IdentityProvider?.ProviderDetails ?? {};
  expect(IdentityProvider?.ProviderType).toBe('OIDC');
  expect(details.oidc_issuer).toBe(idp.issuerUrl);
  expect(details.client_id).toBe(idp.clientId);
  expect(details.authorize_scopes).toBe(OAUTH_SCOPES.join(' '));
  expect(details.attributes_request_method).toBe('GET');
  expect(IdentityProvider?.AttributeMapping).toMatchObject({
    email: 'email',
    given_name: 'given_name',
    family_name: 'family_name',
  });

  const { UserPoolClient } = await cognito.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientId: userPoolClientId,
    }),
  );
  expect(UserPoolClient?.SupportedIdentityProviders).toEqual(
    expect.arrayContaining(['COGNITO', IDP_PROVIDER_NAME]),
  );
};

/** Runs one cleanup step and logs its error instead of throwing. */
const cleanupStep = async (
  label: string,
  step: () => Promise<unknown>,
): Promise<void> => {
  try {
    await step();
    console.log(`Deleted ${label}`);
  } catch (e) {
    if (isNotFound(e)) {
      console.log(`${label} is already deleted`);
    } else {
      console.warn(`Failed to delete ${label}: ${describeError(e)}`);
    }
  }
};

/**
 * Deletes whatever `createTestIdp` created, even after a partial create.
 * Never throws, and is safe to call more than once. Each step runs even when
 * an earlier one fails.
 */
export const deleteTestIdp = async (idp: TestIdp): Promise<void> => {
  const cognito = cognitoClient(idp.region);
  await cleanupStep(`secret ${idp.names.secretName}`, () =>
    secretsClient(idp.region).send(
      new DeleteSecretCommand({
        SecretId: idp.names.secretName,
        ForceDeleteWithoutRecovery: true,
      }),
    ),
  );
  const userPoolId = idp.userPoolId;
  if (!userPoolId) {
    return;
  }
  if (idp.domainCreated) {
    await cleanupStep(`domain ${idp.names.domainPrefix}`, () =>
      cognito.send(
        new DeleteUserPoolDomainCommand({
          Domain: idp.names.domainPrefix,
          UserPoolId: userPoolId,
        }),
      ),
    );
  }
  await cleanupStep(`user pool ${userPoolId}`, () =>
    cognito.send(new DeleteUserPoolCommand({ UserPoolId: userPoolId })),
  );
};

/** The outcome of `keepTestIdp`. */
export interface KeptTestIdp {
  /** ISO time until which the sweep must keep the resources. */
  keepUntil: string;
  /** False when a tag could not be written, so the sweep may reclaim earlier. */
  tagged: boolean;
}

/**
 * Tags the identity provider's user pool and client secret with the time
 * until which `sweepTestIdps` must keep them. Call it when a stack that reads
 * the client secret could not be destroyed, so the destroy can be retried
 * instead of the next run's sweep taking the secret away. Never throws.
 */
export const keepTestIdp = async (
  idp: TestIdp,
  { keepForMs = DEFAULT_KEEP_FOR_MS, now = Date.now() } = {},
): Promise<KeptTestIdp> => {
  const keepUntil = new Date(now + keepForMs).toISOString();
  let tagged = true;
  const tagStep = async (label: string, step: () => Promise<unknown>) => {
    try {
      await step();
      console.log(`Tagged ${label} to keep until ${keepUntil}`);
    } catch (e) {
      if (isNotFound(e)) {
        // There is nothing left to keep, and nothing for an operator to
        // clean up either, so this is not a tagging failure.
        console.log(`${label} is already deleted, so there is nothing to keep`);
      } else {
        tagged = false;
        console.warn(`Failed to tag ${label}: ${describeError(e)}`);
      }
    }
  };

  await tagStep(`secret ${idp.names.secretName}`, () =>
    secretsClient(idp.region).send(
      // TagResource appends to the secret's existing tags, so the run and
      // created-at tags the sweep filters on are kept.
      new TagSecretCommand({
        SecretId: idp.names.secretName,
        Tags: [{ Key: KEEP_UNTIL_TAG, Value: keepUntil }],
      }),
    ),
  );
  const userPoolId = idp.userPoolId;
  if (userPoolId) {
    // Tagging a user pool needs its ARN, which only DescribeUserPool returns.
    await tagStep(`user pool ${userPoolId}`, async () => {
      const cognito = cognitoClient(idp.region);
      const { UserPool } = await cognito.send(
        new DescribeUserPoolCommand({ UserPoolId: userPoolId }),
      );
      if (!UserPool?.Arn) {
        throw new Error('DescribeUserPool returned no user pool ARN');
      }
      await cognito.send(
        // TagResource only adds or overwrites the keys it is given, unlike
        // UpdateUserPool's UserPoolTags, which replaces the whole set, so
        // the run and created-at tags the sweep filters on are kept.
        new TagUserPoolCommand({
          ResourceArn: UserPool.Arn,
          Tags: { [KEEP_UNTIL_TAG]: keepUntil },
        }),
      );
    });
  }
  return { keepUntil, tagged };
};

/** The age cutoff of one sweep, and the time it runs at. */
interface SweepWindow {
  /** Resources created at or after this time are left alone. */
  cutoff: number;
  /** Now, against which a `keep-until` tag is compared. */
  now: number;
}

/**
 * Whether a `keep-until` tag value protects a resource from this sweep. An
 * absent or unreadable value protects nothing, and so does one more than
 * `MAX_KEEP_FOR_MS` ahead of now: `keepTestIdp` never writes a deadline that
 * far out, and `Date.parse` accepts more than ISO 8601 (it reads `2099` as
 * 2099-01-01), so a hand-edited or mistyped tag cannot hold a user pool and
 * its secret out of the sweep for years.
 */
const isKept = (value: string | undefined, now: number): boolean => {
  const until = value ? Date.parse(value) : Number.NaN;
  return !Number.isNaN(until) && until > now && until - now <= MAX_KEEP_FOR_MS;
};

/** Deletes tagged identity provider user pools older than the cutoff. */
const sweepUserPools = async (
  cognito: CognitoIdentityProviderClient,
  { cutoff, now }: SweepWindow,
): Promise<void> => {
  let nextToken: string | undefined;
  do {
    const page = await cognito.send(
      new ListUserPoolsCommand({ MaxResults: 60, NextToken: nextToken }),
    );
    nextToken = page.NextToken;
    for (const { Id, Name } of page.UserPools ?? []) {
      if (!Id || !Name?.startsWith(NAME_PREFIX)) {
        continue;
      }
      try {
        const { UserPool } = await cognito.send(
          new DescribeUserPoolCommand({ UserPoolId: Id }),
        );
        const created = UserPool?.CreationDate?.getTime() ?? Date.now();
        if (
          UserPool?.UserPoolTags?.[TAG_KEY] !== TAG_VALUE ||
          created >= cutoff
        ) {
          continue;
        }
        const keepUntil = UserPool.UserPoolTags?.[KEEP_UNTIL_TAG];
        if (isKept(keepUntil, now)) {
          console.log(
            `Keeping identity provider user pool ${Id} until ${keepUntil}`,
          );
          continue;
        }
        console.log(`Sweeping left-over identity provider user pool ${Id}`);
        if (UserPool.Domain) {
          await cognito.send(
            new DeleteUserPoolDomainCommand({
              Domain: UserPool.Domain,
              UserPoolId: Id,
            }),
          );
        }
        await cognito.send(new DeleteUserPoolCommand({ UserPoolId: Id }));
      } catch (e) {
        console.warn(`Failed to sweep user pool ${Id}: ${describeError(e)}`);
      }
    }
  } while (nextToken);
};

/** Deletes tagged identity provider client secrets older than the cutoff. */
const sweepSecrets = async (
  secrets: SecretsManagerClient,
  { cutoff, now }: SweepWindow,
): Promise<void> => {
  let nextToken: string | undefined;
  do {
    const page = await secrets.send(
      new ListSecretsCommand({
        Filters: [
          { Key: 'tag-key', Values: [TAG_KEY] },
          { Key: 'tag-value', Values: [TAG_VALUE] },
          { Key: 'name', Values: [NAME_PREFIX] },
        ],
        NextToken: nextToken,
      }),
    );
    nextToken = page.NextToken;
    for (const { ARN, Name, Tags, CreatedDate } of page.SecretList ?? []) {
      const tagged = Tags?.some(
        (t) => t.Key === TAG_KEY && t.Value === TAG_VALUE,
      );
      const created = CreatedDate?.getTime() ?? Date.now();
      if (
        !ARN ||
        !Name?.startsWith(NAME_PREFIX) ||
        !tagged ||
        created >= cutoff
      ) {
        continue;
      }
      const keepUntil = Tags?.find((t) => t.Key === KEEP_UNTIL_TAG)?.Value;
      if (isKept(keepUntil, now)) {
        console.log(
          `Keeping identity provider secret ${Name} until ${keepUntil}`,
        );
        continue;
      }
      console.log(`Sweeping left-over identity provider secret ${Name}`);
      try {
        await secrets.send(
          new DeleteSecretCommand({
            SecretId: ARN,
            ForceDeleteWithoutRecovery: true,
          }),
        );
      } catch (e) {
        console.warn(`Failed to sweep secret ${Name}: ${describeError(e)}`);
      }
    }
  } while (nextToken);
};

/**
 * Deletes identity provider user pools and secrets that earlier runs left in
 * the region, for example when a run was killed before its cleanup. Deletes
 * only resources with the `e2e-idp-` name prefix and the `nx-plugin-e2e` tag
 * that are older than `maxAgeMs`, so a run in progress keeps its resources.
 * A resource whose `keep-until` tag is still in the future is left alone, and
 * swept by a later run once that time has passed. Never throws.
 */
export const sweepTestIdps = async (
  region: string,
  { maxAgeMs = DEFAULT_SWEEP_MAX_AGE_MS, now = Date.now() } = {},
): Promise<void> => {
  const sweepWindow: SweepWindow = { cutoff: now - maxAgeMs, now };
  try {
    await sweepUserPools(cognitoClient(region), sweepWindow);
  } catch (e) {
    console.warn(
      `Failed to sweep identity provider user pools: ${describeError(e)}`,
    );
  }
  try {
    await sweepSecrets(secretsClient(region), sweepWindow);
  } catch (e) {
    console.warn(
      `Failed to sweep identity provider secrets: ${describeError(e)}`,
    );
  }
};

/** A resource change from `terraform show -json`. */
export interface TerraformResourceChange {
  address: string;
  change: {
    actions: string[];
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
}

/** Addresses of the main user pool, its app clients and its identity providers. */
const FEDERATION_ADDRESSES = [
  'aws_cognito_identity_provider',
  'aws_cognito_user_pool_client',
  'aws_cognito_user_pool.',
];

/**
 * User pool attributes the test itself changes: `createCognitoTestUser` turns
 * MFA off so the browser login skips MFA setup, and the next plan turns it
 * back on.
 */
const MFA_ATTRIBUTES = [
  'mfa_configuration',
  'software_token_mfa_configuration',
];

/** Top-level attributes whose values differ between `before` and `after`. */
const changedAttributes = ({
  before,
  after,
}: TerraformResourceChange['change']): string[] => {
  const b = before ?? {};
  const a = after ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]),
  );
};

/** Whether a change is an in-place user pool update that only resets MFA. */
const isMfaReset = ({ address, change }: TerraformResourceChange): boolean =>
  address.includes('aws_cognito_user_pool.') &&
  change.actions.length === 1 &&
  change.actions[0] === 'update' &&
  changedAttributes(change).every((key) => MFA_ATTRIBUTES.includes(key));

/**
 * Splits the planned changes of a second plan into changes to the user pool,
 * its app clients and identity providers, which must be empty, and all
 * others, which other modules cause on every plan. A user pool update that
 * only turns MFA back on counts as other: the test turned it off.
 */
export const federationPlanChanges = (
  resourceChanges: TerraformResourceChange[],
): { federation: string[]; other: string[] } => {
  const federation: string[] = [];
  const other: string[] = [];
  for (const resourceChange of resourceChanges) {
    const { address, change } = resourceChange;
    if (change.actions.every((a) => a === 'no-op' || a === 'read')) {
      continue;
    }
    const entry = `${address} (${change.actions.join(', ')})`;
    if (isMfaReset(resourceChange)) {
      other.push(`${address} (update, MFA turned off by the test)`);
    } else if (FEDERATION_ADDRESSES.some((part) => address.includes(part))) {
      federation.push(entry);
    } else {
      other.push(entry);
    }
  }
  return { federation, other };
};
