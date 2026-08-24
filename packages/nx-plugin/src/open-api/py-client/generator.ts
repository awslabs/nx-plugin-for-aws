/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, type Tree } from '@nx/devkit';
import * as path from 'path';
import { declareDependencies } from '../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { updateGitIgnore } from '../../utils/git';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx';
import { buildOpenApiCodeGenerationData } from '../ts-client/generator';
import {
  annotatePythonData,
  assertNoClashingPythonNames,
} from '../utils/codegen-data';
import { toPythonLiteral } from '../utils/codegen-data/languages';
import {
  type CodeGenData,
  isPythonCollection,
  needsPythonTypeAdapter,
} from '../utils/codegen-data/types';
import type { OpenApiPyClientGeneratorSchema } from './schema';

export const OPEN_API_PY_CLIENT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Python packages a generated client imports at runtime. A generator that
 * emits a client into a project spreads these into its own declaration and
 * adds them to that project's pyproject.
 */
export const OPEN_API_PY_CLIENT_DEPENDENCIES = declareDependencies()({
  py: [{ name: 'httpx' }, { name: 'pydantic' }],
});

/**
 * Generate a Python httpx-based client from an OpenAPI spec.
 *
 * Emits:
 *  - types.py        — pydantic v2 models + per-op error classes and TypedDicts
 *  - client.py       — sync  client (httpx.Client)      when clientType includes 'sync'
 *  - async_client.py — async client (httpx.AsyncClient) when clientType includes 'async'
 *
 * The shape mirrors `open-api#ts-client`, but the two decide a few things
 * separately rather than through shared code: this generator reads the neutral
 * `requestShape` from `codegen-data`, while the TypeScript templates still
 * compute inlining themselves. Where they differ today, for the same spec:
 *
 *  - A discriminated object body: TypeScript inlines its fields, Python passes
 *    the body whole so marshalling can dispatch on the discriminator.
 *  - A body carrying `additionalProperties`, a union, or `patternProperties`, or
 *    a body property literally named `body`: TypeScript wraps, Python flattens.
 *  - An optional (`required: false`) object body: Python flattens its required
 *    fields into required keyword arguments, so the body is always sent.
 *  - A primitive `application/json` body: TypeScript sends the raw text, Python
 *    sends it JSON-encoded.
 *  - The media type chosen for a body offering several: TypeScript prefers any
 *    `+json` type, Python only an exact `application/json`.
 *
 * Migrating the TypeScript templates onto `requestShape` would collapse these
 * into one decision; until then they are differences of behaviour, not of
 * correctness, and are covered by this generator's own tests.
 */
export const openApiPyClientGenerator = async (
  tree: Tree,
  options: OpenApiPyClientGeneratorSchema,
) => {
  const data = await buildOpenApiCodeGenerationData(
    tree,
    options.openApiSpecPath,
  );
  const clientType = options.clientType ?? 'both';

  // Derived here rather than in the shared pipeline, so a TypeScript consumer of
  // the same spec pays for neither these fields nor a Python-specific name clash.
  annotatePythonData(data);

  for (const model of data.models) {
    assertNoClashingPythonNames(model);
  }

  generateOpenApiPyClient(tree, data, options.outputPath, clientType);

  // The client is regenerated from the spec, so it is ignored by default.
  // Remove the entry to check it in instead.
  updateGitIgnore(tree, '.', (patterns) => [...patterns, options.outputPath]);

  await addGeneratorMetricsIfApplicable(tree, [
    OPEN_API_PY_CLIENT_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
};

/**
 * Generate an OpenAPI Python client in the target directory
 */
export const generateOpenApiPyClient = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
  clientType: 'sync' | 'async' | 'both' = 'both',
) => {
  // `toPythonLiteral` is shared with the type renderer so a value is escaped
  // the same way wherever a template spells it out. The type predicates let a
  // template ask what a Python type is, rather than matching its spelling.
  const base = {
    ...data,
    clientType,
    toPythonLiteral,
    isPythonCollection,
    needsPythonTypeAdapter,
  };

  generateFiles(
    tree,
    path.join(import.meta.dirname, 'files', 'shared'),
    outputPath,
    base,
  );

  if (clientType === 'sync' || clientType === 'both') {
    generateFiles(
      tree,
      path.join(import.meta.dirname, 'files', 'sync'),
      outputPath,
      base,
    );
  }
  if (clientType === 'async' || clientType === 'both') {
    generateFiles(
      tree,
      path.join(import.meta.dirname, 'files', 'async'),
      outputPath,
      base,
    );
  }
};

export default openApiPyClientGenerator;
