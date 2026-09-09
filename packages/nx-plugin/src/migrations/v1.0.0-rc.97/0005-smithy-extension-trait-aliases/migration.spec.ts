/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../../../smithy/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const EXTENSIONS_PATH = 'packages/api/model/src/extensions.smithy';

/** The `extensions.smithy` shipped before the traits carried an `as:` alias. */
const VENDED_BEFORE = `$version: "2.0"

namespace com.example

use smithy.openapi#specificationExtension

@trait
@specificationExtension
structure query {}

@trait
@specificationExtension
structure mutation {}

@trait
@specificationExtension
structure cursor {
  inputToken: String
  enabled: Boolean
}
`;

const addModelProject = (tree: Tree) =>
  addProjectConfiguration(tree, '@ws/api-model', {
    root: 'packages/api/model',
    sourceRoot: 'packages/api/model/src',
    metadata: {
      generator: SMITHY_PROJECT_GENERATOR_INFO.id,
    } as any,
  });

describe('smithy-extension-trait-aliases migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should alias every vended trait', async () => {
    addModelProject(tree);
    tree.write(EXTENSIONS_PATH, VENDED_BEFORE);

    const result = await migration(tree);

    const after = tree.read(EXTENSIONS_PATH, 'utf-8');
    expect(after).toContain('@specificationExtension(as: "x-query")');
    expect(after).toContain('@specificationExtension(as: "x-mutation")');
    expect(after).toContain('@specificationExtension(as: "x-cursor")');
    expect(after).not.toMatch(/@specificationExtension\s*\n\s*structure/);
    expect(result.nextSteps).toHaveLength(0);
    expect(after).toMatchSnapshot();
  });

  it('should preserve user content in the file it edits', async () => {
    addModelProject(tree);
    tree.write(
      EXTENSIONS_PATH,
      `${VENDED_BEFORE}
/// My own vendor extension
@trait
@specificationExtension(as: "x-my-thing")
structure myThing {
  value: String
}
`,
    );

    await migration(tree);

    const after = tree.read(EXTENSIONS_PATH, 'utf-8');
    expect(after).toContain('/// My own vendor extension');
    expect(after).toContain('@specificationExtension(as: "x-my-thing")');
    expect(after).toContain('structure myThing {');
    expect(after).toContain('@specificationExtension(as: "x-query")');
  });

  it('should skip and report traits which have diverged from the vended shape', async () => {
    addModelProject(tree);
    tree.write(
      EXTENSIONS_PATH,
      `$version: "2.0"

namespace com.example

use smithy.openapi#specificationExtension

@trait
@specificationExtension
structure query {}

@trait
structure mutation {}
`,
    );

    const result = await migration(tree);

    const after = tree.read(EXTENSIONS_PATH, 'utf-8');
    expect(after).toContain('@specificationExtension(as: "x-query")');
    // The user's `mutation` no longer carries `@specificationExtension`, so it
    // is left exactly as it was.
    expect(after).toContain('@trait\nstructure mutation {}');
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain('x-mutation');
    expect(result.nextSteps?.[0]).toContain('x-cursor');
    expect(result.nextSteps?.[0]).not.toContain('x-query');
  });

  it('should leave a trait which already carries an alias alone', async () => {
    addModelProject(tree);
    tree.write(
      EXTENSIONS_PATH,
      VENDED_BEFORE.replace(
        '@specificationExtension\nstructure query',
        '@specificationExtension(as: "x-query")\nstructure query',
      ),
    );

    const result = await migration(tree);

    const after = tree.read(EXTENSIONS_PATH, 'utf-8');
    expect(
      after.match(/@specificationExtension\(as: "x-query"\)/g),
    ).toHaveLength(1);
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should be idempotent', async () => {
    addModelProject(tree);
    tree.write(EXTENSIONS_PATH, VENDED_BEFORE);

    await migration(tree);
    const afterFirstRun = tree.read(EXTENSIONS_PATH, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(EXTENSIONS_PATH, 'utf-8')).toBe(afterFirstRun);
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should ignore projects which are not Smithy models', async () => {
    addProjectConfiguration(tree, '@ws/lib', {
      root: 'packages/lib',
      sourceRoot: 'packages/lib/src',
    });
    tree.write('packages/lib/src/extensions.smithy', VENDED_BEFORE);

    const result = await migration(tree);

    expect(tree.read('packages/lib/src/extensions.smithy', 'utf-8')).toBe(
      VENDED_BEFORE,
    );
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should be a no-op when the user has deleted extensions.smithy', async () => {
    addModelProject(tree);

    const result = await migration(tree);

    expect(tree.exists(EXTENSIONS_PATH)).toBe(false);
    expect(result.nextSteps).toHaveLength(0);
  });
});
