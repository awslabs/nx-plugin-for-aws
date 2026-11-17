/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkFederation,
  createTestIdp,
  deleteTestIdp,
  federationPlanChanges,
  newTestIdp,
  registerIdpCallback,
  sweepTestIdps,
  type TestIdp,
  testIdpNames,
} from './test-idp';

/**
 * Both SDK clients are replaced by one fake whose `send` records the name and
 * input of each command and answers from `handlers`. The Command classes are
 * the real ones, so the tests check what test-idp.ts sends.
 */
const sdk = vi.hoisted(() => {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> =
    {};
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }) => {
    const name = command.constructor.name.replace(/Command$/, '');
    calls.push({ name, input: command.input });
    const handler = handlers[name];
    return handler ? handler(command.input) : {};
  };
  class FakeClient {
    send = send;
  }
  return { calls, handlers, FakeClient };
});

vi.mock('@aws-sdk/client-cognito-identity-provider', async () => ({
  ...(await vi.importActual<object>(
    '@aws-sdk/client-cognito-identity-provider',
  )),
  CognitoIdentityProviderClient: sdk.FakeClient,
}));
vi.mock('@aws-sdk/client-secrets-manager', async () => ({
  ...(await vi.importActual<object>('@aws-sdk/client-secrets-manager')),
  SecretsManagerClient: sdk.FakeClient,
}));

const REGION = 'us-west-2';
const HOUR = 60 * 60 * 1000;

/** An error the SDK throws for a resource that does not exist. */
const notFound = () =>
  Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' });

/** Names of the commands sent so far. */
const sentNames = () => sdk.calls.map((c) => c.name);

/** Input of the first command with the given name. */
const inputOf = (name: string) => sdk.calls.find((c) => c.name === name)?.input;

/** Handlers for a create that succeeds, with the domain active on the first poll. */
const succeedingCreate = () => {
  sdk.handlers.CreateUserPool = () => ({ UserPool: { Id: 'us-west-2_idp' } });
  sdk.handlers.CreateUserPoolClient = () => ({
    UserPoolClient: { ClientId: 'idp-client', ClientSecret: 'raw-secret' },
  });
  sdk.handlers.CreateSecret = () => ({ ARN: 'arn:secret' });
  sdk.handlers.DescribeUserPoolDomain = () => ({
    DomainDescription: { Status: 'ACTIVE' },
  });
};

/** A fake sleep that returns at once and counts its calls. */
const fakeSleep = () => vi.fn(async (_ms: number) => {});

beforeEach(() => {
  sdk.calls.length = 0;
  for (const key of Object.keys(sdk.handlers)) {
    delete sdk.handlers[key];
  }
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('testIdpNames', () => {
  it('derives every name from the test run id', () => {
    expect(testIdpNames('abc123')).toEqual({
      userPoolName: 'e2e-idp-abc123',
      domainPrefix: 'e2e-idp-abc123',
      clientName: 'e2e-idp-abc123',
      secretName: 'e2e-idp-abc123-client-secret',
    });
  });

  it('lower-cases the domain prefix', () => {
    expect(testIdpNames('AbC').domainPrefix).toBe('e2e-idp-abc');
  });
});

describe('newTestIdp', () => {
  it('generates a password that meets the identity provider policy', () => {
    const { password } = newTestIdp('abc', REGION);
    expect(password.length).toBeGreaterThanOrEqual(16);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it('uses the email as the user name', () => {
    const idp = newTestIdp('abc', REGION);
    expect(idp.username).toBe('e2e-idp-abc@example.com');
    expect(idp.email).toBe(idp.username);
  });
});

describe('createTestIdp', () => {
  it('creates the resources in order', async () => {
    succeedingCreate();
    await createTestIdp(newTestIdp('abc', REGION), { sleep: fakeSleep() });
    expect(sentNames()).toEqual([
      'CreateUserPool',
      'CreateUserPoolClient',
      'CreateUserPoolDomain',
      'CreateManagedLoginBranding',
      'AdminCreateUser',
      'AdminSetUserPassword',
      'CreateSecret',
      'DescribeUserPoolDomain',
    ]);
  });

  it('sends the key inputs and fills the handle', async () => {
    succeedingCreate();
    const idp = newTestIdp('abc', REGION);
    await createTestIdp(idp, { sleep: fakeSleep() });

    const pool = inputOf('CreateUserPool');
    expect(pool).toMatchObject({
      PoolName: 'e2e-idp-abc',
      UsernameAttributes: ['email'],
      MfaConfiguration: 'OFF',
      DeletionProtection: 'INACTIVE',
      UserPoolTags: { 'nx-plugin-e2e': 'external-idp', 'e2e-run': 'abc' },
    });
    const tags = (pool?.UserPoolTags ?? {}) as Record<string, string>;
    const createdAt = tags['created-at'];
    expect(new Date(createdAt).toISOString()).toBe(createdAt);

    const client = inputOf('CreateUserPoolClient');
    expect(client).toMatchObject({ GenerateSecret: true });
    expect(client).not.toHaveProperty('AllowedOAuthFlows');
    expect(client).not.toHaveProperty('CallbackURLs');

    expect(inputOf('CreateUserPoolDomain')).toMatchObject({
      Domain: 'e2e-idp-abc',
      ManagedLoginVersion: 2,
    });
    expect(inputOf('CreateManagedLoginBranding')).toMatchObject({
      ClientId: 'idp-client',
      UseCognitoProvidedValues: true,
    });
    expect(inputOf('AdminCreateUser')).toMatchObject({
      MessageAction: 'SUPPRESS',
      UserAttributes: expect.arrayContaining([
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: idp.givenName },
        { Name: 'family_name', Value: idp.familyName },
      ]),
    });
    expect(inputOf('AdminSetUserPassword')).toMatchObject({
      Password: idp.password,
      Permanent: true,
    });

    const secret = inputOf('CreateSecret');
    expect(secret).toMatchObject({
      Name: 'e2e-idp-abc-client-secret',
      SecretString: 'raw-secret',
      Tags: expect.arrayContaining([
        { Key: 'nx-plugin-e2e', Value: 'external-idp' },
        { Key: 'e2e-run', Value: 'abc' },
      ]),
    });

    expect(idp).toMatchObject({
      userPoolId: 'us-west-2_idp',
      clientId: 'idp-client',
      secretArn: 'arn:secret',
      domainCreated: true,
      issuerUrl: 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_idp',
    });
  });

  it('polls the domain until it is active', async () => {
    succeedingCreate();
    const statuses = ['CREATING', 'CREATING', 'ACTIVE'];
    sdk.handlers.DescribeUserPoolDomain = () => ({
      DomainDescription: { Status: statuses.shift() },
    });
    const sleep = fakeSleep();
    await createTestIdp(newTestIdp('abc', REGION), { sleep });
    expect(
      sentNames().filter((n) => n === 'DescribeUserPoolDomain'),
    ).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('throws when the domain is not active in time', async () => {
    succeedingCreate();
    sdk.handlers.DescribeUserPoolDomain = () => ({
      DomainDescription: { Status: 'CREATING' },
    });
    const sleep = fakeSleep();
    await expect(
      createTestIdp(newTestIdp('abc', REGION), {
        sleep,
        intervalMs: 10_000,
        timeoutMs: 600_000,
      }),
    ).rejects.toThrow(/not active after 600s/);
    expect(sleep).toHaveBeenCalledTimes(60);
  });

  it('throws when the domain fails', async () => {
    succeedingCreate();
    sdk.handlers.DescribeUserPoolDomain = () => ({
      DomainDescription: { Status: 'FAILED' },
    });
    await expect(
      createTestIdp(newTestIdp('abc', REGION), { sleep: fakeSleep() }),
    ).rejects.toThrow(/failed to create/);
  });
});

describe('registerIdpCallback', () => {
  it('passes every client field again', async () => {
    succeedingCreate();
    const idp = newTestIdp('abc', REGION);
    await createTestIdp(idp, { sleep: fakeSleep() });
    await registerIdpCallback(idp, 'https://main.example/oauth2/idpresponse');
    expect(inputOf('UpdateUserPoolClient')).toEqual({
      UserPoolId: 'us-west-2_idp',
      ClientId: 'idp-client',
      ClientName: 'e2e-idp-abc',
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: ['openid', 'email', 'profile'],
      CallbackURLs: ['https://main.example/oauth2/idpresponse'],
      SupportedIdentityProviders: ['COGNITO'],
    });
  });
});

describe('deleteTestIdp', () => {
  /** A handle as left by a create that completed. */
  const createdIdp = (): TestIdp => ({
    ...newTestIdp('abc', REGION),
    userPoolId: 'us-west-2_idp',
    domainCreated: true,
    clientId: 'idp-client',
  });

  it('deletes the secret, then the domain, then the user pool', async () => {
    await deleteTestIdp(createdIdp());
    expect(sdk.calls).toEqual([
      {
        name: 'DeleteSecret',
        input: {
          SecretId: 'e2e-idp-abc-client-secret',
          ForceDeleteWithoutRecovery: true,
        },
      },
      {
        name: 'DeleteUserPoolDomain',
        input: { Domain: 'e2e-idp-abc', UserPoolId: 'us-west-2_idp' },
      },
      { name: 'DeleteUserPool', input: { UserPoolId: 'us-west-2_idp' } },
    ]);
  });

  it('does not throw when called again after everything is deleted', async () => {
    const idp = createdIdp();
    await deleteTestIdp(idp);
    sdk.handlers.DeleteSecret = () => {
      throw notFound();
    };
    sdk.handlers.DeleteUserPoolDomain = () => {
      throw notFound();
    };
    sdk.handlers.DeleteUserPool = () => {
      throw notFound();
    };
    await expect(deleteTestIdp(idp)).resolves.toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('runs every step when one fails', async () => {
    sdk.handlers.DeleteSecret = () => {
      throw new Error('AccessDenied');
    };
    sdk.handlers.DeleteUserPoolDomain = () => {
      throw new Error('throttled');
    };
    await expect(deleteTestIdp(createdIdp())).resolves.toBeUndefined();
    expect(sentNames()).toEqual([
      'DeleteSecret',
      'DeleteUserPoolDomain',
      'DeleteUserPool',
    ]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('cleans up after CreateUserPool fails', async () => {
    sdk.handlers.CreateUserPool = () => {
      throw new Error('LimitExceeded');
    };
    sdk.handlers.DeleteSecret = () => {
      throw notFound();
    };
    const idp = newTestIdp('abc', REGION);
    await expect(createTestIdp(idp)).rejects.toThrow('LimitExceeded');
    sdk.calls.length = 0;
    await expect(deleteTestIdp(idp)).resolves.toBeUndefined();
    expect(sentNames()).toEqual(['DeleteSecret']);
  });

  it('cleans up after a failure that follows CreateUserPool', async () => {
    succeedingCreate();
    sdk.handlers.CreateUserPoolClient = () => {
      throw new Error('InvalidParameter');
    };
    sdk.handlers.DeleteSecret = () => {
      throw notFound();
    };
    const idp = newTestIdp('abc', REGION);
    await expect(createTestIdp(idp)).rejects.toThrow('InvalidParameter');
    sdk.calls.length = 0;
    await expect(deleteTestIdp(idp)).resolves.toBeUndefined();
    expect(sentNames()).toEqual(['DeleteSecret', 'DeleteUserPool']);
    expect(inputOf('DeleteUserPool')).toEqual({ UserPoolId: 'us-west-2_idp' });
  });

  it('deletes the domain when its creation fails part-way', async () => {
    succeedingCreate();
    sdk.handlers.CreateUserPoolDomain = () => {
      throw new Error('timeout');
    };
    const idp = newTestIdp('abc', REGION);
    await expect(createTestIdp(idp)).rejects.toThrow('timeout');
    sdk.calls.length = 0;
    await deleteTestIdp(idp);
    expect(sentNames()).toEqual([
      'DeleteSecret',
      'DeleteUserPoolDomain',
      'DeleteUserPool',
    ]);
  });
});

describe('sweepTestIdps', () => {
  const now = Date.UTC(2026, 0, 1, 12);
  const old = new Date(now - 5 * HOUR);
  const young = new Date(now - 1 * HOUR);
  const tagged = { 'nx-plugin-e2e': 'external-idp' };

  /** Describes pools from a fixed set, keyed by id. */
  const describePools = (
    pools: Record<
      string,
      {
        CreationDate: Date;
        UserPoolTags?: Record<string, string>;
        Domain?: string;
      }
    >,
  ) => {
    sdk.handlers.DescribeUserPool = (input) => ({
      UserPool: pools[input.UserPoolId as string],
    });
  };

  it('deletes only old tagged pools with the prefix, domain first', async () => {
    sdk.handlers.ListUserPools = () => ({
      UserPools: [
        { Id: 'old', Name: 'e2e-idp-old' },
        { Id: 'young', Name: 'e2e-idp-young' },
        { Id: 'untagged', Name: 'e2e-idp-untagged' },
        { Id: 'other', Name: 'e2e-test-infra-sandbox' },
      ],
    });
    describePools({
      old: { CreationDate: old, UserPoolTags: tagged, Domain: 'e2e-idp-old' },
      young: { CreationDate: young, UserPoolTags: tagged },
      untagged: { CreationDate: old, UserPoolTags: {} },
    });
    await sweepTestIdps(REGION, { now });

    const describedIds = sdk.calls
      .filter((c) => c.name === 'DescribeUserPool')
      .map((c) => c.input.UserPoolId);
    expect(describedIds).toEqual(['old', 'young', 'untagged']);
    const deletes = sdk.calls.filter((c) => c.name.startsWith('Delete'));
    expect(deletes).toEqual([
      {
        name: 'DeleteUserPoolDomain',
        input: { Domain: 'e2e-idp-old', UserPoolId: 'old' },
      },
      { name: 'DeleteUserPool', input: { UserPoolId: 'old' } },
    ]);
  });

  it('skips the domain delete for a pool without a domain', async () => {
    sdk.handlers.ListUserPools = () => ({
      UserPools: [{ Id: 'old', Name: 'e2e-idp-old' }],
    });
    describePools({ old: { CreationDate: old, UserPoolTags: tagged } });
    await sweepTestIdps(REGION, { now });
    expect(sentNames()).not.toContain('DeleteUserPoolDomain');
    expect(sentNames()).toContain('DeleteUserPool');
  });

  it('follows the pool and secret pagination', async () => {
    sdk.handlers.ListUserPools = (input) =>
      input.NextToken
        ? { UserPools: [{ Id: 'p2', Name: 'e2e-idp-p2' }] }
        : { UserPools: [{ Id: 'p1', Name: 'e2e-idp-p1' }], NextToken: 't1' };
    describePools({
      p1: { CreationDate: old, UserPoolTags: tagged },
      p2: { CreationDate: old, UserPoolTags: tagged },
    });
    sdk.handlers.ListSecrets = (input) =>
      input.NextToken
        ? {
            SecretList: [
              {
                ARN: 'arn:s2',
                Name: 'e2e-idp-s2-client-secret',
                Tags: [{ Key: 'nx-plugin-e2e', Value: 'external-idp' }],
                CreatedDate: old,
              },
            ],
          }
        : { SecretList: [], NextToken: 's1' };
    await sweepTestIdps(REGION, { now });

    expect(
      sdk.calls.filter((c) => c.name === 'ListUserPools').map((c) => c.input),
    ).toEqual([
      { MaxResults: 60, NextToken: undefined },
      { MaxResults: 60, NextToken: 't1' },
    ]);
    expect(
      sdk.calls
        .filter((c) => c.name === 'DeleteUserPool')
        .map((c) => c.input.UserPoolId),
    ).toEqual(['p1', 'p2']);
    expect(inputOf('DeleteSecret')).toEqual({
      SecretId: 'arn:s2',
      ForceDeleteWithoutRecovery: true,
    });
  });

  it('filters secrets by tag, prefix and age', async () => {
    const tag = [{ Key: 'nx-plugin-e2e', Value: 'external-idp' }];
    sdk.handlers.ListSecrets = () => ({
      SecretList: [
        {
          ARN: 'arn:old',
          Name: 'e2e-idp-a-client-secret',
          Tags: tag,
          CreatedDate: old,
        },
        {
          ARN: 'arn:young',
          Name: 'e2e-idp-b-client-secret',
          Tags: tag,
          CreatedDate: young,
        },
        {
          ARN: 'arn:untagged',
          Name: 'e2e-idp-c-client-secret',
          Tags: [],
          CreatedDate: old,
        },
        { ARN: 'arn:other', Name: 'other-secret', Tags: tag, CreatedDate: old },
      ],
    });
    await sweepTestIdps(REGION, { now });

    expect(inputOf('ListSecrets')).toMatchObject({
      Filters: [
        { Key: 'tag-key', Values: ['nx-plugin-e2e'] },
        { Key: 'tag-value', Values: ['external-idp'] },
        { Key: 'name', Values: ['e2e-idp-'] },
      ],
    });
    expect(
      sdk.calls
        .filter((c) => c.name === 'DeleteSecret')
        .map((c) => c.input.SecretId),
    ).toEqual(['arn:old']);
  });

  it('never throws and still sweeps secrets when listing pools fails', async () => {
    sdk.handlers.ListUserPools = () => {
      throw new Error('AccessDenied');
    };
    sdk.handlers.ListSecrets = () => {
      throw new Error('AccessDenied');
    };
    await expect(sweepTestIdps(REGION, { now })).resolves.toBeUndefined();
    expect(sentNames()).toEqual(['ListUserPools', 'ListSecrets']);
  });

  it('keeps sweeping other pools when one delete fails', async () => {
    sdk.handlers.ListUserPools = () => ({
      UserPools: [
        { Id: 'p1', Name: 'e2e-idp-p1' },
        { Id: 'p2', Name: 'e2e-idp-p2' },
      ],
    });
    describePools({
      p1: { CreationDate: old, UserPoolTags: tagged },
      p2: { CreationDate: old, UserPoolTags: tagged },
    });
    sdk.handlers.DeleteUserPool = (input) => {
      if (input.UserPoolId === 'p1') throw new Error('throttled');
      return {};
    };
    await expect(sweepTestIdps(REGION, { now })).resolves.toBeUndefined();
    expect(
      sdk.calls
        .filter((c) => c.name === 'DeleteUserPool')
        .map((c) => c.input.UserPoolId),
    ).toEqual(['p1', 'p2']);
  });
});

describe('checkFederation', () => {
  const idp: TestIdp = {
    ...newTestIdp('abc', REGION),
    clientId: 'idp-client',
    issuerUrl: 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_idp',
  };
  const options = {
    region: REGION,
    userPoolId: 'us-west-2_main',
    userPoolClientId: 'main-client',
    idp,
  };

  /** Answers as a main user pool that registers the identity provider correctly. */
  const correctFederation = () => {
    sdk.handlers.DescribeIdentityProvider = () => ({
      IdentityProvider: {
        ProviderType: 'OIDC',
        ProviderDetails: {
          oidc_issuer: idp.issuerUrl,
          client_id: 'idp-client',
          client_secret: 'raw-secret',
          authorize_scopes: 'openid email profile',
          attributes_request_method: 'GET',
        },
        AttributeMapping: {
          email: 'email',
          given_name: 'given_name',
          family_name: 'family_name',
          username: 'sub',
        },
      },
    });
    sdk.handlers.DescribeUserPoolClient = () => ({
      UserPoolClient: { SupportedIdentityProviders: ['COGNITO', 'E2eIdp'] },
    });
  };

  it('passes for a correct registration', async () => {
    correctFederation();
    await expect(checkFederation(options)).resolves.toBeUndefined();
    expect(inputOf('DescribeIdentityProvider')).toEqual({
      UserPoolId: 'us-west-2_main',
      ProviderName: 'E2eIdp',
    });
    expect(inputOf('DescribeUserPoolClient')).toEqual({
      UserPoolId: 'us-west-2_main',
      ClientId: 'main-client',
    });
  });

  it('fails for a provider that is not OIDC', async () => {
    correctFederation();
    sdk.handlers.DescribeIdentityProvider = () => ({
      IdentityProvider: { ProviderType: 'SAML', ProviderDetails: {} },
    });
    await expect(checkFederation(options)).rejects.toThrow();
  });

  it('fails when the app client does not offer the provider', async () => {
    correctFederation();
    sdk.handlers.DescribeUserPoolClient = () => ({
      UserPoolClient: { SupportedIdentityProviders: ['COGNITO'] },
    });
    await expect(checkFederation(options)).rejects.toThrow();
  });

  it('does not print the client secret when a field differs', async () => {
    correctFederation();
    const describe = sdk.handlers.DescribeIdentityProvider;
    sdk.handlers.DescribeIdentityProvider = (input) => {
      const response = describe(input) as {
        IdentityProvider: { ProviderDetails: Record<string, string> };
      };
      response.IdentityProvider.ProviderDetails.client_id = 'wrong';
      return response;
    };
    const error = await checkFederation(options).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('raw-secret');
  });
});

describe('federationPlanChanges', () => {
  it('separates user pool changes from other drift and ignores no-ops and reads', () => {
    const result = federationPlanChanges([
      {
        address:
          'module.user_identity.module.identity.aws_cognito_user_pool.user_pool',
        change: { actions: ['no-op'] },
      },
      {
        address:
          'module.user_identity.module.identity.aws_cognito_identity_provider.oidc["E2eIdp"]',
        change: { actions: ['update'] },
      },
      {
        address:
          'module.user_identity.module.identity.aws_cognito_user_pool_client.client',
        change: { actions: ['delete', 'create'] },
      },
      {
        address:
          'module.user_identity.module.identity.aws_cognito_user_pool_domain.d',
        change: { actions: ['update'] },
      },
      {
        address: 'module.website.data.aws_iam_policy_document.p',
        change: { actions: ['read'] },
      },
      {
        address: 'module.runtime_config_read.terraform_data.trigger',
        change: { actions: ['create'] },
      },
    ]);
    expect(result).toEqual({
      federation: [
        'module.user_identity.module.identity.aws_cognito_identity_provider.oidc["E2eIdp"] (update)',
        'module.user_identity.module.identity.aws_cognito_user_pool_client.client (delete, create)',
      ],
      other: [
        'module.user_identity.module.identity.aws_cognito_user_pool_domain.d (update)',
        'module.runtime_config_read.terraform_data.trigger (create)',
      ],
    });
  });

  it('treats a user pool update that only restores the MFA the test turned off as other drift', () => {
    const userPool =
      'module.user_identity.module.identity.aws_cognito_user_pool.user_pool';
    const result = federationPlanChanges([
      {
        address: userPool,
        change: {
          actions: ['update'],
          before: {
            name: 'UserPool-1',
            mfa_configuration: 'OFF',
            software_token_mfa_configuration: [],
          },
          after: {
            name: 'UserPool-1',
            mfa_configuration: 'ON',
            software_token_mfa_configuration: [{ enabled: true }],
          },
        },
      },
    ]);
    expect(result).toEqual({
      federation: [],
      other: [`${userPool} (update, MFA turned off by the test)`],
    });
  });

  it('keeps a user pool update that changes anything besides MFA', () => {
    const userPool =
      'module.user_identity.module.identity.aws_cognito_user_pool.user_pool';
    const result = federationPlanChanges([
      {
        address: userPool,
        change: {
          actions: ['update'],
          before: { mfa_configuration: 'OFF', deletion_protection: 'ACTIVE' },
          after: { mfa_configuration: 'ON', deletion_protection: 'INACTIVE' },
        },
      },
      {
        // An attribute unknown until apply is missing from `after`, so it
        // counts as changed.
        address: `${userPool}_b`,
        change: {
          actions: ['update'],
          before: { mfa_configuration: 'OFF', arn: 'arn:old' },
          after: { mfa_configuration: 'ON' },
        },
      },
      {
        address: `${userPool}_c`,
        change: {
          actions: ['delete', 'create'],
          before: { mfa_configuration: 'OFF' },
          after: { mfa_configuration: 'ON' },
        },
      },
    ]);
    expect(result.federation).toEqual([
      `${userPool} (update)`,
      `${userPool}_b (update)`,
      `${userPool}_c (delete, create)`,
    ]);
    expect(result.other).toEqual([]);
  });
});
