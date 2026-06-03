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
 * The driver gathers the set of changed source docs + their git diffs and
 * spawns one Strands agent per (file × target language). Each agent has the
 * built-in `fileEditor` tool available to read sources, read any existing
 * translation, and write the translated file itself.
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
  sourceContent: string;
  /** Empty when this is a newly-added file. */
  diff: string;
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
 * Gather the set of source-language files to translate, with their diffs.
 */
async function getFilesToTranslate(): Promise<FileToTranslate[]> {
  const sourceLangRoot = `${DOCS_DIR}/${config.sourceLanguage}`;
  const includePatterns = config.include.map((p) => `${sourceLangRoot}/${p}`);
  const ignorePatterns = config.exclude.map((p) => `${sourceLangRoot}/${p}`);

  if (options.all) {
    log.info('Translating all source documentation files');
    const files = await glob(includePatterns, { ignore: ignorePatterns });
    return Promise.all(
      files.map(async (file) => ({
        relativePath: path.relative(sourceLangRoot, file),
        sourceAbsPath: file,
        sourceContent: await fs.readFile(file, 'utf-8'),
        diff: '',
      })),
    );
  }

  const git = simpleGit();

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
    (p) => path.resolve(process.cwd(), p),
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
      const sourceContent = await fs.readFile(file, 'utf-8');
      let diff = '';
      try {
        diff = await git.diff([
          `${baseCommit}..HEAD`,
          '--',
          path.relative(process.cwd(), file),
        ]);
      } catch {
        // treat as new file
      }
      return {
        relativePath: path.relative(sourceLangRoot, file),
        sourceAbsPath: file,
        sourceContent,
        diff,
      };
    }),
  );
}

function buildSystemPrompt(targetLang: string): string {
  return `You are an expert technical-documentation translator. Your job is to translate a single MDX documentation file from the source locale \`${config.sourceLanguage}\` into the target locale \`${targetLang}\`.

Both values are locale codes (e.g. ISO 639-1 / BCP-47 style, or common short forms like \`jp\`, \`zh\`, \`pt\`). Interpret them yourself and translate naturally into the language they identify. If a code is ambiguous, prefer the most widely used written form.

You have one tool available: \`fileEditor\`. Use it to:
- Read the source file (\`command: "view"\`). For large files you can read a portion at a time using \`view_range\`, then request the next range.
- Read the existing translation if one is provided (\`command: "view"\`).
- Apply a targeted edit to the existing translation (\`command: "str_replace"\` with \`old_str\`/\`new_str\`).
- Write a brand new file (\`command: "create"\` — it overwrites).

Translation rules:
1. Translate natural-language prose into the target language. Keep technical accuracy.
2. DO NOT translate:
   - Code blocks and inline code (text inside backticks)
   - URLs, link paths, and HTML/JSX/MDX tag names and attributes
   - \`import\` statements, component names, and frontmatter keys
   - Proper names of people, products, or AWS services
3. Preserve every aspect of the MDX structure exactly: frontmatter delimiters, headings, lists, code blocks, MDX components, JSX, whitespace, blank lines.
4. For frontmatter:
   - Translate only string values for the \`title\` and \`description\` keys.
   - Leave \`date\`, \`authors\`, \`template\`, \`slug\`, and all other keys untouched.
5. If any localised link paths embed the source locale (e.g. \`/${config.sourceLanguage}/foo\`), rewrite them to the target locale (\`/${targetLang}/foo\`).
6. Incremental edits (IMPORTANT for large files): if an existing translation AND a diff are provided, do NOT rewrite the whole file. Instead apply one \`str_replace\` per changed region, translating only the prose the diff touched and leaving every other section of the existing translation untouched. Rewriting a large file in full with \`create\` can exceed output limits and fail; \`str_replace\` keeps each edit small and reliable.
7. Only use \`command: "create"\` when no existing translation exists, then translate the whole file.
8. Never wrap output in triple backticks.
9. Always use absolute paths with \`fileEditor\`.

When the translated file has been written, reply with a one-line summary and stop.`;
}

function buildUserPrompt(file: FileToTranslate, targetLang: string): string {
  const targetLangRoot = path.join(DOCS_DIR, targetLang);
  const targetAbsPath = path.join(targetLangRoot, file.relativePath);
  const existingTranslationExists = fs.existsSync(targetAbsPath);

  const diffBlock = file.diff
    ? `Git diff showing what changed in the source since the last translation:\n\`\`\`diff\n${file.diff.slice(0, 40_000)}\n\`\`\``
    : 'There is no prior diff for this file — treat it as new content and translate in full.';

  const existingBlock = existingTranslationExists
    ? `An existing translation for locale \`${targetLang}\` already lives at:\n  \`${targetAbsPath}\`\nRead it with \`fileEditor\` (\`command: "view"\`) and update it in place with \`str_replace\` edits for the changed regions only.`
    : `No existing translation exists yet, so you will create it fresh.`;

  const steps = existingTranslationExists
    ? `Steps:
1. Read the source file (use \`view_range\` slices if it is long) to see the current English content.
2. Read the existing translation at the target path.
3. For each region the diff changed, apply a \`str_replace\` to the target file: match the corresponding existing translated text in \`old_str\` and put the newly translated text in \`new_str\`. Do NOT rewrite the whole file with \`create\` — large files fail that way.
4. Reply with a single short confirmation line.`
    : `Steps:
1. Read the source file. If it is long, read it in slices using \`view_range\`.
2. Write the full translated file to the target path using \`command: "create"\`.
3. Reply with a single short confirmation line.`;

  return `Translate one file from source locale \`${config.sourceLanguage}\` into target locale \`${targetLang}\`.

- Source file (read from here): \`${file.sourceAbsPath}\`
- Target file (write the translation here, absolute path): \`${targetAbsPath}\`

${existingBlock}

${diffBlock}

${steps}`;
}

/**
 * Number of times to retry a single (file x language) translation when the
 * Bedrock stream drops mid-message. Large files occasionally hit transient
 * streaming errors; a fresh agent invocation re-reads the source and existing
 * translation, so retries are idempotent.
 */
const TRANSLATE_MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateFileForLanguage(
  file: FileToTranslate,
  targetLang: string,
): Promise<void> {
  const targetAbsPath = path.join(DOCS_DIR, targetLang, file.relativePath);
  const beforeMtimeMs = fs.existsSync(targetAbsPath)
    ? (await fs.stat(targetAbsPath)).mtimeMs
    : 0;

  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSLATE_MAX_ATTEMPTS; attempt++) {
    const agent = new Agent({
      model: new BedrockModel({
        modelId: config.modelId,
        region: process.env.AWS_REGION ?? config.awsRegion,
        maxTokens: 64_000,
        temperature: 0.2,
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
      break;
    } catch (err) {
      lastError = err;
      if (attempt < TRANSLATE_MAX_ATTEMPTS) {
        const delayMs = 2000 * attempt;
        log.warn(
          `translation attempt ${attempt}/${TRANSLATE_MAX_ATTEMPTS} for ${file.relativePath} → ${targetLang} failed (${err instanceof Error ? err.message : String(err)}); retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }
  }

  // If every attempt errored but the file was nonetheless written this run
  // (the agent often completes the fileEditor write before the final summary
  // stream drops), treat it as success. Otherwise surface the last error.
  const wroteThisRun =
    fs.existsSync(targetAbsPath) &&
    (await fs.stat(targetAbsPath)).mtimeMs > beforeMtimeMs;
  if (lastError && !wroteThisRun) {
    throw lastError;
  }

  // Sanity check: the target file should now exist and have been written during this run.
  if (!fs.existsSync(targetAbsPath)) {
    throw new Error(
      `agent did not write target file ${targetAbsPath} for ${file.relativePath} → ${targetLang}`,
    );
  }
  const afterMtimeMs = (await fs.stat(targetAbsPath)).mtimeMs;
  if (afterMtimeMs <= beforeMtimeMs) {
    log.warn(
      `target ${file.relativePath} → ${targetLang} was not updated (mtime unchanged) — the agent may have decided no change was needed`,
    );
  }
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

  const files = await getFilesToTranslate();

  if (files.length === 0) {
    log.info('No documentation files to translate.');
    return;
  }

  log.info(`Files to translate: ${files.length}`);
  for (const f of files) {
    log.verbose(`  - ${f.relativePath}${f.diff ? ' (changed)' : ' (full)'}`);
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

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
