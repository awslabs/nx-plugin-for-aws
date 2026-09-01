/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Translate documentation files using a Strands agent powered by Claude on AWS Bedrock.
 *
 * Configuration lives in ./translate.config.json (sibling to this file).
 * Run from the repo root:
 *
 *   pnpm tsx ./scripts/translate.ts --all
 *   pnpm tsx ./scripts/translate.ts                # only files changed since last translate commit
 *
 * The driver works out which source docs to translate and spawns one Strands
 * agent per (file × target language). Each agent gets the `fileEditor` tool and
 * the paths it needs — the source file, the target file, and a diff of what
 * changed — then reads, translates and writes the file itself.
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { simpleGit } from 'simple-git';
import glob from 'fast-glob';
import { Agent, BeforeToolCallEvent } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor';

interface TranslateConfig {
  sourceLanguage: string;
  targetLanguages: string[];
  docsDir: string;
  include: string[];
  exclude: string[];
  modelId: string;
  awsRegion: string;
  /**
   * Maximum number of (file x language) translations running in parallel. Each one
   * is a fresh agent invocation, so this caps concurrent Bedrock requests.
   * Defaults to 5 when omitted.
   */
  concurrency?: number;
  /**
   * Commit message marker used to identify previous translation commits, so
   * incremental runs only re-translate changes since the last translation.
   * Defaults to "docs: update translations".
   */
  translationCommitMessage?: string;
  /**
   * Optional repo-only extension: keep per-generator schema property descriptions
   * translated in `schemaTranslations.outputFile`. Set to `null` / omit to disable.
   */
  schemaTranslations?: {
    /** Path to the Nx plugin generators.json, relative to the repo root. */
    generatorsJson: string;
    /** Where to write the translations file, relative to the repo root. */
    outputFile: string;
    /** Path to the nx-plugin package, relative to the repo root (used to resolve schema paths). */
    nxPluginRoot: string;
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.resolve(__dirname, 'translate.config.json');
const config: TranslateConfig = JSON.parse(
  fs.readFileSync(CONFIG_PATH, 'utf-8'),
);
const DOCS_DIR = path.resolve(PROJECT_ROOT, config.docsDir);
const TRANSLATION_COMMIT_MESSAGE =
  config.translationCommitMessage ?? 'docs: update translations';

/**
 * Reject any `fileEditor` call whose `path` resolves outside the configured
 * docs directory. Runs as a `BeforeToolCallEvent` hook so we reuse the
 * built-in tool's schema/description verbatim — nothing else uses fileEditor in
 * this script, so the check is unconditional.
 */
function rejectOutsideDocsDir(event: BeforeToolCallEvent): void {
  if (event.toolUse.name !== 'fileEditor') return;
  const input = event.toolUse.input as { path?: unknown };
  if (typeof input.path !== 'string') return;
  const resolved = path.resolve(input.path);
  const docsDirWithSep = DOCS_DIR.endsWith(path.sep)
    ? DOCS_DIR
    : DOCS_DIR + path.sep;
  if (resolved !== DOCS_DIR && !resolved.startsWith(docsDirWithSep)) {
    event.cancel = `Path ${resolved} is outside the docs directory (${DOCS_DIR}); refusing access.`;
  }
}

interface FileToTranslate {
  relativePath: string;
  sourceAbsPath: string;
  /**
   * Path to a file holding the source diff, or undefined when there is no prior
   * translation to update. Passed to the agent as a path rather than inlined
   * into the prompt, so it reads only as much of it as it needs.
   */
  diffPath?: string;
}

const program = new Command();
program
  .name('translate')
  .description('Translate documentation files using a Strands agent')
  .option('-a, --all', 'Translate all source documentation files')
  .option(
    '-l, --languages <languages>',
    'Comma-separated list of target languages (overrides translate.config.json)',
  )
  .option(
    '-d, --dry-run',
    'Show what would be translated without invoking the agent',
  )
  .option('-v, --verbose', 'Show verbose output')
  .parse(process.argv);
const options = program.opts();

const log = {
  info: (m: string) => console.log(`[translate] ${m}`),
  warn: (m: string) => console.warn(`[translate] ${m}`),
  error: (m: string) => console.error(`[translate] ERROR ${m}`),
  verbose: (m: string) => options.verbose && console.log(`[translate] ${m}`),
};

/**
 * Diffs live under the docs directory so the agent's file access — which is
 * scoped to that directory — can read them. Removed when the run finishes.
 */
const DIFF_DIR = path.join(DOCS_DIR, '.translate-diffs');

async function writeDiff(
  relativePath: string,
  diff: string,
): Promise<string> {
  const diffPath = path.join(DIFF_DIR, `${relativePath}.diff`);
  await fs.outputFile(diffPath, diff, 'utf-8');
  return diffPath;
}

/**
 * Gather the set of source-language files to translate, with their diffs.
 */
async function getFilesToTranslate(): Promise<FileToTranslate[]> {
  const sourceLangRoot = `${DOCS_DIR}/${config.sourceLanguage}`;
  const includePatterns = config.include.map((p) => `${sourceLangRoot}/${p}`);
  const ignorePatterns = config.exclude.map((p) => `${sourceLangRoot}/${p}`);

  if (options.all) {
    log.info('Translating all source documentation files');
    const files = await glob(includePatterns, { ignore: ignorePatterns });
    return files.map((file) => ({
      relativePath: path.relative(sourceLangRoot, file),
      sourceAbsPath: file,
    }));
  }

  const git = simpleGit();
  // git reports paths relative to the repo root, which is not necessarily the
  // directory this script runs from.
  const repoRoot = (await git.revparse(['--show-toplevel'])).trim();

  let currentBranch: string;
  let mainBranch: string;
  if (process.env.GITHUB_HEAD_REF) {
    currentBranch = `origin/${process.env.GITHUB_HEAD_REF}`;
    mainBranch = 'origin/main';
  } else {
    currentBranch = (await git.branch()).current;
    mainBranch = 'main';
  }

  try {
    await git.raw(['rev-parse', '--verify', mainBranch]);
  } catch {
    log.warn(`Could not find "${mainBranch}"; falling back to --all behaviour`);
    options.all = true;
    return getFilesToTranslate();
  }

  const mergeBase = (
    await git.raw(['merge-base', mainBranch, currentBranch])
  ).trim();

  const translationCommits = (
    await git.log({ from: mergeBase, to: 'HEAD' })
  ).all.filter((c) => c.message.includes(TRANSLATION_COMMIT_MESSAGE));

  const baseCommit =
    translationCommits.length > 0 ? translationCommits[0].hash : mergeBase;

  log.info(
    translationCommits.length > 0
      ? `Detecting changed files since last translation commit ${baseCommit.substring(0, 7)}`
      : `Detecting changed files since branch creation ${baseCommit.substring(0, 7)}`,
  );

  const diffNames = (
    await git.diff([`${baseCommit}..HEAD`, '--name-only', '--diff-filter=d'])
  )
    .split('\n')
    .filter(Boolean);

  const { files: uncommitted } = await git.status();
  const uncommittedNames = uncommitted.map((f) => f.path);

  const allCandidates = [...new Set([...diffNames, ...uncommittedNames])].map(
    (p) => path.resolve(repoRoot, p),
  );

  // Filter to files inside the source language dir that match include/exclude
  const includedGlob = await glob(includePatterns, {
    ignore: ignorePatterns,
  });
  const includedSet = new Set(includedGlob.map((p) => path.resolve(p)));

  const changed = allCandidates.filter((abs) => includedSet.has(abs));

  if (changed.length === 0) {
    log.warn('No changed source documentation files detected');
    return [];
  }

  return Promise.all(
    changed.map(async (file) => {
      const relativePath = path.relative(sourceLangRoot, file);
      const diff = await git.diff([
        `${baseCommit}..HEAD`,
        '--',
        path.relative(repoRoot, file),
      ]);
      return {
        relativePath,
        sourceAbsPath: file,
        diffPath: diff ? await writeDiff(relativePath, diff) : undefined,
      };
    }),
  );
}

function buildSystemPrompt(targetLang: string): string {
  return `You are an expert technical-documentation translator. You translate MDX documentation files from the source locale \`${config.sourceLanguage}\` into the target locale \`${targetLang}\`.

Both are locale codes (ISO 639-1 / BCP-47 style, or short forms like \`jp\`, \`zh\`, \`pt\`). Translate naturally into the language the target code identifies.

Use the \`fileEditor\` tool to read the files you are given and to write your translation. Read a long file in slices with \`view_range\`. Use the absolute paths exactly as given — write to the target path verbatim, never to a variation of it.

Translate the prose. Everything else is copied from the source exactly as it is:

- Code blocks. Reproduce each one character for character: the language and \`title\` on the opening fence, and every line of the body. Comments inside code are code — a \`# Creates a new subsegment\` stays in English. Never translate anything between the fences.
- Inline code, URLs, link paths, \`import\` statements, component names, JSX attributes, and \`<Snippet name="..." />\` values.
- Product, service, and people's names, and package names such as \`@aws/nx-plugin\` — translate no part of them, even where they appear in prose or in a \`title\`.
- The MDX structure itself: frontmatter delimiters, heading levels, lists, and the blank lines between blocks. Add none and remove none.

Two things do change:

- In frontmatter, translate only \`title\` and \`description\`. Leave every other key and value alone. Frontmatter is YAML, so wrap a value in double quotes whenever it would otherwise begin with a character YAML reserves — for example a title starting with \`@aws/nx-plugin\` must be written as \`"@aws/nx-plugin ..."\`.
- Rewrite link paths that embed the source locale (\`/${config.sourceLanguage}/foo\` becomes \`/${targetLang}/foo\`), and make a \`parentHeading\` match the translated heading it sits under.

Write the finished file in one \`create\` call, and never with \`str_replace\` — a partial replacement silently duplicates or splices sections. Do not wrap the file in triple backticks.

When the file is written, reply with a one-line summary and stop.`;
}

function buildUserPrompt(file: FileToTranslate, targetLang: string): string {
  const targetAbsPath = path.join(DOCS_DIR, targetLang, file.relativePath);

  if (!file.diffPath) {
    return `Translate \`${file.sourceAbsPath}\` into locale \`${targetLang}\` and write it to \`${targetAbsPath}\`.

Read the source, then write the whole translated file with \`create\`. Always write it, even if a translation is already there — it may be out of date.`;
  }

  return `Update the \`${targetLang}\` translation of \`${file.sourceAbsPath}\`.

- Source: \`${file.sourceAbsPath}\`
- Existing translation to update: \`${targetAbsPath}\`
- Diff of what changed in the source: \`${file.diffPath}\`

Read all three. Retranslate only what the diff touched, keep the existing translated wording everywhere else, then write the whole file back with \`create\`.`;
}

const FENCE_RE = /^\s*(?:`{3,}|~{3,})/;

/**
 * Split a document into alternating prose and fenced-code segments.
 */
function splitOnFences(text: string): { prose: string[]; code: string[] } {
  const prose: string[] = [];
  const code: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (FENCE_RE.test(line)) {
      (inFence ? code : prose).push(current.concat(line).join('\n'));
      current = [];
      inFence = !inFence;
      continue;
    }
    current.push(line);
  }
  (inFence ? code : prose).push(current.join('\n'));
  return { prose, code };
}

/**
 * YAML frontmatter must still parse after translation. A value that begins with
 * a character YAML reserves — most often a title starting with \`@aws/...\` —
 * breaks the docs build, so reject it here and let the retry quote it.
 */
function assertFrontmatterIsParseable(text: string): void {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return;
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const value = lines[i].match(/^[A-Za-z0-9_-]+:\s+(\S)/)?.[1];
    if (value && '@*&%!|>'.includes(value)) {
      throw new Error(
        `frontmatter line ${i + 1} starts with the reserved YAML character "${value}" and must be quoted: ${lines[i].trim()}`,
      );
    }
  }
}

/**
 * An MDX file's imports must still parse after translation. The agent
 * occasionally emits a component's import line twice, which acorn rejects with
 * `Identifier '<name>' has already been declared` and fails the docs build, so
 * reject it here and let the retry write the file cleanly.
 *
 * Only the prose carries MDX imports, so fenced code is excluded — a document
 * quoting two Python snippets that each `import os` is valid. The name and the
 * `from` are matched on the import's own line for the same reason.
 */
function assertImportsAreUnique(text: string): void {
  const seen = new Set<string>();
  for (const chunk of splitOnFences(text).prose) {
    for (const [, name] of chunk.matchAll(
      /^import[^\S\n]+(\w+)[^\S\n]+from[^\S\n]/gm,
    )) {
      if (seen.has(name)) {
        throw new Error(
          `duplicate import of "${name}" — acorn rejects a redeclared identifier and the docs build fails`,
        );
      }
      seen.add(name);
    }
  }
}

/**
 * Copy the source's code blocks over the translated file's. The prompt tells the
 * agent to reproduce them verbatim, but it occasionally translates a comment
 * anyway, which would ship stale or broken code.
 *
 * A differing block count means the translation lost the document's shape —
 * usually a section duplicated or dropped — so this throws rather than stitching
 * mismatched blocks together, letting the caller retry.
 */
async function restoreCodeBlocks(
  sourceAbsPath: string,
  targetAbsPath: string,
): Promise<void> {
  const source = splitOnFences(await fs.readFile(sourceAbsPath, 'utf-8'));
  const target = splitOnFences(await fs.readFile(targetAbsPath, 'utf-8'));

  if (source.code.length !== target.code.length) {
    throw new Error(
      `translation has ${target.code.length} code block(s) but the source has ${source.code.length}`,
    );
  }
  if (source.code.length === 0) return;

  const merged = target.prose.flatMap((chunk, i) =>
    i < source.code.length ? [chunk, source.code[i]] : [chunk],
  );
  await fs.writeFile(targetAbsPath, merged.join('\n'), 'utf-8');
}

/**
 * Number of times to retry a single (file x language) translation. Large files
 * occasionally hit transient Bedrock streaming errors; a fresh agent invocation
 * re-reads the files from disk, so retries are idempotent.
 */
const TRANSLATE_MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateFileForLanguage(
  file: FileToTranslate,
  targetLang: string,
): Promise<void> {
  const targetAbsPath = path.join(DOCS_DIR, targetLang, file.relativePath);

  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSLATE_MAX_ATTEMPTS; attempt++) {
    const agent = new Agent({
      model: new BedrockModel({
        modelId: config.modelId,
        region: process.env.AWS_REGION ?? config.awsRegion,
        maxTokens: 64_000,
        temperature: 0.2,
        // Translating a long file can stream for several minutes, well past the
        // AWS SDK's two-minute default socket timeout.
        clientConfig: { requestHandler: { requestTimeout: 15 * 60_000 } },
      }),
      systemPrompt: buildSystemPrompt(targetLang),
      tools: [fileEditor],
      printer: !!options.verbose,
    });
    agent.addHook(BeforeToolCallEvent, rejectOutsideDocsDir);

    try {
      const result = await agent.invoke(buildUserPrompt(file, targetLang));
      if (result.stopReason !== 'endTurn') {
        log.warn(
          `agent stopped with reason=${result.stopReason} while translating ${file.relativePath} → ${targetLang} — inspect output above`,
        );
      }
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }

    // Judge the file on disk rather than on whether the agent wrote it: the
    // stream often drops after a successful write, and an agent handed an
    // already-correct translation may rightly decide there is nothing to do.
    if (fs.existsSync(targetAbsPath)) {
      try {
        const translated = await fs.readFile(targetAbsPath, 'utf-8');
        assertFrontmatterIsParseable(translated);
        assertImportsAreUnique(translated);
        await restoreCodeBlocks(file.sourceAbsPath, targetAbsPath);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    lastError ??= new Error('no translation exists at the target path');

    if (attempt < TRANSLATE_MAX_ATTEMPTS) {
      const delayMs = 2000 * attempt;
      log.warn(
        `translation attempt ${attempt}/${TRANSLATE_MAX_ATTEMPTS} for ${file.relativePath} → ${targetLang} failed (${lastError instanceof Error ? lastError.message : String(lastError)}); retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Simple concurrency-limited runner.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// -----------------------------------------------------------------------------
// Schema-translations (repo-only extension)
//
// Keeps `docs/src/i18n/schema-translations.json` in sync with each generator's
// `schema.json` property descriptions. The docs site reads that file to render
// translated parameter tables on generator guides.
// -----------------------------------------------------------------------------

type SchemaTranslations = Record<
  string,
  Record<string, Record<string, string>>
>;

interface GeneratorsJson {
  generators: Record<
    string,
    { schema: string; description?: string; hidden?: boolean }
  >;
}

/**
 * Walk every generator's schema.json and collect English descriptions keyed by
 * `generator -> property -> description`.
 */
function extractSchemaDescriptions(): Record<string, Record<string, string>> {
  const cfg = config.schemaTranslations!;
  const generatorsJson: GeneratorsJson = JSON.parse(
    fs.readFileSync(path.resolve(PROJECT_ROOT, cfg.generatorsJson), 'utf-8'),
  );
  const nxPluginRoot = path.resolve(PROJECT_ROOT, cfg.nxPluginRoot);
  const result: Record<string, Record<string, string>> = {};

  for (const [name, gen] of Object.entries(generatorsJson.generators)) {
    // gen.schema is of the form "./src/foo/schema.json" relative to nxPluginRoot
    const schemaPath = path.resolve(nxPluginRoot, gen.schema);
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      if (schema.properties) {
        const props: Record<string, string> = {};
        for (const [prop, def] of Object.entries(
          schema.properties as Record<string, { description?: string }>,
        )) {
          if (def.description) {
            props[prop] = def.description;
          }
        }
        if (Object.keys(props).length > 0) {
          result[name] = props;
        }
      }
    } catch {
      log.verbose(`Could not read schema for generator ${name}`);
    }
  }

  return result;
}

/**
 * Translate a batch of schema descriptions for a single generator to a single
 * target language using a Strands agent without tools.
 */
async function translateSchemaDescriptionBatch(
  generator: string,
  properties: Record<string, string>,
  targetLang: string,
): Promise<Record<string, string>> {
  const agent = new Agent({
    model: new BedrockModel({
      modelId: config.modelId,
      region: process.env.AWS_REGION ?? config.awsRegion,
      maxTokens: 4096,
      temperature: 0.1,
    }),
    systemPrompt: `You are an expert technical-documentation translator. You will be given a JSON object whose values are English descriptions of Nx-generator CLI parameters. Translate each value into the target locale \`${targetLang}\`, keeping the same keys and returning ONLY a valid JSON object with the same shape.

Rules:
- Translate prose naturally.
- DO NOT translate technical terms, acronyms, product and service names (e.g. API, CDK, Lambda, MCP, Cognito, IAM, TypeScript, Python, React, Smithy, FastAPI, tRPC, Terraform, Nx, AWS, S3, CloudFront).
- Preserve any backticked \`identifiers\` or quoted 'values' verbatim.
- Output ONLY the JSON object — no prose, no fences, no comments.`,
    tools: [],
    printer: false,
  });

  const prompt = `Translate the values of this JSON object to locale \`${targetLang}\` (generator: ${generator}). Return ONLY the translated JSON object.\n\n${JSON.stringify(properties, null, 2)}`;
  const result = await agent.invoke(prompt);

  // Extract final assistant text
  const rawText = (() => {
    const msg = result.lastMessage;
    if (!msg) return '';
    // Message content is an array of ContentBlock; pull text blocks.
    const blocks = (msg as { content?: unknown[] }).content ?? [];
    return blocks
      .map((b) => {
        if (typeof b === 'object' && b !== null && 'text' in b) {
          return (b as { text: string }).text;
        }
        return '';
      })
      .join('');
  })();

  // Strip optional ``` fences the model might add despite the instruction.
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object');
    }
    // Only keep keys that were requested — defend against hallucinated keys.
    const out: Record<string, string> = {};
    for (const key of Object.keys(properties)) {
      if (typeof parsed[key] === 'string') {
        out[key] = parsed[key];
      }
    }
    return out;
  } catch (err) {
    log.warn(
      `schema-translations: could not parse response for ${generator} → ${targetLang}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

/**
 * Update schema-translations.json for the given target languages.
 * Adds missing entries, re-translates entries whose English text changed, and
 * prunes generators/properties that no longer exist.
 */
async function updateSchemaTranslations(
  targetLanguages: string[],
): Promise<void> {
  const cfg = config.schemaTranslations;
  if (!cfg) return;

  const outputPath = path.resolve(PROJECT_ROOT, cfg.outputFile);
  const current = extractSchemaDescriptions();

  let existing: SchemaTranslations = {};
  if (fs.existsSync(outputPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    } catch {
      existing = {};
    }
  }

  // Find work to do: any (generator, property) where English changed or
  // any target language is missing.
  type WorkItem = {
    generator: string;
    properties: Record<string, string>;
    targetLang: string;
  };
  const work: WorkItem[] = [];
  for (const [generator, props] of Object.entries(current)) {
    for (const targetLang of targetLanguages) {
      const todo: Record<string, string> = {};
      for (const [prop, description] of Object.entries(props)) {
        const englishChanged =
          existing?.[generator]?.[prop]?.en !== description;
        const missingLang = !existing?.[generator]?.[prop]?.[targetLang];
        if (englishChanged || missingLang) {
          todo[prop] = description;
        }
      }
      if (Object.keys(todo).length > 0) {
        work.push({ generator, properties: todo, targetLang });
      }
    }
  }

  // Always record the current English so we can detect future changes.
  const updated: SchemaTranslations = { ...existing };
  for (const [generator, props] of Object.entries(current)) {
    updated[generator] = updated[generator] ?? {};
    for (const [prop, description] of Object.entries(props)) {
      updated[generator][prop] = updated[generator][prop] ?? {};
      updated[generator][prop].en = description;
    }
  }

  if (work.length === 0) {
    // Still prune and rewrite (pruning may be the only change)
    pruneAndWrite(updated, current, outputPath);
    log.info('schema-translations: no changes needed');
    return;
  }

  log.info(
    `schema-translations: translating ${work.length} generator/locale batch(es)`,
  );

  if (options.dryRun) {
    for (const w of work) {
      log.info(
        `  [dry-run] would translate ${w.generator} (${Object.keys(w.properties).length} props) → ${w.targetLang}`,
      );
    }
    return;
  }

  const concurrency = Math.max(1, config.concurrency ?? 5);
  const tasks = work.map((w) => async () => {
    log.verbose(
      `  schema ${w.generator} → ${w.targetLang} (${Object.keys(w.properties).length} props)`,
    );
    const translations = await translateSchemaDescriptionBatch(
      w.generator,
      w.properties,
      w.targetLang,
    );
    updated[w.generator] = updated[w.generator] ?? {};
    for (const [prop, value] of Object.entries(translations)) {
      updated[w.generator][prop] = updated[w.generator][prop] ?? {};
      updated[w.generator][prop][w.targetLang] = value;
    }
  });

  await runWithConcurrency(tasks, concurrency);

  pruneAndWrite(updated, current, outputPath);
  log.info(`schema-translations: wrote ${outputPath}`);
}

/**
 * Remove generators/properties from `translations` that no longer exist in the
 * current generator set, then write the file. Keeps output sorted for stable
 * diffs.
 */
function pruneAndWrite(
  translations: SchemaTranslations,
  current: Record<string, Record<string, string>>,
  outputPath: string,
): void {
  for (const generator of Object.keys(translations)) {
    if (!current[generator]) {
      delete translations[generator];
      continue;
    }
    for (const prop of Object.keys(translations[generator])) {
      if (!(prop in current[generator])) {
        delete translations[generator][prop];
      }
    }
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify(translations, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Delete translated files whose source document no longer exists. Without this
 * a source file that is renamed or removed leaves its translations behind in
 * every locale, where they still resolve as snippets and pages.
 */
async function pruneOrphanedTranslations(
  targetLanguages: string[],
): Promise<void> {
  const sourceLangRoot = `${DOCS_DIR}/${config.sourceLanguage}`;
  const sourceFiles = new Set(
    (
      await glob(
        config.include.map((p) => `${sourceLangRoot}/${p}`),
        { ignore: config.exclude.map((p) => `${sourceLangRoot}/${p}`) },
      )
    ).map((p) => path.relative(sourceLangRoot, p)),
  );

  for (const lang of targetLanguages) {
    const langRoot = path.join(DOCS_DIR, lang);
    if (!fs.existsSync(langRoot)) continue;
    const translated = await glob(
      config.include.map((p) => `${langRoot}/${p}`),
      { ignore: config.exclude.map((p) => `${langRoot}/${p}`) },
    );
    for (const abs of translated) {
      const rel = path.relative(langRoot, abs);
      if (sourceFiles.has(rel)) continue;
      if (options.dryRun) {
        log.info(`[dry-run] would delete orphaned ${lang}/${rel}`);
      } else {
        log.info(`Deleting orphaned ${lang}/${rel} (no ${config.sourceLanguage} source)`);
        await fs.remove(abs);
      }
    }
  }
}

async function main() {
  const requestedLanguages: string[] = options.languages
    ? options.languages
        .split(',')
        .map((l: string) => l.trim())
        .filter(Boolean)
    : config.targetLanguages;

  const targetLanguages = requestedLanguages.filter(
    (l) => l !== config.sourceLanguage,
  );

  if (targetLanguages.length === 0) {
    log.error('No target languages configured');
    process.exit(1);
  }

  log.info(`Source: ${config.sourceLanguage}`);
  log.info(`Targets: ${targetLanguages.join(', ')}`);

  // Keep the generator-schema descriptions in sync first. This is independent
  // of docs-file changes and cheap to check (no-op when already up to date).
  await updateSchemaTranslations(targetLanguages);

  await pruneOrphanedTranslations(targetLanguages);

  const files = await getFilesToTranslate();

  if (files.length === 0) {
    log.info('No documentation files to translate.');
    return;
  }

  log.info(`Files to translate: ${files.length}`);
  for (const f of files) {
    log.verbose(
      `  - ${f.relativePath}${f.diffPath ? ' (changed)' : ' (full)'}`,
    );
  }

  if (options.dryRun) {
    for (const lang of targetLanguages) {
      for (const f of files) {
        log.info(`[dry-run] would translate ${f.relativePath} → ${lang}`);
      }
    }
    log.info('Done (dry-run).');
    return;
  }

  // Build one task per (file × target language) — each is a fresh agent invocation,
  // so context windows stay small no matter how big the docs site is. A single
  // failing translation records its error rather than aborting the whole run, so
  // every other (file × language) still completes and gets written to disk.
  const failures: string[] = [];
  const tasks = targetLanguages.flatMap((lang) =>
    files.map((file) => async () => {
      log.info(`  ${file.relativePath} → ${lang}`);
      try {
        await translateFileForLanguage(file, lang);
      } catch (err) {
        log.error(
          `${file.relativePath} → ${lang}: ${err instanceof Error ? err.message : String(err)}`,
        );
        failures.push(`${file.relativePath} → ${lang}`);
      }
    }),
  );

  const concurrency = Math.max(1, config.concurrency ?? 5);
  log.info(
    `Running ${tasks.length} translation(s) with concurrency=${concurrency}`,
  );
  await runWithConcurrency(tasks, concurrency);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} translation(s) failed after retries:\n  ${failures.join('\n  ')}`,
    );
  }

  log.info('Done.');
}

main()
  .finally(() => fs.remove(DIFF_DIR))
  .catch((err) => {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
