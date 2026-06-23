/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { frameworkSupportsLanguage } from './agent-connection';

/**
 * Automatic guard against adding an agent framework without connection support.
 *
 * The `framework` enum in each agent generator's `schema.json` is the *only*
 * thing a contributor edits to offer a new framework. This test reads that enum
 * live and asserts every value has connection support wired into the
 * `FRAMEWORKS` registry (which drives all connection codegen) for that language.
 *
 * So if someone adds e.g. `langchain` to `py#agent` and implements the agent
 * but forgets connections, this test fails on its own — no snapshot to update,
 * no per-framework smoke test to remember. The fix is to either add a
 * `FRAMEWORKS` entry (wiring up the connection clients) or not offer the
 * framework in the schema enum.
 */

const AGENT_SCHEMAS: { id: string; language: 'ts' | 'py'; schema: string }[] = [
  { id: 'ts#agent', language: 'ts', schema: '../../ts/agent/schema.json' },
  { id: 'py#agent', language: 'py', schema: '../../py/agent/schema.json' },
];

const readFrameworkEnum = (schemaRelativePath: string): string[] => {
  const schema = JSON.parse(
    readFileSync(join(__dirname, schemaRelativePath), 'utf-8'),
  );
  const frameworkEnum: unknown = schema?.properties?.framework?.enum;
  if (!Array.isArray(frameworkEnum)) {
    throw new Error(
      `Expected a 'framework' enum in ${schemaRelativePath}. If the agent no longer has a framework option, update this guard.`,
    );
  }
  return frameworkEnum as string[];
};

describe('agent framework connection support', () => {
  it.each(AGENT_SCHEMAS)(
    '$id: every framework in the schema enum has connection support',
    ({ language, schema }) => {
      const frameworks = readFrameworkEnum(schema);
      const missing = frameworks.filter(
        (framework) => !frameworkSupportsLanguage(framework, language),
      );
      expect(
        missing,
        `These frameworks are offered in the ${schema} enum but have no ` +
          `connection support in the FRAMEWORKS registry ` +
          `(utils/agent-connection/agent-connection.ts): ${missing.join(', ')}. ` +
          `Add a FRAMEWORKS entry wiring up the connection client templates, ` +
          `or remove the framework from the schema enum.`,
      ).toEqual([]);
    },
  );
});
