/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  getPackageManagerCommand,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateJson,
} from '@nx/devkit';
import { libraryGenerator } from '@nx/react';
import { configureTsProject } from '../ts/lib/ts-project-utils';
import { formatFilesInSubtree } from './format';
import { getNpmScopePrefix, toScopeAlias } from './npm-scope';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
  SHARED_SHADCN_NAME,
} from './shared-constructs-constants';
import { withVersions } from './versions';

const SHADCN_DEPS = [
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'lucide-react',
  'tw-animate-css',
  '@radix-ui/react-label',
  '@radix-ui/react-primitive',
  '@radix-ui/react-slot',
  '@radix-ui/react-separator',
  '@radix-ui/react-dialog',
  '@radix-ui/react-tooltip',
] as const;

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

export async function sharedShadcnGenerator(tree: Tree) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = toScopeAlias(npmScopePrefix);
  const sharedShadcnAlias = `${scopeAlias}${SHARED_SHADCN_NAME}`;
  const fullyQualifiedName = `${npmScopePrefix}${SHARED_SHADCN_NAME}`;
  const libraryRoot = joinPathFragments(PACKAGES_DIR, SHARED_SHADCN_DIR);
  const shadcnSrcRoot = joinPathFragments(libraryRoot, 'src');

  ensureNpmrcIgnoresWorkspaceRoot(tree);

  if (!tree.exists(joinPathFragments(libraryRoot, 'project.json'))) {
    await libraryGenerator(tree, {
      name: fullyQualifiedName,
      directory: libraryRoot,
      bundler: 'vite',
      unitTestRunner: 'vitest',
      linter: 'eslint',
      style: 'css',
    });
    tree.delete(shadcnSrcRoot);
    // The Nx React library generator can scaffold a Babel config we don't need.
    tree.delete(joinPathFragments(libraryRoot, '.babelrc'));

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
      joinPathFragments(__dirname, 'files', SHARED_SHADCN_DIR),
      libraryRoot,
      {
        fullyQualifiedName,
        pkgMgrCmd: getPackageManagerCommand().exec,
        scopeAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
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
          lib: Array.from(
            new Set([...(json.compilerOptions?.lib ?? []), 'DOM']),
          ),
        },
      }),
    );

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

  updateJson(tree, joinPathFragments(libraryRoot, 'project.json'), (json) => {
    const buildTarget = json.targets?.build;
    if (!buildTarget) {
      return json;
    }

    const outputPath = joinPathFragments('dist', libraryRoot);
    const outputs =
      buildTarget.outputs && buildTarget.outputs.length > 0
        ? buildTarget.outputs
        : ['{options.outputPath}'];
    const compileTarget =
      json.targets?.compile ??
      ({
        executor: 'nx:run-commands',
        outputs: [
          `{workspaceRoot}/${joinPathFragments('dist', libraryRoot, 'tsc')}`,
        ],
        options: {
          command: 'tsc --build tsconfig.lib.json',
          cwd: '{projectRoot}',
        },
      } as const);
    const buildDependsOn = Array.from(
      new Set([...(buildTarget.dependsOn ?? []), 'compile']),
    );

    return {
      ...json,
      targets: {
        ...json.targets,
        build: {
          ...buildTarget,
          outputs,
          dependsOn: buildDependsOn,
          options: {
            ...buildTarget.options,
            outputPath: outputPath,
          },
        },
        compile: compileTarget,
      },
    };
  });

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
