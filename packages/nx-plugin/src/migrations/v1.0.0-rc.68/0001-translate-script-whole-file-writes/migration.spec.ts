/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectConfiguration, type Tree, updateJson } from '@nx/devkit';
import { TS_ASTRO_DOCS_GENERATOR_INFO } from '../../../ts/astro-docs/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const SCRIPT = 'docs/scripts/translate.ts';

/**
 * Every migration finishes with `formatFilesInSubtree`, which reflows whatever it
 * finds — including a file this migration deliberately left alone. Comparing with
 * a formatter's choices removed (whitespace, and the trailing commas it drops when
 * collapsing a call onto one line) shows whether the migration changed anything.
 */
const withoutFormatting = (source: string): string =>
  source
    .replace(/\s+/g, ' ')
    .replace(/,(\s*[)}\]])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .trim();

/**
 * The script as a release vended it, held as a fixture rather than produced by
 * running the generator: the generator moves on, but what a user upgrades *from*
 * is fixed, and that is what this migration has to recognise.
 */
const releasedScript = (fixture: string, esm = true): string =>
  readFileSync(join(import.meta.dirname, 'test-fixtures', fixture), 'utf-8')
    .replace(
      /<% if \(esm\) \{ %>(.*?)<% \} else \{ %>(.*?)<% \} %>/g,
      esm ? '$1' : '$2',
    )
    .replace(/<%= pkgMgrCmd %>/g, 'pnpm exec nx')
    .replace(/<%= fullyQualifiedName %>/g, '@proj/docs');

/** The release that first shipped the script, and the most recent one. */
const FIRST_RELEASE = 'released-script-first.ts.fixture';
const LATEST_RELEASE = 'released-script.ts.fixture';

/**
 * A docs project as the generator records it — only the project configuration the
 * migration reads, so the test doesn't depend on everything else the generator
 * writes.
 */
const addDocsProject = (tree: Tree, script: string) => {
  addProjectConfiguration(tree, '@proj/docs', {
    name: '@proj/docs',
    root: 'docs',
    sourceRoot: 'docs/src',
    projectType: 'application',
    metadata: { generator: TS_ASTRO_DOCS_GENERATOR_INFO.id } as never,
  });
  tree.write(SCRIPT, script);
};

describe('translate-script-whole-file-writes migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should rewrite a script vended by the most recent release', async () => {
    addDocsProject(tree, releasedScript(LATEST_RELEASE));

    const result = await migration(tree);

    const migrated = tree.read(SCRIPT, 'utf-8') ?? '';
    // The defining change: whole-file writes, never an in-place edit.
    expect(migrated).toContain(
      'Write the finished file in one \\`create\\` call, and never with \\`str_replace\\`',
    );
    // And the fixes that came with it.
    expect(migrated).toContain('restoreCodeBlocks');
    expect(migrated).toContain('assertFrontmatterIsParseable');
    expect(migrated).toContain('requestTimeout');
    expect(migrated).toContain('repoRoot');
    expect(migrated).toContain('pruneOrphanedTranslations');
    expect(result.nextSteps).toEqual([]);
  });

  it('should rewrite the script the first release vended', async () => {
    // Predates SCRIPTS_DIR, so the migration has to introduce it.
    addDocsProject(tree, releasedScript(FIRST_RELEASE));

    const result = await migration(tree);

    const migrated = tree.read(SCRIPT, 'utf-8') ?? '';
    expect(migrated).toContain('const SCRIPTS_DIR = import.meta.dirname;');
    expect(migrated).toContain(
      "const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');",
    );
    expect(migrated).toContain('restoreCodeBlocks');
    expect(result.nextSteps).toEqual([]);
  });

  it('should use __dirname in a CommonJS workspace', async () => {
    updateJson(tree, 'package.json', (pkg) => ({ ...pkg, type: 'commonjs' }));
    addDocsProject(tree, releasedScript(LATEST_RELEASE, false));

    const result = await migration(tree);

    const migrated = tree.read(SCRIPT, 'utf-8') ?? '';
    expect(migrated).toContain('const SCRIPTS_DIR = __dirname;');
    expect(migrated).not.toContain('import.meta.dirname');
    expect(result.nextSteps).toEqual([]);
  });

  it('should rewrite a script a formatter has reflowed', async () => {
    // Recognition is on the shape of each declaration, not its exact text, so a
    // differently formatted copy still migrates.
    addDocsProject(tree, releasedScript(LATEST_RELEASE).replace(/;\n/g, '\n'));

    const result = await migration(tree);

    expect(tree.read(SCRIPT, 'utf-8')).toContain('restoreCodeBlocks');
    expect(result.nextSteps).toEqual([]);
  });

  it('should rewrite a script with an unrelated addition alongside it', async () => {
    addDocsProject(
      tree,
      `${releasedScript(LATEST_RELEASE)}\nexport const ourHelper = () => 1;\n`,
    );

    const result = await migration(tree);

    const migrated = tree.read(SCRIPT, 'utf-8') ?? '';
    expect(migrated).toContain('restoreCodeBlocks');
    // The user's own addition survives.
    expect(migrated).toContain('export const ourHelper = () => 1;');
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a script with an edited declaration alone and report it', async () => {
    const customised = releasedScript(LATEST_RELEASE).replace(
      /const log = \{[\s\S]*?\n\};/,
      'const log = console;',
    );
    addDocsProject(tree, customised);

    const result = await migration(tree);

    expect(withoutFormatting(tree.read(SCRIPT, 'utf-8') ?? '')).toBe(
      withoutFormatting(customised),
    );
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain('@proj/docs');
    expect(result.nextSteps?.[0]).toContain('customised');
  });

  it('should leave a script alone when one line inside a function was changed', async () => {
    const customised = releasedScript(LATEST_RELEASE).replace(
      "log.info('Done.');",
      "log.info('All finished!');",
    );
    addDocsProject(tree, customised);

    const result = await migration(tree);

    expect(withoutFormatting(tree.read(SCRIPT, 'utf-8') ?? '')).toBe(
      withoutFormatting(customised),
    );
    expect(result.nextSteps).toHaveLength(1);
  });

  it('should leave a heavily rewritten script alone and report it', async () => {
    const customised = releasedScript(LATEST_RELEASE).replace(
      /async function getFilesToTranslate[\s\S]*?\n\}/,
      'async function getFilesToTranslate() {\n  return ourOwnImplementation();\n}',
    );
    addDocsProject(tree, customised);

    const result = await migration(tree);

    expect(withoutFormatting(tree.read(SCRIPT, 'utf-8') ?? '')).toBe(
      withoutFormatting(customised),
    );
    expect(result.nextSteps).toHaveLength(1);
  });

  it('should leave a script alone when a field was added to its interface', async () => {
    const customised = releasedScript(LATEST_RELEASE).replace(
      '  diff: string;',
      '  diff: string;\n  ourOwnField: number;',
    );
    addDocsProject(tree, customised);

    const result = await migration(tree);

    expect(withoutFormatting(tree.read(SCRIPT, 'utf-8') ?? '')).toBe(
      withoutFormatting(customised),
    );
    expect(result.nextSteps).toHaveLength(1);
  });

  it('should leave a script alone when the prompt text was reworded', async () => {
    const customised = releasedScript(LATEST_RELEASE).replace(
      'Efficiency rule',
      'Our own rule',
    );
    addDocsProject(tree, customised);

    const result = await migration(tree);

    expect(withoutFormatting(tree.read(SCRIPT, 'utf-8') ?? '')).toBe(
      withoutFormatting(customised),
    );
    expect(result.nextSteps).toHaveLength(1);
  });

  it('should be idempotent', async () => {
    addDocsProject(tree, releasedScript(LATEST_RELEASE));

    await migration(tree);
    const afterFirst = tree.read(SCRIPT, 'utf-8');
    const result = await migration(tree);

    expect(tree.read(SCRIPT, 'utf-8')).toBe(afterFirst);
    expect(result.nextSteps).toEqual([]);
  });

  it('should do nothing when the docs site has no translation script', async () => {
    addProjectConfiguration(tree, '@proj/docs', {
      name: '@proj/docs',
      root: 'docs',
      metadata: { generator: TS_ASTRO_DOCS_GENERATOR_INFO.id } as never,
    });

    const result = await migration(tree);

    expect(tree.exists(SCRIPT)).toBe(false);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a project from another generator alone', async () => {
    const other = 'apps/other/scripts/translate.ts';
    addProjectConfiguration(tree, '@proj/other', {
      name: '@proj/other',
      root: 'apps/other',
      metadata: { generator: 'ts#project' } as never,
    });
    tree.write(other, '// not ours\n');

    const result = await migration(tree);

    expect(tree.read(other, 'utf-8')).toBe('// not ours\n');
    expect(result.nextSteps).toEqual([]);
  });
});
