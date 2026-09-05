/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { TS_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const SHADCN_ROOT = 'packages/common/shadcn';
const COMPONENTS_JSON = `${SHADCN_ROOT}/components.json`;
const PACKAGE_JSON = `${SHADCN_ROOT}/package.json`;
const BUTTON = `${SHADCN_ROOT}/src/components/ui/button.tsx`;
const SIDEBAR = `${SHADCN_ROOT}/src/components/ui/sidebar.tsx`;
const UTILS = `${SHADCN_ROOT}/src/lib/utils.ts`;

const ALIASES = {
  components: '#components',
  utils: '#lib/utils',
  hooks: '#hooks',
  lib: '#lib',
  ui: '#components/ui',
};

const OLD_BUTTON = `import { cn } from "#lib/utils"

export function Button() {
  return null;
}
`;

const OLD_UTILS = `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/**
 * The shared shadcn package as the release before the `cn` package move left
 * it. Hardcoded rather than produced by running the generator: a migration has
 * to keep applying to the shape that shipped, however far the generator's
 * output moves afterwards.
 */
const givenSharedShadcnPackage = (
  tree: Tree,
  {
    aliases = ALIASES,
    button = OLD_BUTTON,
    utils = OLD_UTILS,
    sidebar,
  }: {
    aliases?: Record<string, string>;
    button?: string;
    utils?: string;
    sidebar?: string;
  } = {},
): void => {
  tree.write(
    PACKAGE_JSON,
    JSON.stringify(
      {
        name: '@proj/common-shadcn',
        version: '0.0.1',
        private: true,
        dependencies: {
          clsx: '2.1.1',
          'tailwind-merge': '3.6.0',
          'class-variance-authority': '0.7.1',
        },
      },
      null,
      2,
    ),
  );
  tree.write(
    COMPONENTS_JSON,
    JSON.stringify(
      { $schema: 'https://ui.shadcn.com/schema.json', aliases },
      null,
      2,
    ),
  );
  tree.write(BUTTON, button);
  tree.write(UTILS, utils);
  if (sidebar) {
    tree.write(SIDEBAR, sidebar);
  }
};

describe('shadcn-cn-package migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should import cn from the cn package and re-export it from utils', async () => {
    givenSharedShadcnPackage(tree);

    const result = await migration(tree);

    expect(read(tree, BUTTON)).toContain(`from 'cn'`);
    expect(read(tree, BUTTON)).not.toContain('#lib/utils');
    expect(read(tree, UTILS)).toBe(`export { cn } from 'cn';\n`);
    expect(result.nextSteps).toEqual([]);
  });

  it('should declare cn and drop clsx and tailwind-merge', async () => {
    givenSharedShadcnPackage(tree);

    await migration(tree);

    const { dependencies } = readJson(tree, PACKAGE_JSON);
    // A workspace with catalogs enabled records the version centrally.
    expect(
      dependencies.cn === 'catalog:' || dependencies.cn === TS_VERSIONS.cn,
    ).toBe(true);
    expect(dependencies.clsx).toBeUndefined();
    expect(dependencies['tailwind-merge']).toBeUndefined();
    expect(dependencies['class-variance-authority']).toBe('0.7.1');
  });

  it('should keep clsx while a file still imports it', async () => {
    givenSharedShadcnPackage(tree, {
      sidebar: `import { clsx } from 'clsx';\n\nexport const cx = clsx;\n`,
    });

    await migration(tree);

    const { dependencies } = readJson(tree, PACKAGE_JSON);
    expect(dependencies.clsx).toBe('2.1.1');
    expect(dependencies['tailwind-merge']).toBeUndefined();
  });

  it('should leave an import that also pulls in a local helper alone', async () => {
    const button = `import { cn, formatLabel } from "#lib/utils"\n\nexport function Button() {\n  return formatLabel(cn('x'));\n}\n`;
    givenSharedShadcnPackage(tree, { button });

    await migration(tree);

    expect(read(tree, BUTTON)).toContain('#lib/utils');
  });

  it('should report a customised utils helper rather than clobber it', async () => {
    givenSharedShadcnPackage(tree, {
      utils: `export const cn = (...args: unknown[]) => args.join(' ');\n`,
    });

    const result = await migration(tree);

    expect(read(tree, UTILS)).toContain('args.join');
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(UTILS);
  });

  it('should skip a package whose aliases have diverged', async () => {
    givenSharedShadcnPackage(tree, {
      aliases: { ...ALIASES, utils: '@/lib/utils' },
    });

    const result = await migration(tree);

    expect(read(tree, BUTTON)).toBe(OLD_BUTTON);
    expect(read(tree, UTILS)).toBe(OLD_UTILS);
    expect(result.nextSteps).toEqual([]);
  });

  it('should do nothing when there is no shared shadcn package', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    givenSharedShadcnPackage(tree);

    await migration(tree);
    const afterFirst = {
      button: read(tree, BUTTON),
      utils: read(tree, UTILS),
      packageJson: read(tree, PACKAGE_JSON),
    };

    const result = await migration(tree);

    expect(read(tree, BUTTON)).toBe(afterFirst.button);
    expect(read(tree, UTILS)).toBe(afterFirst.utils);
    expect(read(tree, PACKAGE_JSON)).toBe(afterFirst.packageJson);
    expect(result.nextSteps).toEqual([]);
  });
});
