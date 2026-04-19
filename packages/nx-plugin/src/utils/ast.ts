/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { QueryBuilder } from '@getgrit/gritql';

const assertFilePath = (tree: Tree, filePath: string) => {
  if (!tree.exists(filePath)) {
    throw new Error(`No file located at ${filePath}`);
  }
};

export const addDestructuredImport = async (
  tree: Tree,
  filePath: string,
  variableNames: string[],
  from: string,
) => {
  assertFilePath(tree, filePath);

  // Check if there's an existing import from this module
  const hasExistingImport = await matchGritQL(
    tree,
    filePath,
    `\`import { $_ } from '${from}'\``,
  );

  if (hasExistingImport) {
    // For each new variable, use GritQL rewrite to add it if not already present
    for (const variableName of variableNames) {
      const localName = variableName.includes(' as ')
        ? variableName.split(' as ')[1]
        : variableName;
      // Use rewrite (=>) which correctly handles comma-separated import specifier lists
      await applyGritQL(
        tree,
        filePath,
        `\`import { $imports } from '${from}'\` => \`import { $imports, ${variableName} } from '${from}'\` where { $imports <: not contains \`${localName}\` }`,
      );
    }
  } else {
    // No existing import — prepend a new one
    const specifiers = variableNames.join(', ');
    const contents = tree.read(filePath)!.toString();
    tree.write(
      filePath,
      `import { ${specifiers} } from '${from}';\n${contents}`,
    );
  }
};

/**
 * Adds an `import <variableName> from '<from>'; statement to the beginning of the file,
 * if it doesn't already exist
 */
export const addSingleImport = async (
  tree: Tree,
  filePath: string,
  variableName: string,
  from: string,
) => {
  assertFilePath(tree, filePath);

  // Check if default import already exists using GritQL
  const alreadyImported = await matchGritQL(
    tree,
    filePath,
    `\`import ${variableName} from '${from}'\``,
  );
  if (alreadyImported) {
    return;
  }

  // Prepend new import to file
  const contents = tree.read(filePath)!.toString();
  tree.write(filePath, `import ${variableName} from "${from}";\n${contents}`);
};

/**
 * Adds an `export * from '<from>'; statement to the given TypeScript file.
 * Note that this will create the file if it does not exist in the tree.
 */
export const addStarExport = async (
  tree: Tree,
  filePath: string,
  from: string,
) => {
  const contents = tree.read(filePath)?.toString() ?? '';

  // For empty/non-existent files, just write the export
  if (!contents.trim()) {
    tree.write(filePath, `export * from "${from}";\n`);
    return;
  }

  // Check if already exported using GritQL
  const alreadyExported = await matchGritQL(
    tree,
    filePath,
    `\`export * from '${from}'\``,
  );
  if (alreadyExported) {
    return;
  }

  // Prepend new export to file
  tree.write(filePath, `export * from "${from}";\n${contents}`);
};

/**
 * Return whether or not the given identifier is exported in the source file.
 * Checks for both `export { Identifier }` and `export type Identifier = ...`.
 */
export const hasExportDeclaration = async (
  source: string,
  identifierName: string,
): Promise<boolean> => {
  const patterns = [
    `\`export type ${identifierName} = $_\``,
    `\`export { ${identifierName} }\``,
    `\`export type { ${identifierName} } from $_\``,
  ];

  for (const pattern of patterns) {
    try {
      const q = new QueryBuilder(`$p => $p where { $p <: ${pattern} }`);
      const result = await q.applyToFile({
        path: 'check.ts',
        content: source,
      });
      if (result !== null) return true;
    } catch {
      // Pattern didn't match, try next
    }
  }

  return false;
};

/**
 * Apply a GritQL pattern to a file in the Nx tree.
 */
export const applyGritQL = async (
  tree: Tree,
  filePath: string,
  pattern: string,
): Promise<boolean> => {
  if (!tree.exists(filePath)) throw new Error(`No file at ${filePath}`);
  const source = tree.read(filePath)!.toString();
  const query = new QueryBuilder(pattern);
  const result = await query.applyToFile({ path: filePath, content: source });
  if (result && result.content !== source) {
    tree.write(filePath, result.content);
    return true;
  }
  return false;
};

/**
 * Check whether a GritQL pattern matches anywhere in a file.
 * Returns true if the pattern matches at least once.
 *
 * Accepts raw GritQL, including patterns that start with a `language <name>`
 * header (e.g. `language python\n\`print($_)\``) — the pattern is passed
 * straight through to QueryBuilder without any wrapping rewrite.
 */
export const matchGritQL = async (
  tree: Tree,
  filePath: string,
  pattern: string,
): Promise<boolean> => {
  if (!tree.exists(filePath)) return false;
  const source = tree.read(filePath)!.toString();
  let matched = false;
  try {
    const query = new QueryBuilder(pattern);
    query.filter(() => {
      matched = true;
      return true;
    });
    await query.applyToFile({ path: filePath, content: source });
  } catch {
    return false;
  }
  return matched;
};
