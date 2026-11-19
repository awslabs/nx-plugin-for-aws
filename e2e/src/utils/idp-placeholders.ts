/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The OpenID Connect identity provider the smoke-test wiring templates
 * (`application-stack.ts.template`, `terraform-deploy/main.tf.template`)
 * register on the main user pool.
 */
export interface IdpPlaceholderValues {
  /** Issuer URL of the identity provider. */
  issuerUrl: string;
  /** Client ID registered at the identity provider. */
  clientId: string;
  /** Name of the Secrets Manager secret that holds the client secret. */
  clientSecretName: string;
}

/**
 * Values for the builds that never deploy. Synth, plan and `terraform test`
 * reference the issuer and the secret but never call them.
 */
export const SAMPLE_IDP: IdpPlaceholderValues = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'e2e-client',
  clientSecretName: 'e2e-idp-client-secret',
};

/** Replaces the `<% IDP_... %>` placeholders of a wiring template with the given values. */
export const renderIdpPlaceholders = (
  content: string,
  idp: IdpPlaceholderValues,
): string =>
  content
    .replace(/<% IDP_ISSUER_URL %>/g, idp.issuerUrl)
    .replace(/<% IDP_CLIENT_ID %>/g, idp.clientId)
    .replace(/<% IDP_CLIENT_SECRET_NAME %>/g, idp.clientSecretName);
