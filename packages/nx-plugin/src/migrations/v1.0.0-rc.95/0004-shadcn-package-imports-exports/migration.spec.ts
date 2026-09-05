/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const SHADCN_ROOT = 'packages/common/shadcn';
const COMPONENTS_JSON = `${SHADCN_ROOT}/components.json`;
const PACKAGE_JSON = `${SHADCN_ROOT}/package.json`;
const BUTTON = `${SHADCN_ROOT}/src/components/ui/button.tsx`;
const SIDEBAR = `${SHADCN_ROOT}/src/components/ui/sidebar.tsx`;
const UTILS = `${SHADCN_ROOT}/src/lib/utils.ts`;
const USE_MOBILE = `${SHADCN_ROOT}/src/hooks/use-mobile.ts`;

const WEBSITE_ROOT = 'packages/websites/test-app';
const WEBSITE_MANIFEST = `${WEBSITE_ROOT}/package.json`;

const FQN = '@proj/common-shadcn';

const OLD_BUTTON = `import { cn } from '${FQN}/lib/utils';\n\nexport function Button() { return null; }\n`;

const OLD_SIDEBAR = `import { useIsMobile } from '${FQN}/hooks/use-mobile';
import { cn } from '${FQN}/lib/utils';
import { Button } from '${FQN}/components/ui/button';

export function Sidebar() { return null; }
`;

const OLD_COMPONENTS_JSON = {
  $schema: 'https://ui.shadcn.com/schema.json',
  style: 'new-york',
  aliases: {
    components: `${FQN}/components`,
    utils: `${FQN}/lib/utils`,
    hooks: `${FQN}/hooks`,
    lib: `${FQN}/lib`,
    ui: `${FQN}/components/ui`,
  },
};

const NEW_ALIASES = {
  components: '#components',
  utils: '#lib/utils',
  hooks: '#hooks',
  lib: '#lib',
  ui: '#components/ui',
};

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/**
 * The shared shadcn package, and a shadcn website depending on it, as the
 * release before the imports/exports move left them. Hardcoded rather than
 * produced by running the generator: a migration has to keep applying to the
 * shape that shipped, however far the generator's output moves afterwards.
 */
const givenSharedShadcnPackage = (
  tree: Tree,
  {
    componentsJson = OLD_COMPONENTS_JSON,
    button = OLD_BUTTON,
    sidebar = OLD_SIDEBAR,
  }: {
    componentsJson?: Record<string, unknown>;
    button?: string;
    sidebar?: string;
  } = {},
): void => {
  tree.write(
    PACKAGE_JSON,
    JSON.stringify(
      { name: FQN, version: '0.0.1', private: true, dependencies: {} },
      null,
      2,
    ),
  );
  tree.write(COMPONENTS_JSON, JSON.stringify(componentsJson, null, 2));
  tree.write(BUTTON, button);
  tree.write(SIDEBAR, sidebar);
  tree.write(UTILS, `export const cn = (...args: unknown[]) => args;\n`);
  tree.write(USE_MOBILE, `export const useIsMobile = () => false;\n`);

  tree.write(
    'tsconfig.base.json',
    JSON.stringify(
      {
        compilerOptions: {
          paths: {
            [FQN]: [`./${SHADCN_ROOT}/src/index.ts`],
            [`${FQN}/*`]: [`./${SHADCN_ROOT}/src/*`],
          },
        },
      },
      null,
      2,
    ),
  );

  addProjectConfiguration(tree, 'test-app', {
    root: WEBSITE_ROOT,
    sourceRoot: `${WEBSITE_ROOT}/src`,
    metadata: {
      generator: REACT_WEBSITE_APP_GENERATOR_INFO.id,
      ux: 'shadcn',
    } as Record<string, unknown>,
  });
  tree.write(
    WEBSITE_MANIFEST,
    JSON.stringify(
      { name: '@proj/test-app', version: '0.0.1', dependencies: {} },
      null,
      2,
    ),
  );
};

describe('shadcn-package-imports-exports migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should apply to the shape the generators produce', async () => {
    givenSharedShadcnPackage(tree);

    const result = await migration(tree);

    expect(readJson(tree, COMPONENTS_JSON).aliases).toEqual(NEW_ALIASES);

    const packageJson = readJson(tree, PACKAGE_JSON);
    expect(packageJson.imports).toEqual({
      '#components/*': './src/components/*.tsx',
      '#lib/*': './src/lib/*.ts',
      '#hooks/*': './src/hooks/*.ts',
    });
    expect(packageJson.exports).toEqual({
      '.': './src/index.ts',
      './styles/*': './src/styles/*',
      './components/*': './src/components/*.tsx',
      './lib/*': './src/lib/*.ts',
      './hooks/*': './src/hooks/*.ts',
    });

    const button = read(tree, BUTTON);
    expect(button).not.toContain(FQN);
    expect(button).toContain("from '#lib/utils'");

    const sidebar = read(tree, SIDEBAR);
    expect(sidebar).not.toContain(FQN);
    expect(sidebar).toContain("from '#hooks/use-mobile'");
    expect(sidebar).toContain("from '#lib/utils'");
    expect(sidebar).toContain("from '#components/ui/button'");
    // The binding survives the move.
    expect(sidebar).toContain('Button');

    const basePaths = readJson(tree, 'tsconfig.base.json').compilerOptions
      .paths;
    expect(basePaths).not.toHaveProperty(`${FQN}/*`);

    const websiteDeps = readJson(tree, WEBSITE_MANIFEST).dependencies;
    expect(websiteDeps[FQN]).toBe('workspace:*');

    expect(result.nextSteps).toEqual([]);
  });

  it('should keep bindings a project added of its own', async () => {
    givenSharedShadcnPackage(tree, {
      button: OLD_BUTTON.replace(
        "import { cn } from '@proj/common-shadcn/lib/utils';",
        "import { cn, cva } from '@proj/common-shadcn/lib/utils';",
      ),
    });

    await migration(tree);

    const button = read(tree, BUTTON);
    expect(button).toContain("from '#lib/utils'");
    expect(button).toContain('cva');
  });

  it('should skip and report a customised import form', async () => {
    // A namespace import is not the generated shape, so it is reported for
    // the user to move by hand rather than rewritten.
    givenSharedShadcnPackage(tree, {
      sidebar: `import * as utils from '${FQN}/lib/utils';\n`,
    });

    const result = await migration(tree);

    expect(read(tree, SIDEBAR)).toContain(
      `import * as utils from '${FQN}/lib/utils'`,
    );
    expect(result.nextSteps).toEqual([
      expect.stringContaining(`${SIDEBAR}: still imports '${FQN}/lib/utils'`),
    ]);
  });

  it('should leave a components.json with customised aliases alone', async () => {
    const customAliases = {
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'new-york',
      aliases: {
        components: '~/components',
        utils: '~/lib/utils',
        hooks: '~/hooks',
        lib: '~/lib',
        ui: '~/components/ui',
      },
    };
    givenSharedShadcnPackage(tree, { componentsJson: customAliases });

    const result = await migration(tree);

    expect(readJson(tree, COMPONENTS_JSON)).toEqual(customAliases);
    expect(read(tree, BUTTON)).toContain(FQN);
    expect(readJson(tree, PACKAGE_JSON)).not.toHaveProperty('imports');
    expect(result.nextSteps).toEqual([
      expect.stringContaining(`${COMPONENTS_JSON}: aliases have diverged`),
    ]);
  });

  it('should leave a workspace that already moved itself alone', async () => {
    givenSharedShadcnPackage(tree, {
      componentsJson: {
        $schema: 'https://ui.shadcn.com/schema.json',
        style: 'new-york',
        aliases: NEW_ALIASES,
      },
      button: `import { cn } from '#lib/utils';\n`,
      sidebar: `import { cn } from '#lib/utils';\n`,
    });

    const result = await migration(tree);

    expect(read(tree, BUTTON)).toBe(`import { cn } from '#lib/utils';\n`);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    givenSharedShadcnPackage(tree);

    await migration(tree);
    const afterFirst = {
      button: read(tree, BUTTON),
      sidebar: read(tree, SIDEBAR),
      componentsJson: readJson(tree, COMPONENTS_JSON),
      packageJson: readJson(tree, PACKAGE_JSON),
      basePaths: readJson(tree, 'tsconfig.base.json'),
      websiteManifest: readJson(tree, WEBSITE_MANIFEST),
    };
    const result = await migration(tree);

    expect(read(tree, BUTTON)).toEqual(afterFirst.button);
    expect(read(tree, SIDEBAR)).toEqual(afterFirst.sidebar);
    expect(readJson(tree, COMPONENTS_JSON)).toEqual(afterFirst.componentsJson);
    expect(readJson(tree, PACKAGE_JSON)).toEqual(afterFirst.packageJson);
    expect(readJson(tree, 'tsconfig.base.json')).toEqual(afterFirst.basePaths);
    expect(readJson(tree, WEBSITE_MANIFEST)).toEqual(
      afterFirst.websiteManifest,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a workspace with no shared shadcn package alone', async () => {
    const result = await migration(tree);

    expect(tree.exists(COMPONENTS_JSON)).toBe(false);
    expect(result.nextSteps).toEqual([]);
  });
});
