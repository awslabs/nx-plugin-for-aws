/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unified + remark-mdx pipeline for the MCP `generator-guide` tool.
 *
 * Passes (in order, each over the already-transformed tree):
 *   1. Snippet inlining — `<Snippet name>` → recursive post-process.
 *   2. Filter transforms — `<OptionFilter>`, `<Infrastructure>` slot
 *      selection, `<Tabs><TabItem _filter>` pruning.
 *   3. Component transforms — `<NxCommands>` / `<RunGenerator>` /
 *      `<GeneratorParameters>` / `<CreateNxWorkspaceCommand>` /
 *      `<InstallCommand>` / `<PackageManagerShortCommand>` /
 *      `<PackageManagerExecCommand>` render down to markdown.
 */
import type { Root, RootContent } from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import { NxGeneratorInfo } from '../utils/generators';
import {
  describePredicate,
  evaluatePredicate,
  extractStringArrayExpression,
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
import {
  hasBareAttr,
  isJsxElement,
  readEstreeAttr,
  readExpressionAttr,
  readStringAttr,
  type JsxElement,
  type JsxParent,
} from './mdx-ast';
import fs from 'fs';

export interface PipelineOptions {
  generators: NxGeneratorInfo[];
  packageManager?: string;
  snippetContentProvider?: (name: string) => Promise<string> | string;
  options?: Record<string, string>;
}

// unified v11 is ESM-only and this package is CJS; dynamic import + rolldown's
// inlineDynamicImports bundles everything into the published MCP binary.
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

const parseMdxWithDeps = (source: string, deps: RemarkDeps): Root =>
  deps
    .unified()
    .use(deps.remarkParse)
    .use(deps.remarkFrontmatter)
    .use(deps.remarkMdx)
    .parse(source) as Root;

/** Parse MDX (with frontmatter) into mdast. Exposed so callers like
 *  `fetchGuideFrontmatters` don't need to re-load remark themselves. */
export const parseMdx = async (source: string): Promise<Root> => {
  const deps = await loadRemarkDeps();
  return parseMdxWithDeps(source, deps);
};

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
  const tree = parseMdxWithDeps(guide, deps);

  await inlineSnippets(tree, opts, deps);
  applyFilterTransforms(tree, opts.options);
  applyComponentTransforms(tree, opts, deps);

  return stringifyMdx(tree, deps);
};

const inlineSnippets = async (
  tree: Root,
  opts: PipelineOptions,
  deps: RemarkDeps,
): Promise<void> => {
  const provider = opts.snippetContentProvider;
  if (!provider) return;

  interface PendingSnippet {
    parent: JsxParent;
    index: number;
    name: string;
    node: JsxElement;
  }

  const pending: PendingSnippet[] = [];
  const walk = (parent: JsxParent): void => {
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

  // Splice in descending index order per parent so earlier indices stay valid.
  const byParent = new Map<JsxParent, (typeof fetched)[number][]>();
  for (const f of fetched) {
    const bucket = byParent.get(f.parent) ?? [];
    bucket.push(f);
    byParent.set(f.parent, bucket);
  }
  for (const [parent, items] of byParent) {
    items.sort((a, b) => b.index - a.index);
    for (const { index, name, replacement, node } of items) {
      if (replacement === undefined) continue;
      const snippetTree = parseMdxWithDeps(replacement, deps);
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

const applyFilterTransforms = (
  tree: Root,
  options: Record<string, string> | undefined,
): void => {
  const iacProvider = options?.iacProvider;

  const transform = (parent: JsxParent): void => {
    const children = parent.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!isJsxElement(child)) continue;

      if (child.name === 'OptionFilter') {
        const when = parseWhenAttr(child);
        if (!when) continue; // malformed — leave alone
        // Recurse first so nested filters collapse before we replace this wrapper.
        transform(child);
        const not = hasBareAttr(child, 'not');
        if (options) {
          const replacement = evaluatePredicate(when, not, options)
            ? (child.children as RootContent[])
            : [];
          children.splice(i, 1, ...replacement);
          i += replacement.length - 1;
        } else {
          children.splice(i, 1, buildNoteQuote(child, when, not));
        }
        continue;
      }

      if (child.name === 'Infrastructure') {
        if (iacProvider === 'CDK' || iacProvider === 'Terraform') {
          const body = selectInfrastructureSlot(child, iacProvider);
          const pseudo: MdxJsxFlowElement = {
            type: 'mdxJsxFlowElement',
            name: 'tmp',
            attributes: [],
            children: body as MdxJsxFlowElement['children'],
          };
          transform(pseudo);
          children.splice(i, 1, ...(pseudo.children as RootContent[]));
          i--;
          continue;
        }
        // No iacProvider → keep both slots so readers / agents see both variants.
        transform(child);
        continue;
      }

      if (child.name === 'Tabs' && child.type === 'mdxJsxFlowElement') {
        transform(child);
        const dropped = applyTabsFilter(child, options);
        if (dropped === 'empty') {
          children.splice(i, 1);
          i--;
          continue;
        }
        if (dropped === 'inline') {
          const survivor = (child.children as RootContent[]).find(
            (c): c is MdxJsxFlowElement =>
              isJsxElement(c) && c.name === 'TabItem',
          )!;
          const body = survivor.children as RootContent[];
          children.splice(i, 1, ...body);
          i += body.length - 1;
          continue;
        }
        continue;
      }

      transform(child);
    }
  };
  transform(tree);
};

const selectInfrastructureSlot = (
  node: JsxElement,
  iacProvider: 'CDK' | 'Terraform',
): RootContent[] => {
  const slotName = iacProvider.toLowerCase();
  const frag = (node.children as RootContent[]).find(
    (c): c is MdxJsxFlowElement =>
      isJsxElement(c) &&
      c.name === 'Fragment' &&
      readStringAttr(c, 'slot') === slotName,
  );
  return (frag?.children as RootContent[]) ?? [];
};

/**
 * Prune TabItems whose `_filter` doesn't match `options`. Returns:
 *   - `'empty'` if the <Tabs> now has no <TabItem>s — caller drops it.
 *   - `'inline'` if exactly one filtered <TabItem> survived — caller
 *     inlines the body so agents see just the picked variant.
 *   - `'keep'` otherwise.
 */
const applyTabsFilter = (
  tabs: MdxJsxFlowElement,
  options: Record<string, string> | undefined,
): 'empty' | 'inline' | 'keep' => {
  const children = tabs.children as RootContent[];
  const surviving: RootContent[] = [];
  let anyFiltered = false;
  for (const child of children) {
    if (!isJsxElement(child) || child.name !== 'TabItem') {
      surviving.push(child);
      continue;
    }
    const filterEstree = readEstreeAttr(child, '_filter');
    if (!filterEstree) {
      surviving.push(child);
      continue;
    }
    anyFiltered = true;
    let predicate: Predicate;
    try {
      predicate = parseWhenExpression(filterEstree as never);
    } catch {
      stripFilterAttr(child);
      surviving.push(child);
      continue;
    }
    if (!options || evaluatePredicate(predicate, false, options)) {
      stripFilterAttr(child);
      surviving.push(child);
    }
  }
  if (anyFiltered) {
    tabs.children = surviving as MdxJsxFlowElement['children'];
  }
  const tabItems = surviving.filter(
    (c) => isJsxElement(c) && c.name === 'TabItem',
  );
  if (tabItems.length === 0 && surviving.length === 0) return 'empty';
  if (anyFiltered && tabItems.length === 1) return 'inline';
  return 'keep';
};

const stripFilterAttr = (el: JsxElement): void => {
  el.attributes = el.attributes.filter(
    (a) => !(a.type === 'mdxJsxAttribute' && a.name === '_filter'),
  );
};

/**
 * `> [!NOTE] Only when …` blockquote. The alert header goes through as an
 * `html` node so remark-stringify doesn't escape the `[`/`]` brackets —
 * downstream agents match on the literal GitHub alert syntax.
 */
const buildNoteQuote = (
  source: JsxElement,
  predicate: Predicate,
  not: boolean,
): RootContent => {
  const marker = describePredicate(predicate, not);
  const description = readStringAttr(source, 'description');
  const headerLines = description
    ? [`[!NOTE] ${marker}`, description]
    : [`[!NOTE] ${marker}`];
  const headerNodes: RootContent[] = headerLines.map(
    (line) => ({ type: 'html', value: line }) as RootContent,
  );
  return {
    type: 'blockquote',
    children: [...headerNodes, ...(source.children as RootContent[])] as never,
  } as RootContent;
};

const parseWhenAttr = (node: JsxElement): Predicate | undefined => {
  const estree = readEstreeAttr(node, 'when');
  if (!estree) return undefined;
  try {
    return parseWhenExpression(estree as never);
  } catch {
    return undefined;
  }
};

const applyComponentTransforms = (
  tree: Root,
  opts: PipelineOptions,
  deps: RemarkDeps,
): void => {
  const pm = opts.packageManager ?? 'pnpm';
  const transform = (parent: JsxParent): void => {
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
  node: JsxElement,
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
      return [
        codeBlock(buildInstallCommand(pm, pkg, hasBareAttr(node, 'dev'))),
      ];
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

/** Parse the `commands={[…]}` attribute from the estree that remark-mdx
 *  attaches to the JSX attribute value. */
const readCommandsAttr = (node: JsxElement): string[] | undefined => {
  const estree = readEstreeAttr(node, 'commands');
  if (!estree) return undefined;
  try {
    return extractStringArrayExpression(estree as never);
  } catch {
    return undefined;
  }
};
