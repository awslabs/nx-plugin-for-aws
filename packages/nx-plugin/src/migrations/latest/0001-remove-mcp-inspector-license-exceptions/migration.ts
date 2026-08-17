/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { removeLicenseExceptions } from '../../../license/config';

/**
 * MCP Inspector v1 declared `SEE LICENSE IN LICENSE`, which resolves to no SPDX
 * identifier, so the license check needed an exception per published package.
 * v2 ships as a single package declaring `MIT`, which the allowlist already
 * covers, and the stale exceptions would override that with `Apache-2.0`.
 */
const OBSOLETE_EXCEPTIONS = [
  '@modelcontextprotocol/inspector',
  '@modelcontextprotocol/inspector-cli',
  '@modelcontextprotocol/inspector-server',
  '@modelcontextprotocol/inspector-client',
];

export default async function migration(tree: Tree): Promise<void> {
  await removeLicenseExceptions(tree, OBSOLETE_EXCEPTIONS);
}
