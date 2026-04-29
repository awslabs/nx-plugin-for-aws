/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single unified/remark-mdx pipeline that performs every MDX transformation
 * the MCP guide post-processor needs.
 *
 * Passes (each walks the already-filtered tree):
 *   1. Snippet inlining — fetches each `<Snippet name="…">`, recursively
 *      post-processes the body, and splices it back into the tree wrapped
 *      in a `<Snippet name="…">…</Snippet>` so the surrounding structure
 *      is preserved.
 *   2. Filter transforms — OptionFilter, Infrastructure, and TabItem
 *      `_filter` are evaluated against the supplied `options` (same
 *      semantics as `<OptionFilter when={{…}}>`).
 *   3. Component transforms — NxCommands / RunGenerator /
 *      GeneratorParameters / CreateNxWorkspaceCommand / InstallCommand /
 *      PackageManagerShortCommand / PackageManagerExecCommand render down
 *      to plain markdown.
 *
 * The upstream MCP binary is bundled by rolldown with
 * `output.codeSplitting: false` + `inlineDynamicImports: true`, so the
 * `await import()` calls below resolve to the same chunk at runtime and
 * ship inside the published `@aws/nx-plugin-mcp` binary with no external
 * node_modules required.
 */
import type { Root, RootContent } from 'mdast';
import type {
  MdxJsxAttribute,
  MdxJsxAttributeValueExpression,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from 'mdast-util-mdx-jsx';
import { NxGeneratorInfo } from '../utils/generators';
import {
  describePredicate,
  evaluatePredicate,
  parseWhenExpression,
  type Predicate,
} from './option-filter';
import {
  buildCreateNxWorkspaceCommand,
  buildInstallCommand,
  buildPackageManagerExecCommand,
  buildPackageManagerShortCommand,
} from '../utils/commands';
import {
  buildNxCommand,
  renderGeneratorCommand,
  renderSchema,
} from './guide-render';
import fs from 'fs';

export interface PipelineOptions {
  generators: NxGeneratorInfo[];
  packageManager?: string;
  snippetContentProvider?: (name: string) => Promise<string> | string;
  options?: Record<string, string>;
}

// unified v11 and the remark ecosystem are ESM-only; this package is CJS.
// Dynamic `import()` + a memoised promise is the cleanest bridge — rolldown
// inlines the whole dep graph at build time (see the `inlineDynamicImports`
// note at the top of this file).
interface RemarkDeps {
  unified: typeof import('unified').unified;
  remarkParse: typeof import('remark-parse').default;
  remarkMdx: typeof import('remark-mdx').default;
  remarkStringify: typeof import('remark-stringify').default;
  remarkFrontmatter: typeof import('remark-frontmatter').default;
}

let depsPromise: Promise<RemarkDeps> | undefined;
const loadRemarkDeps = (): Promise<RemarkDeps> => {
  if (!depsPromise) {
    depsPromise = (async () => ({
      unified: (await import('unified')).unified,
      remarkParse: (await import('remark-parse')).default,
      remarkMdx: (await import('remark-mdx')).default,
      remarkStringify: (await import('remark-stringify')).default,
      remarkFrontmatter: (await import('remark-frontmatter')).default,
    }))();
  }
  return depsPromise;
};

const parseMdx = (source: string, deps: RemarkDeps): Root =>
  deps
    .unified()
    .use(deps.remarkParse)
    .use(deps.remarkFrontmatter)
    .use(deps.remarkMdx)
    .parse(source) as Root;

const stringifyMdx = (tree: Root, deps: RemarkDeps): string =>
  String(
    deps
      .unified()
      .use(deps.remarkFrontmatter)
      .use(deps.remarkMdx)
      .use(deps.remarkStringify, {
        bullet: '-',
        fences: true,
        listItemIndent: 'one',
      })
      .stringify(tree),
  );

export const postProcessGuideWithRemark = async (
  guide: string,
  opts: PipelineOptions,
): Promise<string> => {
  const deps = await loadRemarkDeps();
  const tree = parseMdx(guide, deps);

  await inlineSnippets(tree, opts, deps);
  applyFilterTransforms(tree, opts.options);
  applyComponentTransforms(tree, opts, deps);

  return stringifyMdx(tree, deps);
};

// ---------------------------------------------------------------------------
// Snippet inlining
// ---------------------------------------------------------------------------

const inlineSnippets = async (
  tree: Root,
  opts: PipelineOptions,
  deps: RemarkDeps,
): Promise<void> => {
  const provider = opts.snippetContentProvider;
  if (!provider) return;

  interface PendingSnippet {
    parent: Root | MdxJsxFlowElement | MdxJsxTextElement;
    index: number;
    name: string;
    node: MdxJsxFlowElement | MdxJsxTextElement;
  }

  const pending: PendingSnippet[] = [];
  const walk = (parent: Root | MdxJsxFlowElement | MdxJsxTextElement): void => {
    const children = parent.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!isJsxElement(child)) continue;
      if (child.name === 'Snippet') {
        const name = readStringAttr(child, 'name');
        if (name) pending.push({ parent, index: i, name, node: child });
        continue;
      }
      walk(child);
    }
  };
  walk(tree);
  if (pending.length === 0) return;

  const fetched = await Promise.all(
    pending.map(async (p) => {
      let raw = '';
      try {
        raw = await provider(p.name);
      } catch {
        raw = '';
      }
      if (!raw) return { ...p, replacement: undefined };
      const processed = await postProcessGuideWithRemark(raw.trim(), opts);
      return { ...p, replacement: processed };
    }),
  );

  // Group pending items by parent so we can splice in descending order
  // per parent — keeping earlier indices stable as we go.
  const byParent = new Map<
    Root | MdxJsxFlowElement | MdxJsxTextElement,
    (typeof fetched)[number][]
  >();
  for (const f of fetched) {
    const bucket = byParent.get(f.parent) ?? [];
    bucket.push(f);
    byParent.set(f.parent, bucket);
  }
  for (const [parent, items] of byParent) {
    items.sort((a, b) => b.index - a.index);
    for (const { index, name, replacement, node } of items) {
      if (replacement === undefined) continue;
      const snippetTree = parseMdx(replacement, deps);
      const wrapper: MdxJsxFlowElement = {
        type: 'mdxJsxFlowElement',
        name: 'Snippet',
        attributes: [{ type: 'mdxJsxAttribute', name: 'name', value: name }],
        children: snippetTree.children as MdxJsxFlowElement['children'],
      };
      if ('position' in node && node.position) {
        (wrapper as { position?: unknown }).position = node.position;
      }
      (parent.children as RootContent[]).splice(
        index,
        1,
        wrapper as RootContent,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Filter transforms: OptionFilter / Infrastructure / TabItem _filter
// ---------------------------------------------------------------------------

const applyFilterTransforms = (
  tree: Root,
  options: Record<string, string> | undefined,
): void => {
  const iacProvider = options?.iacProvider;

  const transform = (
    parent: Root | MdxJsxFlowElement | MdxJsxTextElement,
  ): void => {
    const children = parent.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!isJsxElement(child)) continue;

      if (child.name === 'OptionFilter') {
        const when = parseWhenAttr(child);
        const not = hasNotAttr(child);
        if (when) {
          // Recurse into the body first so nested filters are normalised
          // before we decide whether to keep this wrapper.
          transform(child);
          if (options) {
            if (evaluatePredicate(when, not, options)) {
              children.splice(i, 1, ...(child.children as RootContent[]));
              i--;
            } else {
              children.splice(i, 1);
              i--;
            }
          } else {
            // No options → wrap the body in a `> [!NOTE] Only when …`
            // blockquote so consumers can see the branching condition.
            const marker = describePredicate(when, not);
            const description = readStringAttr(child, 'description');
            const headerLines = description
              ? [`[!NOTE] ${marker}`, description]
              : [`[!NOTE] ${marker}`];
            const note = buildNoteQuote(
              headerLines,
              child.children as RootContent[],
            );
            children.splice(i, 1, note);
          }
          continue;
        }
        // Malformed OptionFilter — leave alone but still recurse.
        continue;
      }

      if (child.name === 'Infrastructure') {
        if (iacProvider === 'CDK' || iacProvider === 'Terraform') {
          const slotName = iacProvider.toLowerCase();
          const frag = (child.children as RootContent[]).find(
            (c): c is MdxJsxFlowElement =>
              isJsxElement(c) &&
              c.name === 'Fragment' &&
              readStringAttr(c, 'slot') === slotName,
          );
          const replacement = (frag?.children as RootContent[]) ?? [];
          // Recurse into the surviving slot body so nested filters still
          // run.
          const pseudo: MdxJsxFlowElement = {
            type: 'mdxJsxFlowElement',
            name: 'tmp',
            attributes: [],
            children: replacement as MdxJsxFlowElement['children'],
          };
          transform(pseudo);
          children.splice(i, 1, ...(pseudo.children as RootContent[]));
          i--;
          continue;
        }
        // No iacProvider selection → leave Infrastructure untouched so
        // the docs site keeps the side-by-side tabs and MCP agents see
        // both slots clearly labelled.
        transform(child);
        continue;
      }

      if (child.name === 'Tabs' && child.type === 'mdxJsxFlowElement') {
        transform(child); // inner transforms first
        applyTabsFilter(child, options);
        const tabItems = (child.children as RootContent[]).filter(
          (c) => isJsxElement(c) && c.name === 'TabItem',
        ) as MdxJsxFlowElement[];
        // If every filtered tab was dropped, remove the empty Tabs block.
        if (
          tabItems.length === 0 &&
          (child.children as RootContent[]).every(
            (c) =>
              !isJsxElement(c) ||
              (c.name !== 'TabItem' && c.name !== 'TabItem'),
          )
        ) {
          children.splice(i, 1);
          i--;
          continue;
        }
        // If exactly one TabItem carried a `_filter` and survived, inline
        // its body so the agent gets a cleaner read.
        if (tabItems.length === 1) {
          const survivor = tabItems[0];
          const hadFilter = (child.children as RootContent[]).some(
            (c) =>
              isJsxElement(c) &&
              c.attributes.some(
                (a) => a.type === 'mdxJsxAttribute' && a.name === '_filter',
              ),
          );
          if (hadFilter) {
            const body = survivor.children as RootContent[];
            children.splice(i, 1, ...body);
            i--;
            continue;
          }
        }
        continue;
      }

      transform(child);
    }
  };
  transform(tree);
};

const applyTabsFilter = (
  tabs: MdxJsxFlowElement,
  options: Record<string, string> | undefined,
): void => {
  const children = tabs.children as RootContent[];
  const surviving: RootContent[] = [];
  let anyFiltered = false;
  for (const child of children) {
    if (!isJsxElement(child) || child.name !== 'TabItem') {
      surviving.push(child);
      continue;
    }
    const filterExpr = readExpressionAttr(child, '_filter');
    if (!filterExpr) {
      surviving.push(child);
      continue;
    }
    anyFiltered = true;
    let predicate: Predicate;
    try {
      predicate = parseWhenExpression(filterExpr);
    } catch {
      stripFilterAttr(child);
      surviving.push(child);
      continue;
    }
    if (!options) {
      stripFilterAttr(child);
      surviving.push(child);
      continue;
    }
    if (evaluatePredicate(predicate, false, options)) {
      stripFilterAttr(child);
      surviving.push(child);
    }
    // else: drop.
  }
  if (anyFiltered) {
    tabs.children = surviving as MdxJsxFlowElement['children'];
  }
};

const stripFilterAttr = (el: MdxJsxFlowElement | MdxJsxTextElement): void => {
  el.attributes = el.attributes.filter(
    (a) => !(a.type === 'mdxJsxAttribute' && a.name === '_filter'),
  );
};

/**
 * Wrap a body of RootContent in a blockquote, prepending one or more
 * header lines. Used when `options` is omitted to keep OptionFilter
 * branches visible with a `> [!NOTE] Only when …` marker.
 *
 * The GitHub-style `[!NOTE] …` alert syntax uses `[`/`]` characters that
 * remark-stringify normally escapes in plain text (producing
 * `> \[!NOTE]`). Emit each header line as an `html` node so it survives
 * stringification verbatim — downstream agents look for the literal
 * `> [!NOTE] Only when` marker.
 */
const buildNoteQuote = (
  headerLines: string[],
  body: RootContent[],
): RootContent => {
  const headerNodes: RootContent[] = headerLines.map(
    (line) => ({ type: 'html', value: line }) as RootContent,
  );
  return {
    type: 'blockquote',
    children: [...headerNodes, ...body] as never,
  } as RootContent;
};

// ---------------------------------------------------------------------------
// Component transforms
// ---------------------------------------------------------------------------

const applyComponentTransforms = (
  tree: Root,
  opts: PipelineOptions,
  deps: RemarkDeps,
): void => {
  const pm = opts.packageManager ?? 'pnpm';
  const transform = (
    parent: Root | MdxJsxFlowElement | MdxJsxTextElement,
  ): void => {
    const children = parent.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!isJsxElement(child)) continue;
      const replacement = renderComponent(child, opts, pm, deps);
      if (replacement !== undefined) {
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
        continue;
      }
      transform(child);
    }
  };
  transform(tree);
};

const renderComponent = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
  opts: PipelineOptions,
  pm: string,
  deps: RemarkDeps,
): RootContent[] | undefined => {
  switch (node.name) {
    case 'NxCommands': {
      const commands = readCommandsAttr(node);
      if (!commands) return undefined;
      return [
        codeBlock(
          commands
            .map((c) => buildNxCommand(c, opts.packageManager))
            .join('\n'),
        ),
      ];
    }
    case 'RunGenerator': {
      const generatorId = readStringAttr(node, 'generator');
      if (!generatorId) return undefined;
      const schema = findSchema(opts.generators, generatorId);
      if (!schema) return undefined;
      return parseMarkdownFragment(
        renderGeneratorCommand(generatorId, schema, opts.packageManager),
        deps,
      );
    }
    case 'GeneratorParameters': {
      const generatorId = readStringAttr(node, 'generator');
      if (!generatorId) return undefined;
      const schema = findSchema(opts.generators, generatorId);
      if (!schema) return undefined;
      return parseMarkdownFragment(renderSchema(schema), deps);
    }
    case 'CreateNxWorkspaceCommand': {
      const workspace = readStringAttr(node, 'workspace');
      if (!workspace) return undefined;
      const iacProvider = readStringAttr(node, 'iacProvider') as
        | 'CDK'
        | 'Terraform'
        | undefined;
      return [
        codeBlock(buildCreateNxWorkspaceCommand(pm, workspace, iacProvider)),
      ];
    }
    case 'InstallCommand': {
      const pkg =
        readStringAttr(node, 'pkg') ?? readExpressionAttr(node, 'pkg');
      if (!pkg) return undefined;
      const isDev = node.attributes.some(
        (a) => a.type === 'mdxJsxAttribute' && a.name === 'dev',
      );
      return [codeBlock(buildInstallCommand(pm, pkg, isDev))];
    }
    case 'PackageManagerShortCommand': {
      const commands = readCommandsAttr(node);
      if (!commands) return undefined;
      return [
        codeBlock(
          commands
            .map((c) => buildPackageManagerShortCommand(pm, c))
            .join('\n'),
        ),
      ];
    }
    case 'PackageManagerExecCommand': {
      const commands = readCommandsAttr(node);
      if (!commands) return undefined;
      return [
        codeBlock(
          commands.map((c) => buildPackageManagerExecCommand(pm, c)).join('\n'),
        ),
      ];
    }
    default:
      return undefined;
  }
};

const codeBlock = (body: string): RootContent => ({
  type: 'code',
  lang: 'bash',
  value: body,
});

const parseMarkdownFragment = (
  markdown: string,
  deps: RemarkDeps,
): RootContent[] => {
  const fragTree = deps.unified().use(deps.remarkParse).parse(markdown) as Root;
  return fragTree.children as RootContent[];
};

const findSchema = (
  generators: NxGeneratorInfo[],
  generatorId: string,
):
  | { properties?: Record<string, unknown>; required?: string[] }
  | undefined => {
  const info = generators.find((g) => g.id === generatorId);
  if (!info) return undefined;
  try {
    return JSON.parse(fs.readFileSync(info.resolvedSchemaPath, 'utf-8'));
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

const isJsxElement = (
  node: RootContent,
): node is MdxJsxFlowElement | MdxJsxTextElement =>
  node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';

const readStringAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
  name: string,
): string | undefined => {
  const attr = findAttr(node, name);
  if (!attr) return undefined;
  if (typeof attr.value === 'string') return attr.value;
  return undefined;
};

const readExpressionAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
  name: string,
): string | undefined => {
  const attr = findAttr(node, name);
  if (!attr) return undefined;
  if (typeof attr.value === 'object' && attr.value !== null) {
    return (attr.value as MdxJsxAttributeValueExpression).value;
  }
  return undefined;
};

const findAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
  name: string,
): MdxJsxAttribute | undefined => {
  const attr = node.attributes.find(
    (a) => a.type === 'mdxJsxAttribute' && a.name === name,
  );
  return attr?.type === 'mdxJsxAttribute' ? attr : undefined;
};

const parseWhenAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
): Predicate | undefined => {
  const expr = readExpressionAttr(node, 'when');
  if (!expr) return undefined;
  try {
    return parseWhenExpression(expr);
  } catch {
    return undefined;
  }
};

const hasNotAttr = (node: MdxJsxFlowElement | MdxJsxTextElement): boolean =>
  node.attributes.some((a) => a.type === 'mdxJsxAttribute' && a.name === 'not');

/**
 * Extract a JS-array `commands={[...]}` attribute and return the list
 * of string values. Tolerant of single-quoted entries.
 */
const readCommandsAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
): string[] | undefined => {
  const expr = readExpressionAttr(node, 'commands');
  if (!expr) return undefined;
  try {
    const jsonish = expr
      .replaceAll("\\'", '__ESCAPED_SINGLE_QUOTE__')
      .replaceAll("'", '"')
      .replaceAll('__ESCAPED_SINGLE_QUOTE__', "\\'");
    const parsed = JSON.parse(jsonish);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.map((v) => String(v));
  } catch {
    return undefined;
  }
};
