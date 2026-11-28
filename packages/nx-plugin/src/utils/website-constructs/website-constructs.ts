/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { addStarExport } from '../ast.js';
import type { DeclaredPyDependency } from '../declared-dependencies.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addArtifactProjectToTargets } from '../nx.js';
import {
  generatedTerraform,
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  type IPyDepVersion,
  PY_VERSIONS,
  terraformProviderVersions,
} from '../versions.js';

/**
 * Python version the generated Terraform pins in the static website module's
 * inline `uv run --with` scripts, which upload the site's assets. Nothing
 * installs it, so it is declared for its version alone, and only on the
 * Terraform branch that writes the scripts.
 */
export const WEBSITE_CONSTRUCTS_PY_DEPENDENCIES = [
  { name: 'boto3', when: generatedTerraform },
] as const satisfies readonly DeclaredPyDependency<
  IPyDepVersion,
  IacMetadata
>[];

export type WebsiteHosting = 'cloudfront' | 'api-gateway';

export interface AddWebsiteInfraOptions {
  websiteProjectName: string;
  scopeAlias: string;
  websiteContentPath: string;
  websiteNameKebabCase: string;
  websiteNameClassName: string;
  /**
   * How the website is served. CDK only for 'api-gateway'.
   *
   * @default 'cloudfront'
   */
  hosting?: WebsiteHosting;
}

/**
 * Add infrastructure for a static website
 */
export const addWebsiteInfra = async (
  tree: Tree,
  options: AddWebsiteInfraOptions & { iac: Iac },
) => {
  if (options.iac === 'cdk') {
    if (options.hosting === 'api-gateway') {
      await addApiGatewayWebsiteCdkConstructs(tree, options);
    } else {
      await addWebsiteCdkConstructs(tree, options);
    }
  } else if (options.iac === 'terraform') {
    if (options.hosting === 'api-gateway') {
      throw new Error(
        'Hosting a website through API Gateway is only supported with CDK',
      );
    }
    addWebsiteTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iac ${options.iac}`);
  }

  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addArtifactProjectToTargets(config, options.websiteProjectName);
      return config;
    },
  );
};

const addWebsiteCdkConstructs = async (
  tree: Tree,
  options: AddWebsiteInfraOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
    { ...options, ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app'),
    { ...options, ...esmVars(tree) },
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
      'app',
      'index.ts',
    ),
    './static-websites/index.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'static-websites',
      'index.ts',
    ),
    `./${options.websiteNameKebabCase}.js`,
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
    './static-website.js',
  );
};

const addApiGatewayWebsiteCdkConstructs = async (
  tree: Tree,
  options: AddWebsiteInfraOptions,
) => {
  const constructsSrc = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
  );
  // Replace a CloudFront website construct when switching how it is hosted,
  // but only as generated
  const websiteConstructPath = joinPathFragments(
    constructsSrc,
    'app',
    'static-websites',
    `${options.websiteNameKebabCase}.ts`,
  );
  if (
    tree.exists(websiteConstructPath) &&
    /extends (Core)?StaticWebsite\b/.test(
      tree.read(websiteConstructPath, 'utf-8') ?? '',
    )
  ) {
    const generated = renderCloudFrontConstructs(tree, options);
    // A changed construct is not deleted, and the switch stops whole, since
    // the API Gateway construct cannot be written over it
    if (!isAsGenerated(tree, websiteConstructPath, generated.app)) {
      throw new Error(
        `${websiteConstructPath} is hosted on CloudFront and has changed since it was generated, so the website cannot be switched to API Gateway hosting. Move your changes aside and delete it, then run the generator again.`,
      );
    }
    tree.delete(websiteConstructPath);
    // Remove the CloudFront core too when no other website uses it and it is
    // as generated
    const staticWebsitesDir = joinPathFragments(
      constructsSrc,
      'app',
      'static-websites',
    );
    const stillUsed = tree
      .children(staticWebsitesDir)
      .some((file) =>
        /extends (Core)?StaticWebsite\b/.test(
          tree.read(joinPathFragments(staticWebsitesDir, file), 'utf-8') ?? '',
        ),
      );
    const corePath = joinPathFragments(
      constructsSrc,
      'core',
      'static-website.ts',
    );
    const coreIndex = joinPathFragments(constructsSrc, 'core', 'index.ts');
    if (!stillUsed && tree.exists(corePath)) {
      if (isAsGenerated(tree, corePath, generated.core)) {
        tree.delete(corePath);
        tree.write(
          coreIndex,
          (tree.read(coreIndex, 'utf-8') ?? '').replace(
            "export * from './static-website.js';\n",
            '',
          ),
        );
      } else {
        logger.info(
          `${corePath} has changed since it was generated, so it is kept, though no website uses it now`,
        );
      }
    }
  }

  const templateOptions = { ...options, ...esmVars(tree) };
  for (const dir of ['core', 'app']) {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'cdk-api-gateway', dir),
      joinPathFragments(constructsSrc, dir),
      templateOptions,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  await addStarExport(
    tree,
    joinPathFragments(constructsSrc, 'app', 'index.ts'),
    './static-websites/index.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(constructsSrc, 'app', 'static-websites', 'index.ts'),
    `./${options.websiteNameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(constructsSrc, 'core', 'index.ts'),
    './api-gateway-static-website.js',
  );
};

/** The CloudFront website constructs as this generator would write them */
const renderCloudFrontConstructs = (
  tree: Tree,
  options: AddWebsiteInfraOptions,
): { app: string; core: string } => {
  const scratch = '.nx-plugin-for-aws-render';
  const vars = { ...options, ...esmVars(tree) };
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app'),
    joinPathFragments(scratch, 'app'),
    vars,
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    joinPathFragments(scratch, 'core'),
    vars,
  );
  const rendered = {
    app:
      tree.read(
        joinPathFragments(
          scratch,
          'app',
          'static-websites',
          `${options.websiteNameKebabCase}.ts`,
        ),
        'utf-8',
      ) ?? '',
    core:
      tree.read(
        joinPathFragments(scratch, 'core', 'static-website.ts'),
        'utf-8',
      ) ?? '',
  };
  tree.delete(scratch);
  return rendered;
};

/**
 * Whether the file at `path` is `generated`, ignoring the whitespace and
 * punctuation the formatter may have changed
 */
const isAsGenerated = (tree: Tree, path: string, generated: string) => {
  const normalise = (code: string) => code.replace(/[\s,;]/g, '');
  return normalise(tree.read(path, 'utf-8') ?? '') === normalise(generated);
};

const addWebsiteTerraformModules = (
  tree: Tree,
  options: AddWebsiteInfraOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core'),
    {
      ...options,
      boto3Version: PY_VERSIONS.boto3,
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app'),
    { ...options, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
