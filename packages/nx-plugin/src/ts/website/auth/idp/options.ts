/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { kebabCase, snakeCase, toClassName } from '../../../../utils/names.js';
import type { TsWebsiteAuthIdpGeneratorSchema } from './schema';

export const DEFAULT_SCOPES = 'openid email profile';
export const DEFAULT_ATTRIBUTE_MAPPING =
  '{"email":"email","given_name":"given_name","family_name":"family_name"}';

/**
 * Cognito standard attribute names keyed by the `AttributeMapping` property
 * CDK's `UserPoolIdentityProviderOidc` takes for them. Other attributes,
 * including `phone_number_verified`, go under `custom`.
 */
const CDK_STANDARD_ATTRIBUTES: Record<string, string> = {
  address: 'address',
  birthdate: 'birthdate',
  email: 'email',
  email_verified: 'emailVerified',
  family_name: 'familyName',
  gender: 'gender',
  given_name: 'givenName',
  locale: 'locale',
  middle_name: 'middleName',
  name: 'fullname',
  nickname: 'nickname',
  phone_number: 'phoneNumber',
  picture: 'profilePicture',
  preferred_username: 'preferredUsername',
  profile: 'profilePage',
  zoneinfo: 'timezone',
  updated_at: 'lastUpdateTime',
  website: 'website',
};

const isStandardAttribute = (attribute: string): boolean =>
  Object.hasOwn(CDK_STANDARD_ATTRIBUTES, attribute);

const OTHER_ATTRIBUTE = /^(phone_number_verified|custom:\w{1,20})$/;

/** The attributes the vended user pool requires, so every sign-in must supply them. */
const REQUIRED_ATTRIBUTES = ['email', 'given_name', 'family_name'];

const ENTRA_MULTI_TENANT_PATHS = ['common', 'organizations', 'consumers'];

/** Characters that would end or interpolate a string literal in TypeScript or HCL. */
const UNSAFE_CHARACTERS = /[\s"'`\\${}]/;

export interface IdpOptions {
  name: string;
  className: string;
  nameKebabCase: string;
  nameSnakeCase: string;
  constructId: string;
  issuerUrl: string;
  clientId: string;
  clientSecretName: string;
  scopes: string[];
  identifiers: string[];
  cdkAttributeMapping: {
    standard: [string, string][];
    custom: [string, string][];
  };
  terraformAttributeMappingLines: string[];
}

const resolveName = (name: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(name ?? '')) {
    throw new Error(
      'name must be 3-32 characters, start with a letter and contain only letters, digits and hyphens',
    );
  }
  if (name.toUpperCase() === 'COGNITO') {
    throw new Error(
      'name must not be COGNITO, which Cognito reserves for sign-in with the user pool itself',
    );
  }
  return name;
};

const resolveIssuerUrl = (issuerUrl: string): string => {
  let url: URL;
  try {
    url = new URL(issuerUrl);
  } catch {
    throw new Error(`issuerUrl must be a URL, but is ${issuerUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error('issuerUrl must use https://');
  }
  if (UNSAFE_CHARACTERS.test(issuerUrl)) {
    throw new Error(
      'issuerUrl must not contain whitespace, quotes, backticks, backslashes, $, { or }',
    );
  }
  const [firstSegment] = url.pathname.split('/').filter(Boolean);
  if (ENTRA_MULTI_TENANT_PATHS.includes(firstSegment?.toLowerCase())) {
    throw new Error(
      "Microsoft Entra ID multi-tenant issuers (/common/, /organizations/, /consumers/) are not supported. Use your tenant's issuer, https://login.microsoftonline.com/<tenant-id>/v2.0",
    );
  }
  // Used as given: URL.href would add a trailing slash the IdP's iss claim may not have.
  return issuerUrl;
};

const resolveClientId = (clientId: string): string => {
  if (!/^[A-Za-z0-9._~:/+=@-]{1,255}$/.test(clientId ?? '')) {
    throw new Error(
      'clientId must be 1-255 characters of letters, digits and . _ ~ : / + = @ -',
    );
  }
  return clientId;
};

const resolveClientSecretName = (secretName: string): string => {
  if (!/^[A-Za-z0-9/_+=.@-]{1,512}$/.test(secretName)) {
    throw new Error(
      'clientSecretName must be 1-512 characters of letters, digits and / _ + = . @ -',
    );
  }
  return secretName;
};

const resolveScopes = (scopes: string): string[] => {
  const list = scopes.split(/\s+/).filter(Boolean);
  if (list.some((scope) => UNSAFE_CHARACTERS.test(scope))) {
    throw new Error(
      'scopes must not contain quotes, backticks, backslashes, $, { or }',
    );
  }
  if (!list.includes('openid')) {
    throw new Error('scopes must include openid');
  }
  return list;
};

const resolveIdentifiers = (identifiers?: string): string[] => {
  const list = (identifiers ?? '')
    .split(',')
    .map((identifier) => identifier.trim())
    .filter(Boolean);
  if (
    list.length > 50 ||
    list.some(
      (identifier) =>
        identifier.length > 40 || !/^[\w\s+=.@-]+$/.test(identifier),
    )
  ) {
    throw new Error(
      'identifiers must be at most 50 comma-separated values, each 1-40 letters, digits, spaces or _ + = . @ -',
    );
  }
  return list;
};

const resolveAttributeMapping = (
  attributeMapping: string,
): [attribute: string, claim: string][] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(attributeMapping);
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'attributeMapping must be a JSON object of user pool attributes to identity provider claims, for example {"email":"email","given_name":"given_name","family_name":"family_name"}',
    );
  }
  const entries = Object.entries(parsed);
  for (const [attribute, claim] of entries) {
    if (!(isStandardAttribute(attribute) || OTHER_ATTRIBUTE.test(attribute))) {
      throw new Error(
        `attributeMapping has an unknown user pool attribute ${attribute}. Use a standard attribute such as given_name, or custom:<name>`,
      );
    }
    if (
      typeof claim !== 'string' ||
      claim.length < 1 ||
      claim.length > 128 ||
      UNSAFE_CHARACTERS.test(claim)
    ) {
      throw new Error(
        `attributeMapping must map ${attribute} to a claim name of 1-128 characters without whitespace, quotes, backticks, backslashes, $, { or }`,
      );
    }
  }
  const missing = REQUIRED_ATTRIBUTES.find(
    (attribute) => !entries.some(([key]) => key === attribute),
  );
  if (missing) {
    throw new Error(`attributeMapping must map ${missing}`);
  }
  return entries as [string, string][];
};

/** Lines of an HCL map, with `=` aligned as `terraform fmt` aligns it. */
const alignedHclMapLines = (
  entries: [string, string][],
  indent: string,
): string[] => {
  const width = Math.max(...entries.map(([key]) => key.length + 2));
  return entries.map(
    ([key, value]) => `${indent}${`"${key}"`.padEnd(width)} = "${value}"`,
  );
};

/**
 * Validate the generator options and derive the names and values the
 * templates render. Every value that reaches a template is restricted to
 * characters that cannot end or interpolate a TypeScript or HCL string.
 */
export const resolveIdpOptions = (
  schema: TsWebsiteAuthIdpGeneratorSchema,
): IdpOptions => {
  if ((schema.type ?? 'oidc') !== 'oidc') {
    throw new Error(`type must be oidc, but is ${schema.type}`);
  }
  const name = resolveName(schema.name);
  const className = toClassName(name);
  const mapping = resolveAttributeMapping(
    schema.attributeMapping ?? DEFAULT_ATTRIBUTE_MAPPING,
  );

  return {
    name,
    className,
    nameKebabCase: kebabCase(name),
    nameSnakeCase: snakeCase(name),
    constructId: `${className}IdentityProvider`,
    issuerUrl: resolveIssuerUrl(schema.issuerUrl),
    clientId: resolveClientId(schema.clientId),
    clientSecretName: resolveClientSecretName(
      schema.clientSecretName ?? `${name}-oidc-client-secret`,
    ),
    scopes: resolveScopes(schema.scopes ?? DEFAULT_SCOPES),
    identifiers: resolveIdentifiers(schema.identifiers),
    cdkAttributeMapping: {
      standard: mapping
        .filter(([attribute]) => isStandardAttribute(attribute))
        .map(([attribute, claim]) => [
          CDK_STANDARD_ATTRIBUTES[attribute],
          claim,
        ]),
      custom: mapping.filter(([attribute]) => !isStandardAttribute(attribute)),
    },
    // Cognito adds username = sub when it returns the provider, and the
    // mapping cannot set username, so Terraform writes it to match.
    terraformAttributeMappingLines: alignedHclMapLines(
      [...mapping, ['username', 'sub']],
      '    ',
    ),
  };
};
