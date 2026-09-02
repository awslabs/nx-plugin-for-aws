/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { FsTree, flushChanges } from 'nx/src/generators/tree';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  type ProjectNameRequirement,
  parsePipRequirementsLine,
  VersionOperator,
} from 'pip-requirements-js';
import fastGlob from 'fast-glob';
import { parseDocument } from 'yaml';
import { applyGritQL } from '../packages/nx-plugin/src/utils/ast';
import {
  resolveAgentCoreRuntimes,
  unresolvedAgentCoreRuntimeWarning,
} from '../packages/nx-plugin/src/utils/agent-core-runtime-resolution.js';
import {
  type RuntimeResolution,
  resolveLambdaRuntimes,
  unresolvedRuntimeWarning,
} from '../packages/nx-plugin/src/utils/lambda-runtime-resolution';
import { isNxPackage } from '../packages/nx-plugin/src/utils/version-upgrade-migration/nx-package-updates';
import { registerNxPackageUpdates } from '../packages/nx-plugin/src/utils/version-upgrade-migration/register';
import {
  AGENT_CORE_RUNTIME_VERSIONS,
  type IJavaVersion,
  type IMiseVersion,
  JAVA_ARTIFACTS,
  JAVA_VERSIONS,
  LAMBDA_RUNTIME_VERSIONS,
  MISE_TOOLS,
  MISE_VERSIONS,
  PY_VERSIONS,
  TERRAFORM_VERSIONS,
  TS_VERSIONS,
  VENDORED_VERSIONS,
} from '../packages/nx-plugin/src/utils/versions';
import {
  type LockstepGroup,
  holdGroupsInLockstep,
} from '../packages/nx-plugin/src/utils/version-lockstep/lockstep';
import { refreshShadcnTemplates } from './update-versions/shadcn';

interface VersionChange {
  name: string;
  oldVersion: string;
  newVersion: string;
}

interface TemplateChange {
  path: string;
}

/** Something the run could not do, reported so it reaches the PR body. */
interface ReportNote {
  note: string;
}

type ReportChange = VersionChange | TemplateChange | ReportNote;

interface ChangeGroup {
  title: string;
  changes: ReportChange[];
}

/**
 * Manifests whose npm dependencies are resolved alongside the vended pins: the
 * workspace root plus every package `pnpm-workspace.yaml` lists.
 */
const repoManifests = (): string[] => {
  const workspace = parseDocument(readFileSync('pnpm-workspace.yaml', 'utf-8'));
  const patterns = (workspace.toJS().packages ?? []) as string[];
  return [
    'package.json',
    ...fastGlob
      .sync(
        patterns.map((pattern) => `${pattern}/package.json`),
        { onlyFiles: true },
      )
      .sort(),
  ];
};

/**
 * Every npm dependency `manifestPath` declares, including whatever its
 * `packageManager` field pins so that moves too.
 */
const readManifestDependencies = (
  manifestPath: string,
): Record<string, string> => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const [packageManager, packageManagerVersion] = String(
    manifest.packageManager ?? '',
  ).split('@');
  return {
    ...(packageManager && packageManagerVersion
      ? { [packageManager]: packageManagerVersion }
      : {}),
    ...manifest.peerDependencies,
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
};

/**
 * Apply resolved versions to a manifest's own dependencies, including the
 * `packageManager` pin.
 */
const applyManifestVersions = (
  tree: FsTree,
  manifestPath: string,
  versions: Record<string, string>,
): VersionChange[] => {
  const contents = tree.read(manifestPath, 'utf-8');
  if (!contents) return [];
  const manifest = JSON.parse(contents);
  const changes: VersionChange[] = [];

  const [packageManager, packageManagerVersion] = String(
    manifest.packageManager ?? '',
  ).split('@');
  const resolvedPackageManager = versions[packageManager];
  if (
    packageManagerVersion &&
    resolvedPackageManager &&
    resolvedPackageManager !== packageManagerVersion
  ) {
    manifest.packageManager = `${packageManager}@${resolvedPackageManager}`;
    changes.push({
      name: 'packageManager',
      oldVersion: packageManagerVersion,
      newVersion: resolvedPackageManager,
    });
  }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, current] of Object.entries<string>(
      manifest[field] ?? {},
    )) {
      const resolved = versions[name];
      if (resolved && resolved !== current) {
        manifest[field][name] = resolved;
        changes.push({ name, oldVersion: current, newVersion: resolved });
      }
    }
  }
  if (changes.length > 0) {
    tree.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return changes;
};

/**
 * Gets updated TypeScript versions by running npm-check-updates
 * @param tmpDir - Temporary directory to use for the operation
 * @returns Updated versions mapping
 */
const getUpdatedTypeScriptVersions = (
  tmpDir: string,
): Record<string, string> => {
  // Create ts subdirectory
  const tsDir = join(tmpDir, 'ts');

  // Generate a dummy project in ts by running pnpm init
  execSync('mkdir -p ts', { cwd: tmpDir });
  execSync('pnpm init', { cwd: tsDir, stdio: 'inherit' });

  // Vended pins win over this repo's own where both declare a package.
  const packageJsonPath = join(tsDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  packageJson.dependencies = {
    ...Object.assign({}, ...repoManifests().map(readManifestDependencies)),
    ...TS_VERSIONS,
  };
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Copy root .ncurc.cjs to ts directory
  const rootNcurcPath = join(process.cwd(), '.ncurc.cjs');
  const tsNcurcPath = join(tsDir, '.ncurc.cjs');
  cpSync(rootNcurcPath, tsNcurcPath);

  // Run pnpm dlx npm-check-updates --configFileName .ncurc.cjs inside ts dir
  console.log('Running npm-check-updates for TypeScript dependencies...');
  execSync(
    `pnpm dlx npm-check-updates@${TS_VERSIONS['npm-check-updates']} --configFileName .ncurc.cjs`,
    {
      cwd: tsDir,
      stdio: 'inherit',
    },
  );

  // Read ts/package.json to get updated mapping of dependencies
  const updatedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const updatedVersions = updatedPackageJson.dependencies as Record<
    string,
    string
  >;

  console.log('Updated TypeScript versions:', updatedVersions);
  return updatedVersions;
};

/**
 * Gets updated Python versions by running pip-check-updates via uvx
 * @param tmpDir - Temporary directory to use for the operation
 * @returns Updated versions mapping
 */
const getUpdatedPythonVersions = (tmpDir: string): Record<string, string> => {
  // Create py subdirectory
  const pyDir = join(tmpDir, 'py');
  execSync('mkdir -p py', { cwd: tmpDir });

  // Write all PY_VERSIONS to a requirements.txt file
  const requirementsPath = join(pyDir, 'requirements.txt');
  const requirementsContent = Object.entries(PY_VERSIONS)
    .map(([pkg, version]) => `${pkg}${version}`)
    .join('\n');
  writeFileSync(requirementsPath, requirementsContent);

  // Run pip-check-updates via uvx
  console.log('Running pip-check-updates for Python dependencies...');
  execSync(
    `uvx --from pip-check-updates${PY_VERSIONS['pip-check-updates']} pcu --target minor -u`,
    {
      cwd: pyDir,
      stdio: 'inherit',
    },
  );

  // Read the updated requirements.txt
  const updatedRequirements = readFileSync(requirementsPath, 'utf-8');
  const updatedVersions: Record<string, string> = {};

  // Parse each line using pip-requirements-js
  updatedRequirements.split('\n').forEach((line) => {
    try {
      const parsed = parsePipRequirementsLine(line.trim());

      // Filter for ProjectName type with exactly 1 versionSpec where operator is ==
      if (
        parsed?.type === 'ProjectName' &&
        parsed.versionSpec &&
        parsed.versionSpec.length === 1 &&
        parsed.versionSpec[0].operator === VersionOperator.VersionMatching
      ) {
        const req = parsed as ProjectNameRequirement;
        const version = `==${req.versionSpec![0].version}`;

        // Build package name with extras if present
        const packageName =
          req.extras && req.extras.length > 0
            ? `${req.name}[${req.extras.join(',')}]`
            : req.name;

        updatedVersions[packageName] = version;
      }
    } catch (error) {
      console.warn(`Could not parse line: ${line}`, error);
    }
  });

  console.log('Updated Python versions:', updatedVersions);
  return updatedVersions;
};

/**
 * Pins that must move as a unit. Members must share a version line.
 */
const LOCKSTEP_GROUPS: readonly LockstepGroup[] = [
  // A duplicate `@ag-ui/client` fails every generated website with TS2322.
  ['@ag-ui/client', '@ag-ui/core', '@ag-ui/encoder'],
  // The wasm bindings format generated files; the CLI checks them.
  ['@biomejs/wasm-nodejs', '@biomejs/biome'],
  ['@astral-sh/ruff-wasm-nodejs', 'ruff'],
];

/**
 * Compares two `major.minor.patch` version strings.
 * @returns positive if a > b, negative if a < b, zero if equal
 */
const compareSemver = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
};

/**
 * Gets updated Terraform provider versions by querying the Terraform Registry.
 * Each provider is pinned to the latest stable release within its current major
 * version (e.g. `6.52.0` may bump to `6.61.0`, but never to `7.x`).
 * @returns Updated versions mapping
 */
const getUpdatedTerraformVersions = async (): Promise<
  Record<string, string>
> => {
  const updatedVersions: Record<string, string> = {};

  for (const [provider, currentVersion] of Object.entries(TERRAFORM_VERSIONS)) {
    const major = Number(currentVersion.split('.')[0]);

    // Fetch all published versions for the provider
    const response = await fetch(
      `https://registry.terraform.io/v1/providers/hashicorp/${provider}/versions`,
    );
    const { versions } = (await response.json()) as {
      versions: { version: string }[];
    };

    // Find the latest stable release within the current major version
    let latest = currentVersion;
    for (const { version } of versions) {
      // Only consider stable `major.minor.patch` releases (no pre-release tags)
      const parsed = version.match(/^(\d+)\.\d+\.\d+$/);
      if (!parsed || Number(parsed[1]) !== major) {
        continue;
      }
      if (compareSemver(version, latest) > 0) {
        latest = version;
      }
    }

    updatedVersions[provider] = latest;
  }

  console.log('Updated Terraform versions:', updatedVersions);
  return updatedVersions;
};

/**
 * Applies updated versions to the versions file
 * @param tree - FsTree instance to use for file modifications
 * @param currentVersions - The current versions object (e.g., TS_VERSIONS or PY_VERSIONS)
 * @param updatedVersions - The updated versions mapping
 * @param versionsFilePath - Path to the versions file
 * @param versionConstantName - Name of the constant in the file (e.g., 'TS_VERSIONS')
 * @returns Array of version changes
 */
const applyUpdatedVersions = async (
  tree: FsTree,
  currentVersions: Record<string, string>,
  updatedVersions: Record<string, string>,
  versionsFilePath: string,
  _versionConstantName: string,
): Promise<VersionChange[]> => {
  const changes: VersionChange[] = [];

  // Loop over versions dictionary, updating each version
  for (const depName of Object.keys(currentVersions)) {
    const oldVersion = currentVersions[depName];
    const newVersion = updatedVersions[depName];

    // Track if version changed
    if (oldVersion !== newVersion) {
      changes.push({ name: depName, oldVersion, newVersion });

      // Use GritQL to rewrite the property value.
      // Keys are either bare identifiers (e.g. boto3) or string literals (e.g. '@aws-sdk/client-dynamodb')
      // depending on whether the name is a valid JS identifier.
      const isIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(depName);
      const pattern = isIdentifier
        ? `\`${depName}: '${oldVersion}'\` => \`${depName}: '${newVersion}'\``
        : `\`'${depName}': '${oldVersion}'\` => \`'${depName}': '${newVersion}'\``;

      try {
        await applyGritQL(tree, versionsFilePath, pattern);
        console.log(`Updated ${depName} to ${newVersion}`);
      } catch (error) {
        console.warn(`Could not update ${depName}:`, error);
      }
    }
  }

  return changes;
};

/**
 * Writes the version update report to disk
 * @param changeGroups - Array of change groups, each with a title and list of changes
 */
const writeReport = (changeGroups: ChangeGroup[]): void => {
  const reportDir = join(process.cwd(), 'dist', 'scripts', 'update-versions');
  mkdirSync(reportDir, { recursive: true });

  const reportPath = join(reportDir, 'report.txt');
  let reportContent = '';

  // Process each change group
  changeGroups.forEach((group, index) => {
    if (group.changes.length > 0) {
      // Add separator between groups
      if (index > 0) {
        reportContent += '\n';
      }

      reportContent += `${group.title}\n`;
      group.changes.forEach((change) => {
        if ('oldVersion' in change) {
          reportContent += `- ${change.name} ${change.oldVersion} -> ${change.newVersion}\n`;
          return;
        }
        if ('note' in change) {
          reportContent += `- ${change.note}\n`;
          return;
        }
        reportContent += `- ${change.path}\n`;
      });
    }
  });

  // If no changes at all
  if (reportContent.length === 0) {
    reportContent = 'No version updates required.\n';
  }

  writeFileSync(reportPath, reportContent);
  console.log(`Report written to ${reportPath}`);
  console.log('\n' + reportContent);
};

/**
 * Fetches the latest git-secrets release tag from GitHub and updates
 * the vendored script if a newer version is available.
 */
const updateGitSecrets = async (
  tree: FsTree,
): Promise<VersionChange | undefined> => {
  const currentVersion = VENDORED_VERSIONS['git-secrets'];

  // Get latest tag from GitHub API
  const response = await fetch(
    'https://api.github.com/repos/awslabs/git-secrets/tags?per_page=1',
  );
  const tags = (await response.json()) as { name: string }[];
  const latestVersion = tags[0]?.name;

  if (!latestVersion || latestVersion === currentVersion) {
    console.log(`git-secrets is up to date (${currentVersion})`);
    return undefined;
  }

  console.log(
    `Updating git-secrets from ${currentVersion} to ${latestVersion}`,
  );

  // Fetch the script at the new tag
  const scriptResponse = await fetch(
    `https://raw.githubusercontent.com/awslabs/git-secrets/${latestVersion}/git-secrets`,
  );
  const scriptContent = await scriptResponse.text();

  // Update the vendored script
  const vendoredPath =
    'packages/nx-plugin/src/preset/git-secrets-files/git-secrets-dir/git-secrets';
  tree.write(vendoredPath, scriptContent);

  // Update the version in versions.ts using GritQL
  await applyGritQL(
    tree,
    'packages/nx-plugin/src/utils/versions.ts',
    `\`'git-secrets': '${currentVersion}'\` => \`'git-secrets': '${latestVersion}'\``,
  );

  return {
    name: 'git-secrets',
    oldVersion: currentVersion,
    newVersion: latestVersion,
  };
};

/**
 * The latest version of a tool that `mise` can install.
 *
 * Asked of mise rather than of the tool's own releases, so the version this vends
 * is one the tool that resolves it can actually install — a release mise's registry
 * hasn't picked up yet would leave every build failing to resolve it.
 *
 * Run through `pnpm dlx` rather than added to this repo's dependencies: the `mise`
 * npm package fetches its own binary in a `preinstall` and publishes nothing for
 * Windows, so depending on it would fail `pnpm i` on every Windows CI job. This
 * script only ever runs on Linux.
 */
const getLatestMiseVersion = (tool: IMiseVersion): string | undefined => {
  try {
    const latest = execSync(
      `pnpm dlx mise@${TS_VERSIONS.mise} latest ${tool}`,
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return /^\d+\.\d+\.\d+$/.test(latest) ? latest : undefined;
  } catch (error) {
    console.warn(`Could not resolve the latest ${tool} via mise:`, error);
    return undefined;
  }
};

/**
 * The latest release of a Maven artifact, from its `maven-metadata.xml` on Maven
 * Central.
 *
 * The metadata document rather than the search API: the latter's index lags well
 * behind (it reported smithy-model 1.58.0 while 1.72.1 was current), which would
 * silently hold these pins back.
 */
const getLatestMavenVersion = async (
  coordinate: IJavaVersion,
): Promise<string | undefined> => {
  const [group, artifact] = coordinate.split(':');
  const response = await fetch(
    `https://repo1.maven.org/maven2/${group.replace(/\./g, '/')}/${artifact}/maven-metadata.xml`,
  );
  if (!response.ok) {
    console.warn(`Could not fetch Maven metadata for ${coordinate}`);
    return undefined;
  }
  const metadata = await response.text();
  // `<release>` is the latest non-snapshot; fall back to the last listed version
  // for an artifact whose metadata omits it.
  const release = /<release>([^<]+)<\/release>/.exec(metadata)?.[1];
  const versions = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map(
    ([, version]) => version,
  );
  return release ?? versions.at(-1);
};

/** The latest release of every Maven coordinate in {@link JAVA_VERSIONS}. */
const getUpdatedJavaVersions = async (): Promise<Record<string, string>> =>
  Object.fromEntries(
    await Promise.all(
      JAVA_ARTIFACTS.map(async (artifact) => [
        artifact,
        (await getLatestMavenVersion(artifact)) ?? JAVA_VERSIONS[artifact],
      ]),
    ),
  );

/**
 * The latest managed Lambda runtimes, and the languages this could not resolve.
 *
 * Read from `Runtime.ALL` in `aws-cdk-lib`, a curated list that omits runtimes
 * still in public preview. `aws-cdk-lib` is a dev dependency of this repo for the
 * scripts only — never a dependency of the published plugin.
 *
 * A failure is isolated to this bump: the current pins are kept, a warning is
 * logged, and the caller reports it in the PR body. Taking the whole run down
 * would drop that week's TypeScript, Python, Terraform, Java and mise bumps too.
 */
const getUpdatedLambdaRuntimeVersions =
  async (): Promise<RuntimeResolution> => {
    let identifiers: string[] = [];
    try {
      const { Runtime } = await import('aws-cdk-lib/aws-lambda');
      // Deduped: an alias such as `NODEJS_LATEST` repeats a runtime's name.
      identifiers = [...new Set(Runtime.ALL.map((runtime) => runtime.name))];
    } catch (error) {
      console.warn('Could not read the aws-cdk-lib runtime list:', error);
    }

    const resolution = resolveLambdaRuntimes(identifiers);
    for (const entry of resolution.unresolved) {
      console.warn(unresolvedRuntimeWarning(entry));
    }
    return resolution;
  };

/**
 * The latest managed AgentCore Runtime runtimes, and the languages this could not
 * resolve.
 *
 * Read from the `AgentCoreRuntime` members `aws-cdk-lib` publishes — the same
 * source and the same failure handling as the Lambda runtimes, but a distinct
 * list: AgentCore offers fewer runtimes than Lambda, so the pins must move
 * independently or a create call is rejected.
 */
const getUpdatedAgentCoreRuntimeVersions =
  async (): Promise<RuntimeResolution> => {
    let identifiers: string[] = [];
    try {
      const { AgentCoreRuntime } = await import(
        'aws-cdk-lib/aws-bedrockagentcore'
      );
      identifiers = Object.getOwnPropertyNames(AgentCoreRuntime)
        .map((name) => (AgentCoreRuntime as Record<string, unknown>)[name])
        .filter(
          (member): member is { value: string } =>
            typeof member === 'object' &&
            member !== null &&
            typeof (member as { value?: unknown }).value === 'string',
        )
        .map((member) => member.value);
    } catch (error) {
      console.warn(
        'Could not read the aws-cdk-lib AgentCoreRuntime list:',
        error,
      );
    }

    const resolution = resolveAgentCoreRuntimes(identifiers);
    for (const entry of resolution.unresolved) {
      console.warn(unresolvedAgentCoreRuntimeWarning(entry));
    }
    return resolution;
  };

/** The latest version mise can install of every tool in {@link MISE_VERSIONS}. */
const getUpdatedMiseVersions = (): Record<string, string> =>
  Object.fromEntries(
    MISE_TOOLS.map((tool) => [
      tool,
      getLatestMiseVersion(tool) ?? MISE_VERSIONS[tool],
    ]),
  );

/**
 * Moves the Smithy CLI version CI installs on Windows onto `newVersion`.
 *
 * Windows resolves the CLI from the PATH rather than through mise, so the version
 * lives in the workflow action rather than in `versions.ts`. Left behind, it fails
 * every Windows Smithy build: the CLI refuses a model built against a newer
 * `smithy-model` than its own.
 */
const updateWindowsSmithyCli = (tree: FsTree, newVersion: string): void => {
  const actionPath = '.github/actions/init-monorepo/action.yml';
  const action = tree.read(actionPath, 'utf-8');
  if (!action) {
    console.warn(`Could not read ${actionPath}`);
    return;
  }
  const document = parseDocument(action);
  const pin = ['inputs', 'smithy-version', 'default'];
  if (!document.hasIn(pin)) {
    console.warn(`Could not find ${pin.join('.')} in ${actionPath}`);
    return;
  }
  document.setIn(pin, newVersion);
  // `lineWidth: 0` disables wrapping, so the long descriptions and shell scripts
  // this document holds come back out on the lines they went in on.
  tree.write(actionPath, document.toString({ lineWidth: 0 }));
  console.log(`Updated the Windows Smithy CLI to ${newVersion}`);
};

const main = async () => {
  // Parse command line arguments
  const isDryRun = process.argv.includes('--dry-run');

  // Create tmp dir with random suffix mkdtemp
  const tmpDir = mkdtempSync(join(tmpdir(), 'update-versions-'));
  console.log(`Created temporary directory: ${tmpDir}`);

  if (isDryRun) {
    console.log('Running in DRY RUN mode - no files will be modified\n');
  }

  try {
    // Create FsTree from nx devkit pointing at project root
    const tree = new FsTree(process.cwd(), false);

    // Both resolved before either is written, since a group may span them.
    const updatedTsVersions = getUpdatedTypeScriptVersions(tmpDir);
    const updatedPyVersions = getUpdatedPythonVersions(tmpDir);

    // Applied before the rewrites so a held version is never written.
    const lockstepNotes = holdGroupsInLockstep(
      LOCKSTEP_GROUPS,
      updatedTsVersions,
      updatedPyVersions,
    );

    // This repo's manifests, from the same pass as the vended pins.
    const manifestChanges = repoManifests().flatMap((manifestPath) =>
      applyManifestVersions(tree, manifestPath, updatedTsVersions),
    );

    // Apply updated TypeScript versions to the versions file
    const tsChanges = await applyUpdatedVersions(
      tree,
      TS_VERSIONS,
      updatedTsVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'TS_VERSIONS',
    );

    // Apply updated Python versions to the versions file
    const pyChanges: ReportChange[] = await applyUpdatedVersions(
      tree,
      PY_VERSIONS,
      updatedPyVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'PY_VERSIONS',
    );
    pyChanges.push(...lockstepNotes);

    // Get updated Terraform provider versions
    const updatedTerraformVersions = await getUpdatedTerraformVersions();

    // Apply updated Terraform provider versions to the versions file
    const terraformChanges = await applyUpdatedVersions(
      tree,
      TERRAFORM_VERSIONS,
      updatedTerraformVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'TERRAFORM_VERSIONS',
    );

    // Get updated Java versions from Maven Central
    const updatedJavaVersions = await getUpdatedJavaVersions();

    // Apply updated Java versions to the versions file
    const javaChanges = await applyUpdatedVersions(
      tree,
      JAVA_VERSIONS,
      updatedJavaVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'JAVA_VERSIONS',
    );

    // Get the latest versions of the tools mise resolves
    const updatedMiseVersions = getUpdatedMiseVersions();

    // Apply updated mise tool versions to the versions file
    const miseChanges = await applyUpdatedVersions(
      tree,
      MISE_VERSIONS,
      updatedMiseVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'MISE_VERSIONS',
    );

    // Get the latest managed Lambda runtimes
    const {
      versions: updatedLambdaRuntimeVersions,
      unresolved: unresolvedRuntimes,
    } = await getUpdatedLambdaRuntimeVersions();

    // Apply updated Lambda runtimes to the versions file. Both IaC providers and
    // the uv project Python version derive from these, so one rewrite moves them.
    const lambdaRuntimeChanges: ReportChange[] = await applyUpdatedVersions(
      tree,
      LAMBDA_RUNTIME_VERSIONS,
      updatedLambdaRuntimeVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'LAMBDA_RUNTIME_VERSIONS',
    );

    // Reported in the PR body, so a resolution failure is visible without reading
    // the CI logs and can't be mistaken for "already up to date".
    for (const entry of unresolvedRuntimes) {
      lambdaRuntimeChanges.push({ note: unresolvedRuntimeWarning(entry) });
    }

    // Get the latest managed AgentCore runtimes, which agents and MCP servers
    // packaged as code run on.
    const {
      versions: updatedAgentCoreRuntimeVersions,
      unresolved: unresolvedAgentCoreRuntimes,
    } = await getUpdatedAgentCoreRuntimeVersions();

    const agentCoreRuntimeChanges: ReportChange[] = await applyUpdatedVersions(
      tree,
      AGENT_CORE_RUNTIME_VERSIONS,
      updatedAgentCoreRuntimeVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'AGENT_CORE_RUNTIME_VERSIONS',
    );

    for (const entry of unresolvedAgentCoreRuntimes) {
      agentCoreRuntimeChanges.push({
        note: unresolvedAgentCoreRuntimeWarning(entry),
      });
    }

    // Keep the Smithy CLI CI installs on Windows in step with the mise pin
    const smithyChange = miseChanges.find((change) => change.name === 'smithy');
    if (smithyChange) {
      updateWindowsSmithyCli(tree, smithyChange.newVersion);
    }

    // Update vendored git-secrets
    const gitSecretsChange = await updateGitSecrets(tree);
    const vendoredChanges: VersionChange[] = gitSecretsChange
      ? [gitSecretsChange]
      : [];

    const updatedShadcnTemplateFiles = refreshShadcnTemplates(tree, tmpDir);

    // Ship the bumps to existing workspaces. Only the nx packages need
    // registering: everything else moves through the version sync migration,
    // which is committed once and runs on every upgrade.
    //
    // The version comes from the change just applied rather than `NX_VERSION`:
    // rewriting `versions.ts` on the tree cannot change what this process
    // imported at load, so the constant still holds the version being replaced.
    const nxChange = tsChanges.find((change) => isNxPackage(change.name));
    const migrationFiles = nxChange
      ? registerNxPackageUpdates(tree, nxChange.newVersion)
      : [];

    // Only apply changes if not a dry run
    if (!isDryRun) {
      flushChanges(tree.root, tree.listChanges());
    }

    // Write the report
    writeReport([
      { title: 'TypeScript Dependencies', changes: tsChanges },
      ...(manifestChanges.length > 0
        ? [{ title: 'Repo Dependencies', changes: manifestChanges }]
        : []),
      { title: 'Python Dependencies', changes: pyChanges },
      { title: 'Terraform Providers', changes: terraformChanges },
      { title: 'Java Dependencies', changes: javaChanges },
      { title: 'mise Tools', changes: miseChanges },
      { title: 'Lambda Runtimes', changes: lambdaRuntimeChanges },
      { title: 'AgentCore Runtimes', changes: agentCoreRuntimeChanges },
      ...(vendoredChanges.length > 0
        ? [{ title: 'Vendored Tools', changes: vendoredChanges }]
        : []),
      ...(updatedShadcnTemplateFiles.length > 0
        ? [
            {
              title: `Shadcn Templates`,
              changes: updatedShadcnTemplateFiles.map((path) => ({ path })),
            },
          ]
        : []),
      {
        title: 'Migration',
        changes: migrationFiles.map((path) => ({ path })),
      },
    ]);
  } catch (error) {
    console.error('Error updating versions:', error);
    process.exit(1);
  } finally {
    // Clean up temporary directory
    rmSync(tmpDir, { recursive: true, force: true });
    console.log(`Cleaned up temporary directory: ${tmpDir}`);
  }
};

void main();
