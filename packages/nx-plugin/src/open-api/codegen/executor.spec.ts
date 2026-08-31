/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ExecutorContext } from '@nx/devkit';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenApiCodegenTarget } from './executor-schema';

let workspace: string;

vi.mock('@nx/devkit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nx/devkit')>()),
  get workspaceRoot() {
    return workspace;
  },
}));

const { default: executor } = await import('./executor.js');

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
};

const SPEC_PATH = 'dist/openapi.json';
const OUTPUT_PATH = 'src/generated';

const run = (generator: OpenApiCodegenTarget, options?: { dryRun?: boolean }) =>
  executor(
    {
      generator,
      openApiSpecPath: SPEC_PATH,
      outputPath: OUTPUT_PATH,
      ...options,
    },
    {} as ExecutorContext,
  );

const generatedFiles = (): string[] => {
  const dir = join(workspace, OUTPUT_PATH);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
};

const generatedContents = (): string[] =>
  generatedFiles().map((file) =>
    readFileSync(join(workspace, OUTPUT_PATH, file), 'utf-8'),
  );

describe('open-api-codegen executor', () => {
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'codegen-executor-'));
    mkdirSync(join(workspace, 'dist'), { recursive: true });
    writeFileSync(join(workspace, SPEC_PATH), JSON.stringify(SPEC));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it.each([
    ['ts-client', ['client.gen.ts', 'types.gen.ts']],
    ['ts-hooks', ['client.gen.ts', 'options-proxy.gen.ts', 'types.gen.ts']],
    ['ts-metadata', ['metadata.gen.ts']],
    ['json-metadata', ['operations.json']],
  ] as const)('should generate %s to disk', async (generator, expected) => {
    const result = await run(generator);

    expect(result).toEqual({ success: true });
    expect(generatedFiles()).toEqual(expected);
  });

  it('should format what it writes', async () => {
    await run('ts-client');

    const client = readFileSync(
      join(workspace, OUTPUT_PATH, 'client.gen.ts'),
      'utf-8',
    );
    expect(client).not.toContain('\t');
    expect(client).not.toContain('"');
  });

  it('should write nothing when dryRun is set', async () => {
    const result = await run('ts-client', { dryRun: true });

    expect(result).toEqual({ success: true });
    expect(generatedFiles()).toEqual([]);
  });

  // `constructor` and friends are inherited keys, so a lookup on the generator
  // map finds them even though they are not generators.
  it.each(['not-a-generator', 'constructor', 'toString', '__proto__'])(
    'should fail for the unknown generator %s',
    async (generator) => {
      const result = await executor(
        {
          generator: generator as OpenApiCodegenTarget,
          openApiSpecPath: SPEC_PATH,
          outputPath: OUTPUT_PATH,
        },
        {} as ExecutorContext,
      );

      expect(result).toEqual({ success: false });
      expect(generatedFiles()).toEqual([]);
    },
  );

  it('should be idempotent', async () => {
    await run('ts-hooks');
    const first = generatedContents();

    await run('ts-hooks');

    expect(generatedContents()).toEqual(first);
  });
});
