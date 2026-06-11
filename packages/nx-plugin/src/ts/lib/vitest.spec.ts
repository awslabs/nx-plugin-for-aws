/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import * as ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import tsProjectGenerator from './generator';
import { configureVitest } from './vitest';

// Returns the syntax errors produced when parsing the given TypeScript source.
const syntaxErrors = (content: string): string[] => {
  const sourceFile = ts.createSourceFile(
    'vitest.config.mts',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return (
    (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? []
  ).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
};

describe('vitest utils', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsProjectGenerator(tree, {
      name: 'test',
      skipInstall: true,
    });
  });

  it('should configure vitest to pass with no tests', async () => {
    await configureVitest(tree, {
      dir: 'test',
      fullyQualifiedName: 'test',
    });
    const content = tree.read('test/vitest.config.mts', 'utf8');
    expect(content).toContain('passWithNoTests: true');
  });

  it('should generate a valid vitest.config.mts without a double comma', () => {
    const content = tree.read('test/vitest.config.mts', 'utf8');
    // Guards against the grit transform emitting `},,` when the matched
    // properties already end with a trailing comma.
    expect(content).not.toMatch(/,\s*,/);
    expect(content).toMatchSnapshot('vitest.config.mts');
  });

  // The grit transform splices `passWithNoTests` into the existing `test`
  // block. Appending it after the final property only stays valid when that
  // property has a trailing comma, so verify the result parses cleanly across
  // a variety of test block shapes regardless of trailing commas.
  it.each([
    {
      name: 'trailing comma on last property',
      config: `import { defineConfig } from 'vitest/config';
export default defineConfig(() => ({
  test: {
    name: '@proj/test',
    watch: false,
  },
}));
`,
    },
    {
      name: 'no trailing comma on last property',
      config: `import { defineConfig } from 'vitest/config';
export default defineConfig(() => ({
  test: {
    name: '@proj/test',
    watch: false
  },
}));
`,
    },
    {
      name: 'single line test block',
      config: `import { defineConfig } from 'vitest/config';
export default defineConfig(() => ({
  test: { globals: true },
}));
`,
    },
    {
      name: 'empty test block',
      config: `import { defineConfig } from 'vitest/config';
export default defineConfig(() => ({
  test: {},
}));
`,
    },
  ])('should add passWithNoTests producing valid syntax: $name', async ({
    config,
  }) => {
    tree.write('test/vitest.config.mts', config);

    await configureVitest(tree, {
      dir: 'test',
      fullyQualifiedName: 'test',
    });

    const content = tree.read('test/vitest.config.mts', 'utf8')!;
    expect(content).toContain('passWithNoTests: true');
    expect(syntaxErrors(content)).toEqual([]);
  });

  it('should not add passWithNoTests when it is already present', async () => {
    const config = `import { defineConfig } from 'vitest/config';
export default defineConfig(() => ({
  test: {
    passWithNoTests: true,
    name: '@proj/test',
  },
}));
`;
    tree.write('test/vitest.config.mts', config);

    await configureVitest(tree, {
      dir: 'test',
      fullyQualifiedName: 'test',
    });

    const content = tree.read('test/vitest.config.mts', 'utf8')!;
    expect(content.match(/passWithNoTests/g)).toHaveLength(1);
    expect(syntaxErrors(content)).toEqual([]);
  });
});
