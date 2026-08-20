/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator';
import {
  addDestructuredImport,
  applyGritQL,
  captureGritQLVariable,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import type { ComponentMetadata } from '../../../utils/nx';

/**
 * Extract the inline session-id Express middleware - previously duplicated
 * verbatim in every ts#agent AG-UI/A2A `index.ts` - into a shared
 * `middleware/session-id-middleware.ts` module sitting beside `index.ts`,
 * mirroring how `agent.ts`/`session.ts` are already shared siblings.
 *
 * HTTP is untouched: its one procedure is a tRPC subscription served over
 * WebSocket, which bypasses Express entirely, so it never had this middleware
 * to begin with (see `enterSessionContext` in its `router.ts` instead).
 *
 * AG-UI and A2A wire the same logic up differently - AG-UI binds it to a
 * named `sessionIdMiddleware` const before use, while A2A inlines it directly
 * at the `app.use` call site - so each gets its own old-shape pattern below,
 * even though both resolve to the same shared middleware content.
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the
 *   generated shape and report them via `nextSteps`, rather than clobbering
 *   the user's changes.
 * - Idempotent: re-running is a no-op once migrated.
 */

const EXPRESS_IMPORT_OLD =
  "import express, { type Request, type Response, type NextFunction } from 'express';";
const EXPRESS_IMPORT_NEW = "import express from 'express';";

const RANDOM_UUID_IMPORT = "import { randomUUID } from 'node:crypto';";

const SESSION_ID_HEADER_LINE =
  "const SESSION_ID_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';";

// The leading comment sits directly above both shapes below. GritQL can only
// match it as its own comment node - folding it into the same backtick
// snippet as the statement that follows fails to parse as one construct - so
// it's matched/deleted as a separate step from the statement/expression.
const MIDDLEWARE_LEADING_COMMENT =
  '// Bind the inbound session (or a fresh UUID) for downstream MCP / A2A calls.';

// AG-UI binds the middleware to a named const, used later via `app.use(sessionIdMiddleware)`.
const AGUI_MIDDLEWARE_DEFINITION_OLD = `const sessionIdMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers[SESSION_ID_HEADER];
  const sessionId = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
  runWithSessionId(sessionId, () => next());
};`;

// A2A inlines the same logic directly at the `app.use` call site instead.
const A2A_MIDDLEWARE_USE_OLD = `app.use((req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers[SESSION_ID_HEADER];
    const sessionId = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
    runWithSessionId(sessionId, () => next());
  });`;
const A2A_MIDDLEWARE_USE_NEW = 'app.use(sessionIdMiddleware);';

// Captures the agent-connection package specifier so the new middleware
// module targets the same one. Generic over `$names` since a connection
// generator may have merged its own import into this same statement.
const RUNWITHSESSIONID_IMPORT_CAPTURE =
  "`import { $names } from '$mod';` where { $names <: contains `runWithSessionId` }";

// Removes `runWithSessionId` from the named import, preserving any other
// merged specifiers (or the whole statement if it was the only one).
// Decomposed via `import_clause(name=named_imports($imports))` since a naive
// `$rest`-based rewrite silently fails once other specifiers are involved.
const REMOVE_RUNWITHSESSIONID_IMPORT_PATTERN = `\`import $clause from '$mod';\` as $import where {
  $clause <: import_clause(name=named_imports($imports)),
  $imports <: contains \`runWithSessionId\`,
  if ($imports <: [\`runWithSessionId\`]) { $import => . } else { $imports <: some import_specifier(name=\`runWithSessionId\`) => . }
}`;

// Both protocols' `common-express/` dir vends byte-identical middleware
// content; read as the single source of truth rather than hand-duplicating
// it here.
const SESSION_ID_MIDDLEWARE_TEMPLATE = readFileSync(
  join(
    import.meta.dirname,
    '../../../ts/agent/files/common-express/middleware/session-id-middleware.ts.template',
  ),
  'utf-8',
);

const sessionIdMiddlewareContent = (agentConnectionImport: string): string =>
  SESSION_ID_MIDDLEWARE_TEMPLATE.replace(
    '<%- agentConnectionImport %>',
    agentConnectionImport,
  );

const findAgentComponents = (
  components: ComponentMetadata[] | undefined,
): ComponentMetadata[] =>
  (components ?? []).filter(
    (component) =>
      component.generator === TS_AGENT_GENERATOR_INFO.id &&
      (component.protocol === 'ag-ui' || component.protocol === 'a2a'),
  );

const migrateIndex = async (
  tree: Tree,
  indexPath: string,
  protocol: 'ag-ui' | 'a2a',
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(indexPath)) return;

  const contents = tree.read(indexPath, 'utf-8') ?? '';
  if (!contents.includes(SESSION_ID_HEADER_LINE)) return;

  const middlewarePattern =
    protocol === 'ag-ui'
      ? AGUI_MIDDLEWARE_DEFINITION_OLD
      : A2A_MIDDLEWARE_USE_OLD;

  const diverged = () => {
    nextSteps.push(
      `${indexPath}: diverged from the generated ts#agent ${protocol} shape - left untouched. Manually move the inline session-id middleware into a sibling \`middleware/session-id-middleware.ts\` module and import \`sessionIdMiddleware\` from there (see the ts#agent generator's template).`,
    );
  };

  const ready =
    (await matchGritQL(tree, indexPath, `\`${EXPRESS_IMPORT_OLD}\``)) &&
    (await matchGritQL(tree, indexPath, `\`${RANDOM_UUID_IMPORT}\``)) &&
    (await matchGritQL(tree, indexPath, `\`${SESSION_ID_HEADER_LINE}\``)) &&
    (await matchGritQL(tree, indexPath, `\`${MIDDLEWARE_LEADING_COMMENT}\``)) &&
    (await matchGritQL(tree, indexPath, `\`${middlewarePattern}\``)) &&
    (await matchGritQL(tree, indexPath, RUNWITHSESSIONID_IMPORT_CAPTURE));

  if (!ready) {
    diverged();
    return;
  }

  const mod = await captureGritQLVariable(
    tree,
    indexPath,
    RUNWITHSESSIONID_IMPORT_CAPTURE,
    'mod',
  );
  if (!mod) {
    diverged();
    return;
  }

  const dir = indexPath.split('/').slice(0, -1).join('/');
  const middlewarePath = joinPathFragments(
    dir,
    'middleware',
    'session-id-middleware.ts',
  );

  if (!tree.exists(middlewarePath)) {
    tree.write(middlewarePath, sessionIdMiddlewareContent(mod));
  }

  await applyGritQL(
    tree,
    indexPath,
    `\`${EXPRESS_IMPORT_OLD}\` => \`${EXPRESS_IMPORT_NEW}\``,
  );
  await applyGritQL(tree, indexPath, `\`${RANDOM_UUID_IMPORT}\` => .`);
  await applyGritQL(tree, indexPath, `\`${SESSION_ID_HEADER_LINE}\` => .`);
  await applyGritQL(tree, indexPath, REMOVE_RUNWITHSESSIONID_IMPORT_PATTERN);
  await applyGritQL(tree, indexPath, `\`${MIDDLEWARE_LEADING_COMMENT}\` => .`);

  if (protocol === 'ag-ui') {
    await applyGritQL(
      tree,
      indexPath,
      `\`${AGUI_MIDDLEWARE_DEFINITION_OLD}\` => .`,
    );
  } else {
    await applyGritQL(
      tree,
      indexPath,
      `\`${A2A_MIDDLEWARE_USE_OLD}\` => \`${A2A_MIDDLEWARE_USE_NEW}\``,
    );
  }

  await addDestructuredImport(
    tree,
    indexPath,
    ['sessionIdMiddleware'],
    './middleware/session-id-middleware.js',
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const components = findAgentComponents(
      (project.metadata as { components?: ComponentMetadata[] })?.components,
    );

    for (const component of components) {
      if (!component.path) continue;

      const indexPath = joinPathFragments(
        project.root,
        component.path,
        'index.ts',
      );

      await migrateIndex(
        tree,
        indexPath,
        component.protocol as 'ag-ui' | 'a2a',
        nextSteps,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
