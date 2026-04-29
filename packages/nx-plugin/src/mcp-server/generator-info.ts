/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { kebabCase } from '../utils/names';
import { NxGeneratorInfo } from '../utils/generators';
import { evaluatePredicate } from './option-filter';
import {
  buildNxCommand,
  renderGeneratorCommand,
  renderSchema,
} from './guide-render';
import { postProcessGuideWithRemark } from './guide-pipeline';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Re-export so existing callers of `generator-info` continue working.
export { buildNxCommand } from './guide-render';

/**
 * Render summary information about a generator
 */
export const renderGeneratorInfo = (
  packageManager: string,
  info: NxGeneratorInfo,
): string => {
  const schema = JSON.parse(fs.readFileSync(info.resolvedSchemaPath, 'utf-8'));

  return `${info.id}

Description: ${info.description}

Available Parameters:
${renderSchema(schema)}

Command:
${renderGeneratorCommand(info.id, schema, packageManager)}
`;
};

interface GeneratorSchemaShape {
  properties?: Record<
    string,
    { enum?: unknown[]; default?: unknown; description?: string }
  >;
}

export interface FilterableOption {
  key: string;
  enum: string[];
  default?: string;
  description?: string;
}

/**
 * Load the filterable options that a generator's schema exposes as enum
 * properties. These are the options a user could pass on the CLI; agents
 * read the list to choose `options` values to pass back through
 * `generator-guide` and narrow the returned content.
 *
 * Multi-variant generators (e.g. `connection`) layer additional filterable
 * keys on top by declaring them in each guide page's `when:` frontmatter —
 * see `collectFrontmatterFilterableOptions`. The two sources are merged by
 * `loadFilterableOptionsWithFrontmatter`.
 */
export const loadFilterableOptionsFromSchema = (
  info: NxGeneratorInfo,
): FilterableOption[] => {
  const options: FilterableOption[] = [];
  try {
    const schema = JSON.parse(
      fs.readFileSync(info.resolvedSchemaPath, 'utf-8'),
    ) as GeneratorSchemaShape;
    const props = schema.properties ?? {};
    for (const [key, prop] of Object.entries(props)) {
      if (!Array.isArray(prop.enum) || prop.enum.length === 0) continue;
      options.push({
        key,
        enum: (prop.enum as unknown[]).map((v) => String(v)),
        default: prop.default !== undefined ? String(prop.default) : undefined,
        description: prop.description,
      });
    }
  } catch {
    // Schema load failure — return whatever we have (possibly nothing).
  }
  return options;
};

/**
 * Look at the `when:` frontmatter of every guide page belonging to a
 * generator and add any keys not already surfaced via the JSON schema.
 * This lets the `connection` generator advertise `sourceType` /
 * `targetType` / `protocol` without touching `generators.json`.
 */
const collectFrontmatterFilterableOptions = (
  fetched: FetchedGuide[],
  fromSchema: FilterableOption[],
): FilterableOption[] => {
  const extras = new Map<string, Set<string>>();
  for (const guide of fetched) {
    const when = guide.frontmatter.when;
    if (!when) continue;
    for (const [key, rawValues] of Object.entries(when)) {
      const bucket = extras.get(key) ?? new Set<string>();
      for (const v of rawValues) bucket.add(v);
      extras.set(key, bucket);
    }
  }
  const out: FilterableOption[] = [];
  const seen = new Set(fromSchema.map((o) => o.key));
  for (const [key, values] of extras) {
    if (seen.has(key)) continue;
    out.push({ key, enum: [...values] });
  }
  return out;
};

/**
 * Decide whether the agent-supplied `options` describe a combination the
 * generator actually supports. Returns undefined when the combination is
 * fine (including when the agent hasn't narrowed enough to decide) and a
 * human-readable explanation otherwise.
 *
 * Supported combinations are inferred from the union of `when:` predicates
 * across a generator's guide pages. A generator with no `when:` predicates
 * on any of its pages (the common case — `ts#trpc-api`, `py#fast-api` …)
 * opts out of the check automatically.
 */
const describeUnsupportedCombinationFromFetched = (
  info: NxGeneratorInfo,
  fetched: FetchedGuide[],
  options: Record<string, string> | undefined,
): string | undefined => {
  if (!options) return undefined;

  const predicates = fetched
    .map((g) => g.frontmatter.when)
    .filter((w): w is Record<string, string[]> => w !== undefined);
  if (predicates.length === 0) return undefined;

  // Consider only the option keys that actually participate in at least
  // one predicate — other options (e.g. schema enums) are orthogonal.
  const predicateKeys = new Set<string>();
  for (const p of predicates)
    for (const k of Object.keys(p)) predicateKeys.add(k);
  const suppliedPredicateKeys = [...predicateKeys].filter(
    (k) => options[k] !== undefined,
  );
  if (suppliedPredicateKeys.length === 0) return undefined;

  // If any predicate is still reachable given the keys the agent has
  // committed to so far, treat this as a partial (valid) selection and
  // skip the warning — the agent can keep narrowing.
  const stillReachable = predicates.some((pred) =>
    suppliedPredicateKeys.every((k) => {
      const values = pred[k];
      if (values === undefined) return true; // predicate doesn't care about this key
      return values.includes(options[k]);
    }),
  );
  if (stillReachable) return undefined;

  return renderUnsupportedMessage(info, options, predicates);
};

const renderUnsupportedMessage = (
  info: NxGeneratorInfo,
  requested: Record<string, string>,
  predicates: Record<string, string[]>[],
): string => {
  const requestedDesc = Object.entries(requested)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ');
  const supportedList = predicates
    .map((pred) => {
      const parts = Object.entries(pred).map(
        ([k, vs]) => `${k} = ${vs.join(' | ')}`,
      );
      return `- ${parts.join(', ')}`;
    })
    .join('\n');
  return `## ${info.id}

> [!WARNING] Unsupported combination: ${requestedDesc}. The \`${info.id}\` generator has no guide variant matching this combination — running it will likely fail.

Supported combinations:
${supportedList}

Pick a combination from the list above, or choose a different generator.`;
};

/**
 * Render the "Filterable options" block that list-generators emits for each
 * generator. Agents read this before invoking `generator-guide` and use it
 * to pass the right `options` — so the guide comes back narrowed to just
 * the branches that apply to their selection.
 *
 * This is synchronous on purpose — it only reads the schema. Frontmatter-
 * derived keys (e.g. `connection`'s sourceType/targetType/protocol) are
 * merged in by `renderFilterableOptionsWithFrontmatter` below.
 */
export const renderFilterableOptions = (info: NxGeneratorInfo): string => {
  const filterable = loadFilterableOptionsFromSchema(info);
  return formatFilterableOptions(info, filterable);
};

/**
 * Same as `renderFilterableOptions` but also folds in filter keys surfaced
 * by `when:` blocks on the generator's guide pages. Used by
 * `list-generators`, which fetches every page anyway.
 */
export const renderFilterableOptionsAsync = async (
  info: NxGeneratorInfo,
): Promise<string> => {
  const schemaOptions = loadFilterableOptionsFromSchema(info);
  const fetched = await fetchGuideFrontmatters(info);
  const frontmatterOptions = collectFrontmatterFilterableOptions(
    fetched,
    schemaOptions,
  );
  return formatFilterableOptions(info, [
    ...schemaOptions,
    ...frontmatterOptions,
  ]);
};

const formatFilterableOptions = (
  _info: NxGeneratorInfo,
  filterable: FilterableOption[],
): string => {
  if (filterable.length === 0) return '';
  const entries = filterable
    .map((opt) => {
      const def = opt.default ? ` (default: ${opt.default})` : '';
      return `- ${opt.key}: ${opt.enum.join(' | ')}${def}`;
    })
    .join('\n');
  return `\`generator-guide\` options:\n${entries}`;
};

/**
 * A guide page after its raw MDX has been fetched and the YAML frontmatter
 * parsed. The body excludes the frontmatter delimiter; the parsed
 * `frontmatter.when` predicate drives guide-level filtering.
 */
interface FetchedGuide {
  page: string;
  raw: string;
  body: string;
  frontmatter: {
    when?: Record<string, string[]>;
    title?: string;
  };
}

/**
 * Result of `fetchGuidePagesForGenerator`. When the agent's options pick
 * a combination no variant page matches, `kind` is `'unsupported'` and
 * `content` holds an explanatory warning the tool should surface on its
 * own (without wrapping it in the usual `## <id>` summary). Otherwise
 * `content` is the rendered guide text.
 */
export type GuideFetchResult =
  | { kind: 'ok'; content: string }
  | { kind: 'unsupported'; content: string };

/**
 * Retrieve the markdown guide pages for a generator.
 *
 * Every page listed in `guidePages` (or the kebab-cased generator id when
 * that field is absent) is fetched in parallel — local files first, GitHub
 * fallback — and its YAML frontmatter is parsed to pick up any `when:`
 * predicate. Pages without a `when:` are always included; pages with a
 * `when:` are included when either:
 *   - `options` is absent (agent hasn't narrowed yet — keep every variant),
 *     or
 *   - the predicate matches `options` using the same semantics as
 *     `<OptionFilter when={{…}}>` (AND across keys, OR within a key).
 *
 * If the agent has supplied enough options to identify a combination and
 * no variant page matches, the result is `{ kind: 'unsupported' }` and the
 * caller surfaces the warning directly.
 */
export const fetchGuidePagesForGenerator = async (
  info: NxGeneratorInfo,
  generators: NxGeneratorInfo[],
  packageManager?: string,
  snippetContentProvider?: SnippetContentProvider,
  options?: Record<string, string>,
): Promise<GuideFetchResult> => {
  const fetched = await fetchGuideFrontmatters(info);

  const unsupported = describeUnsupportedCombinationFromFetched(
    info,
    fetched,
    options,
  );
  if (unsupported !== undefined) {
    return { kind: 'unsupported', content: unsupported };
  }

  const kept = fetched.filter((g) => {
    if (!g.frontmatter.when) return true;
    if (!options) return true;
    return evaluatePredicate(g.frontmatter.when, false, options);
  });

  const processed = await Promise.all(
    kept.map((g) =>
      postProcessGuide(
        g.body,
        generators,
        packageManager,
        snippetContentProvider,
        options,
      ),
    ),
  );
  return { kind: 'ok', content: processed.join('\n\n') };
};

/**
 * Fetch every guide page referenced by a generator, in parallel, and
 * return { page, raw, body, frontmatter } for each one. Used by both
 * `fetchGuidePagesForGenerator` (to filter + render) and
 * `renderFilterableOptionsAsync` (to build the filterable-options list
 * from the union of frontmatter `when:` keys).
 */
export const fetchGuideFrontmatters = async (
  info: NxGeneratorInfo,
): Promise<FetchedGuide[]> => {
  const pages: string[] = [...(info.guidePages ?? [kebabCase(info.id)])];
  const results = await Promise.allSettled(
    pages.map(async (page) => ({ page, raw: await fetchGuideRaw(page) })),
  );
  const fulfilled: { page: string; raw: string }[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.raw) fulfilled.push(r.value);
  }
  return fulfilled.map(({ page, raw }) => {
    const { body, frontmatter } = splitFrontmatter(raw);
    return { page, raw, body, frontmatter };
  });
};

/**
 * Read a guide's raw MDX, local filesystem first, GitHub fallback.
 */
const fetchGuideRaw = async (page: string): Promise<string> => {
  const local = fetchLocalGuide(page);
  if (local !== undefined) return local;
  const response = await fetch(
    `https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/refs/heads/main/docs/src/content/docs/en/guides/${page}.mdx`,
  );
  return await response.text();
};

/**
 * Parse the leading YAML frontmatter off an MDX page. Returns `{ body,
 * frontmatter }` with `body` stripped of the leading `---…---` block.
 */
const splitFrontmatter = (
  raw: string,
): {
  body: string;
  frontmatter: { when?: Record<string, string[]>; title?: string };
} => {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) return { body: raw, frontmatter: {} };
  const body = raw.slice(match[0].length);
  let parsed: unknown;
  try {
    parsed = yaml.load(match[1]);
  } catch {
    return { body, frontmatter: {} };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { body, frontmatter: {} };
  }
  const obj = parsed as Record<string, unknown>;
  const frontmatter: { when?: Record<string, string[]>; title?: string } = {};
  if (typeof obj.title === 'string') frontmatter.title = obj.title;
  if (obj.when && typeof obj.when === 'object' && !Array.isArray(obj.when)) {
    const when: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(
      obj.when as Record<string, unknown>,
    )) {
      when[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
    frontmatter.when = when;
  }
  return { body, frontmatter };
};

/**
 * Search the monorepo-relative guides directory for a page before falling
 * back to GitHub. This is the common case during local development
 * (`pnpm nx mcp-inspect @aws/nx-plugin`), and it also means test workspaces
 * that link the built plugin read the guides they're actually iterating on
 * instead of whatever is currently on `main`.
 *
 * When running as the published `@aws/nx-plugin-mcp` package, `__dirname`
 * resolves somewhere inside `node_modules/@aws/nx-plugin-mcp`, the local
 * probe misses, and we fall back to GitHub.
 */
const GUIDES_RELATIVE_PROBES = [
  // nx-plugin package compiled from source (src/mcp-server/…)
  '../../../docs/src/content/docs/en/guides',
  // rolldown-bundled `@aws/nx-plugin-mcp` binary in dist
  '../../../../docs/src/content/docs/en/guides',
];

const fetchLocalGuide = (guide: string): string | undefined => {
  for (const rel of GUIDES_RELATIVE_PROBES) {
    const candidate = path.resolve(__dirname, rel, `${guide}.mdx`);
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf-8');
      }
    } catch {
      // Probe failure → keep looking.
    }
  }
  return undefined;
};

/**
 * Fetch markdown guide pages. Prefers local files (see `fetchLocalGuide`)
 * and falls back to fetching from the repo on `main` when no local copy
 * is available.
 */
export const fetchGuidePages = async (
  guidePages: string[],
  generators: NxGeneratorInfo[],
  packageManager?: string,
  snippetContentProvider?: SnippetContentProvider,
  options?: Record<string, string>,
): Promise<string> => {
  const guides = await Promise.allSettled(
    guidePages.map(async (guide) => {
      const local = fetchLocalGuide(guide);
      if (local !== undefined) return local;
      const response = await fetch(
        `https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/refs/heads/main/docs/src/content/docs/en/guides/${guide}.mdx`,
      );
      return await response.text();
    }),
  );
  const fulfilled = guides.filter((result) => result.status === 'fulfilled');
  const processed = await Promise.all(
    fulfilled.map((result) =>
      postProcessGuide(
        result.value,
        generators,
        packageManager,
        snippetContentProvider,
        options,
      ),
    ),
  );
  return processed.join('\n\n');
};

/**
 * A function which retrieves snippet content given a snippet name.
 */
export type SnippetContentProvider = (
  snippetName: string,
) => Promise<string> | string;

const SNIPPETS_RELATIVE_PROBES = [
  '../../../docs/src/content/docs/en/snippets',
  '../../../../docs/src/content/docs/en/snippets',
];

const SNIPPET_BASE_URL =
  'https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/refs/heads/main/docs/src/content/docs/en/snippets';

/**
 * Fetch a snippet's content. Tries the local repo checkout first (when
 * running under `mcp-inspect` or a linked test workspace) before falling
 * back to the copy on `main`.
 */
export const fetchSnippet: SnippetContentProvider = async (
  snippetName: string,
): Promise<string> => {
  for (const rel of SNIPPETS_RELATIVE_PROBES) {
    const candidate = path.resolve(__dirname, rel, `${snippetName}.mdx`);
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf-8');
      }
    } catch {
      // Probe failure — try next fallback.
    }
  }
  try {
    const response = await fetch(`${SNIPPET_BASE_URL}/${snippetName}.mdx`);
    if (!response.ok) {
      return '';
    }
    return await response.text();
  } catch {
    return '';
  }
};

/**
 * Post-process a guide page. Thin wrapper around the unified/remark-mdx
 * pipeline in `guide-pipeline.ts` — the real work (snippet inlining,
 * OptionFilter/Infrastructure/TabItem filtering, command/schema rendering)
 * happens there. Kept under the same name so other packages
 * (e.g. the docs site's `markdown-content.astro`) can continue importing
 * `postProcessGuide` with the same signature.
 */
export const postProcessGuide = async (
  guide: string,
  generators: NxGeneratorInfo[],
  packageManager?: string,
  snippetContentProvider?: SnippetContentProvider,
  options?: Record<string, string>,
): Promise<string> => {
  return postProcessGuideWithRemark(guide, {
    generators,
    packageManager,
    snippetContentProvider: snippetContentProvider ?? fetchSnippet,
    options,
  });
};
