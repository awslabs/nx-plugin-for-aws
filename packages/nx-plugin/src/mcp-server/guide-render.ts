/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared rendering helpers used by the unified/remark-mdx guide pipeline.
 * Kept in their own module so `generator-info.ts` (which still exports
 * `renderGeneratorInfo` for list-generators) and the pipeline both render
 * identical command strings without either re-implementing the other.
 */
import { buildPackageManagerExecCommand } from '../utils/commands';

/**
 * Build an nx command, optionally prefixed by the package manager's exec
 * wrapper. A bare `nx <command>` is returned when no package manager is
 * passed, matching the legacy regex-based post-processor's behaviour.
 */
export const buildNxCommand = (command: string, pm?: string) =>
  pm ? buildPackageManagerExecCommand(pm, `nx ${command}`) : `nx ${command}`;

/**
 * Serialise a generator schema's `properties` map to the bullet list
 * `<GeneratorParameters>` expands to.
 */
export const renderSchema = (schema: {
  properties?: Record<string, unknown>;
  required?: string[];
}): string => {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .map(([parameter, raw]) => {
      const p = raw as {
        type?: string;
        enum?: unknown[];
        description?: string;
      };
      const enumPart = p.enum ? ` [options: ${p.enum.join(', ')}]` : '';
      const requiredPart = required.has(parameter) ? ` (required)` : '';
      return `- ${parameter} [type: ${p.type}]${enumPart}${requiredPart} ${p.description}`;
    })
    .join('\n');
};

/**
 * Build the fenced-code invocation that `<RunGenerator>` expands to.
 */
export const renderGeneratorCommand = (
  generatorId: string,
  schema: { properties?: Record<string, unknown>; required?: string[] },
  packageManager?: string,
): string => {
  const required = new Set(schema.required ?? []);
  const args = Object.keys(schema.properties ?? {})
    .filter((k) => required.has(k))
    .map((k) => `--${k}=<${k}>`)
    .join(' ');
  return `\`\`\`bash\n${buildNxCommand(
    `g @aws/nx-plugin:${generatorId} --no-interactive ${args}`,
    packageManager,
  )}\n\`\`\``;
};
