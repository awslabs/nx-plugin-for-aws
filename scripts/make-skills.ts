/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateFiles, joinPathFragments } from '@nx/devkit';
import { flushChanges, FsTree } from 'nx/src/generators/tree';
import { buildCreateNxWorkspaceCommand } from '../packages/nx-plugin/src/utils/commands';
import GeneratorsJson from '../packages/nx-plugin/generators.json';

interface GeneratorInfo {
  description: string;
  hidden?: boolean;
}

interface GeneratorsJsonSchema {
  generators: Record<string, GeneratorInfo>;
}

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
    (GeneratorsJson as GeneratorsJsonSchema).generators,
  )
    .filter(([, info]) => !info.hidden)
    .map(([id, info]) => ({
      id,
      description: info.description,
    }));

  const maxIdLen = Math.max(...generators.map((g) => g.id.length + 2));
  const maxDescLen = Math.max(...generators.map((g) => g.description.length));

  const header = `| ${'Generator'.padEnd(maxIdLen)} | ${'Description'.padEnd(maxDescLen)} |`;
  const separator = `| ${'-'.repeat(maxIdLen)} | ${'-'.repeat(maxDescLen)} |`;
  const rows = generators.map(
    (g) =>
      `| ${`\`${g.id}\``.padEnd(maxIdLen)} | ${g.description.padEnd(maxDescLen)} |`,
  );

  return [header, separator, ...rows].join('\n');
};

const KIRO_FRONTMATTER = `---
name: 'nx-plugin-for-aws'
displayName: 'Nx Plugin for AWS'
description: 'Scaffold and build cloud-native applications on AWS using @aws/nx-plugin generators. Covers workspace creation, project scaffolding with TypeScript, Python, React, CDK, Terraform, and more.'
keywords: ['nx-plugin-for-aws', 'aws-nx-plugin', 'nx', 'aws', 'cdk', 'terraform']
author: 'AWS'
---`;

const CLAUDE_FRONTMATTER = `---
name: nx-plugin-for-aws
description: >-
  Scaffold and build cloud-native applications on AWS using @aws/nx-plugin generators.
  Use when the user wants to create workspaces, generate projects, or scaffold infrastructure with the Nx Plugin for AWS.
---`;

// --- Main ---

const tree = new FsTree(ROOT, false);
const templateDir = joinPathFragments(__dirname, 'skill-templates');

const sharedVariables = {
  prerequisites: getPrerequisites(),
  createNxWorkspaceCommand: getCreateNxWorkspaceCommand(),
  generators: getGeneratorsTable(),
};

// Write POWER.md (Kiro)
generateFiles(tree, templateDir, 'powers/nx-plugin-for-aws', {
  ...sharedVariables,
  fileName: 'POWER.md',
  frontmatter: KIRO_FRONTMATTER,
});

// Write SKILL.md (Claude Code)
generateFiles(tree, templateDir, 'skills/nx-plugin-for-aws', {
  ...sharedVariables,
  fileName: 'SKILL.md',
  frontmatter: CLAUDE_FRONTMATTER,
});

flushChanges(tree.root, tree.listChanges());

for (const change of tree.listChanges()) {
  console.log(`Generated ${change.path}`);
}
