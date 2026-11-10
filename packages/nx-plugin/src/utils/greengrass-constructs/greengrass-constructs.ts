/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  getProjects,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { addStarExport, applyGritQL, matchGritQL } from '../ast.js';
import type {
  DependencyDeclaration,
  MustDeclare,
} from '../declared-dependencies.js';
import { forDependencies } from '../declared-dependencies.js';
import { addDependenciesToPackageJson } from '../dependencies.js';
import { buildDefaultComponentName } from '../greengrass/naming.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addArtifactProjectToTargets } from '../nx.js';
import type { IacMetadata } from '../shared-constructs-constants.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  cdkLambdaRuntimeVars,
  type ITsDepVersion,
  terraformProviderVersions,
  withVersions,
} from '../versions.js';

/** CDK recipe parsing and the deploy-time version resolver dependencies. */
export const GREENGRASS_CONSTRUCTS_DEPENDENCIES = [
  { name: 'js-yaml', when: (m: IacMetadata) => m.iac === 'cdk' },
  {
    name: '@types/js-yaml',
    dev: true,
    when: (m: IacMetadata) => m.iac === 'cdk',
  },
  {
    name: '@aws-sdk/client-greengrassv2',
    when: (m: IacMetadata) => m.iac === 'cdk',
  },
] as const satisfies readonly {
  name: ITsDepVersion;
  dev?: boolean;
  root?: boolean;
  when?: (m: IacMetadata) => boolean;
}[];

const CORE_GREENGRASS_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'core',
  'greengrass',
);
const APP_GREENGRASS_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'app',
  'greengrass',
);
const CORE_GREENGRASS_TERRAFORM_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
  'core',
  'greengrass',
);
const APP_GREENGRASS_COMPONENT_TERRAFORM_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
  'app',
  'greengrass-component',
);
/** Add the awscc requirement and default configuration to existing root modules. */
const configureGreengrassTerraformProviders = async (
  tree: Tree,
): Promise<void> => {
  const roots = [...getProjects(tree).values()]
    .filter((project) => project.projectType === 'application')
    .map(
      (project) => project.sourceRoot ?? joinPathFragments(project.root, 'src'),
    )
    .filter((root) => tree.children(root).some((name) => name.endsWith('.tf')));
  if (roots.length === 0) {
    logger.warn(
      'Create a terraform#project application and re-run greengrass#component to configure awscc, ' +
        'or declare hashicorp/awscc and provider "awscc" { region = var.aws_region } in your root module.',
    );
  }
  for (const root of roots) {
    const paths = tree
      .children(root)
      .filter((name) => name.endsWith('.tf'))
      .map((name) => joinPathFragments(root, name));
    const requirement = `awscc = {
      source  = "hashicorp/awscc"
      version = "${terraformProviderVersions().awsccProviderVersion}"
    }`;
    let requirementPath: string | undefined;
    let configured = false;
    for (const path of paths) {
      if (
        await matchGritQL(
          tree,
          path,
          'language hcl\n`required_providers { $_ }`',
        )
      ) {
        requirementPath ??= path;
      }
      configured ||= await matchGritQL(
        tree,
        path,
        'language hcl\n`provider "awscc" { $config }` where { $config <: not contains `alias = $_` }',
      );
    }
    if (!requirementPath) {
      requirementPath = joinPathFragments(root, 'greengrass-providers.tf');
      if (tree.exists(requirementPath)) {
        throw new Error(
          `Cannot add awscc required_providers: ${requirementPath} already exists without a terraform block. Configure awscc in the root module.`,
        );
      }
      tree.write(
        requirementPath,
        `terraform {\n  required_providers {\n    ${requirement}\n  }\n}\n`,
      );
    } else {
      const filledEmptyBlock = await applyGritQL(
        tree,
        requirementPath,
        `language hcl\n\`required_providers {}\` => \`required_providers {\n    ${requirement}\n  }\``,
      );
      if (!filledEmptyBlock) {
        await applyGritQL(
          tree,
          requirementPath,
          'language hcl\n`required_providers { $providers }` where { ' +
            '$providers <: not contains `awscc = $_`, ' +
            `$providers += \`\n    ${requirement}\` }`,
        );
      }
    }
    if (!configured) {
      tree.write(
        requirementPath,
        `${tree.read(requirementPath, 'utf-8')!.trimEnd()}\n\nprovider "awscc" {\n  region = var.aws_region\n}\n`,
      );
    }
  }
};

/** Registers `projectName`'s artifact target on the shared iac project the caller vended into. */
const addArtifactProjectToSharedTargets = (
  tree: Tree,
  iac: Iac,
  projectName: string,
): void => {
  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addArtifactProjectToTargets(config, projectName);
      return config;
    },
  );
};

/**
 * Vends the shared `GreengrassArtifactBucket` / `GreengrassComponentVersion` /
 * `GreengrassDeployment` / recipe-reader constructs (CDK) or modules
 * (Terraform, via the `hashicorp/awscc` provider - neither
 * `AWS::GreengrassV2::ComponentVersion` nor `AWS::GreengrassV2::Deployment`
 * exists in the pinned `hashicorp/aws` provider) into
 * `common/constructs/src/core/greengrass/` or
 * `common/terraform/src/core/greengrass/`. Existing core files are preserved
 * on later component runs; missing files are added. Idempotent: called from
 * every component generator run.
 */
export const addGreengrassCoreConstructs = async <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  { iac }: { iac: Iac },
  declaration: D & MustDeclare<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES, D>,
): Promise<void> => {
  const componentName = buildDefaultComponentName(tree, 'Namespace');
  const componentKeyPrefix = `${componentName.slice(0, componentName.lastIndexOf('.'))}.*`;
  if (iac === 'terraform') {
    await configureGreengrassTerraformProviders(tree);
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        'files',
        'terraform',
        'core',
        'greengrass',
      ),
      CORE_GREENGRASS_TERRAFORM_DIR,
      { ...terraformProviderVersions(), componentKeyPrefix },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
    return;
  }
  if (iac !== 'cdk') {
    throw new Error(`Unsupported iac ${iac}`);
  }

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'core',
      'greengrass',
    ),
    CORE_GREENGRASS_DIR,
    { ...esmVars(tree), ...cdkLambdaRuntimeVars(), componentKeyPrefix },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'next-version'),
    joinPathFragments(CORE_GREENGRASS_DIR, 'next-version'),
    { nextVersionFileName: 'index.js' },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
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
    './greengrass/index.js',
  );

  addDependenciesToPackageJson(
    tree,
    withVersions(
      forDependencies<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['js-yaml', '@aws-sdk/client-greengrassv2'],
    ),
    withVersions(
      forDependencies<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['@types/js-yaml'],
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'package.json'),
  );
};

export interface AddGreengrassComponentAppConstructOptions {
  readonly iac: Iac;
  readonly componentNameClassName: string;
  readonly componentDisplayName: string;
  readonly componentDirName: string;
  readonly project: string;
  /** The host project whose `<c>-artifact` target this construct reads at synth time. */
  readonly hostProjectName: string;
  readonly recipesDirFromRoot: string;
  readonly artifactsDirFromRoot: string;
}

/**
 * Vends the per-component app construct/module: a thin
 * `GreengrassComponentVersion` wrapper pinning this component's build output
 * paths, at `common/constructs/src/app/greengrass/<componentDirName>.ts`
 * (CDK) or `common/terraform/src/app/greengrass-component/<componentDirName>/`
 * (Terraform, taking the artifact bucket's name as a plain input variable so
 * user IaC can own or import the shared artifact repository).
 * `OverwriteStrategy.KeepExisting` either way. Registers the host project on
 * the shared iac project's `build`/`assemble` targets so `nx run
 * <infra>:deploy` always deploys a freshly built artifact.
 */
export const addGreengrassComponentAppConstruct = async <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  options: AddGreengrassComponentAppConstructOptions,
  declaration: D & MustDeclare<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES, D>,
): Promise<void> => {
  await addGreengrassCoreConstructs(
    tree,
    { iac: options.iac },
    forDependencies<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES>(declaration),
  );

  if (options.iac === 'terraform') {
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        'files',
        'terraform',
        'app',
        'greengrass-component',
      ),
      APP_GREENGRASS_COMPONENT_TERRAFORM_DIR,
      options,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
    addArtifactProjectToSharedTargets(
      tree,
      'terraform',
      options.hostProjectName,
    );
    return;
  }

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'app',
      'greengrass-component',
    ),
    APP_GREENGRASS_DIR,
    { ...options, ...esmVars(tree) },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addStarExport(
    tree,
    joinPathFragments(APP_GREENGRASS_DIR, 'index.ts'),
    `./${options.componentDirName}.js`,
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
    './greengrass/index.js',
  );

  addArtifactProjectToSharedTargets(tree, 'cdk', options.hostProjectName);
};
