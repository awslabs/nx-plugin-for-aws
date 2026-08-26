/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..');

/** WAFv2 requires its CloudWatch logging destination to carry this name prefix. */
const WAF_LOG_NAME_PREFIX = 'aws-waf-logs-';

/** Every vended template under the plugin's source tree. */
const templateFiles = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.template')) {
        found.push(path.relative(PLUGIN_SRC, full));
      }
    }
  };
  walk(PLUGIN_SRC);
  return found;
};

/** A log group definition found in a vended template. */
interface LogGroup {
  /** Template path, relative to the plugin's `src`. */
  readonly file: string;
  /** Terraform resource label, or CDK construct id. */
  readonly id: string;
  /** The definition's text, from which encryption is read. */
  readonly body: string;
}

/**
 * Extracts each `{ ... }` or `resource ... { ... }` body starting at every match
 * of `opener`, by counting braces. A regex can't do this: the bodies nest, and
 * carry both HCL `${...}` interpolations and JS template literals.
 */
const blocksFrom = (
  contents: string,
  opener: RegExp,
): { id: string; body: string }[] => {
  const found: { id: string; body: string }[] = [];
  for (const match of contents.matchAll(opener)) {
    const openBrace = contents.indexOf('{', match.index);
    if (openBrace < 0) {
      continue;
    }
    let depth = 0;
    let end = openBrace;
    for (; end < contents.length; end++) {
      if (contents[end] === '{') depth++;
      else if (contents[end] === '}' && --depth === 0) break;
    }
    found.push({
      id: match[1],
      body: contents.slice(openBrace + 1, end),
    });
  }
  return found;
};

/**
 * Whether a log group's name resolves to the WAF prefix. The name is either
 * written inline or routed through a Terraform local / TypeScript const so the
 * KMS key policy's encryption-context condition can name the same log group, so
 * both the definition and the whole file are considered.
 */
const isWafLogGroup = (body: string, contents: string): boolean => {
  if (body.includes(WAF_LOG_NAME_PREFIX)) {
    return true;
  }
  const indirect = /\b(?:name|logGroupName)\b\s*[:=]\s*(?:local\.)?(\w+)/.exec(
    body,
  );
  return (
    !!indirect &&
    new RegExp(
      `\\b${indirect[1]}\\b\\s*=\\s*[^\\n]*${WAF_LOG_NAME_PREFIX}`,
    ).test(contents)
  );
};

const wafLogGroups = (
  matches: (contents: string) => { id: string; body: string }[],
): LogGroup[] =>
  templateFiles().flatMap((file) => {
    const contents = fs.readFileSync(path.join(PLUGIN_SRC, file), 'utf-8');
    if (!contents.includes(WAF_LOG_NAME_PREFIX)) {
      return [];
    }
    return matches(contents)
      .filter(({ body }) => isWafLogGroup(body, contents))
      .map(({ id, body }) => ({ file, id, body }));
  });

const terraformWafLogGroups = (): LogGroup[] =>
  wafLogGroups((contents) =>
    blocksFrom(contents, /resource\s+"aws_cloudwatch_log_group"\s+"(\w+)"/g),
  );

const cdkWafLogGroups = (): LogGroup[] =>
  wafLogGroups((contents) =>
    blocksFrom(contents, /new\s+(?:\w+\.)?LogGroup\(\s*\w+,\s*'([^']+)'/g),
  );

/**
 * WAF logs carry full request metadata - URIs, headers and client IPs - so every
 * WAF log group we vend must be encrypted with a customer-managed KMS key, on
 * both IaC providers.
 *
 * Lambda and API Gateway execution log groups are deliberately out of scope:
 * they hold no request bodies, and the CDK side doesn't vend log groups for them
 * at all (Lambda creates its own), so there is no provider parity to hold.
 */
describe('waf log group encryption', () => {
  it('should find every vended WAF log group on both providers', () => {
    expect(
      terraformWafLogGroups()
        .map(({ file, id }) => `${file} :: ${id}`)
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        "utils/agent-core-constructs/files/terraform/app/agentcore-gateway/__nameKebabCase__/__nameKebabCase__.tf.template :: gateway_waf_logs",
        "utils/api-constructs/files/terraform/core/api/rest/rest-api/rest-api.tf.template :: api_waf_logs",
        "utils/identity-constructs/files/terraform/core/user-identity/identity/identity.tf.template :: user_pool_waf_logs",
      ]
    `);

    expect(
      cdkWafLogGroups()
        .map(({ file, id }) => `${file} :: ${id}`)
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        "utils/agent-core-constructs/files/cdk/core/agentcore-gateway/agentcore-gateway.ts.template :: WebAclLogs",
        "utils/api-constructs/files/cdk/core/api/rest/rest-api.ts.template :: WebAclLogs",
        "utils/identity-constructs/files/cdk/core/user-identity.ts.template :: WebAclLogs",
      ]
    `);
  });

  it.each(terraformWafLogGroups())(
    'should encrypt the Terraform $id log group in $file with a customer-managed key',
    ({ body }) => {
      expect(body).toMatch(/kms_key_id\s*=\s*aws_kms_key\./);
    },
  );

  it.each(cdkWafLogGroups())(
    'should encrypt the CDK $id log group in $file with a customer-managed key',
    ({ body }) => {
      expect(body).toMatch(/encryptionKey:\s*\w/);
    },
  );

  it.each([...terraformWafLogGroups(), ...cdkWafLogGroups()])(
    'should not suppress CKV_AWS_158 for the $id log group in $file',
    ({ body, file }) => {
      // The suppression only ever covered unencrypted log groups. Left behind it
      // would claim the encryption below it doesn't exist.
      expect(body).not.toContain('CKV_AWS_158');
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, file), 'utf-8');
      expect(contents).not.toMatch(/CKV_AWS_158[^\n]*(?:WAF|waf)/);
    },
  );

  it.each(terraformWafLogGroups())(
    'should scope the Terraform $id key policy to CloudWatch Logs for that log group',
    ({ file, body }) => {
      const keyName = /kms_key_id\s*=\s*aws_kms_key\.(\w+)/.exec(body)![1];
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, file), 'utf-8');
      const [key] = blocksFrom(
        contents,
        new RegExp(`resource\\s+"aws_kms_key"\\s+"(${keyName})"`, 'g'),
      );

      expect(key.body).toContain('enable_key_rotation     = true');
      expect(key.body).toMatch(/Service = "logs\.\$\{[^}]+\}\.amazonaws\.com"/);
      // Without the encryption-context condition the grant would let CloudWatch
      // Logs encrypt under this key on behalf of any log group in the account.
      expect(key.body).toMatch(
        /ArnEquals = \{\s*"kms:EncryptionContext:aws:logs:arn"/,
      );
    },
  );

  it.each(cdkWafLogGroups())(
    'should grant CloudWatch Logs use of the CDK $id encryption key',
    ({ file, body }) => {
      const keyVar = /encryptionKey:\s*(\w+)/.exec(body)![1];
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, file), 'utf-8');

      expect(contents).toMatch(
        new RegExp(`const ${keyVar}(?::[^=]+)? = .*new Key\\(`, 's'),
      );
      expect(contents).toMatch(
        new RegExp(
          `${keyVar}\\.(?:grantEncryptDecrypt|addToResourcePolicy)\\(`,
        ),
      );
      expect(contents).toMatch(/logs\.\$\{[^}]*\.region\}\.amazonaws\.com/);
    },
  );
});
