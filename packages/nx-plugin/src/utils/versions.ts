/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type DeclaredPy,
  type DeclaredTs,
  type DependencyDeclaration,
  declaredNames,
} from './declared-dependencies.js';

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
  '@aws-sdk/client-dynamodb': '3.1121.0',
  '@aws-sdk/client-api-gateway': '3.1121.0',
  '@aws-sdk/client-iam': '3.1121.0',
  '@aws-sdk/client-bedrock-agentcore': '3.1121.0',
  '@aws-sdk/client-bedrock-runtime': '3.1121.0',
  '@aws-sdk/client-s3': '3.1121.0',
  '@aws-sdk/client-sts': '3.1121.0',
  '@aws-sdk/credential-providers': '3.1121.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.972.69',
  '@aws-sdk/client-secrets-manager': '3.1121.0',
  '@aws-sdk/rds-signer': '3.1121.0',
  '@smithy/server-apigateway': '0.3.3',
  '@smithy/server-node': '0.3.3',
  '@aws-lambda-powertools/logger': '2.35.0',
  '@aws-lambda-powertools/metrics': '2.35.0',
  '@aws-lambda-powertools/parameters': '2.35.0',
  '@aws-lambda-powertools/tracer': '2.35.0',
  '@aws-lambda-powertools/parser': '2.35.0',
  '@aws-sdk/client-appconfigdata': '3.1121.0',
  '@middy/core': '7.9.2',
  '@nxlv/python': '23.0.0',
  '@nx-extend/terraform': '10.4.1',
  // These must all hold the same version — see NX_PACKAGES.
  nx: '23.1.2',
  '@nx/devkit': '23.1.2',
  '@nx/js': '23.1.2',
  '@nx/react': '23.1.2',
  '@nx/vite': '23.1.2',
  '@nx/vitest': '23.1.2',
  '@nx/workspace': '23.1.2',
  'create-nx-workspace': '23.1.2',
  '@swc-node/register': '1.12.1',
  '@swc/core': '1.16.1',
  '@modelcontextprotocol/sdk': '1.30.0',
  '@modelcontextprotocol/inspector': '2.4.0',
  '@ag-ui/a2ui-toolkit': '0.0.4',
  '@ag-ui/aws-strands': '0.2.3',
  '@ag-ui/client': '0.0.57',
  '@ag-ui/core': '0.0.57',
  '@ag-ui/encoder': '0.0.57',
  'agent-chat-cli': '0.3.0',
  '@copilotkit/react-core': '1.69.3',
  rxjs: '7.8.2',
  '@strands-agents/sdk': '1.15.0',
  '@tanstack/react-router': '1.170.32',
  '@tanstack/router-plugin': '1.168.35',
  '@tanstack/router-generator': '1.167.33',
  '@tanstack/virtual-file-routes': '1.162.0',
  '@tanstack/router-utils': '1.162.2',
  '@cloudscape-design/board-components': '3.0.221',
  '@cloudscape-design/chat-components': '1.0.165',
  '@cloudscape-design/components': '3.0.1356',
  '@cloudscape-design/global-styles': '1.0.67',
  '@tanstack/react-query': '5.102.8',
  '@tanstack/react-query-devtools': '5.102.8',
  '@trpc/tanstack-react-query': '11.18.0',
  '@trpc/client': '11.18.0',
  '@trpc/server': '11.18.0',
  '@types/node': '26.4.0',
  '@types/aws-lambda': '8.10.162',
  '@types/cors': '2.8.19',
  '@types/pg': '8.23.1',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/config-resolver': '4.7.2',
  '@smithy/node-config-provider': '4.6.2',
  '@smithy/node-http-handler': '4.11.3',
  '@smithy/types': '4.17.2',
  '@vitest/coverage-v8': '4.1.11',
  '@vitest/ui': '4.1.11',
  '@astrojs/react': '6.0.4',
  '@astrojs/starlight': '0.41.10',
  astro: '7.2.9',
  cookie: '2.0.1',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1139.0',
  'aws-cdk-lib': '2.267.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.8.1',
  cors: '2.8.6',
  chalk: '6.0.0',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  commander: '15.0.0',
  electrodb: '3.9.3',
  esbuild: '0.28.2',
  'event-source-polyfill': '1.0.31',
  '@types/event-source-polyfill': '1.0.5',
  '@biomejs/biome': '2.5.11',
  '@prisma/adapter-mariadb': '7.10.0',
  '@prisma/adapter-pg': '7.10.0',
  '@prisma/client': '7.10.0',
  ejs: '6.0.1',
  '@types/ejs': '3.1.5',
  express: '5.2.1',
  'fast-glob': '3.3.3',
  husky: '9.1.7',
  'fs-extra': '11.4.0',
  '@types/fs-extra': '11.0.4',
  mariadb: '3.5.3',
  mise: '2026.8.14',
  npm: '12.0.2',
  'npm-check-updates': '23.1.0',
  'oidc-client-ts': '3.5.0',
  pg: '8.23.0',
  prisma: '7.10.0',
  'react-oidc-context': '3.3.1',
  react: '19.2.8',
  'react-dom': '19.2.8',
  rolldown: '1.2.6',
  'rolldown-plugin-dts': '0.28.3',
  shx: '0.4.0',
  'simple-git': '3.36.0',
  'source-map-support': '0.5.21',
  'starlight-blog': '0.29.0',
  tailwindcss: '4.3.3',
  '@tailwindcss/vite': '4.3.3',
  tsx: '4.23.12',
  'lucide-react': '1.37.0',
  'radix-ui': '1.6.7',
  shadcn: '4.19.0',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.6.0',
  vite: '8.2.2',
  typescript: '6.0.3',
  vitest: '4.1.11',
  zod: '4.5.4',
  ws: '8.21.3',
} as const;
export type ITsDepVersion = keyof typeof TS_VERSIONS;

/**
 * Dependencies that must move as a unit, held at the lowest version proposed
 * across each group by the version update. Members must share a version line.
 *
 * The wasm formatter bindings are dependencies of this repo rather than vended
 * pins, so they are named here but versioned in the manifests.
 */
export const LOCKSTEP_GROUPS = [
  // A duplicate `@ag-ui/client` fails every generated website with TS2322.
  ['@ag-ui/client', '@ag-ui/core', '@ag-ui/encoder'],
  // The wasm bindings format generated files; the CLI checks them.
  ['@biomejs/wasm-nodejs', '@biomejs/biome'],
  ['@astral-sh/ruff-wasm-nodejs', 'ruff'],
] as const satisfies readonly (readonly [string, string, ...string[]])[];

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
  'ag-ui-langgraph': '==0.0.44',
  'ag-ui-protocol': '==0.1.21',
  'ag-ui-strands': '==0.3.0',
  aiosqlite: '==0.22.1',
  'aws-lambda-powertools': '==3.34.0',
  'aws-lambda-powertools[tracer]': '==3.34.0',
  'aws-lambda-powertools[parser]': '==3.34.0',
  'aws-opentelemetry-distro': '==0.19.0',
  'bedrock-agentcore': '==1.22.0',
  boto3: '==1.43.83',
  checkov: '==3.3.16',
  fastapi: '==0.141.1',
  'fastapi[standard]': '==0.141.1',
  httpx: '==0.28.1',
  langchain: '==1.3.18',
  'langchain-aws': '==1.7.4',
  'langchain-mcp-adapters': '==0.3.2',
  langgraph: '==1.2.11',
  'langgraph-checkpoint-aws': '==1.2.2',
  'langgraph-checkpoint-sqlite': '==3.1.1',
  mcp: '==1.28.1',
  'pip-check-updates': '==0.29.0',
  'pip-licenses': '==5.5.5',
  ruff: '==0.16.5',
  'strands-agents': '==1.54.0',
  'strands-agents[a2a]': '==1.54.0',
  'strands-agents-tools': '==0.8.7',
  ty: '==0.0.75',
  pynamodb: '==6.1.0',
  uvicorn: '==0.52.4',
  sqlmodel: '==0.0.42',
  alembic: '==1.19.1',
  aiomysql: '==0.3.2',
  asyncpg: '==0.31.0',
  // Pinned explicitly: SQLAlchemy's async engine pulls greenlet transitively,
  // and leaving it unpinned lets uv resolve to a just-released version whose
  // platform wheels may not all be published yet (breaking aarch64 installs).
  greenlet: '==3.5.5',
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
  'software.amazon.smithy:smithy-model': '1.73.0',
  'software.amazon.smithy:smithy-aws-traits': '1.73.0',
  'software.amazon.smithy:smithy-validation-model': '1.73.0',
  'software.amazon.smithy:smithy-openapi': '1.73.0',
  'software.amazon.smithy.typescript:smithy-aws-typescript-codegen': '0.53.0',
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
  smithy: '1.73.0',
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
 * The managed Lambda runtimes generated infrastructure targets, as the single
 * source both IaC providers derive from.
 *
 * CDK and Terraform name the same runtime differently — `Runtime.NODEJS_24_X`
 * against `nodejs24.x` — so deriving both from the version here keeps a bump one
 * edit that moves them together. Resolved by the version update workflow.
 */
export const LAMBDA_RUNTIME_VERSIONS = {
  node: '24',
  python: '3.14',
} as const;
export type ILambdaRuntime = keyof typeof LAMBDA_RUNTIME_VERSIONS;

/**
 * The managed AgentCore Runtime runtimes generated infrastructure targets, for
 * agents and MCP servers packaged as code rather than as a container image.
 *
 * Tracked separately from {@link LAMBDA_RUNTIME_VERSIONS}: AgentCore publishes
 * its own, smaller set, so a Lambda bump would otherwise move these to a runtime
 * AgentCore rejects at create time. Resolved by the version update workflow from
 * the `AgentCoreRuntime` members `aws-cdk-lib` publishes, the same source the
 * Lambda runtimes come from.
 */
export const AGENT_CORE_RUNTIME_VERSIONS = {
  node: '22',
  python: '3.14',
} as const;
export type IAgentCoreRuntime = keyof typeof AGENT_CORE_RUNTIME_VERSIONS;

/**
 * The runtime as AgentCore's `runtime` field names it, e.g. `NODE_22` or
 * `PYTHON_3_14`.
 */
export const agentCoreRuntime = (runtime: IAgentCoreRuntime): string =>
  runtime === 'node'
    ? `NODE_${AGENT_CORE_RUNTIME_VERSIONS.node}`
    : `PYTHON_${AGENT_CORE_RUNTIME_VERSIONS.python.replace('.', '_')}`;

/**
 * The interpreter uv pins for a generated Python project, as the Lambda runtime's
 * `major.minor`.
 *
 * No patch: uv reads this as a request for any patch of that minor, so it resolves
 * whichever one the platform has a build for. Naming an exact patch pins one that
 * may not exist everywhere, and Lambda patches the interpreter itself, so the minor
 * is the whole of what a project needs to agree on.
 */
export const pyenvPythonVersion = (): string => LAMBDA_RUNTIME_VERSIONS.python;

/**
 * The `[project].requires-python` specifier for a generated Python project.
 *
 * A lower bound on the Lambda runtime's `major.minor`: the deployed interpreter
 * is that version, and Ruff derives its `target-version` from this (`py314`), so
 * lint targets the same version the function runs on.
 */
export const pyprojectPythonDependency = (): string =>
  `>=${LAMBDA_RUNTIME_VERSIONS.python}`;

/** The runtime as Terraform's `runtime` attribute names it, e.g. `nodejs24.x`. */
export const terraformLambdaRuntime = (runtime: ILambdaRuntime): string =>
  runtime === 'node'
    ? `nodejs${LAMBDA_RUNTIME_VERSIONS.node}.x`
    : `python${LAMBDA_RUNTIME_VERSIONS.python}`;

/**
 * The runtime as an `aws-cdk-lib` `Runtime` member, e.g. `Runtime.NODEJS_24_X`.
 * Always an explicitly versioned member, never a `_LATEST` alias.
 */
export const cdkLambdaRuntime = (runtime: ILambdaRuntime): string =>
  runtime === 'node'
    ? `Runtime.NODEJS_${LAMBDA_RUNTIME_VERSIONS.node}_X`
    : `Runtime.PYTHON_${LAMBDA_RUNTIME_VERSIONS.python.replace('.', '_')}`;

/**
 * Substitution variables exposing the pinned runtimes to generated CDK
 * templates (e.g. `runtime: <%- nodeRuntime %>`). Paired with
 * {@link terraformLambdaRuntimeVars}, which names the same variables so a
 * template reads alike under either provider.
 */
export const cdkLambdaRuntimeVars = () => ({
  nodeRuntime: cdkLambdaRuntime('node'),
  pythonRuntime: cdkLambdaRuntime('python'),
});

/**
 * Substitution variables exposing the pinned runtimes to generated `.tf`
 * templates (e.g. `runtime = "<%- nodeRuntime %>"`).
 */
export const terraformLambdaRuntimeVars = () => ({
  nodeRuntime: terraformLambdaRuntime('node'),
  pythonRuntime: terraformLambdaRuntime('python'),
});

/**
 * Exact versions for Terraform providers used by generated `.tf` modules.
 * Pinned exactly (no range operator) so generated infrastructure is reproducible.
 */
export const TERRAFORM_VERSIONS = {
  aws: '6.62.0',
  random: '3.9.0',
  null: '3.3.1',
  archive: '2.8.0',
  external: '2.4.1',
  local: '2.9.0',
  time: '0.14.1',
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
