/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * A `.python-version` naming an exact CPython patch resolves only where uv has a
 * build of that patch: `3.14.7` installs on Linux but not on macOS, so `uv sync`
 * fails there on a workspace that works elsewhere.
 *
 * uv reads a bare `major.minor` as a request for any patch of that minor, so
 * dropping the patch lets each platform resolve a build it has. Lambda patches the
 * interpreter itself, so the minor is the whole of what a project needs to pin.
 *
 * Only a patch of the minor the releases in question vended is dropped — another
 * minor is the user's choice of interpreter, and the version sync moves the
 * interpreter forward when the runtime's minor itself changes.
 */

/**
 * The Python runtime minor those releases vended, spelled out rather than read
 * from `LAMBDA_RUNTIME_VERSIONS`.
 *
 * A migration describes a fixed point in history: it has to keep rewriting the
 * versions those releases actually wrote, whatever the current pin is. Reading the
 * live constant would silently retarget this at whatever minor the plugin vends by
 * the time a user upgrades, and stop correcting the value it exists for.
 */
const VENDED_MINOR = '3.14';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  // uv writes a `.python-version` per project as well as at the root, and one
  // left behind fails `uv sync` for that project alone.
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path !== '.python-version' && !path.endsWith('/.python-version')) {
      return;
    }
    const declared = (tree.read(path, 'utf-8') ?? '').trim();
    if (/^(\d+\.\d+)\.\d+$/.exec(declared)?.[1] === VENDED_MINOR) {
      tree.write(path, `${VENDED_MINOR}\n`);
    }
  });

  await formatFilesInSubtree(tree);

  return {};
}
