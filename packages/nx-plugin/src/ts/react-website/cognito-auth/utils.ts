/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  addDestructuredImport,
  applyGritQLTransform,
} from '../../../utils/ast';
import { readFileSync } from 'fs';
import { join } from 'path';

const readGritPattern = (name: string): string =>
  readFileSync(join(__dirname, 'grit', `${name}.grit`), 'utf-8').trim();

// Adds a user greeting and sign-out button to the default AppLayout header when using the None UX provider.
export async function addNoneAuthMenu(tree: Tree, appLayoutTsxPath: string) {
  await applyGritQLTransform(
    tree,
    appLayoutTsxPath,
    readGritPattern('none-auth-menu'),
  );
}

// Adds a top navigation dropdown with sign-out when using the Cloudscape UX provider.
export async function addCloudscapeAuthMenu(
  tree: Tree,
  appLayoutTsxPath: string,
) {
  await applyGritQLTransform(
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
  await applyGritQLTransform(
    tree,
    appLayoutTsxPath,
    readGritPattern('shadcn-state-declarations'),
  );

  // Add useEffect, useRef, useState imports from react
  addDestructuredImport(
    tree,
    appLayoutTsxPath,
    ['useEffect', 'useRef', 'useState'],
    'react',
  );

  // Append the auth menu to the header element
  await applyGritQLTransform(
    tree,
    appLayoutTsxPath,
    readGritPattern('shadcn-auth-menu'),
  );
}
