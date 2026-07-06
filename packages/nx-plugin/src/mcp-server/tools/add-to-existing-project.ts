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
    match:
      /ts\.readConfigFile is not a function|Unsupported version of 'typescript'/i,
    title: 'TypeScript version incompatible',
    solution:
      "The workspace uses TypeScript 7 (native compiler), which removes the TypeScript JS API that Nx executors and the plugin's generators rely on, or pins a `typescript` range below 5.4. Set the root `typescript` devDependency to a 5.x/6.x version (e.g. `~5.9.0`) and reinstall before running `nx add @aws/nx-plugin`.",
  },
  {
    match: /was already invoked by a parent Nx process|Recursive task invocation/i,
    title: 'Recursive task invocation detected',
    solution:
      'The ROOT package.json is registered as an Nx project and its `build` script calls `nx run-many --target build`, so the root target invokes itself. Either set `"nx": { "includedScripts": [] }` on the root package.json, or move the root package\'s source into `packages/<name>/` so the root becomes a workspace manifest.',
  },
  {
    match:
      /plugin worker.*(not connected within|exited with code|before the connection)|nx sync.*(hang|timeout)/i,
    title: 'Plugin worker timeout / hang (duplicate nx installs)',
    solution:
      'Almost always caused by two different `nx` versions in the same node_modules tree (e.g. workspace nx@X.Y.2 with a nested nx@X.Y.1 under an @nx/* or @aws/nx-plugin package) — their IPC handshake deadlocks. Run `npm ls nx` (or `pnpm why nx`) and align every copy to ONE version: set the root `nx` devDependency to the version the plugin resolves (the `init` generator pins this automatically), delete node_modules and the lockfile if needed, and reinstall. `nx reset` alone does not fix it.',
  },
  {
    match: /Cannot find module '@nx\/js'|Cannot find module '@nx\//i,
    title: "Cannot find module '@nx/js' (or another @nx/* package)",
    solution:
      "The workspace's package manager did not hoist the plugin's `@nx/*` dependencies to the root node_modules (npm hoisting varies with conflicting peers). Install the missing package at the root at the same version as the workspace's `nx` (e.g. `npm install -D @nx/js@<nx version>`), then re-run the failed command. The `init` generator adds `@nx/js` as a root devDependency to prevent recurrence.",
  },
  {
    match: /ERR_PNPM_IGNORED_BUILDS|Ignored build scripts/i,
    title: 'pnpm blocked dependency build scripts',
    solution:
      "pnpm skips install scripts for packages not allow-listed in `pnpm-workspace.yaml`. The `init` generator allow-lists the ones the plugin's tooling needs (`@swc/core`, `esbuild`, `nx`, `sharp`), but the block can fire during `nx add` itself (before init runs). Run `pnpm approve-builds` and approve the listed packages, or add them under `allowBuilds:` in `pnpm-workspace.yaml`, then re-run the install.",
  },
  {
    match: /npm error ERESOLVE|unable to resolve dependency tree|peer dep/i,
    title: 'npm peer dependency conflict',
    solution:
      "npm's strict peer resolution can reject the install when the workspace already pins different versions of shared tooling (typescript, vitest, etc). Retry the install with `--legacy-peer-deps`, or align the conflicting devDependency version in the root package.json with the one the plugin requires. pnpm workspaces don't hit this.",
  },
  {
    match: /iac\.provider|IaC provider "inherit"/i,
    title: 'IaC provider "inherit" requires iac.provider to be set',
    solution:
      'The workspace has no `aws-nx-plugin.config.mts`, which means the `init` generator has not run. Run `nx add @aws/nx-plugin` (which installs the plugin and runs its `init` generator), or run the generator directly with `nx g @aws/nx-plugin:init`.',
  },
  {
    match: /Cannot find package\.json|ENOENT.*package\.json/i,
    title: 'Cannot find package.json (non-Node project)',
    solution:
      'Nx and the plugin are npm packages, so the workspace root needs a minimal `package.json` before `nx init`/`nx add` can run — create one with `{"name": "<project>", "private": true, "type": "module"}` (this does not affect your existing language tooling), then re-run `nx init` and `nx add @aws/nx-plugin`.',
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
      /require is not defined in ES module scope|module is not defined in ES module scope|type.*module|ESM|CommonJS|commonjs/i,
    title: 'ESM/CommonJS mismatch',
    solution:
      'The module format is workspace-wide, read from the root `package.json` `type` field: `type: "module"` means ESM, absent or `"commonjs"` means CommonJS. `init` preserves whichever the workspace uses (writing it explicitly), and generated TypeScript code follows that format. If existing `.js` config files break after the root `type` changed, the root `type` was likely edited by hand — either restore the original `type` and re-run `init`, or rename the affected config files (`.cjs` for CommonJS files in an ESM workspace, `.mjs` for the reverse).',
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

The recommended path is \`nx add @aws/nx-plugin\` — it installs the plugin at a version compatible with the workspace's Nx and automatically runs the plugin's \`init\` generator to configure the workspace. Prefer this over installing the package manually or editing configuration by hand. If the project is not yet an Nx workspace, run \`nx init\` first (that is Nx's own tool for adopting Nx).

Working non-interactively (agents, CI):
- \`npx nx@latest init --interactive=false\` may still stop to ask about detected tool plugins — pass \`--plugins=skip\` (add them later with \`nx add\`) or \`--plugins=all\`.
- \`nx add @aws/nx-plugin\` runs \`init\` with defaults (iac=cdk). To choose explicitly, run \`nx g @aws/nx-plugin:init --iac=<cdk|terraform> --no-interactive\` afterwards — it is idempotent. Verify \`aws-nx-plugin.config.mts\` exists after \`nx add\`; if it doesn't, the init generator did not run — run it directly.
- Use the \`generator-guide\` tool with generator \`init\` for its options.`,
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
