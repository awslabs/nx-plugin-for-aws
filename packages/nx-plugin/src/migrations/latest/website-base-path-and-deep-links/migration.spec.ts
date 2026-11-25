/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const read = (name: string) =>
  readFileSync(join(import.meta.dirname, name), 'utf-8');
const TEMPLATES = '../../../ts/react-website';
/** Today's generator output, with the doc comment the migration leaves alone */
const withOldComment = (text: string) =>
  text.replace("present at the app's base path", "present at '/'");
const FILES = {
  'apps/website/src/components/CognitoAuth/index.tsx': {
    old: read('old-CognitoAuth.tsx.fixture'),
    now: read(
      `${TEMPLATES}/cognito-auth/files/app/components/CognitoAuth/index.tsx.template`,
    ),
  },
  'apps/website/src/components/RuntimeConfig/index.tsx': {
    old: read('old-RuntimeConfig.tsx.fixture'),
    now: read(
      `${TEMPLATES}/runtime-config/files/app/components/RuntimeConfig/index.tsx.template`,
    ),
  },
};
const APP_LAYOUT = 'apps/website/src/components/AppLayout/index.tsx';
const OLD_SIGN_OUT = `export const Menu = () => (
  <button
    onClick={() =>
      signoutRedirect({
        post_logout_redirect_uri: window.location.origin,
        extraQueryParams: {
          redirect_uri: window.location.origin,
          response_type: 'code',
        },
      })
    }
  />
);
`;

describe('website-base-path-and-deep-links', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'website', {
      root: 'apps/website',
      sourceRoot: 'apps/website/src',
    });
    for (const [path, { old }] of Object.entries(FILES)) {
      tree.write(path, old);
    }
    tree.write(APP_LAYOUT, OLD_SIGN_OUT);
    await formatFilesInSubtree(tree);
  });

  it('should leave CognitoAuth and RuntimeConfig as the generator writes them now, comments aside', async () => {
    await migration(tree);

    const expected = createTreeUsingTsSolutionSetup();
    for (const [path, { now }] of Object.entries(FILES)) {
      expected.write(path, withOldComment(now));
    }
    await formatFilesInSubtree(expected);
    for (const path of Object.keys(FILES)) {
      expect(tree.read(path, 'utf-8')).toBe(expected.read(path, 'utf-8'));
    }
  });

  it('should make the sign-out redirects honour the base path', async () => {
    await migration(tree);

    const appLayout = tree.read(APP_LAYOUT, 'utf-8') ?? '';
    expect(appLayout).not.toMatch(/redirect_uri: window\.location\.origin,/);
    expect(appLayout.match(/document\.baseURI/g)).toHaveLength(2);
  });

  it('should migrate a sign-out menu written with double quotes', async () => {
    // As the none and shadcn auth menus write it
    tree.write(APP_LAYOUT, OLD_SIGN_OUT.replaceAll("'code'", '"code"'));

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.read(APP_LAYOUT, 'utf-8')).not.toMatch(
      /redirect_uri: window\.location\.origin,/,
    );
  });

  it('should change nothing when run again', async () => {
    await migration(tree);
    const once = [...Object.keys(FILES), APP_LAYOUT].map((p) =>
      tree.read(p, 'utf-8'),
    );

    const result = await migration(tree);

    expect(
      [...Object.keys(FILES), APP_LAYOUT].map((p) => tree.read(p, 'utf-8')),
    ).toEqual(once);
    expect(result.nextSteps).toEqual([]);
  });

  it('should report a CognitoAuth patched by hand for the base path alone', async () => {
    const path = 'apps/website/src/components/CognitoAuth/index.tsx';
    const patched = (tree.read(path, 'utf-8') ?? '').replace(
      'redirect_uri: window.location.origin,',
      'redirect_uri: window.location.origin + import.meta.env.BASE_URL,',
    );
    tree.write(path, patched);

    const result = await migration(tree);

    expect(tree.read(path, 'utf-8')).toBe(patched);
    expect(result.nextSteps).toEqual([expect.stringContaining(path)]);
  });

  it('should leave a file that has diverged, and say so', async () => {
    const path = 'apps/website/src/components/CognitoAuth/index.tsx';
    tree.write(path, '// my own sign-in\n');

    const result = await migration(tree);

    expect(tree.read(path, 'utf-8')).toBe('// my own sign-in\n');
    expect(result.nextSteps).toEqual([expect.stringContaining(path)]);
  });
});
