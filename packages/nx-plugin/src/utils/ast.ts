/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { ast, tsquery } from '@phenomnomnominal/tsquery';
import ts, {
  factory,
  ImportClause,
  ImportSpecifier,
  JsxChild,
  JsxClosingElement,
  JsxOpeningElement,
  Node,
  Expression,
} from 'typescript';
import { execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

const assertFilePath = (tree: Tree, filePath: string) => {
  if (!tree.exists(filePath)) {
    throw new Error(`No file located at ${filePath}`);
  }
};

const updateFile = (
  tree: Tree,
  filePath: string,
  doUpdate: (prev: string) => string,
) => {
  assertFilePath(tree, filePath);
  const contents = tree.read(filePath)?.toString() ?? '';
  const updatedContents = doUpdate(contents);
  if (updatedContents !== contents) {
    tree.write(filePath, updatedContents);
  }
};

const createOrUpdateFile = (
  tree: Tree,
  filePath: string,
  doUpdate: (prev?: string) => string,
) => {
  const contents = tree.read(filePath)?.toString();
  const updatedContents = doUpdate(contents);
  if (updatedContents !== contents) {
    tree.write(filePath, updatedContents);
  }
};

export const addDestructuredImport = (
  tree: Tree,
  filePath: string,
  variableNames: string[],
  from: string,
) => {
  updateFile(tree, filePath, (contents) => {
    const sourceAst = ast(contents);

    // Check if any of the variables are already imported from the same module
    const existingImports: ImportSpecifier[] = tsquery.query(
      sourceAst,
      `ImportDeclaration[moduleSpecifier.text="${from}"] ImportClause ImportSpecifier`,
    );

    const existingVariables = new Set(
      existingImports.map((node) => {
        const importSpecifier = node as ImportSpecifier;
        return importSpecifier.name.escapedText.toString();
      }),
    );

    // Filter out variables that are already imported
    const newVariables = variableNames.filter(
      (name) =>
        !existingVariables.has(
          name.includes(' as ') ? name.split(' as ')[1] : name,
        ),
    );

    if (newVariables.length === 0) {
      return contents;
    }

    const destructuredImport = factory.createImportDeclaration(
      undefined,
      factory.createImportClause(
        false,
        undefined,
        factory.createNamedImports([
          ...existingImports,
          ...newVariables.map((variableName) => {
            const [name, alias] = variableName.split(' as ');
            return factory.createImportSpecifier(
              false,
              alias ? factory.createIdentifier(name) : undefined,
              factory.createIdentifier(alias || name),
            );
          }),
        ]),
      ),
      factory.createStringLiteral(from, true),
    );

    return prependStatementsToCodeText(contents, [destructuredImport]);
  });
};

/**
 * Adds an `import <variableName> from '<from>'; statement to the beginning of the file,
 * if it doesn't already exist
 */
export const addSingleImport = (
  tree: Tree,
  filePath: string,
  variableName: string,
  from: string,
) => {
  updateFile(tree, filePath, (contents) => {
    const sourceAst = ast(contents);

    // Check if the import already exists
    const existingImports = tsquery.query(
      sourceAst,
      `ImportDeclaration[moduleSpecifier.text="${from}"] ImportClause > Identifier[text="${variableName}"]`,
    );

    if (existingImports.length > 0) {
      return contents;
    }

    const importDeclaration = factory.createImportDeclaration(
      undefined,
      factory.createImportClause(
        false,
        factory.createIdentifier(variableName),
        undefined,
      ) as ImportClause,
      factory.createStringLiteral(from),
    );

    return prependStatementsToCodeText(contents, [importDeclaration]);
  });
};

/**
 * Adds an `export * from '<from>'; statement to the given TypeScript file.
 * Note that this will create the file if it does not exist in the tree.
 */
export const addStarExport = (tree: Tree, filePath: string, from: string) => {
  createOrUpdateFile(tree, filePath, (contents) => {
    const hasExport =
      tsquery.query(
        ast(contents ?? ''),
        `ExportDeclaration StringLiteral[text="${from}"]`,
      ).length > 0;

    if (!hasExport) {
      const exportDeclaration = factory.createExportDeclaration(
        undefined,
        undefined,
        undefined,
        factory.createStringLiteral(from),
      );

      return prependStatementsToCodeText(contents ?? '', [exportDeclaration]);
    }
    return contents;
  });
};

/**
 * Replace nodes matching a given selector by applying the transformer on matches
 */
export const replace = (
  tree: Tree,
  filePath: string,
  selector: string,
  transformer: (node: Node) => Node,
  errorIfNoMatches = true,
) => {
  assertFilePath(tree, filePath);
  const source = tree.read(filePath).toString();

  if (errorIfNoMatches) {
    const queryNodes = tsquery.query(ast(source), selector);
    if (queryNodes.length === 0) {
      throw new Error(
        `Could not locate an element in ${filePath} matching ${selector}`,
      );
    }
  }

  const updatedSource = applyTransform(source, selector, transformer);

  if (source !== updatedSource) {
    tree.write(filePath, updatedSource);
  }
};

/**
 * Replace nodes matching a given selector if present, otherwise leaves the code unchanged
 */
export const replaceIfExists = (
  tree: Tree,
  filePath: string,
  selector: string,
  transformer: (node: Node) => Node,
) => replace(tree, filePath, selector, transformer, false);

/**
 * Apply a transform to the given code using the transformer.
 * Equivalent to tsquery.map, except that this preserves existing code formatting where possible
 */
const applyTransform = (
  code: string,
  selector: string,
  transformer: (node: Node) => Node,
): string => {
  const sourceFile = ast(code);

  const transforms: { start: number; end: number; newText: string }[] = [];

  const printer = ts.createPrinter({
    removeComments: true,
  });

  tsquery.map(sourceFile, selector, (node) => {
    const newNode = transformer(node);

    if (newNode !== node && newNode) {
      transforms.push({
        start: node.getStart(sourceFile, true),
        end: node.getEnd(),
        newText: printer.printNode(
          ts.EmitHint.Unspecified,
          newNode,
          sourceFile,
        ),
      });
    }

    return newNode;
  });

  let newCode = code;
  let offset = 0;

  transforms.forEach((transform) => {
    newCode =
      newCode.substring(0, transform.start + offset) +
      transform.newText +
      newCode.substring(transform.end + offset);
    offset = newCode.length - code.length;
  });

  return newCode;
};

const insertStatements = (
  isPrepend: boolean,
  code: string,
  statements: ts.Statement[],
): string => {
  const sourceFile = ast(code);
  const printer = ts.createPrinter();
  const newText = statements
    .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, sourceFile))
    .join('\n');
  if (isPrepend) {
    return newText + '\n' + code;
  }
  return code + '\n' + newText;
};

const appendStatementsToCodeText = (
  code: string,
  statements: ts.Statement[],
): string => {
  return insertStatements(false, code, statements);
};

const prependStatementsToCodeText = (
  code: string,
  statements: ts.Statement[],
): string => {
  return insertStatements(true, code, statements);
};

export const prependStatements = (
  tree: Tree,
  filePath: string,
  statements: ts.Statement[],
) => {
  updateFile(tree, filePath, (contents) => {
    return prependStatementsToCodeText(contents, statements);
  });
};

export const appendStatements = (
  tree: Tree,
  filePath: string,
  statements: ts.Statement[],
) => {
  updateFile(tree, filePath, (contents) => {
    return appendStatementsToCodeText(contents, statements);
  });
};

/**
 * Query a typescript file in the tree using tsquery
 */
export const query = (
  tree: Tree,
  filePath: string,
  selector: string,
): Node[] => {
  assertFilePath(tree, filePath);
  const source = tree.read(filePath).toString();
  return tsquery.query(ast(source), selector);
};

export const createJsxElementFromIdentifier = (
  identifier: string,
  children: readonly JsxChild[],
) =>
  factory.createJsxElement(
    factory.createJsxOpeningElement(
      factory.createIdentifier(identifier),
      undefined,
      factory.createJsxAttributes([]),
    ),
    children,
    factory.createJsxClosingElement(factory.createIdentifier(identifier)),
  );

export const createJsxElement = (
  openingElement: JsxOpeningElement,
  children: readonly JsxChild[],
  closingElement: JsxClosingElement,
) => factory.createJsxElement(openingElement, children, closingElement);

/**
 * Convert a given json object to its AST representation
 */
export const jsonToAst = (obj: unknown): Node => {
  if (obj === null) {
    return factory.createNull();
  }

  if (obj === undefined) {
    return factory.createIdentifier('undefined');
  }

  if (typeof obj === 'string') {
    return factory.createStringLiteral(obj);
  }

  if (typeof obj === 'number') {
    return factory.createNumericLiteral(obj);
  }

  if (typeof obj === 'boolean') {
    return obj ? factory.createTrue() : factory.createFalse();
  }

  if (Array.isArray(obj)) {
    return factory.createArrayLiteralExpression(
      obj.map((item) => jsonToAst(item) as Expression),
    );
  }

  if (typeof obj === 'object') {
    return factory.createObjectLiteralExpression(
      Object.entries(obj).map(([key, value]) => {
        // Check if the key is a valid identifier
        const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
        return factory.createPropertyAssignment(
          isValidIdentifier
            ? factory.createIdentifier(key)
            : factory.createStringLiteral(key),
          jsonToAst(value) as Expression,
        );
      }),
    );
  }

  throw new Error(`Unsupported type: ${typeof obj}`);
};

/**
 * Return whether or not the given identifier is exported in the source file
 */
export const hasExportDeclaration = (
  source: string,
  identifierName: string,
): boolean => {
  const sourceFile = ast(source);
  return (
    tsquery.query(
      sourceFile,
      `ExportDeclaration:has(ExportSpecifier:has(Identifier[name="${identifierName}"]))`,
    ).length > 0 ||
    tsquery.query(
      sourceFile,
      `TypeAliasDeclaration:has(ExportKeyword):has(Identifier[name="${identifierName}"])`,
    ).length > 0
  );
};

let gritBin: string | undefined;

const resolveGritBin = (): string => {
  if (!gritBin) {
    const cliPkgDir = dirname(require.resolve('@getgrit/cli/package.json'));
    const binPath = join(cliPkgDir, 'node_modules', '.bin_real', 'grit');
    if (!existsSync(binPath)) {
      // Binary not yet installed — trigger the @getgrit/cli install synchronously.
      // This handles cases where the postinstall was skipped (e.g. pnpm cache restore).
      try {
        execFileSync('node', [join(cliPkgDir, 'install.js')], {
          cwd: cliPkgDir,
          stdio: 'pipe',
          timeout: 60_000,
        });
      } catch {
        // Ignore install errors — check below will throw with a clear message
      }
    }
    if (!existsSync(binPath)) {
      throw new Error(
        `grit binary not found at ${binPath}. Run "pnpm install" to trigger the @getgrit/cli postinstall.`,
      );
    }
    gritBin = binPath;
  }
  return gritBin;
};

/** Spawn the native grit binary with stdin piped. */
const execGrit = (
  args: string[],
  input: string,
  timeout = 10_000,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const bin = resolveGritBin();
    const proc = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    proc.on('error', reject);
    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf-8').trim();
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8');
        reject(
          new Error(`Command failed: ${bin} ${args.join(' ')}\n${stderr}`),
        );
        return;
      }
      resolve(stdout);
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });

/**
 * Apply a GritQL pattern to a file in the Nx tree.
 * Content is passed via stdin; filePath is used only for language detection.
 */
export const applyGritQLTransform = async (
  tree: Tree,
  filePath: string,
  pattern: string,
): Promise<boolean> => {
  if (!tree.exists(filePath)) throw new Error(`No file at ${filePath}`);
  const source = tree.read(filePath)!.toString();
  const result = await execGrit(
    ['apply', pattern, '--stdin', filePath, '--dry-run'],
    source,
  );
  if (result && result !== source) {
    tree.write(filePath, result);
    return true;
  }
  return false;
};

/**
 * Check whether a GritQL pattern matches anywhere in a file.
 * Returns true if the pattern matches at least once.
 */
export const hasGritQLMatch = async (
  tree: Tree,
  filePath: string,
  pattern: string,
): Promise<boolean> => {
  if (!tree.exists(filePath)) return false;
  const source = tree.read(filePath)!.toString();
  try {
    const result = await execGrit(
      ['apply', `${pattern} => ${pattern}`, '--stdin', filePath, '--dry-run'],
      source,
    );
    return result !== '';
  } catch {
    return false;
  }
};
