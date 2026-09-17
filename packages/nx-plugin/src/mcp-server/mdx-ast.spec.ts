/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseMdx } from './guide-pipeline.js';
import { stripFrontmatterAndEsm } from './mdx-ast.js';

const strip = async (raw: string) =>
  stripFrontmatterAndEsm(raw, await parseMdx(raw));

describe('stripFrontmatterAndEsm', () => {
  it('removes the frontmatter', async () => {
    expect(await strip('---\ntitle: My Page\n---\n\nContent\n')).toBe(
      'Content',
    );
  });

  it('removes import and export statements', async () => {
    const raw = [
      '---',
      'title: My Page',
      '---',
      "import Link from '@components/link.astro';",
      '',
      'export const code = `const a = 1;`;',
      '',
      'Content',
      '',
    ].join('\n');

    expect(await strip(raw)).toBe('Content');
  });

  it('keeps import statements inside fenced code blocks', async () => {
    const raw = [
      '---',
      'title: My Page',
      '---',
      "import Link from '@components/link.astro';",
      '',
      'Add the import:',
      '',
      '```ts',
      "import { Stack } from 'aws-cdk-lib';",
      "import { Construct } from 'constructs';",
      '',
      'export class MyStack extends Stack {}',
      '```',
      '',
    ].join('\n');

    const result = await strip(raw);

    expect(result).not.toContain('@components/link.astro');
    expect(result).toContain("import { Stack } from 'aws-cdk-lib';");
    expect(result).toContain("import { Construct } from 'constructs';");
    expect(result).toContain('export class MyStack extends Stack {}');
  });

  it('keeps import statements inside a JSX attribute template literal', async () => {
    const raw = [
      '---',
      'title: My Page',
      '---',
      "import Diff from '@components/diff.astro';",
      '',
      "<Diff before={`import { a } from 'a';",
      '',
      'export const b = 1;',
      '`} />',
      '',
    ].join('\n');

    const result = await strip(raw);

    expect(result).not.toContain('@components/diff.astro');
    expect(result).toContain("import { a } from 'a';");
    expect(result).toContain('export const b = 1;');
  });

  it('leaves content untouched when there is no preamble', async () => {
    expect(await strip('Just content\n')).toBe('Just content');
  });
});
