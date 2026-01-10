/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  TS_VERSIONS,
  PY_VERSIONS,
} from '../packages/nx-plugin/src/utils/versions';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  mkdirSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { flushChanges, FsTree } from 'nx/src/generators/tree';
import { replace } from '../packages/nx-plugin/src/utils/ast';
import { factory } from 'typescript';
import {
  parsePipRequirementsLine,
  ProjectNameRequirement,
  VersionOperator,
} from 'pip-requirements-js';

interface VersionChange {
  name: string;
  oldVersion: string;
  newVersion: string;
}

interface ChangeGroup {
  title: string;
  changes: VersionChange[];
}

const SHADCN_COMPONENTS = [
  'alert',
  'breadcrumb',
  'button',
  'card',
  'input',
  'separator',
  'sheet',
  'sidebar',
  'skeleton',
  'spinner',
  'tooltip',
];

const SHADCN_TEMPLATE_ROOT = join(
  process.cwd(),
  'packages',
  'nx-plugin',
  'src',
  'utils',
  'files',
  'common',
  'shadcn',
  'src',
);

const applyShadcnTemplateAliases = (contents: string): string =>
  contents.replace(/@\//g, '<%= scopeAlias %>common-shadcn/');

const refreshShadcnTemplates = (
  shadcnVersion: string,
  tmpDir: string,
): string[] => {
  const shadcnDir = join(tmpDir, 'shadcn');
  const shadcnSrcDir = join(shadcnDir, 'src');
  const shadcnUiDir = join(shadcnSrcDir, 'components', 'ui');
  const updatedTemplates: string[] = [];

  rmSync(shadcnDir, { recursive: true, force: true });
  mkdirSync(shadcnUiDir, { recursive: true });
  mkdirSync(join(shadcnSrcDir, 'lib'), { recursive: true });
  mkdirSync(join(shadcnSrcDir, 'hooks'), { recursive: true });
  mkdirSync(join(shadcnSrcDir, 'styles'), { recursive: true });

  // Update the current globals.css.template instead of starting from a blank file.
  const globalsTemplatePath = join(
    SHADCN_TEMPLATE_ROOT,
    'styles',
    'globals.css.template',
  );
  writeFileSync(
    join(shadcnSrcDir, 'styles', 'globals.css'),
    readFileSync(globalsTemplatePath, 'utf-8'),
  );

  writeFileSync(
    join(shadcnDir, 'package.json'),
    JSON.stringify(
      {
        name: 'shadcn-template-refresh',
        private: true,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(shadcnDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(shadcnDir, 'components.json'),
    JSON.stringify(
      {
        $schema: 'https://ui.shadcn.com/schema.json',
        style: 'new-york',
        rsc: true,
        tsx: true,
        tailwind: {
          config: '',
          css: 'src/styles/globals.css',
          baseColor: 'zinc',
          cssVariables: true,
        },
        iconLibrary: 'lucide',
        aliases: {
          components: '@/components',
          utils: '@/lib/utils',
          hooks: '@/hooks',
          lib: '@/lib',
          ui: '@/components/ui',
        },
      },
      null,
      2,
    ),
  );

  console.log('Refreshing Shadcn templates...');
  execSync(
    `npx -y shadcn@${shadcnVersion} add ${SHADCN_COMPONENTS.join(' ')}`,
    {
      cwd: shadcnDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: '1',
      },
    },
  );

  const writeTemplateFile = (sourcePath: string, targetPath: string): void => {
    const sourceContents = readFileSync(sourcePath, 'utf-8');
    const templatedContents = applyShadcnTemplateAliases(sourceContents);
    writeFileSync(targetPath, templatedContents);
    updatedTemplates.push(relative(process.cwd(), targetPath));
  };

  for (const component of SHADCN_COMPONENTS) {
    const sourcePath = join(shadcnUiDir, `${component}.tsx`);
    if (!existsSync(sourcePath)) {
      console.warn(
        `Skipping Shadcn component output (not generated): ${sourcePath}`,
      );
      continue;
    }
    const targetPath = join(
      SHADCN_TEMPLATE_ROOT,
      'components',
      'ui',
      `${component}.tsx.template`,
    );
    writeTemplateFile(sourcePath, targetPath);
  }

  const useMobileSource = join(shadcnSrcDir, 'hooks', 'use-mobile.ts');
  if (existsSync(useMobileSource)) {
    writeTemplateFile(
      useMobileSource,
      join(SHADCN_TEMPLATE_ROOT, 'hooks', 'use-mobile.ts.template'),
    );
  } else {
    console.warn(
      `Skipping Shadcn hook output (not generated): ${useMobileSource}`,
    );
  }

  writeTemplateFile(
    join(shadcnSrcDir, 'styles', 'globals.css'),
    join(SHADCN_TEMPLATE_ROOT, 'styles', 'globals.css.template'),
  );

  console.log('Shadcn templates refreshed.');
  return updatedTemplates;
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

  // Update ts/package.json to add all dependencies from TS_VERSIONS
  const packageJsonPath = join(tsDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  packageJson.dependencies = { ...TS_VERSIONS };
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Copy root .ncurc.cjs to ts directory
  const rootNcurcPath = join(process.cwd(), '.ncurc.cjs');
  const tsNcurcPath = join(tsDir, '.ncurc.cjs');
  cpSync(rootNcurcPath, tsNcurcPath);

  // Run npx -y npm-check-updates --configFileName .ncurc.cjs inside ts dir
  console.log('Running npm-check-updates for TypeScript dependencies...');
  execSync(
    `npx -y npm-check-updates@${TS_VERSIONS['npm-check-updates']} --configFileName .ncurc.cjs`,
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
 * Applies updated versions to the versions file
 * @param tree - FsTree instance to use for file modifications
 * @param currentVersions - The current versions object (e.g., TS_VERSIONS or PY_VERSIONS)
 * @param updatedVersions - The updated versions mapping
 * @param versionsFilePath - Path to the versions file
 * @param versionConstantName - Name of the constant in the file (e.g., 'TS_VERSIONS')
 * @returns Array of version changes
 */
const applyUpdatedVersions = (
  tree: FsTree,
  currentVersions: Record<string, string>,
  updatedVersions: Record<string, string>,
  versionsFilePath: string,
  versionConstantName: string,
): VersionChange[] => {
  const changes: VersionChange[] = [];

  // Loop over versions dictionary, updating each version
  for (const depName of Object.keys(currentVersions)) {
    const oldVersion = currentVersions[depName];
    const newVersion = updatedVersions[depName];

    // Track if version changed
    if (oldVersion !== newVersion) {
      changes.push({ name: depName, oldVersion, newVersion });

      // Find the property assignment for this dependency
      // Match both identifier keys (e.g., boto3) and string literal keys (e.g., 'strands-agents')
      const selector = `VariableStatement:has(Identifier[name="${versionConstantName}"]) ObjectLiteralExpression PropertyAssignment:has(Identifier[text="${depName}"], StringLiteral[value="${depName}"])`;

      try {
        replace(
          tree,
          versionsFilePath,
          selector,
          () => {
            // Replace the string literal value with the new version
            return factory.createPropertyAssignment(
              factory.createStringLiteral(depName, true),
              factory.createStringLiteral(newVersion, true),
            );
          },
          false, // Don't error if no matches
        );
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
      group.changes.forEach(({ name, oldVersion, newVersion }) => {
        reportContent += `- ${name} ${oldVersion} -> ${newVersion}\n`;
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

    // Get updated TypeScript versions
    const updatedTsVersions = getUpdatedTypeScriptVersions(tmpDir);

    // Apply updated TypeScript versions to the versions file
    const tsChanges = applyUpdatedVersions(
      tree,
      TS_VERSIONS,
      updatedTsVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'TS_VERSIONS',
    );
    const shadcnChange = tsChanges.find((change) => change.name === 'shadcn');

    // Get updated Python versions
    const updatedPyVersions = getUpdatedPythonVersions(tmpDir);

    // Apply updated Python versions to the versions file
    const pyChanges = applyUpdatedVersions(
      tree,
      PY_VERSIONS,
      updatedPyVersions,
      'packages/nx-plugin/src/utils/versions.ts',
      'PY_VERSIONS',
    );

    // Only apply changes if not a dry run
    if (!isDryRun) {
      flushChanges(tree.root, tree.listChanges());
      if (shadcnChange?.newVersion) {
        refreshShadcnTemplates(shadcnChange.newVersion, tmpDir);
      }
    }

    // Write the report
    writeReport([
      { title: 'TypeScript Dependencies', changes: tsChanges },
      { title: 'Python Dependencies', changes: pyChanges },
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
