/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import { addPythonDestructuredImport } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { normalizeDistributionName } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';
import type { UVPyprojectToml } from '../../../utils/nxlv-python.js';
import { tryReadToml } from '../../../utils/toml.js';

/**
 * Replace the `current_time` tool from strands-agents-tools with a local
 * `current_time` tool in py#agent projects.
 *
 * strands-agents-tools 0.9.0 is a tombstone release: importing any of its
 * tools raises ImportError. The py#agent generator now defines `current_time`
 * in agent.py with the `@tool` decorator, next to the sample `subtract` tool.
 *
 * In every Python file of a py#agent project with a top-level
 * `from strands_tools import ...` that imports `current_time`, the migration
 * drops `current_time` from that import (keeping any other names), defines the
 * local tool after the file's imports, and adds the `datetime` and `strands`
 * imports it needs. Code that refers to `current_time`, such as an Agent's
 * `tools=[...]` list, then uses the local tool.
 *
 * A file is left unchanged and listed in `nextSteps` when the rewrite would
 * not be safe: `current_time` is aliased, imported twice, imported below top
 * level or already defined, or a name the tool needs (`datetime`, `UTC`,
 * `tool`) is already bound to something else. A file that still imports from
 * strands_tools after the migration is listed in `nextSteps` too.
 *
 * The generator no longer adds strands-agents-tools, but this migration leaves
 * the dependency in place: a py#agent project whose `[project].dependencies`
 * lists it gets a `nextSteps` note to keep it below 0.9 or remove it.
 */

const STRANDS_TOOLS_MODULE = 'strands_tools';
const CURRENT_TIME = 'current_time';

/** The tool the generator vends in agent.py. */
const CURRENT_TIME_TOOL = `@tool
def current_time() -> str:
    """Get the current date and time in UTC (ISO 8601)."""
    return datetime.now(UTC).isoformat()`;

/** The imports {@link CURRENT_TIME_TOOL} needs, as module and names. */
const TOOL_IMPORTS: [module: string, names: string[]][] = [
  ['datetime', ['UTC', 'datetime']],
  ['strands', ['tool']],
];

/** A `from <module> import <names>` statement in a Python file. */
interface FromImport {
  /** Offset of the statement's first character. */
  readonly start: number;
  /** Offset just past the statement, before its line break. */
  readonly end: number;
  readonly module: string;
  /** True when the statement starts at column 0. */
  readonly topLevel: boolean;
  /**
   * The imported names. Undefined for a statement this migration does not
   * parse, such as one with a comment, a line continuation or `*`.
   */
  readonly names?: ImportedName[];
}

interface ImportedName {
  readonly name: string;
  readonly alias?: string;
}

/** `from <module> import <names>`, with the names on one line or in parentheses. */
const FROM_IMPORT =
  /^([ \t]*)from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm;
/** A top-level `import <modules>` statement. */
const TOP_LEVEL_IMPORT = /^import[ \t][^\n]*/gm;
const IMPORTED_NAME = /^(\w+)(?:\s+as\s+(\w+))?$/;

/** Parse the comma-separated names of a from-import, or undefined if any is not a plain (aliased) name. */
const parseNames = (list: string): ImportedName[] | undefined => {
  const names: ImportedName[] = [];
  for (const entry of list.replace(/^\(|\)$/g, '').split(',')) {
    if (entry.trim() === '') continue;
    const match = IMPORTED_NAME.exec(entry.trim());
    if (!match) return undefined;
    names.push({ name: match[1], alias: match[2] });
  }
  return names;
};

const parseFromImports = (content: string): FromImport[] =>
  [...content.matchAll(FROM_IMPORT)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    module: match[2],
    topLevel: match[1] === '',
    names: parseNames(match[3]),
  }));

const hasWord = (text: string, word: string): boolean =>
  new RegExp(`\\b${word}\\b`).test(text);

/**
 * True when a line binds `name` outside from-imports: a `def` or `class`, an
 * assignment, a plain `import`, or an `as` alias (with, except, import).
 */
const bindsOutsideFromImports = (content: string, name: string): boolean =>
  new RegExp(
    `^[ \\t]*(?:(?:async[ \\t]+)?(?:def|class)[ \\t]+${name}\\b|${name}[ \\t]*(?::[^\\n=]*)?=(?!=)|import[ \\t][^\\n]*\\b${name}\\b)|\\bas[ \\t]+${name}\\b`,
    'm',
  ).test(content);

/**
 * True when `name` is bound in the file other than by a top-level, unaliased
 * `from <module> import <name>`. A from-import of `module` below top level
 * also counts, because a name added to it would not reach module scope.
 */
const isNameTaken = (
  content: string,
  imports: FromImport[],
  name: string,
  module: string,
): boolean =>
  bindsOutsideFromImports(content, name) ||
  imports.some((statement) => {
    if (statement.names === undefined) {
      return (
        statement.module === module ||
        hasWord(content.slice(statement.start, statement.end), name)
      );
    }
    if (statement.module === module) {
      return (
        !statement.topLevel ||
        statement.names.some(
          (entry) =>
            entry.alias !== undefined &&
            (entry.name === name || entry.alias === name),
        )
      );
    }
    return statement.names.some(
      (entry) => (entry.alias ?? entry.name) === name,
    );
  });

/** Offset just past the file's last top-level import statement. */
const endOfImports = (content: string, imports: FromImport[]): number =>
  Math.max(
    ...imports.filter((statement) => statement.topLevel).map((s) => s.end),
    ...[...content.matchAll(TOP_LEVEL_IMPORT)].map(
      (match) => match.index + match[0].length,
    ),
  );

const formatName = ({ name, alias }: ImportedName): string =>
  alias === undefined ? name : `${name} as ${alias}`;

type FileOutcome =
  /** The file was rewritten to use the local tool. */
  | { readonly kind: 'rewritten'; readonly content: string }
  /** The file imports current_time in a shape this migration leaves alone. */
  | { readonly kind: 'diverged' }
  /** The file does not import current_time from strands_tools. */
  | { readonly kind: 'none' };

/** Work out how a file that mentions strands_tools should change. */
const localiseCurrentTime = (content: string): FileOutcome => {
  const imports = parseFromImports(content);
  const timeImports = imports.filter(
    (statement) =>
      (statement.module === STRANDS_TOOLS_MODULE ||
        statement.module.startsWith(`${STRANDS_TOOLS_MODULE}.`)) &&
      hasWord(content.slice(statement.start, statement.end), CURRENT_TIME),
  );
  if (timeImports.length === 0) return { kind: 'none' };

  const [target] = timeImports;
  const names = target.names;
  if (
    timeImports.length > 1 ||
    target.module !== STRANDS_TOOLS_MODULE ||
    names === undefined ||
    isNameTaken(content, imports, CURRENT_TIME, STRANDS_TOOLS_MODULE) ||
    TOOL_IMPORTS.some(([module, toolNames]) =>
      toolNames.some((name) => isNameTaken(content, imports, name, module)),
    )
  ) {
    return { kind: 'diverged' };
  }

  // Keep the other names; drop the statement when current_time was the only one.
  const remaining = names.filter((entry) => entry.name !== CURRENT_TIME);
  const statement =
    remaining.length === 0
      ? ''
      : `from ${STRANDS_TOOLS_MODULE} import ${remaining.map(formatName).join(', ')}`;
  // The tool's imports for modules the file does not import yet. Modules it
  // already imports get the missing names appended later. Writing new imports
  // here, after the last import, rather than at the top of the file keeps them
  // below a module docstring.
  const missingImports = TOOL_IMPORTS.filter(
    ([module]) => !imports.some((s) => s.module === module),
  )
    .map(
      ([module, toolNames]) =>
        `\nfrom ${module} import ${toolNames.join(', ')}`,
    )
    .join('');
  // Edit from the end of the file so earlier offsets stay valid. The tool goes
  // after the last import, which may be the rewritten statement itself.
  const insertAt = endOfImports(content, imports);
  const withTool = `${content.slice(0, insertAt)}${missingImports}\n\n\n${CURRENT_TIME_TOOL}\n${content.slice(insertAt)}`;
  return {
    kind: 'rewritten',
    content: `${withTool.slice(0, target.start)}${statement}${withTool.slice(target.end)}`,
  };
};

const MIGRATION_GUIDE =
  'https://strandsagents.com/docs/user-guide/migrate/strands-agents-tools/';

const divergedNextStep = (filePath: string): string =>
  `${filePath}: it imports current_time from strands-agents-tools in a shape this migration does not rewrite (for example an aliased import, or a current_time, datetime, UTC or tool name the file already defines), so it was left unchanged. strands-agents-tools 0.9.0 removed current_time (importing it raises ImportError). Define a local current_time tool instead, as the py#agent generator does in agent.py: ${MIGRATION_GUIDE}`;

const strandsToolsImportNextStep = (filePath: string): string =>
  `${filePath}: it still imports from strands_tools. strands-agents-tools 0.9.0 is a tombstone release (importing any of its tools raises ImportError); keep strands-agents-tools pinned below 0.9 or replace these tools: ${MIGRATION_GUIDE}`;

/** Migrate one Python file of a py#agent project. */
const migrateFile = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const content = tree.read(filePath, 'utf-8');
  if (!content?.includes(STRANDS_TOOLS_MODULE)) return;

  const outcome = localiseCurrentTime(content);
  if (outcome.kind === 'diverged') {
    nextSteps.push(divergedNextStep(filePath));
    return;
  }
  if (outcome.kind === 'rewritten') {
    tree.write(filePath, outcome.content);
    // Append any missing names to the datetime and strands imports.
    for (const [module, names] of TOOL_IMPORTS) {
      await addPythonDestructuredImport(tree, filePath, names, module);
    }
    if (!outcome.content.includes(STRANDS_TOOLS_MODULE)) return;
  }
  nextSteps.push(strandsToolsImportNextStep(filePath));
};

const STRANDS_TOOLS = 'strands-agents-tools';

/** True when a requirement names strands-agents-tools, in any PEP 503 spelling. */
const isStrandsToolsRequirement = (requirement: unknown): boolean => {
  if (typeof requirement !== 'string') return false;
  try {
    const parsed = parsePipRequirementsLine(requirement);
    return (
      (parsed?.type === 'ProjectName' || parsed?.type === 'ProjectURL') &&
      normalizeDistributionName(parsed.name) === STRANDS_TOOLS
    );
  } catch {
    return false;
  }
};

/** True when the pyproject.toml's `[project].dependencies` lists strands-agents-tools. */
const listsStrandsTools = (tree: Tree, pyprojectPath: string): boolean => {
  const dependencies = (
    tryReadToml(tree, pyprojectPath) as UVPyprojectToml | undefined
  )?.project?.dependencies;
  return (
    Array.isArray(dependencies) && dependencies.some(isStrandsToolsRequirement)
  );
};

const strandsToolsNextStep = (pyprojectPath: string): string =>
  `${pyprojectPath}: it lists strands-agents-tools, which the py#agent generator no longer adds. strands-agents-tools 0.9.0 is a tombstone release (importing any of its tools raises ImportError); keep it pinned below 0.9 or remove it if unused.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const isPyAgentProject = (
      (project.metadata as { components?: ComponentMetadata[] })?.components ??
      []
    ).some((component) => component.generator === PY_AGENT_GENERATOR_INFO.id);
    if (!isPyAgentProject) continue;

    const pythonFiles: string[] = [];
    visitNotIgnoredFiles(tree, project.root, (filePath) => {
      if (filePath.endsWith('.py')) pythonFiles.push(filePath);
    });
    for (const filePath of pythonFiles) {
      await migrateFile(tree, filePath, nextSteps);
    }

    // The dependency stays; only point out that 0.9.0 must not be installed.
    const pyprojectPath = joinPathFragments(project.root, 'pyproject.toml');
    if (listsStrandsTools(tree, pyprojectPath)) {
      nextSteps.push(strandsToolsNextStep(pyprojectPath));
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
