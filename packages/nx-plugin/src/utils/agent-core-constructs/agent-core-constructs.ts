/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { addStarExport } from '../ast.js';
import type { Containers } from '../containers.js';
import {
  type DeclaredPyDependency,
  type DeclaredTsDependency,
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../declared-dependencies.js';
import { addDependenciesToPackageJson } from '../dependencies.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addArtifactProjectToTargets } from '../nx.js';
import {
  generatedCdk,
  generatedTerraform,
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  cdkLambdaRuntimeVars,
  type IPyDepVersion,
  type ITsDepVersion,
  PY_VERSIONS,
  terraformProviderVersions,
  withVersions,
} from '../versions.js';

type IACProvider = { iac: Iac };

/**
 * Dependencies a caller must declare to add an AgentCore Gateway construct.
 *
 * Both providers render Cedar policies with `ejs`, each from a different
 * manifest: the CDK construct imports it from the shared constructs project,
 * while Terraform's `render-cedar.cjs` resolves it from the workspace root,
 * since the shared terraform project it runs in has no `package.json`.
 */
export const AGENT_CORE_CONSTRUCTS_DEPENDENCIES = [
  { name: 'ejs', when: generatedCdk },
  { name: '@aws-sdk/client-bedrock-agentcore', when: generatedCdk },
  { name: '@types/ejs', when: generatedCdk },
  { name: 'ejs', when: generatedTerraform, dev: true, root: true },
] as const satisfies readonly DeclaredTsDependency<
  ITsDepVersion,
  IacMetadata
>[];

/**
 * Python versions the generated Terraform pins in an inline `uv run --with`
 * script, rather than in any `pyproject.toml`.
 *
 * Spread through `ownedElsewhere` because nothing installs them into the
 * workspace — the pin is owned so the version sync keeps it current, and gated on
 * Terraform since the CDK branch writes no such script.
 */
export const AGENT_CORE_CONSTRUCTS_PY_DEPENDENCIES = [
  { name: 'boto3', when: generatedTerraform },
  { name: 'httpx', when: generatedTerraform },
  { name: 'mcp', when: generatedTerraform },
] as const satisfies readonly DeclaredPyDependency<
  IPyDepVersion,
  IacMetadata
>[];

export type AgentCoreAuth = 'iam' | 'cognito';

export type AgentCoreSession = 's3' | 'dynamodb-s3' | 'in-memory';

/**
 * How the runtime's artifact is packaged, and the details each packaging needs.
 *
 * `container` builds an arm64 image from a Dockerfile and hosts it from ECR.
 * `code` uploads a zip of the built code to S3 and runs it on an AgentCore
 * managed language runtime.
 */
export type AgentCoreArtifact =
  | {
      readonly type: 'container';
      /** Local image tag the build produces, published to ECR by Terraform. */
      readonly dockerImageTag: string;
      /** Build context directory, holding the Dockerfile and built artifacts. */
      readonly outputDir: string;
    }
  | {
      readonly type: 'code';
      /** Packaged code directory, archived and uploaded as the artifact. */
      readonly outputDir: string;
      /** Managed language runtime, e.g. `NODE_22` or `PYTHON_3_14`. */
      readonly runtime: string;
      /** Entry point file within the package, run by the managed runtime. */
      readonly entryPoint: string;
    };

export interface AddAgentCoreInfraProps {
  nameClassName: string;
  nameKebabCase: string;
  projectName: string;
  artifact: AgentCoreArtifact;
  appDirectory: string;
  serverProtocol: 'mcp' | 'http' | 'a2a';
  auth: AgentCoreAuth;
  /** How this runtime's session should be persisted. MCP servers have no session, so pass 'in-memory'. */
  session: AgentCoreSession;
  containers: Containers;
}

/**
 * Template substitution variables describing the runtime artifact, shared by
 * the CDK and Terraform branches so both read the same fields.
 */
/**
 * The shared Terraform module directory a given packaging uses, under
 * `core/`. Container packaging keeps the original `agent-core` name so
 * existing workspaces are untouched.
 */
const terraformAgentCoreModule = (artifact: AgentCoreArtifact): string =>
  artifact.type === 'container' ? 'agent-core' : 'agent-core-code';

const artifactTemplateVars = (artifact: AgentCoreArtifact) => ({
  container: artifact.type === 'container',
  artifactOutputDir: artifact.outputDir,
  terraformAgentCoreModule: terraformAgentCoreModule(artifact),
  dockerImageTag:
    artifact.type === 'container' ? artifact.dockerImageTag : undefined,
  codeRuntime: artifact.type === 'code' ? artifact.runtime : undefined,
  codeEntryPoint: artifact.type === 'code' ? artifact.entryPoint : undefined,
});

const addAgentCoreInfra = async (
  tree: Tree,
  options: AddAgentCoreInfraProps & { iac: Iac },
) => {
  switch (options.iac) {
    case 'cdk':
      await addAgentCoreCDKInfra(tree, options);
      break;
    case 'terraform':
      addAgentCoreTerraformInfra(tree, options);
      break;
  }

  // Update shared constructs/terraform project configuration to depend on this project
  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addArtifactProjectToTargets(config, options.projectName);
      return config;
    },
  );
};

const addAgentCoreCDKInfra = async (
  tree: Tree,
  options: AddAgentCoreInfraProps,
) => {
  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
    ),
    {
      ...options,
      ...artifactTemplateVars(options.artifact),
      ...esmVars(tree),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
      'index.ts',
    ),
    `./${options.nameKebabCase}/${options.nameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    `./${options.appDirectory}/index.js`,
  );
};

const addAgentCoreTerraformInfra = (
  tree: Tree,
  options: AddAgentCoreInfraProps,
) => {
  // Add the AgentCore shared module. Each packaging gets its own module
  // directory: the shared modules are written `KeepExisting` (so they stay
  // user-owned), and a workspace may host both packagings at once, which a
  // single directory could only serve for whichever was generated first.
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'core',
      'agent-core',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'core',
      terraformAgentCoreModule(options.artifact),
    ),
    {
      containers: options.containers,
      boto3Version: PY_VERSIONS.boto3,
      ...artifactTemplateVars(options.artifact),
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate app specific agent core configuration
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'agent-core',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      options.appDirectory,
    ),
    {
      ...options,
      ...artifactTemplateVars(options.artifact),
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};

export interface AddMcpServerInfraProps {
  mcpServerNameClassName: string;
  mcpServerNameKebabCase: string;
  projectName: string;
  artifact: AgentCoreArtifact;
  auth: AgentCoreAuth;
  containers: Containers;
}

/**
 * Add an MCP server CDK construct
 */
export const addMcpServerInfra = async (
  tree: Tree,
  options: AddMcpServerInfraProps & IACProvider,
) => {
  await addAgentCoreInfra(tree, {
    nameClassName: options.mcpServerNameClassName,
    nameKebabCase: options.mcpServerNameKebabCase,
    artifact: options.artifact,
    projectName: options.projectName,
    appDirectory: 'mcp-servers',
    serverProtocol: 'mcp',
    iac: options.iac,
    auth: options.auth,
    // MCP servers are stateless (no conversation session to persist).
    session: 'in-memory',
    containers: options.containers,
  });
};

export interface AddAgentInfraProps {
  agentNameClassName: string;
  agentNameKebabCase: string;
  projectName: string;
  artifact: AgentCoreArtifact;
  auth: AgentCoreAuth;
  session: AgentCoreSession;
  serverProtocol?: 'http' | 'a2a';
  containers: Containers;
}

/**
 * Add an agent CDK construct
 */
export const addAgentInfra = async (
  tree: Tree,
  options: AddAgentInfraProps & IACProvider,
) => {
  await addAgentCoreInfra(tree, {
    nameClassName: options.agentNameClassName,
    nameKebabCase: options.agentNameKebabCase,
    projectName: options.projectName,
    artifact: options.artifact,
    appDirectory: 'agents',
    session: options.session,
    serverProtocol: options.serverProtocol ?? 'http',
    iac: options.iac,
    auth: options.auth,
    containers: options.containers,
  });
};

export interface AddAgentCoreGatewayInfraProps {
  gatewayNameClassName: string;
  gatewayNameKebabCase: string;
  projectName: string;
  projectDirectory: string;
  cedarPolicy: boolean;
  auth: AgentCoreAuth;
  /**
   * The gateway's protocol: mcp aggregates MCP server targets, http proxies
   * agent runtime targets via path-based routing.
   */
  protocol: 'mcp' | 'http';
}

export const addAgentCoreGatewayInfra = async <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps & IACProvider,
  declaration: D & MustDeclare<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES, D>,
) => {
  switch (options.iac) {
    case 'cdk':
      await addAgentCoreGatewayCDKInfra(tree, options, declaration);
      break;
    case 'terraform':
      addAgentCoreGatewayTerraformInfra(tree, options, declaration);
      break;
  }

  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addArtifactProjectToTargets(config, options.projectName);
      return config;
    },
  );
};

const addAgentCoreGatewayCDKInfra = async (
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps,
  declaration: DependencyDeclaration,
) => {
  // Generic gateway construct (readiness probe, policy engine, Cedar policy
  // loading) shared by all gateways
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'core',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'agentcore-gateway',
    ),
    { ...esmVars(tree), ...cdkLambdaRuntimeVars() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'app',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'gateways',
    ),
    {
      nameClassName: options.gatewayNameClassName,
      nameKebabCase: options.gatewayNameKebabCase,
      projectDirectory: options.projectDirectory,
      cedarPolicy: options.cedarPolicy,
      auth: options.auth,
      protocol: options.protocol,
      ...esmVars(tree),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'index.ts',
    ),
    './agentcore-gateway/agentcore-gateway.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'gateways',
      'index.ts',
    ),
    `./${options.gatewayNameKebabCase}/${options.gatewayNameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './gateways/index.js',
  );

  // The gateway construct renders Cedar policies with ejs and its readiness
  // probe uses the AgentCore SDK client; declare both so the lint passes.
  addDependenciesToPackageJson(
    tree,
    withVersions(
      forDependencies<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['ejs', '@aws-sdk/client-bedrock-agentcore'],
    ),
    withVersions(
      forDependencies<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['@types/ejs'],
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'package.json'),
  );
};

const addAgentCoreGatewayTerraformInfra = (
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps,
  declaration: DependencyDeclaration,
) => {
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'core',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'core',
      'agentcore-gateway',
    ),
    { ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'gateways',
    ),
    {
      nameClassName: options.gatewayNameClassName,
      nameKebabCase: options.gatewayNameKebabCase,
      projectDirectory: options.projectDirectory,
      cedarPolicy: options.cedarPolicy,
      auth: options.auth,
      protocol: options.protocol,
      boto3Version: PY_VERSIONS.boto3,
      httpxVersion: PY_VERSIONS.httpx,
      mcpVersion: PY_VERSIONS.mcp,
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // The Cedar render script is only needed when policies are enabled
  if (!options.cedarPolicy) {
    const renderScript = joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'gateways',
      options.gatewayNameKebabCase,
      'render-cedar.cjs',
    );
    if (tree.exists(renderScript)) {
      tree.delete(renderScript);
    }
    return;
  }

  // render-cedar.cjs resolves ejs from the workspace root, since the shared
  // terraform project it runs in has no package.json.
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(
      forDependencies<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['ejs'],
    ),
  );
};

export interface AddAgentCoreHarnessInfraProps {
  harnessNameClassName: string;
  harnessNameKebabCase: string;
  /**
   * Workspace-root-relative harness project root, eg `packages/my-harness`.
   * The `src/PROMPT.md` path both templates read is derived from it.
   */
  projectRoot: string;
  /** Leading-letter-guaranteed, 31-char-truncated resource name prefix. */
  harnessNamePrefix: string;
}

/**
 * Template substitution context shared by the CDK and Terraform harness
 * branches. Both prompt path fields carry the same workspace-root-relative
 * path, named per provider so each template's usage reads on its own.
 */
interface HarnessTemplateContext {
  nameClassName: string;
  nameKebabCase: string;
  harnessNamePrefix: string;
  /** Joined onto `findWorkspaceRoot()` in the CDK construct. */
  promptPathFromCdk: string;
  /** Appended to the `path.module` walk to the workspace root in Terraform. */
  promptPathFromTerraform: string;
}

/**
 * Add AgentCore Harness infrastructure for the selected IaC provider.
 *
 * Renders the provider-specific Harness infrastructure (a CDK construct or
 * a Terraform module) into the Shared Infrastructure Project with
 * `KeepExisting`, so existing files become user-owned and are never
 * rewritten by reruns.
 *
 * Unlike agents, MCP servers and gateways, no build dependency is added
 * from the shared infrastructure project to the Harness Project: generated
 * Harness infrastructure does not import Harness Project source, so a
 * dependency would only create false rebuild coupling.
 */
export const addAgentCoreHarnessInfra = async (
  tree: Tree,
  options: AddAgentCoreHarnessInfraProps & IACProvider,
): Promise<void> => {
  // One resolved template context, built once and passed to both provider
  // branches. The prompt path is derived from the same projectRoot the
  // Harness Project is written to, so explicit placement needs no extra logic.
  const promptPath = joinPathFragments(options.projectRoot, 'src', 'PROMPT.md');
  const templateContext: HarnessTemplateContext = {
    nameClassName: options.harnessNameClassName,
    nameKebabCase: options.harnessNameKebabCase,
    harnessNamePrefix: options.harnessNamePrefix,
    promptPathFromCdk: promptPath,
    promptPathFromTerraform: promptPath,
  };

  switch (options.iac) {
    case 'cdk':
      await addAgentCoreHarnessCDKInfra(tree, templateContext);
      break;
    case 'terraform':
      addAgentCoreHarnessTerraformInfra(tree, templateContext);
      break;
  }
};

const addAgentCoreHarnessCDKInfra = async (
  tree: Tree,
  templateContext: HarnessTemplateContext,
) => {
  // Generate the app specific CDK construct under
  // src/app/harnesses/<kebab-case-name>/
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'app',
      'agentcore-harness',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'harnesses',
    ),
    { ...templateContext, ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export the construct through the harnesses app index and the shared
  // app index. addStarExport creates a missing index file and semantically
  // deduplicates equivalent exports on reruns.
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'harnesses',
      'index.ts',
    ),
    `./${templateContext.nameKebabCase}/${templateContext.nameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './harnesses/index.js',
  );
};

const addAgentCoreHarnessTerraformInfra = (
  tree: Tree,
  templateContext: HarnessTemplateContext,
) => {
  // Generate the app specific Terraform module under
  // src/app/harnesses/<kebab-case-name>/. No CDK files or exports are
  // created on this path.
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'agentcore-harness',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'harnesses',
    ),
    { ...templateContext, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
