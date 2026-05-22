/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { addDestructuredImport, applyGritQL } from '../../../utils/ast';
import { readFileSync } from 'fs';
import { join } from 'path';
import { kebabCase } from '../../../utils/names';

const readGritPattern = (name: string): string =>
  readFileSync(join(__dirname, 'grit', `${name}.grit`), 'utf-8').trim();

// The Cognito hosted prefix domain pattern is ^[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?$ with a max length of 63.
// Both CDK and Terraform templates append a suffix (account id, optional random hex) to the prefix when
// creating the user pool domain. We cap derived prefixes at 41 characters to leave room for the longest
// suffix used by the Terraform template ("-<12-digit account id>-<8-char hex>" = 22 characters).
const MAX_DERIVED_DOMAIN_PREFIX_LENGTH = 41;

// Cognito rejects prefixes that contain any of these case-insensitive substrings with
// "Domain cannot contain reserved word".
const COGNITO_DOMAIN_RESERVED_WORDS = ['aws', 'amazon', 'cognito'];

/**
 * Derive a Cognito-compatible hosted-domain prefix from the npm scope and the website project name.
 *
 * Cognito domain prefixes must:
 * - Match `^[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?$`
 * - Be 1-63 characters in total
 * - Not contain the reserved words `aws`, `amazon`, or `cognito` as substrings
 *
 * The plugin appends an account id (and a random suffix for Terraform) when actually creating the
 * user pool domain, so the derived value is conservatively truncated to leave room for those suffixes.
 */
export const deriveCognitoDomainPrefix = (
  npmScope: string | undefined,
  projectName: string,
): string => {
  const projectNameWithoutScope = projectName.includes('/')
    ? projectName.split('/').pop()!
    : projectName;
  const parts = [npmScope, projectNameWithoutScope].filter(
    (p): p is string => !!p,
  );
  let candidate = kebabCase(parts.join('-'));
  for (const reserved of COGNITO_DOMAIN_RESERVED_WORDS) {
    candidate = candidate.replace(new RegExp(reserved, 'gi'), '');
  }
  candidate = candidate
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_DERIVED_DOMAIN_PREFIX_LENGTH)
    .replace(/-+$/g, '');
  if (!candidate) {
    throw new Error(
      `Unable to derive a valid Cognito domain prefix from scope "${npmScope ?? ''}" and project "${projectName}". Please specify a cognitoDomain explicitly.`,
    );
  }
  return candidate;
};

// Adds a user greeting and sign-out button to the default AppLayout header when using the None UX provider.
export async function addNoneAuthMenu(tree: Tree, appLayoutTsxPath: string) {
  await applyGritQL(tree, appLayoutTsxPath, readGritPattern('none-auth-menu'));
}

// Adds a top navigation dropdown with sign-out when using the Cloudscape UX provider.
export async function addCloudscapeAuthMenu(
  tree: Tree,
  appLayoutTsxPath: string,
) {
  await applyGritQL(
    tree,
    appLayoutTsxPath,
    readGritPattern('cloudscape-auth-menu'),
  );
}

export async function addShadcnAuthMenu(tree: Tree, appLayoutTsxPath: string) {
  if (!tree.exists(appLayoutTsxPath)) {
    throw new Error(`Expected top nav component at ${appLayoutTsxPath}`);
  }

  // Prepend state declarations to the AppLayout component body
  await applyGritQL(
    tree,
    appLayoutTsxPath,
    readGritPattern('shadcn-state-declarations'),
  );

  // Add useEffect, useRef, useState imports from react
  await addDestructuredImport(
    tree,
    appLayoutTsxPath,
    ['useEffect', 'useRef', 'useState'],
    'react',
  );

  // Append the auth menu to the header element
  await applyGritQL(
    tree,
    appLayoutTsxPath,
    readGritPattern('shadcn-auth-menu'),
  );
}
