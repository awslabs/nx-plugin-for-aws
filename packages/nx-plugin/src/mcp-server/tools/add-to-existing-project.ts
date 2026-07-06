/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NxGeneratorInfo } from '../../utils/generators';
import { fetchGuidePages } from '../generator-info';
import { PackageManagerSchema } from '../schema';

/**
 * The guide page (under `get_started/`) that backs this tool. Fetched at call
 * time so the tool and the published docs never drift.
 */
const EXISTING_PROJECT_GUIDE = 'existing-project';

/**
 * Common errors users hit when adding the plugin to a workspace it didn't
 * create, mapped to the fix. Keyed on a distinctive substring of the error so
 * an agent can pass the raw message it saw and get the right entry first.
 */
interface ErrorMapping {
  readonly match: RegExp;
  readonly title: string;
  readonly solution: string;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  {
    match: /iac\.provider|IaC provider "inherit"/i,
    title: 'IaC provider "inherit" requires iac.provider to be set',
    solution:
      'The workspace has no `aws-nx-plugin.config.mts`, which means the `init` generator has not run. Run `nx add @aws/nx-plugin` (which installs the plugin and runs its `init` generator), or run the generator directly with `nx g @aws/nx-plugin:init`.',
  },
  {
    match: /Missing root "?tsconfig\.json"?/i,
    title: 'Missing root "tsconfig.json"',
    solution:
      "Nx's TypeScript sync generator needs a root `tsconfig.json`. The `init` generator creates a minimal one if it is absent — run `nx add @aws/nx-plugin`.",
  },
  {
    match: /workspace is out of sync|typescript-sync/i,
    title: 'The workspace is out of sync',
    solution:
      'TypeScript project references need syncing. Ensure `init` has run (it registers `@nx/js:typescript-sync` and `@aws/nx-plugin:ts#sync` in `nx.json`), then run `nx sync`.',
  },
  {
    match:
      /NG4006|emitDeclarationOnly is not supported|TS6059|not under 'rootDir'|TS7016|Could not find a declaration file|TS5011|rootDir/i,
    title: 'One of your existing projects breaks after adding the plugin',
    solution:
      "The plugin's generated projects carry their TypeScript settings in their own `tsconfig.lib.json`, so they build regardless of your base config. These errors appear in a PRE-EXISTING project of yours that inherits a `tsconfig.base.json` `init` created (`composite`/`emitDeclarationOnly`/`nodenext`) but isn't compatible with it — e.g. the Angular compiler rejects `emitDeclarationOnly` (NG4006), or a project with `outDir` now needs an explicit `rootDir` (TS5011). Add per-project tsconfig overrides for those projects (e.g. `\"rootDir\": \"src\"`), or give them a separate base config. `init` never rewrites an existing base, so it can't break inheriting projects.",
  },
  {
    match:
      /require is not defined in ES module scope|type.*module|ESM|CommonJS|commonjs/i,
    title: 'CommonJS project conflicts with the plugin (ESM)',
    solution:
      "The plugin's generators produce ES modules and `init` sets `type: \"module\"` on the root `package.json`. Adopting the plugin in a CommonJS project assumes moving that project to ESM (rename CommonJS `.js` config files to `.cjs`, or migrate to `import`/`export`). Broad CommonJS support is tracked separately.",
  },
];

const renderErrorGuidance = (errorMessage?: string): string => {
  if (!errorMessage) {
    return '';
  }
  const matched = ERROR_MAPPINGS.filter((m) => m.match.test(errorMessage));
  if (matched.length === 0) {
    return '';
  }
  return `## Matching the error you reported

${matched
  .map((m) => `### ${m.title}\n\n${m.solution}`)
  .join('\n\n')}

`;
};

const renderErrorReference = (): string =>
  `## Common errors and fixes

${ERROR_MAPPINGS.map((m) => `- **${m.title}** — ${m.solution}`).join('\n')}`;

/**
 * Add a tool which guides an agent through adding @aws/nx-plugin to an existing
 * Nx or non-Nx workspace. The bulk of the guidance is pulled from the
 * `existing-project` docs page so there is a single source of truth.
 */
export const addToExistingProjectTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'add-to-existing-project',
    {
      title: 'Add to Existing Project',
      description:
        'Tool for adding the Nx Plugin for AWS to an existing Nx workspace or non-Nx monorepo. Use this when a user wants to adopt @aws/nx-plugin in a project that was not created with the plugin preset, or hits configuration errors (e.g. IaC provider "inherit", missing tsconfig, ESM/CJS issues) when running generators in such a workspace.',
      inputSchema: {
        packageManager: PackageManagerSchema.optional(),
        errorMessage: z
          .string()
          .optional()
          .describe(
            'The exact error message the user encountered, if any. Used to surface the most relevant fix first.',
          ),
      },
    },
    async ({ packageManager, errorMessage }) => {
      const guide = await fetchGuidePages(
        [EXISTING_PROJECT_GUIDE],
        generators,
        packageManager,
      );
      const sections = [
        `# Adding @aws/nx-plugin to an existing project

The recommended path is \`nx add @aws/nx-plugin\` — it installs the plugin at a version compatible with the workspace's Nx and automatically runs the plugin's \`init\` generator to configure the workspace. Prefer this over installing the package manually or editing configuration by hand. If the project is not yet an Nx workspace, run \`nx init\` first (that is Nx's own tool for adopting Nx). Use the \`generator-guide\` tool with generator \`init\` for its options.`,
        renderErrorGuidance(errorMessage),
        guide,
        renderErrorReference(),
      ].filter(Boolean);
      return {
        content: [
          {
            type: 'text' as const,
            text: sections.join('\n\n'),
          },
        ],
      };
    },
  );
};
