/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import {
  addPyDependencies,
  addTsDependencies,
} from '../../utils/add-dependencies.js';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import {
  type GreengrassPlatformSelection,
  resolvePlatforms,
} from '../../utils/greengrass/constants.js';
import {
  assertValidComponentName,
  buildDefaultComponentName,
  MAX_CDK_COMPONENT_NAME_LENGTH,
} from '../../utils/greengrass/naming.js';
import { isValidComponentVersion } from '../../utils/greengrass/recipe.js';
import {
  addGreengrassComponentAppConstruct,
  type GREENGRASS_CONSTRUCTS_DEPENDENCIES,
} from '../../utils/greengrass-constructs/greengrass-constructs.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { toClassName, toKebabCase } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addComponentGeneratorMetadata,
  normalizeTargetKeyOrder,
  readProjectConfigurationUnqualified,
  updateComponentGeneratorMetadata,
} from '../../utils/nx.js';
import {
  type SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants.js';
import type { GreengrassComponentMetadata } from './generator.js';
import { GREENGRASS_COMPONENT_GENERATOR_INFO } from './metadata.js';
import type { GreengrassComponentGeneratorSchema } from './schema.js';

export type Language = NonNullable<
  GreengrassComponentGeneratorSchema['language']
>;

export interface NormalizedComponent {
  readonly options: GreengrassComponentGeneratorSchema;
  readonly language: Language;
  readonly project: ProjectConfiguration;
  readonly componentDirName: string;
  readonly componentName: string;
  readonly componentVersion: string;
  readonly publisher: string;
  readonly ipc: boolean;
  readonly gdkConfig: boolean;
  readonly platform: GreengrassPlatformSelection;
  readonly platforms: ReturnType<typeof resolvePlatforms>;
  readonly infra: 'component-version' | 'none';
  readonly iac?: 'cdk' | 'terraform';
  readonly existingMetadata?: GreengrassComponentMetadata;
}

export const GREENGRASS_SCRIPTS_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
  'src',
  'greengrass',
);

export const sharedComponentTargets = ({
  artifactTarget,
  componentDirName,
  componentName,
  distDir,
}: {
  readonly artifactTarget: string;
  readonly componentDirName: string;
  readonly componentName: string;
  readonly distDir: string;
}) => ({
  [`${componentDirName}-deploy-local`]: normalizeTargetKeyOrder({
    executor: 'nx:run-commands',
    dependsOn: [artifactTarget],
    options: {
      command: `tsx ${GREENGRASS_SCRIPTS_DIR}/deploy-local.ts ${distDir}`,
    },
  }),
  [`${componentDirName}-logs`]: normalizeTargetKeyOrder({
    executor: 'nx:run-commands',
    continuous: true,
    options: {
      command: `tsx ${GREENGRASS_SCRIPTS_DIR}/component-logs.ts ${componentName}`,
    },
  }),
});

export const normalizeComponent = async (
  tree: Tree,
  options: GreengrassComponentGeneratorSchema,
): Promise<NormalizedComponent> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);
  const hasTypeScript = tree.exists(
    joinPathFragments(project.root, 'tsconfig.json'),
  );
  const hasPython = tree.exists(
    joinPathFragments(project.root, 'pyproject.toml'),
  );
  if (!hasTypeScript && !hasPython) {
    throw new Error(
      `Greengrass components require a supported host project. "${options.project}" has neither tsconfig.json nor pyproject.toml.`,
    );
  }
  let language: Language;
  if (!options.language) {
    if (hasTypeScript && hasPython) {
      throw new Error(
        `The project "${options.project}" has both tsconfig.json and pyproject.toml. Pass --language=typescript or --language=python.`,
      );
    }
    language = hasTypeScript ? 'typescript' : 'python';
  } else {
    language = options.language;
    if (language === 'typescript' && !hasTypeScript) {
      throw new Error(
        `--language=typescript requires tsconfig.json in "${options.project}".`,
      );
    }
    if (language === 'python' && !hasPython) {
      throw new Error(
        `--language=python requires pyproject.toml in "${options.project}".`,
      );
    }
  }
  if (language === 'typescript' && !project.sourceRoot) {
    throw new Error(
      'This project does not have a source root. Please add a source root to the project configuration before running this generator.',
    );
  }
  const components =
    (
      project.metadata as {
        components?: (GreengrassComponentMetadata & {
          generator?: string;
          name?: string;
        })[];
      }
    )?.components ?? [];
  const componentDirName = toKebabCase(options.name);
  const existingMetadata = components.find(
    (component) =>
      component.generator === GREENGRASS_COMPONENT_GENERATOR_INFO.id &&
      component.name === componentDirName,
  );
  if (existingMetadata?.language && existingMetadata.language !== language) {
    throw new Error(
      `The Greengrass component "${componentDirName}" already uses ${existingMetadata.language}. A component cannot change language under the same name.`,
    );
  }
  const componentName =
    options.componentName ?? buildDefaultComponentName(tree, options.name);
  assertValidComponentName(componentName);
  const componentVersion = options.componentVersion ?? '1.0.0';
  if (!isValidComponentVersion(componentVersion)) {
    throw new Error(
      `ComponentVersion "${componentVersion}" must be a valid semantic version (eg. "1.0.0") or one of NEXT_PATCH, NEXT_MINOR, NEXT_MAJOR.`,
    );
  }
  const infra = options.infra ?? 'component-version';
  if (existingMetadata?.iac && infra === 'none') {
    throw new Error(
      `This project already has a Greengrass component named "${componentDirName}" with infrastructure provisioned (iac=${existingMetadata.iac}). Re-running with --infra=none would leave that infrastructure orphaned - remove it manually first, or keep --infra=component-version.`,
    );
  }
  const iac =
    infra === 'none'
      ? undefined
      : ((await resolveIac(tree, options.iac ?? 'inherit')) as
          | 'cdk'
          | 'terraform');
  if (iac === 'cdk' && componentName.length > MAX_CDK_COMPONENT_NAME_LENGTH) {
    throw new Error(
      `ComponentName "${componentName}" is ${componentName.length} characters long, exceeding the ${MAX_CDK_COMPONENT_NAME_LENGTH}-character limit for CDK Greengrass component artifacts. Shorten --componentName to ${MAX_CDK_COMPONENT_NAME_LENGTH} characters or fewer.`,
    );
  }
  if (iac === 'terraform' && componentVersion.startsWith('NEXT_')) {
    throw new Error(
      'Terraform Greengrass components require an explicit semantic version. Set --componentVersion to a value such as 1.0.0; NEXT_* versions are supported with CDK infrastructure.',
    );
  }
  const platform = options.platform ?? 'linux-arm64';
  return {
    options,
    language,
    project,
    componentDirName,
    componentName,
    componentVersion,
    publisher: options.publisher ?? getNpmScope(tree) ?? 'monorepo',
    ipc: options.ipc ?? false,
    gdkConfig: options.gdkConfig ?? false,
    platform,
    platforms: resolvePlatforms(platform),
    infra,
    iac,
    existingMetadata,
  };
};

export const assertUnchangedPlatform = (
  component: NormalizedComponent,
  manifestPreview: string,
): void => {
  const existingPlatform = component.existingMetadata?.platform;
  if (!existingPlatform || existingPlatform === component.platform) {
    return;
  }
  throw new Error(
    `This project already has a Greengrass component named "${component.componentDirName}" generated for platform "${existingPlatform}". recipe.yaml is user-owned and is never rewritten, so this run cannot change it to "${component.platform}" - the targets would then build artifacts the recipe does not declare. If you did not mean to change the platform, re-run with --platform=${existingPlatform} (this option has a default, so leaving it off asks for "${component.platform}"). To change it on purpose, edit ${joinPathFragments(component.project.root, 'greengrass', component.componentDirName, 'recipe.yaml')} by hand so its Manifests match, bump ComponentVersion (published versions are immutable), and set platform to "${component.platform}" in this project's project.json metadata.components entry. The manifests "${component.platform}" expects are:\n${manifestPreview}`,
  );
};

/**
 * The shared tail every language adapter owes after it writes its
 * language-specific templates and targets: record/update metadata (language
 * always persisted, so a later rerun can refuse a language change under the
 * same identity), provision the optional shared/app infrastructure, install the
 * language's applicable dependencies, emit metrics and format. Called once,
 * from each adapter, rather than duplicated in both.
 */
export const finalizeComponent = async <const D extends DependencyDeclaration>(
  tree: Tree,
  component: NormalizedComponent,
  entrypoint: string,
  dependencies: D &
    MustDeclare<typeof SHARED_CONSTRUCTS_DEPENDENCIES, D> &
    MustDeclare<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES, D>,
): Promise<GeneratorCallback> => {
  const metadata: GreengrassComponentMetadata = {
    language: component.language,
    componentName: component.componentName,
    componentVersion: component.componentVersion,
    platform: component.platform,
    ipc: component.ipc,
    gdkConfig: component.gdkConfig,
    ...(component.iac ? { iac: component.iac } : {}),
  };
  addComponentGeneratorMetadata(
    tree,
    component.project.name,
    GREENGRASS_COMPONENT_GENERATOR_INFO,
    entrypoint,
    component.componentDirName,
    metadata,
  );
  // An escalation from `--infra none` already has an entry, which the add above
  // leaves as it is - including its missing `iac`. Record the resolved one, or
  // the orphan guard would not see the infrastructure this run provisions and a
  // later `--infra none` would silently orphan it.
  if (component.iac || component.existingMetadata) {
    updateComponentGeneratorMetadata(
      tree,
      component.project.name,
      GREENGRASS_COMPONENT_GENERATOR_INFO,
      component.componentDirName,
      {
        language: component.language,
        gdkConfig: component.gdkConfig,
        ...(component.iac ? { iac: component.iac } : {}),
      },
    );
  }
  if (component.infra !== 'none') {
    // Each helper below is itself generic over the caller's declaration and
    // re-checks MustDeclare against its own constant; `dependencies`'s type
    // here already proves both to the *outer* MustDeclare intersection above,
    // so this narrows to what each helper asks for, same as those helpers'
    // own internal forwarding.
    await sharedConstructsGenerator(
      tree,
      { iac: component.iac! },
      forDependencies<typeof SHARED_CONSTRUCTS_DEPENDENCIES>(dependencies),
    );
    await addGreengrassComponentAppConstruct(
      tree,
      {
        iac: component.iac!,
        componentNameClassName: toClassName(component.options.name),
        componentDisplayName: component.componentName,
        componentDirName: component.componentDirName,
        project: component.project.name,
        hostProjectName: component.project.name,
        recipesDirFromRoot: `dist/${component.project.root}/greengrass/${component.componentDirName}/greengrass-build/recipes`,
        artifactsDirFromRoot: `dist/${component.project.root}/greengrass/${component.componentDirName}/greengrass-build/artifacts`,
      },
      forDependencies<typeof GREENGRASS_CONSTRUCTS_DEPENDENCIES>(dependencies),
    );
  }
  if (component.language === 'python') {
    addPyDependencies(tree, dependencies, {
      metadata,
      projectRoot: component.project.root,
    });
  } else {
    addTsDependencies(tree, dependencies, {
      metadata,
      projectRoot: component.project.root,
    });
  }
  await addGeneratorMetricsIfApplicable(tree, [
    GREENGRASS_COMPONENT_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);

  return () =>
    installDependencies(tree, component.options.preferInstallDependencies, {
      languages:
        component.language === 'python'
          ? ['typescript', 'python']
          : ['typescript'],
    });
};
