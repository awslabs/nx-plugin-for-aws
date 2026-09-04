/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NxGeneratorInfo } from '../../utils/generators.js';
import { fetchGuidePages } from '../generator-info.js';
import { PackageManagerSchema } from '../schema.js';

/**
 * Guide pages documenting behaviour that spans generators, so no single
 * generator owns them and `generator-guide` never returns them. Each is
 * described for the agent so it can pick the ones relevant to its task.
 */
export const BEST_PRACTICE_PAGES = {
  workspace: 'Workspace layout, configuration and common commands',
  'typescript-project': 'Conventions for TypeScript projects',
  'python-project': 'Conventions for Python projects',
  security:
    'Security controls vended infrastructure carries, and the shared responsibility model',
  'runtime-config':
    'How generated projects discover one another through AWS AppConfig',
  'docker-bundling': 'Building and deploying container images',
  'local-development':
    'Running projects locally with the serve and dev targets',
} as const satisfies Record<string, string>;

export type BestPracticePage = keyof typeof BEST_PRACTICE_PAGES;

export const BEST_PRACTICE_PAGE_NAMES = Object.keys(
  BEST_PRACTICE_PAGES,
) as BestPracticePage[];

/**
 * Add a tool which serves the cross-cutting guide pages. Kept separate from
 * `general-guidance` so an agent fetches only the pages its task needs rather
 * than every page on every call.
 */
export const addBestPracticesTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'best-practices',
    {
      title: 'Best Practices',
      description:
        'Tool to retrieve guidance which spans generators, rather than applying to one in particular. ' +
        'Request the pages relevant to your task:\n' +
        Object.entries(BEST_PRACTICE_PAGES)
          .map(([page, description]) => `- \`${page}\`: ${description}`)
          .join('\n'),
      inputSchema: {
        packageManager: PackageManagerSchema.optional(),
        pages: z
          .array(z.enum(BEST_PRACTICE_PAGE_NAMES))
          .min(1)
          .describe('The guide pages to retrieve.'),
      },
    },
    async ({ packageManager, pages }) => ({
      content: [
        {
          type: 'text' as const,
          text: await fetchGuidePages(pages, generators, packageManager),
        },
      ],
    }),
  );
};
