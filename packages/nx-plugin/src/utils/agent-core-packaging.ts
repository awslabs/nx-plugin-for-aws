/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from './declared-dependencies.js';
import { FS_DEPENDENCIES, FsCommands } from './fs.js';
import { addArtifactDependencyToTargets } from './nx.js';
import {
  type ITsDepVersion,
  LAMBDA_RUNTIME_VERSIONS,
  TS_VERSIONS,
} from './versions.js';

/**
 * How an AgentCore Runtime's artifact is packaged and hosted.
 *
 * `agentcore` uploads a `.zip` of the built code to S3 and runs it on an
 * AgentCore managed language runtime, which skips the container build, ECR
 * repository and image push entirely — the fastest build and deploy cycle.
 * `agentcore-ecr` builds an arm64 container image and hosts it from ECR, for
 * workloads needing OS-level control (e.g. native system libraries) or an
 * established container pipeline.
 */
export const AGENT_CORE_INFRA = ['agentcore', 'agentcore-ecr', 'none'] as const;

export type AgentCoreInfra = (typeof AGENT_CORE_INFRA)[number];

/** Whether the given infra option hosts on AgentCore Runtime at all. */
export const isAgentCoreHosted = (infra: AgentCoreInfra): boolean =>
  infra === 'agentcore' || infra === 'agentcore-ecr';

/** Whether the given infra option builds and hosts a container image. */
export const isContainerHosted = (infra: AgentCoreInfra): boolean =>
  infra === 'agentcore-ecr';

/**
 * The AgentCore managed runtime for the Node version generated projects target,
 * e.g. `NODE_22`.
 *
 * AgentCore only publishes a Node 22 runtime, so the major is pinned here
 * rather than derived from {@link LAMBDA_RUNTIME_VERSIONS}: those track Lambda,
 * which offers newer majors AgentCore would reject.
 */
export const agentCoreNodeRuntime = (): string => 'NODE_22';

/**
 * The AgentCore managed runtime for the Python version generated projects
 * target, e.g. `PYTHON_3_14`, derived from the same pin the bundle resolves
 * wheels against so the two cannot drift.
 */
export const agentCorePythonRuntime = (): string =>
  `PYTHON_${LAMBDA_RUNTIME_VERSIONS.python.replace('.', '_')}`;

export interface RemoveContainerArtifactsOptions {
  /** Project configuration to remove the container targets from (mutated in place). */
  readonly project: ProjectConfiguration;
  /** Component source directory that may hold a `Dockerfile`. */
  readonly sourceDir: string;
  /** Component target prefix, e.g. `agent` or `my-mcp-server`. */
  readonly targetPrefix: string;
}

/**
 * Remove the container build artifacts a previous `agentcore-ecr` run left
 * behind, so re-running with `agentcore` fully switches the component to code
 * packaging rather than leaving an orphaned `Dockerfile` and image build.
 *
 * The aggregate `docker` and `trivy` targets are dropped only once no component
 * target remains under them, since a project can host several components and
 * only some may use containers.
 */
export const removeContainerArtifacts = (
  tree: Tree,
  options: RemoveContainerArtifactsOptions,
): void => {
  const { project, sourceDir, targetPrefix } = options;

  const dockerfilePath = joinPathFragments(sourceDir, 'Dockerfile');
  if (tree.exists(dockerfilePath)) {
    tree.delete(dockerfilePath);
    // Generated infrastructure is user-owned, so the existing construct or
    // module still references the container artifact this run removed.
    console.warn(
      `Warning: ${targetPrefix} was previously generated with infra 'agentcore-ecr'. Its generated infrastructure is yours to edit, so it still builds a container image and will fail now that the Dockerfile is gone. Delete the generated infrastructure for ${targetPrefix} and re-run this generator to have it rewritten for code packaging.`,
    );
  }

  project.targets ??= {};
  for (const suffix of ['docker', 'trivy'] as const) {
    const componentTargetName = `${targetPrefix}-${suffix}`;
    delete project.targets[componentTargetName];

    const aggregate = project.targets[suffix];
    if (!aggregate?.dependsOn) {
      continue;
    }
    aggregate.dependsOn = aggregate.dependsOn.filter(
      (dependency) => dependency !== componentTargetName,
    );
    // An aggregate with nothing left under it would be an empty target, so drop
    // it along with the `build`/`assemble` edges that fan out to it.
    if (aggregate.dependsOn.length === 0) {
      delete project.targets[suffix];
      for (const parent of ['build', 'assemble'] as const) {
        const parentTarget = project.targets[parent];
        if (parentTarget?.dependsOn) {
          parentTarget.dependsOn = parentTarget.dependsOn.filter(
            (dependency) => dependency !== suffix,
          );
        }
      }
    }
  }
};

/**
 * Dependencies a caller must declare to add a code (`.zip`) packaging target.
 *
 * The TypeScript package target vendors the AWS Distro for OpenTelemetry into
 * the package directory, so its version is declared here (spread through
 * `ownedElsewhere` by callers, since the install targets the built package
 * rather than any workspace manifest).
 */
export const CODE_PACKAGE_DEPENDENCIES = [
  ...FS_DEPENDENCIES,
  { name: '@aws/aws-distro-opentelemetry-node-autoinstrumentation' },
] as const satisfies readonly { name: ITsDepVersion }[];

export interface AddTypeScriptCodePackageTargetOptions {
  /** Project configuration to add the target to (mutated in place). */
  readonly project: ProjectConfiguration;
  /** Name of the packaging target to add, e.g. `agent-package`. */
  readonly targetName: string;
  /** Name of the target producing the bundled `index.js`, depended on here. */
  readonly bundleTargetName: string;
  /** Directory holding the bundled `index.js`, relative to the workspace root. */
  readonly bundleOutputDir: string;
  /** Directory to assemble the deployable package in, relative to the workspace root. */
  readonly packageOutputDir: string;
}

/**
 * Add a target assembling the deployable code package for a TypeScript
 * AgentCore Runtime.
 *
 * The package is the rolldown bundle plus a vendored AWS Distro for
 * OpenTelemetry install. AgentCore rejects a code package with no OpenTelemetry
 * dependencies present (`CREATE_FAILED`: "OpenTelemetry instrumentation
 * executable not found"), so ADOT must ship inside the package rather than
 * being installed at runtime — the `opentelemetry-instrument` entry point
 * prefix resolves it from there.
 *
 * The install is scoped to the package directory with `--prefix` and
 * `--no-save`, so it never touches the project's own manifest. `--omit=dev`
 * keeps the package to what the runtime loads. ADOT is pure JavaScript with no
 * native binaries, so the package is architecture independent even though
 * AgentCore only runs arm64.
 */
export const addTypeScriptCodePackageTarget = <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  options: AddTypeScriptCodePackageTargetOptions,
  declaration: D & MustDeclare<typeof CODE_PACKAGE_DEPENDENCIES, D>,
): void => {
  const {
    project,
    targetName,
    bundleTargetName,
    bundleOutputDir,
    packageOutputDir,
  } = options;

  const fs = new FsCommands(
    tree,
    forDependencies<typeof FS_DEPENDENCIES>(declaration),
  );
  const adotVersion =
    TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'];

  project.targets ??= {};
  project.targets[targetName] = {
    cache: true,
    inputs: ['default'],
    outputs: [`{workspaceRoot}/${packageOutputDir}`],
    executor: 'nx:run-commands',
    options: {
      commands: [
        fs.rm(packageOutputDir),
        fs.mkdir(packageOutputDir),
        fs.cp(
          joinPathFragments(bundleOutputDir, 'index.js'),
          joinPathFragments(packageOutputDir, 'index.js'),
        ),
        `npm install --prefix ${packageOutputDir} --no-save --no-audit --no-fund --omit=dev @aws/aws-distro-opentelemetry-node-autoinstrumentation@${adotVersion}`,
      ],
      parallel: false,
    },
    dependsOn: [bundleTargetName],
  };

  addArtifactDependencyToTargets(project, targetName);
};

export interface AddPythonCodePackageTargetOptions {
  /** Project configuration to add the target to (mutated in place). */
  readonly project: ProjectConfiguration;
  /** Name of the packaging target to add, e.g. `agent-package`. */
  readonly targetName: string;
  /** Name of the arm64 bundle target, depended on here. */
  readonly bundleTargetName: string;
  /** Directory holding the arm64 bundle, relative to the workspace root. */
  readonly bundleOutputDir: string;
  /** Directory to assemble the deployable package in, relative to the workspace root. */
  readonly packageOutputDir: string;
  /**
   * The project's source root, which is itself the module directory — copied
   * into the package under {@link moduleName} so the agent's imports resolve.
   */
  readonly sourceRoot: string;
  /** Python module name (the source root's last segment). */
  readonly moduleName: string;
  /**
   * Path to the entry point script, relative to the workspace root. Copied to
   * the package root, where AgentCore's `entryPoint` runs it.
   */
  readonly entryPointPath: string;
  /** File name the entry point takes at the package root. */
  readonly entryPointFileName: string;
}

/**
 * Add a target assembling the deployable code package for a Python AgentCore
 * Runtime.
 *
 * The package is the arm64 dependency bundle (which already carries
 * `bin/opentelemetry-instrument` from `aws-opentelemetry-distro`, satisfying
 * AgentCore's requirement that OpenTelemetry be present), the project's own
 * module tree, and a root entry point script.
 *
 * The entry point sits at the package root rather than inside the module:
 * AgentCore runs it as a file path, and Python gives a script run that way no
 * parent package, so the agent's own `from .init import app` would raise
 * `ImportError: attempted relative import with no known parent package`. The
 * root script imports the module absolutely instead, which resolves those
 * relative imports normally.
 */
export const addPythonCodePackageTarget = <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  options: AddPythonCodePackageTargetOptions,
  declaration: D & MustDeclare<typeof FS_DEPENDENCIES, D>,
): void => {
  const {
    project,
    targetName,
    bundleTargetName,
    bundleOutputDir,
    packageOutputDir,
    sourceRoot,
    moduleName,
    entryPointPath,
    entryPointFileName,
  } = options;

  const fs = new FsCommands(
    tree,
    forDependencies<typeof FS_DEPENDENCIES>(declaration),
  );

  project.targets ??= {};
  project.targets[targetName] = {
    cache: true,
    inputs: ['production', '^production'],
    outputs: [`{workspaceRoot}/${packageOutputDir}`],
    executor: 'nx:run-commands',
    options: {
      commands: [
        fs.rm(packageOutputDir),
        fs.mkdir(packageOutputDir),
        fs.cp(bundleOutputDir, packageOutputDir),
        fs.cp(sourceRoot, joinPathFragments(packageOutputDir, moduleName)),
        fs.cp(
          entryPointPath,
          joinPathFragments(packageOutputDir, entryPointFileName),
        ),
      ],
      parallel: false,
    },
    dependsOn: [bundleTargetName],
  };

  addArtifactDependencyToTargets(project, targetName);
};
