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
} from '../shared-constructs-constants.js';
import {
  cdkLambdaRuntimeVars,
  type ITsDepVersion,
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

/** Registers `projectName`'s artifact target on the shared CDK project. */
const addArtifactProjectToSharedTargets = (
  tree: Tree,
  projectName: string,
): void => {
  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      addArtifactProjectToTargets(config, projectName);
      return config;
    },
  );
};

/**
 * Vends the shared artifact repository, component publication, deployment and
 * recipe-reader CDK constructs into common/constructs/src/core/greengrass/.
 * Existing core files are preserved and missing files are added on every run.
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
 * Vends a per-component GreengrassComponentVersion wrapper at
 * common/constructs/src/app/greengrass/<componentDirName>.ts, preserving edits.
 * Registers the host project on the shared CDK project's build/assemble targets
 * so infrastructure deployment always consumes a freshly built artifact.
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

  addArtifactProjectToSharedTargets(tree, options.hostProjectName);
};
