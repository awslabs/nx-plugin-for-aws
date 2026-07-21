/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { builtinModules } from 'node:module';
import { joinPathFragments, readJson, type Tree } from '@nx/devkit';
import { minimatch } from 'minimatch';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import '../utils/mock-project-graph';
import { tsSmithyApiGenerator } from '../smithy/ts/api/generator';
import { tsTrpcApiGenerator } from '../trpc/backend/generator';
import { tsAgentGenerator } from '../ts/agent/generator';
import { tsAstroDocsGenerator } from '../ts/astro-docs/generator';
import { tsLambdaFunctionGenerator } from '../ts/lambda-function/generator';
import tsProjectGenerator from '../ts/lib/generator';
import { tsMcpServerGenerator } from '../ts/mcp-server/generator';
import { tsRdbGenerator } from '../ts/rdb/generator';
import { tsReactWebsiteGenerator } from '../ts/react-website/app/generator';
import { createTreeUsingTsSolutionSetup } from './test';

/**
 * Every project a generator vends must declare the third-party packages its
 * source imports in its own package.json — the vended
 * `noUndeclaredDependencies: error` lint rule enforces exactly this in user
 * workspaces, but only at CI/build time there. This spec enforces the same
 * invariant against the in-memory tree, so a template importing a package the
 * emitting generator forgot to declare fails the unit suite rather than a
 * downstream smoke test.
 *
 * File classes mirror the vended biome config: config, spec/test and stories
 * files may use root-level tooling (root package.json devDependencies);
 * everything else must resolve from the owning project's manifest.
 */

// Must match the `overrides` includes in DEFAULT_BIOME_CONFIG (format.ts).
const ROOT_TOOLING_FILE_GLOBS = [
  '**/*.config.{ts,mts,cts,js,mjs,cjs}',
  '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  '**/*.stories.{ts,tsx}',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/** `@scope/name/deep/path` -> `@scope/name`; `pkg/deep/path` -> `pkg`. */
const toPackageName = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/** The DefinitelyTyped package for a runtime package name. */
const toTypesPackageName = (packageName: string): string =>
  packageName.startsWith('@')
    ? `@types/${packageName.slice(1).replace('/', '__')}`
    : `@types/${packageName}`;

interface ImportedPackage {
  packageName: string;
  /** Every import of this package in the file is type-only. */
  typeOnly: boolean;
}

/**
 * Collect the external package names a source file imports, using the
 * TypeScript AST (static imports, export-from and dynamic import calls).
 */
const collectImportedPackages = (
  filePath: string,
  contents: string,
): ImportedPackage[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
  );
  const byPackage = new Map<string, boolean>();

  const record = (specifier: string, typeOnly: boolean) => {
    // Skip relative imports, node builtins and protocol-style virtual modules
    // (`astro:content`, `bun:test`, ...) — none resolve to npm packages, and
    // the vended lint rule ignores them too.
    if (
      specifier.startsWith('.') ||
      NODE_BUILTINS.has(specifier) ||
      /^[a-z-]+:/.test(specifier)
    ) {
      return;
    }
    const packageName = toPackageName(specifier);
    byPackage.set(
      packageName,
      (byPackage.get(packageName) ?? true) && typeOnly,
    );
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier.text, node.importClause?.isTypeOnly ?? false);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier.text, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      record(node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return [...byPackage.entries()].map(([packageName, typeOnly]) => ({
    packageName,
    typeOnly,
  }));
};

const collectDeclared = (tree: Tree, packageJsonPath: string): Set<string> => {
  const json = readJson<Record<string, Record<string, string> | undefined>>(
    tree,
    packageJsonPath,
  );
  return new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
  ]);
};

/** Recursively list files under a directory in the tree. */
const listFiles = (tree: Tree, dir: string): string[] =>
  tree.children(dir).flatMap((child) => {
    const path = joinPathFragments(dir, child);
    return tree.isFile(path) ? [path] : listFiles(tree, path);
  });

describe('vended projects declare the dependencies their source imports', () => {
  let tree: Tree;

  beforeAll(async () => {
    tree = createTreeUsingTsSolutionSetup();
    // A representative sweep of TypeScript generators, covering the shared
    // packages (constructs, agent-connection, shadcn, scripts) and the main
    // project types.
    await tsProjectGenerator(tree, { name: 'ts-lib' });
    await tsReactWebsiteGenerator(tree, {
      name: 'website',
      iac: 'cdk',
      ux: 'shadcn',
    });
    await tsTrpcApiGenerator(tree, {
      name: 'trpc-api',
      infra: 'http-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });
    await tsSmithyApiGenerator(tree, {
      name: 'smithy-api',
      infra: 'rest-lambda',
      auth: 'iam',
      iac: 'cdk',
    });
    await tsAgentGenerator(tree, {
      project: 'ts-lib',
      infra: 'none',
      iac: 'cdk',
    });
    await tsMcpServerGenerator(tree, {
      project: 'ts-lib',
      infra: 'none',
      iac: 'cdk',
    });
    await tsLambdaFunctionGenerator(tree, {
      project: 'ts-lib',
      name: 'TestFunction',
      event: 'EventBridgeSchema',
      iac: 'cdk',
    });
    await tsRdbGenerator(tree, {
      name: 'db',
      directory: 'packages',
      infra: 'aurora',
      engine: 'postgres',
      databaseUser: 'databaseUser',
      databaseName: 'databaseName',
      framework: 'prisma',
      iac: 'cdk',
    });
    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      preferInstallDependencies: false,
    });
    // terraform#project is intentionally omitted: terraform projects carry no
    // package.json (their deps live at the workspace root), so there's no
    // project manifest for this per-project sweep to check.
  });

  it('has no undeclared third-party imports in any vended project', () => {
    const rootDeclared = collectDeclared(tree, 'package.json');

    // Project manifests (any non-root package.json), with their names so
    // cross-project imports are recognised as local.
    const manifestPaths = listFiles(tree, '.').filter(
      (path) => path !== 'package.json' && path.endsWith('/package.json'),
    );
    const localPackageNames = new Set(
      manifestPaths.map(
        (path) => readJson<{ name?: string }>(tree, path).name ?? '',
      ),
    );

    const undeclaredByProject: Record<string, string[]> = {};

    for (const manifestPath of manifestPaths) {
      const projectRoot = manifestPath.slice(0, -'/package.json'.length);
      const declared = collectDeclared(tree, manifestPath);

      for (const filePath of listFiles(tree, projectRoot)) {
        if (!SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
          continue;
        }
        const usesRootTooling = ROOT_TOOLING_FILE_GLOBS.some((glob) =>
          minimatch(filePath, glob),
        );
        const contents = tree.read(filePath, 'utf-8') ?? '';

        for (const imported of collectImportedPackages(filePath, contents)) {
          const { packageName, typeOnly } = imported;
          if (localPackageNames.has(packageName)) {
            continue;
          }
          const satisfiedBy = (declarations: Set<string>) =>
            declarations.has(packageName) ||
            (typeOnly && declarations.has(toTypesPackageName(packageName)));
          if (satisfiedBy(declared)) {
            continue;
          }
          if (usesRootTooling && satisfiedBy(rootDeclared)) {
            continue;
          }
          undeclaredByProject[projectRoot] = [
            ...(undeclaredByProject[projectRoot] ?? []),
            `${packageName} (${filePath})`,
          ];
        }
      }
    }

    expect(
      undeclaredByProject,
      'Projects import packages their package.json does not declare — the vended noUndeclaredDependencies lint rule will fail. Declare them via addDependenciesToPackageJson targeting the owning project manifest.',
    ).toEqual({});
  });
});
