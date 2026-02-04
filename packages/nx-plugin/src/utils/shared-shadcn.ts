/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateJson,
} from '@nx/devkit';
import { ArrayLiteralExpression, Expression, factory } from 'typescript';
import tsProjectGenerator from '../ts/lib/generator';
import { configureTsProject } from '../ts/lib/ts-project-utils';
import { formatFilesInSubtree } from './format';
import { getNpmScopePrefix, toScopeAlias } from './npm-scope';
import { jsonToAst, query, replace } from './ast';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
  SHARED_SHADCN_NAME,
} from './shared-constructs-constants';
import { ITsDepVersion, withVersions } from './versions';

const SHADCN_DEPS = [
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'lucide-react',
  'tw-animate-css',
  'radix-ui',
] as const satisfies ITsDepVersion[];

const NPMRC_IGNORE_WORKSPACE_ROOT_CHECK = 'ignore-workspace-root-check=true';

const ensureNpmrcIgnoresWorkspaceRoot = (tree: Tree): boolean => {
  const npmrcPath = '.npmrc';
  if (tree.exists(npmrcPath)) {
    const npmrcContent = tree.read(npmrcPath, 'utf-8');
    const alreadyConfigured = npmrcContent
      .split(/\r?\n/)
      .some((line) => line.trim() === NPMRC_IGNORE_WORKSPACE_ROOT_CHECK);

    if (alreadyConfigured) {
      return false;
    }

    const needsTrailingNewline =
      npmrcContent.length > 0 && !npmrcContent.endsWith('\n');
    tree.write(
      npmrcPath,
      `${npmrcContent}${needsTrailingNewline ? '\n' : ''}${NPMRC_IGNORE_WORKSPACE_ROOT_CHECK}\n`,
    );
    return true;
  }

  tree.write(npmrcPath, `${NPMRC_IGNORE_WORKSPACE_ROOT_CHECK}\n`);
  return true;
};

const addSharedShadcnEslintRules = (
  tree: Tree,
  eslintConfigPath: string,
): void => {
  if (!tree.exists(eslintConfigPath)) {
    return;
  }

  const existingRule = query(
    tree,
    eslintConfigPath,
    'PropertyAssignment:has(StringLiteral[value="@nx/enforce-module-boundaries"])',
  );

  if (existingRule.length > 0) {
    return;
  }

  // shadcn generates aliased imports from components.json, which conflict with our
  // relative-import lint rule. This rule is therefore disabled for common-shadcn.
  // import { cn } from ':my-app/common-shadcn/lib/utils';

  const ruleConfig = jsonToAst({
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  }) as Expression;

  replace(
    tree,
    eslintConfigPath,
    'ExportAssignment > ArrayLiteralExpression',
    (node: ArrayLiteralExpression) =>
      factory.createArrayLiteralExpression(
        [...node.elements, ruleConfig],
        true,
      ),
  );
};

export async function sharedShadcnGenerator(tree: Tree) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = toScopeAlias(npmScopePrefix);
  const sharedShadcnAlias = `${scopeAlias}${SHARED_SHADCN_NAME}`;
  const fullyQualifiedName = `${npmScopePrefix}${SHARED_SHADCN_NAME}`;
  const libraryRoot = joinPathFragments(PACKAGES_DIR, SHARED_SHADCN_DIR);
  const shadcnSrcRoot = joinPathFragments(libraryRoot, 'src');
  const eslintConfigPath = joinPathFragments(libraryRoot, 'eslint.config.mjs');

  ensureNpmrcIgnoresWorkspaceRoot(tree);

  if (!tree.exists(joinPathFragments(libraryRoot, 'project.json'))) {
    await tsProjectGenerator(tree, {
      name: SHARED_SHADCN_NAME,
      directory: PACKAGES_DIR,
      subDirectory: SHARED_SHADCN_DIR,
    });

    tree.delete(shadcnSrcRoot);

    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_SHADCN_DIR, 'src'),
      shadcnSrcRoot,
      {
        scopeAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );

    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_SHADCN_DIR, 'readme'),
      libraryRoot,
      {
        fullyQualifiedName,
        scopeAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );

    configureTsProject(tree, {
      dir: libraryRoot,
      fullyQualifiedName,
    });

    updateJson(
      tree,
      joinPathFragments(libraryRoot, 'tsconfig.lib.json'),
      (json) => ({
        ...json,
        compilerOptions: {
          ...json.compilerOptions,
          jsx: 'react-jsx',
          module: 'preserve',
          moduleResolution: 'bundler',
          lib: Array.from(
            new Set([...(json.compilerOptions?.lib ?? []), 'DOM']),
          ),
        },
        include: Array.from(new Set([...(json.include ?? []), 'src/**/*.tsx'])),
      }),
    );

    addSharedShadcnEslintRules(tree, eslintConfigPath);
    addDependenciesToPackageJson(tree, withVersions([...SHADCN_DEPS]), {});
  }

  updateJson(tree, 'tsconfig.base.json', (json) => ({
    ...json,
    compilerOptions: {
      ...json.compilerOptions,
      paths: {
        ...(json.compilerOptions?.paths ?? {}),
        [`${sharedShadcnAlias}/*`]: [
          joinPathFragments(libraryRoot, 'src', '*'),
        ],
      },
    },
  }));

  if (!tree.exists('components.json')) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'shadcn'),
      '.',
      {
        sharedShadcnAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }

  await formatFilesInSubtree(tree);
}
