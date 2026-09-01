/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import { addDynamoDBTerraformModules } from './dynamodb-constructs.js';

const APP_MODULE_FILE =
  'packages/common/terraform/src/app/dynamodb/my-table/my-table.tf';
const CORE_MODULE_FILE =
  'packages/common/terraform/src/core/dynamodb/dynamodb.tf';

const DOCS_DIR = join(__dirname, '../../../../../docs/src/content/docs/en');

/** Names of every `output "..."` block declared in a Terraform file. */
const outputNames = (hcl: string): string[] =>
  [...hcl.matchAll(/^output "([^"]+)" \{/gm)].map(([, name]) => name);

const mdxFilesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? mdxFilesIn(path)
      : path.endsWith('.mdx')
        ? [path]
        : [];
  });

describe('dynamodb-constructs utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const generateTerraformModules = () =>
    addDynamoDBTerraformModules(tree, {
      projectName: '@proj/my-table',
      nameClassName: 'MyTable',
      nameKebabCase: 'my-table',
      tableName: 'my-table',
      projectRoot: 'packages/my-table',
    });

  it('should expose the table and key attributes as outputs on the app module', () => {
    generateTerraformModules();

    const appModule = tree.read(APP_MODULE_FILE, 'utf-8') ?? '';

    expect(outputNames(appModule)).toEqual(
      expect.arrayContaining(['table_name', 'table_arn', 'kms_key_arn']),
    );
  });

  it('should re-export every output of the core module from the app module', () => {
    generateTerraformModules();

    const coreOutputs = outputNames(tree.read(CORE_MODULE_FILE, 'utf-8') ?? '');
    const appModule = tree.read(APP_MODULE_FILE, 'utf-8') ?? '';

    expect(coreOutputs.length).toBeGreaterThan(0);
    expect(outputNames(appModule)).toEqual(expect.arrayContaining(coreOutputs));
    // Each re-export forwards the equivalently named core module attribute
    for (const name of coreOutputs) {
      expect(appModule).toContain(
        `value       = module.dynamodb_table.${name}`,
      );
    }
  });

  /**
   * The connection guides tell users to reference these attributes from their
   * root Terraform configuration, so an attribute the docs name but the module
   * doesn't declare is a `terraform plan` failure for anyone following them.
   */
  it('should declare every app module attribute the docs reference', () => {
    generateTerraformModules();

    const declared = new Set(
      outputNames(tree.read(APP_MODULE_FILE, 'utf-8') ?? ''),
    );

    const referenced = new Map<string, string[]>();
    for (const file of mdxFilesIn(DOCS_DIR)) {
      for (const [, attribute] of readFileSync(file, 'utf-8').matchAll(
        /\bmodule\.my_table\.([a-z_]+)/g,
      )) {
        referenced.set(attribute, [...(referenced.get(attribute) ?? []), file]);
      }
    }

    expect([...referenced.keys()]).not.toHaveLength(0);
    expect(
      [...referenced.entries()]
        .filter(([attribute]) => !declared.has(attribute))
        .map(([attribute, files]) => `${attribute} (${files.join(', ')})`),
    ).toEqual([]);
  });

  /**
   * The same invariant for the consumer side of the documented grant: the role
   * the shared Lambda snippet attaches its policy to must be an output of the
   * API app modules it is included from, and the agent/MCP server guides grant
   * access through the agent-core app module's own IAM input.
   */
  it('should reference role attributes the consumer modules declare', () => {
    const snippet = readFileSync(
      join(DOCS_DIR, 'snippets/connection/lambda-dynamodb-access.mdx'),
      'utf-8',
    );
    const roleAttributes = [
      ...snippet.matchAll(/^\s*role\s*=\s*module\.my_api\.(\w+)$/gm),
    ].map(([, attribute]) => attribute);

    expect(roleAttributes).not.toHaveLength(0);

    for (const apiType of ['rest', 'http']) {
      const template = readFileSync(
        join(
          __dirname,
          '../api-constructs/files/terraform/app/apis',
          apiType,
          '__apiNameKebabCase__/__apiNameKebabCase__.tf.template',
        ),
        'utf-8',
      );
      expect(outputNames(template)).toEqual(
        expect.arrayContaining(roleAttributes),
      );
    }

    const agentCoreTemplate = readFileSync(
      join(
        __dirname,
        '../agent-core-constructs/files/terraform/app/agent-core',
        '__nameKebabCase__/__nameKebabCase__.tf.template',
      ),
      'utf-8',
    );
    expect(agentCoreTemplate).toContain(
      'variable "additional_iam_policy_statements"',
    );
    // The agent-core app module exposes no role name, so its guides grant
    // access through that input rather than an aws_iam_role_policy.
    for (const guide of [
      'ts-agent-dynamodb',
      'py-agent-dynamodb',
      'ts-mcp-server-dynamodb',
      'py-mcp-server-dynamodb',
    ]) {
      const content = readFileSync(
        join(DOCS_DIR, 'guides/connection', `${guide}.mdx`),
        'utf-8',
      );
      expect(content).toContain('additional_iam_policy_statements');
      expect(content).not.toMatch(/role\s*=\s*module\./);
    }
  });
});
