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

// Leaves room for the IaC suffix (Terraform: `-<12-digit account>-<8-char hex>` = 22 chars) inside Cognito's 63-char limit.
const MAX_DERIVED_DOMAIN_PREFIX_LENGTH = 41;

// Cognito rejects domains containing these substrings ("Domain cannot contain reserved word").
const COGNITO_DOMAIN_RESERVED_WORDS = ['aws', 'amazon', 'cognito'];

export const deriveCognitoDomainPrefix = (
  npmScope: string | undefined,
  projectName: string,
): string => {
  const projectWithoutScope = projectName.includes('/')
    ? projectName.split('/').pop()!
    : projectName;
  const kebab = kebabCase(
    [npmScope, projectWithoutScope].filter(Boolean).join('-'),
  );
  const stripped = COGNITO_DOMAIN_RESERVED_WORDS.reduce(
    (s, word) => s.replaceAll(word, ''),
    kebab,
  );
  const candidate = stripped
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_DERIVED_DOMAIN_PREFIX_LENGTH)
    .replace(/-$/, '');
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
