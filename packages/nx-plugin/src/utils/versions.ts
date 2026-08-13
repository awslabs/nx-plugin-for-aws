/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type DeclaredPy,
  type DeclaredTs,
  type DependencyDeclaration,
  declaredNames,
} from './declared-dependencies';

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@a2a-js/sdk': '0.3.14',
  '@aws/aws-distro-opentelemetry-node-autoinstrumentation': '0.12.0',
  // Pinned above the version the ADOT autoinstrumentation package resolves
  // transitively (2.8.0) to clear CVE-2026-59892 (HIGH).
  '@opentelemetry/propagator-jaeger': '2.10.0',
  // Overridden in the vended agent/MCP image builds to clear CVE-2026-14257
  // (HIGH) in brace-expansion: minimatch 10 is the lowest major depending on
  // brace-expansion 5.x, the only line Trivy's `< 5.0.8` advisory range treats
  // as fixed. Overriding brace-expansion directly is not viable — 5.x drops the
  // CommonJS default export that minimatch 9 calls.
  minimatch: '10.2.6',
  '@aws-sdk/client-dynamodb': '3.1106.0',
  '@aws-sdk/client-api-gateway': '3.1106.0',
  '@aws-sdk/client-iam': '3.1106.0',
  '@aws-sdk/client-bedrock-agentcore': '3.1106.0',
  '@aws-sdk/client-bedrock-runtime': '3.1106.0',
  '@aws-sdk/client-s3': '3.1106.0',
  '@aws-sdk/client-sts': '3.1106.0',
  '@aws-sdk/credential-providers': '3.1106.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.972.66',
  '@aws-sdk/client-secrets-manager': '3.1106.0',
  '@aws-sdk/rds-signer': '3.1106.0',
  '@smithy/server-apigateway': '0.2.0',
  '@smithy/server-node': '0.2.0',
  '@aws-lambda-powertools/logger': '2.34.0',
  '@aws-lambda-powertools/metrics': '2.34.0',
  '@aws-lambda-powertools/parameters': '2.34.0',
  '@aws-lambda-powertools/tracer': '2.34.0',
  '@aws-lambda-powertools/parser': '2.34.0',
  '@aws-sdk/client-appconfigdata': '3.1106.0',
  '@middy/core': '7.7.2',
  '@nxlv/python': '22.2.2',
  '@nx-extend/terraform': '10.4.1',
  // These must all hold the same version — see NX_PACKAGES.
  nx: '23.1.1',
  '@nx/devkit': '23.1.1',
  '@nx/js': '23.1.1',
  '@nx/react': '23.1.1',
  '@nx/vite': '23.1.1',
  '@nx/vitest': '23.1.1',
  '@nx/workspace': '23.1.1',
  'create-nx-workspace': '23.1.1',
  '@swc-node/register': '1.12.1',
  '@swc/core': '1.15.47',
  '@modelcontextprotocol/sdk': '1.30.0',
  '@modelcontextprotocol/inspector': '0.22.0',
  '@ag-ui/a2ui-toolkit': '0.0.4',
  '@ag-ui/aws-strands': '0.2.3',
  '@ag-ui/client': '0.0.57',
  '@ag-ui/core': '0.0.57',
  '@ag-ui/encoder': '0.0.57',
  'agent-chat-cli': '0.3.0',
  '@copilotkit/react-core': '1.66.4',
  rxjs: '7.8.2',
  '@strands-agents/sdk': '1.12.0',
  '@tanstack/react-router': '1.170.23',
  '@tanstack/router-plugin': '1.168.27',
  '@tanstack/router-generator': '1.167.25',
  '@tanstack/virtual-file-routes': '1.162.0',
  '@tanstack/router-utils': '1.162.2',
  '@cloudscape-design/board-components': '3.0.213',
  '@cloudscape-design/chat-components': '1.0.157',
  '@cloudscape-design/components': '3.0.1342',
  '@cloudscape-design/global-styles': '1.0.65',
  '@tanstack/react-query': '5.101.4',
  '@tanstack/react-query-devtools': '5.101.4',
  '@trpc/tanstack-react-query': '11.18.0',
  '@trpc/client': '11.18.0',
  '@trpc/server': '11.18.0',
  '@types/node': '26.2.0',
  '@types/aws-lambda': '8.10.162',
  '@types/cors': '2.8.19',
  '@types/pg': '8.21.0',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/config-resolver': '4.6.16',
  '@smithy/node-config-provider': '4.5.16',
  '@smithy/node-http-handler': '4.9.13',
  '@smithy/types': '4.16.1',
  '@vitest/coverage-v8': '4.1.10',
  '@vitest/ui': '4.1.10',
  '@astrojs/react': '6.0.2',
  '@astrojs/starlight': '0.41.3',
  astro: '7.1.1',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1135.1',
  'aws-cdk-lib': '2.263.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.8.1',
  cors: '2.8.6',
  chalk: '5.6.2',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  commander: '15.0.0',
  'cpy-cli': '7.0.0',
  electrodb: '3.9.2',
  esbuild: '0.28.2',
  'event-source-polyfill': '1.0.31',
  '@types/event-source-polyfill': '1.0.5',
  '@biomejs/biome': '2.5.7',
  '@prisma/adapter-mariadb': '7.9.1',
  '@prisma/adapter-pg': '7.9.1',
  '@prisma/client': '7.9.1',
  ejs: '6.0.1',
  '@types/ejs': '3.1.5',
  express: '5.2.1',
  'fast-glob': '3.3.3',
  husky: '9.1.7',
  'fs-extra': '11.4.0',
  '@types/fs-extra': '11.0.4',
  'make-dir-cli': '4.0.0',
  mariadb: '3.5.3',
  mise: '2026.8.3',
  ncp: '2.0.0',
  npm: '12.0.2',
  'npm-check-updates': '22.2.9',
  'oidc-client-ts': '3.5.0',
  pg: '8.23.0',
  prisma: '7.9.1',
  'react-oidc-context': '3.3.1',
  react: '19.2.8',
  'react-dom': '19.2.8',
  rimraf: '6.1.3',
  rolldown: '1.2.3',
  'rolldown-plugin-dts': '0.28.0',
  'simple-git': '3.36.0',
  'source-map-support': '0.5.21',
  'starlight-blog': '0.28.0',
  tailwindcss: '4.3.3',
  '@tailwindcss/vite': '4.3.3',
  tsx: '4.23.11',
  'lucide-react': '1.30.0',
  'radix-ui': '1.6.7',
  shadcn: '4.16.2',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.6.0',
  vite: '8.2.1',
  typescript: '6.0.3',
  vitest: '4.1.10',
  zod: '4.4.3',
  ws: '8.21.3',
} as const;
export type ITsDepVersion = keyof typeof TS_VERSIONS;

/**
 * Add versions to the given dependencies, which the declaration must own.
 *
 * @param declaration the calling generator's `DEPENDENCIES`
 */
export const withVersions = <D extends DependencyDeclaration>(
  declaration: D,
  deps: readonly DeclaredTs<D>[],
): Record<string, string> => {
  assertDeclared(declaration.ts, deps, 'ts');
  return Object.fromEntries(
    deps.map((dep) => [dep, TS_VERSIONS[dep as ITsDepVersion]]),
  );
};

/**
 * The `nx` and `@nx/*` packages a generated workspace pins, all of which must
 * hold the same version: a workspace nx even a patch apart hoists a second
 * nested nx, and the two deadlock `nx sync`.
 *
 * Bumping them in a user's workspace requires `packageJsonUpdates` rather than a
 * migration — see `version-upgrade-migration/nx-package-updates.ts`.
 */
export const NX_PACKAGES = [
  'nx',
  '@nx/devkit',
  '@nx/js',
  '@nx/react',
  '@nx/vite',
  '@nx/vitest',
  '@nx/workspace',
] as const satisfies readonly ITsDepVersion[];

/**
 * The nx version the plugin is built against, and the single source of truth
 * for every place a workspace's nx is pinned.
 */
export const NX_VERSION = TS_VERSIONS.nx;

/**
 * Versions for Python dependencies added by generators
 */
export const PY_VERSIONS = {
  'a2a-sdk': '==0.3.26',
  'ag-ui-langgraph': '==0.0.42',
  'ag-ui-protocol': '==0.1.19',
  'ag-ui-strands': '==0.2.4',
  'aws-lambda-powertools': '==3.31.1',
  'aws-lambda-powertools[tracer]': '==3.31.1',
  'aws-lambda-powertools[parser]': '==3.31.1',
  'aws-opentelemetry-distro': '==0.19.0',
  'bedrock-agentcore': '==1.21.0',
  boto3: '==1.43.67',
  checkov: '==3.3.9',
  fastapi: '==0.141.1',
  'fastapi[standard]': '==0.141.1',
  httpx: '==0.28.1',
  langchain: '==1.3.14',
  'langchain-aws': '==1.7.0',
  'langchain-mcp-adapters': '==0.3.2',
  langgraph: '==1.2.10',
  mcp: '==1.28.1',
  'pip-check-updates': '==0.29.0',
  'pip-licenses': '==5.5.5',
  ruff: '==0.16.2',
  'strands-agents': '==1.51.0',
  'strands-agents[a2a]': '==1.51.0',
  'strands-agents-tools': '==0.8.6',
  ty: '==0.0.69',
  pynamodb: '==6.1.0',
  uvicorn: '==0.52.1',
  sqlmodel: '==0.0.39',
  alembic: '==1.19.1',
  aiomysql: '==0.3.2',
  asyncpg: '==0.31.0',
  // Pinned explicitly: SQLAlchemy's async engine pulls greenlet transitively,
  // and leaving it unpinned lets uv resolve to a just-released version whose
  // platform wheels may not all be published yet (breaking aarch64 installs).
  greenlet: '==3.5.4',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = <D extends DependencyDeclaration>(
  declaration: D,
  deps: readonly DeclaredPy<D>[],
): string[] => {
  assertDeclared(declaration.py, deps, 'py');
  return deps.map((dep) => `${dep}${PY_VERSIONS[dep as IPyDepVersion]}`);
};

/** Catches undeclared packages that reach here past the type checker. */
const assertDeclared = (
  declared: readonly { readonly name: string }[],
  deps: readonly unknown[],
  kind: 'ts' | 'py',
): void => {
  const names = declaredNames(declared);
  const undeclared = deps.filter((dep) => !names.includes(dep as string));
  if (undeclared.length > 0) {
    throw new Error(
      `Undeclared ${kind} dependencies: ${undeclared.join(', ')}. Add them to the generator's declareDependencies({ ${kind}: [...] }).`,
    );
  }
};

/**
 * Versions for vendored tools
 */
export const VENDORED_VERSIONS = {
  'git-secrets': '1.3.0',
} as const;

/**
 * Versions of Java dependencies added by generators, keyed by Maven coordinate.
 *
 * Every entry is resolved from Maven Central by the version update and named
 * `<group>:<artifact>:<version>` where a generator writes it.
 */
export const JAVA_VERSIONS = {
  'software.amazon.smithy:smithy-model': '1.72.1',
  'software.amazon.smithy:smithy-aws-traits': '1.72.1',
  'software.amazon.smithy:smithy-validation-model': '1.72.1',
  'software.amazon.smithy:smithy-openapi': '1.72.1',
  'software.amazon.smithy.typescript:smithy-aws-typescript-codegen': '0.52.0',
} as const;
export type IJavaVersion = keyof typeof JAVA_VERSIONS;

/** The Maven coordinates the version update resolves, in declaration order. */
export const JAVA_ARTIFACTS = Object.keys(JAVA_VERSIONS) as IJavaVersion[];

/** A Maven coordinate as a dependency names it: `<group>:<artifact>:<version>`. */
export const javaMavenDependency = (artifact: IJavaVersion): string =>
  `${artifact}:${JAVA_VERSIONS[artifact]}`;

/**
 * Versions of tools resolved by mise, keyed by the tool name mise knows.
 *
 * Every entry is checked with `mise latest <tool>` by the version update. Nothing
 * is installed into the workspace: the pin travels in the `project.json` target
 * command, which is what the version sync reaches to move it forward.
 */
export const MISE_VERSIONS = {
  smithy: '1.72.1',
} as const;
export type IMiseVersion = keyof typeof MISE_VERSIONS;

/** The tools the version update resolves through mise, in declaration order. */
export const MISE_TOOLS = Object.keys(MISE_VERSIONS) as IMiseVersion[];

/**
 * Base container images used by generated Dockerfiles. Pinned exactly so
 * generated images are reproducible, and chosen to be free of known
 * HIGH/CRITICAL vulnerabilities at time of generation.
 */
export const BASE_IMAGES = {
  node: 'public.ecr.aws/docker/library/node:lts-slim',
  python: 'public.ecr.aws/docker/library/python:3.14-slim',
} as const;

/**
 * Versions for container tooling used by generated image build/scan targets.
 * Pinned exactly so generated images are reproducible.
 */
export const CONTAINER_VERSIONS = {
  // ECR-hosted Trivy image used to scan built images during the build.
  trivy: '0.72.0',
} as const;

/**
 * Repository each pinned tool image is pulled from, keyed as
 * {@link CONTAINER_VERSIONS}. Kept beside the versions so a tool added here is
 * one entry rather than a reference built somewhere else, which is also what
 * lets the version sync find these pins wherever a target command runs them.
 */
export const CONTAINER_REPOSITORIES = {
  trivy: 'public.ecr.aws/aquasecurity/trivy',
} as const satisfies Record<keyof typeof CONTAINER_VERSIONS, string>;

/** The pinned reference for a tool image, as a target command runs it. */
export const containerImage = (tool: keyof typeof CONTAINER_VERSIONS): string =>
  `${CONTAINER_REPOSITORIES[tool]}:${CONTAINER_VERSIONS[tool]}`;

/**
 * Exact versions for Terraform providers used by generated `.tf` modules.
 * Pinned exactly (no range operator) so generated infrastructure is reproducible.
 */
export const TERRAFORM_VERSIONS = {
  aws: '6.60.0',
  random: '3.9.0',
  null: '3.3.0',
  archive: '2.8.0',
  external: '2.4.0',
  local: '2.9.0',
  time: '0.14.0',
} as const;
export type ITerraformProviderVersion = keyof typeof TERRAFORM_VERSIONS;

/**
 * Substitution variables exposing Terraform provider version constraints to
 * generated `.tf` templates (e.g. `version = "<%- awsProviderVersion %>"`)
 */
export const terraformProviderVersions = () => ({
  awsProviderVersion: TERRAFORM_VERSIONS.aws,
  randomProviderVersion: TERRAFORM_VERSIONS.random,
  nullProviderVersion: TERRAFORM_VERSIONS.null,
  archiveProviderVersion: TERRAFORM_VERSIONS.archive,
  externalProviderVersion: TERRAFORM_VERSIONS.external,
  localProviderVersion: TERRAFORM_VERSIONS.local,
  timeProviderVersion: TERRAFORM_VERSIONS.time,
});
