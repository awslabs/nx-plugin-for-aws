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
 * Ensure a Python `from <module> import <name1>, <name2>, ...` statement
 * exists in the given file. If the module already has a `from <module> import`
 * line, any missing names are appended; otherwise a fresh import statement is
 * prepended to the file (ruff's import sorter will reorder it into place on
 * the next format pass).
 *
 * We try to append first (which only succeeds if an import-from for the
 * module already exists AND the name isn't yet in the list). If nothing
 * was rewritten after trying every requested name, we fall back to checking
 * whether the module is imported at all; if not, we prepend a fresh
 * `from <module> import ...` line.
 */
export const addPythonDestructuredImport = async (
  tree: Tree,
  filePath: string,
  variableNames: string[],
  from: string,
) => {
  assertFilePath(tree, filePath);

  // Determine whether there's any `from <module> import ...` line in the file.
  // We detect this by attempting a no-op transformation — the file is unchanged,
  // but a successful match tells us the line exists.
  const beforeContents = tree.read(filePath)!.toString();
  let moduleAlreadyImported = false;
  for (const variableName of variableNames) {
    // Appends the name if the import-from exists and the name isn't already there.
    const appended = await applyGritQL(
      tree,
      filePath,
      `language python\n\`from ${from} import $names\` where { $names <: not contains \`${variableName}\`, $names += \`, ${variableName}\` }`,
    );
    if (appended) {
      moduleAlreadyImported = true;
    }
  }

  // If the append succeeded for at least one name, we know the module line
  // exists; we're done. If nothing was appended we need to distinguish
  // between "module not imported" (need to add a new line) and "module
  // imported but all names already present" (no-op).
  if (moduleAlreadyImported) {
    return;
  }

  const allAlreadyPresent = await matchGritQL(
    tree,
    filePath,
    `language python\n\`from ${from} import $names\` where { ${variableNames
      .map((n) => `$names <: contains \`${n}\``)
      .join(', ')} }`,
  );
  if (allAlreadyPresent) {
    return;
  }

  // No existing `from <module> import` line — prepend one. Ruff's import
  // sorter will place it in the right group on the next formatter pass.
  const specifiers = variableNames.join(', ');
  tree.write(filePath, `from ${from} import ${specifiers}\n${beforeContents}`);
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
