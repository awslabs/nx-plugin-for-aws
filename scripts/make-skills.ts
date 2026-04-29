/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildCreateNxWorkspaceCommand } from '../packages/nx-plugin/src/utils/commands';
import GeneratorsJson from '../packages/nx-plugin/generators.json';

const ROOT = join(__dirname, '..');

/**
 * Read required-prerequisites.mdx and strip frontmatter
 */
const getPrerequisites = (): string => {
  const content = readFileSync(
    join(ROOT, 'docs/src/content/docs/en/snippets/required-prerequisites.mdx'),
    'utf-8',
  );
  // Remove YAML frontmatter (--- ... ---)
  return content.replace(/^---[\s\S]*?---\n/, '').trim();
};

/**
 * Build the create workspace command using pnpm as the default
 */
const getCreateNxWorkspaceCommand = (): string => {
  return buildCreateNxWorkspaceCommand('pnpm', 'my-app');
};

/**
 * Build the generators table from generators.json, filtering out hidden generators
 */
const getGeneratorsTable = (): string => {
  const generators = Object.entries(
    (GeneratorsJson as Record<string, any>).generators,
  )
    .filter(([, info]: [string, any]) => !info.hidden)
    .map(([id, info]: [string, any]) => ({
      id,
      description: info.description,
    }));

  // Find the max width for padding
  const maxIdLen = Math.max(...generators.map((g) => g.id.length + 2)); // +2 for backticks
  const maxDescLen = Math.max(...generators.map((g) => g.description.length));

  const header = `| ${'Generator'.padEnd(maxIdLen)} | ${'Description'.padEnd(maxDescLen)} |`;
  const separator = `| ${'-'.repeat(maxIdLen)} | ${'-'.repeat(maxDescLen)} |`;
  const rows = generators.map(
    (g) =>
      `| ${`\`${g.id}\``.padEnd(maxIdLen)} | ${g.description.padEnd(maxDescLen)} |`,
  );

  return [header, separator, ...rows].join('\n');
};

/**
 * Render a template by replacing {{variable}} placeholders
 */
const renderTemplate = (
  template: string,
  variables: Record<string, string>,
): string => {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
};

/**
 * Convert POWER.md content to SKILL.md for Claude Code
 * Strips Kiro-specific frontmatter and adjusts format
 */
const convertToSkill = (powerContent: string): string => {
  // Replace Kiro YAML frontmatter with Claude Code skill frontmatter
  const withoutFrontmatter = powerContent.replace(/^---[\s\S]*?---\n/, '');

  const skillFrontmatter = `---
name: nx-plugin-for-aws
description: >-
  Scaffold and build cloud-native applications on AWS using @aws/nx-plugin generators.
  Use when the user wants to create workspaces, generate projects, or scaffold infrastructure with the Nx Plugin for AWS.
---
`;

  return skillFrontmatter + withoutFrontmatter;
};

// --- Main ---

const template = readFileSync(
  join(ROOT, 'powers/nx-plugin-for-aws/POWER.md.template'),
  'utf-8',
);

const variables: Record<string, string> = {
  prerequisites: getPrerequisites(),
  createNxWorkspaceCommand: getCreateNxWorkspaceCommand(),
  generators: getGeneratorsTable(),
};

const powerContent = renderTemplate(template, variables);

// Write POWER.md (Kiro)
const powerPath = join(ROOT, 'powers/nx-plugin-for-aws/POWER.md');
writeFileSync(powerPath, powerContent);
console.log(`Generated ${powerPath}`);

// Write SKILL.md (Claude Code — plugin)
const skillContent = convertToSkill(powerContent);
const pluginSkillDir = join(ROOT, 'skills/nx-plugin-for-aws');
mkdirSync(pluginSkillDir, { recursive: true });
const pluginSkillPath = join(pluginSkillDir, 'SKILL.md');
writeFileSync(pluginSkillPath, skillContent);
console.log(`Generated ${pluginSkillPath}`);
