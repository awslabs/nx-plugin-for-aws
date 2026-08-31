/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  addStarExport,
  appendToArrayViaGritQL,
  applyGritQL,
  matchGritQL,
} from '../ast.js';
import type { DeclaredPyDependency } from '../declared-dependencies.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
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
 * Python version the generated Terraform pins in the callback URL module's inline
 * `uv run --with` script. Nothing installs it, so it is declared for its version
 * alone, and only on the Terraform branch that writes the script.
 */
export const IDENTITY_CONSTRUCTS_PY_DEPENDENCIES = [
  { name: 'boto3', when: generatedTerraform },
] as const satisfies readonly DeclaredPyDependency<
  IPyDepVersion,
  IacMetadata
>[];

export interface AddIdentityInfraOptions {
  cognitoDomain: string;
  allowSignup: boolean;
  /**
   * Local ports (dev server, preview, ...) of the website adding auth,
   * allow-listed as Cognito callback/logout URLs so its sign-in redirects succeed.
   */
  localCallbackPorts: number[];
}

/**
 * Idempotently allow-list a local port as a Cognito callback/logout URL, on
 * whichever shared identity construct/module the given `iac` provider vends.
 * Shared between the auth generator (adding a new website's ports) and the
 * migration that backfills ports for websites that predate per-project port
 * assignment.
 *
 * Returns whether the port ended up allow-listed (already was, or now is) —
 * `false` means the file doesn't exist or has diverged from the shape this
 * can recognise, which the migration reports via `nextSteps` rather than
 * clobbering.
 */
export const addLocalCallbackUrl = async (
  tree: Tree,
  iac: Iac,
  port: number,
): Promise<boolean> => {
  if (iac === 'cdk') {
    return addLocalCallbackUrlToCdk(tree, port);
  } else if (iac === 'terraform') {
    return addLocalCallbackUrlToTerraform(tree, port);
  } else {
    throw new Error(`Unsupported iac ${iac}`);
  }
};

const addLocalCallbackUrlToCdk = async (
  tree: Tree,
  port: number,
): Promise<boolean> => {
  const filePath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'core',
    'user-identity.ts',
  );
  const url = `'http://localhost:${port}'`;
  if (!tree.exists(filePath)) {
    return false;
  }
  // Scoped to the array, so a URL mentioned elsewhere in the file (e.g. a
  // comment, or a different array) doesn't read as allow-listed.
  if (
    await matchGritQL(
      tree,
      filePath,
      `\`LOCAL_CALLBACK_URLS = [$items]\` where { $items <: contains \`${url}\` }`,
    )
  ) {
    return true;
  }
  return appendToArrayViaGritQL(tree, filePath, 'LOCAL_CALLBACK_URLS = ', url);
};

// Rewrites the last array element directly (rather than inserting after a
// placeholder) so the indentation is exact — nothing reformats generated
// `.tf` files afterward.
const addLocalCallbackUrlToTerraform = async (
  tree: Tree,
  port: number,
): Promise<boolean> => {
  const filePath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'core',
    'user-identity',
    'identity',
    'identity.tf',
  );
  const url = `"http://localhost:${port}"`;
  if (!tree.exists(filePath)) {
    return false;
  }
  // Scoped to the array, so a URL mentioned elsewhere in the file doesn't
  // read as allow-listed.
  if (
    await matchGritQL(
      tree,
      filePath,
      `language hcl\n\`local_callback_urls = [$items]\` where { $items <: contains \`${url}\` }`,
    )
  ) {
    return true;
  }
  return applyGritQL(
    tree,
    filePath,
    `language hcl\n\`local_callback_urls = [$items]\` where { $items <: not contains \`${url}\`, $items <: [$..., $last], $last => \`$last,\n    ${url}\` }`,
  );
};

/**
 * Add infrastructure for a static website. Returns the local ports that could
 * not be allow-listed as Cognito callback/logout URLs, because the shared
 * construct/module no longer matches the generated shape.
 */
export const addIdentityInfra = async (
  tree: Tree,
  options: AddIdentityInfraOptions & { iac: Iac },
): Promise<number[]> => {
  if (options.iac === 'cdk') {
    return addIdentityCdkConstructs(tree, options);
  } else if (options.iac === 'terraform') {
    return addIdentityTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iac ${options.iac}`);
  }
};

const addIdentityCdkConstructs = async (
  tree: Tree,
  options: AddIdentityInfraOptions,
): Promise<number[]> => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
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
      'core',
      'index.ts',
    ),
    './user-identity.js',
  );

  // The construct is shared by every website in the workspace, so each one adding
  // auth allow-lists its own local ports rather than overwriting the others'.
  const portsNotAllowListed: number[] = [];
  for (const port of options.localCallbackPorts) {
    if (!(await addLocalCallbackUrlToCdk(tree, port))) {
      portsNotAllowListed.push(port);
    }
  }
  return portsNotAllowListed;
};

const addIdentityTerraformModules = async (
  tree: Tree,
  options: AddIdentityInfraOptions,
): Promise<number[]> => {
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

  // The module is shared by every website in the workspace, so each one adding
  // auth allow-lists its own local ports rather than overwriting the others'.
  const portsNotAllowListed: number[] = [];
  for (const port of options.localCallbackPorts) {
    if (!(await addLocalCallbackUrlToTerraform(tree, port))) {
      portsNotAllowListed.push(port);
    }
  }

  // Update the static website module to add the callback url
  const staticWebsiteModule = tree.read(
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'core',
      'static-website',
      'static-website.tf',
    ),
    'utf-8',
  );
  if (
    staticWebsiteModule &&
    !staticWebsiteModule.includes(
      'source = "../user-identity/add-callback-url"',
    )
  ) {
    // Find the aws_cloudfront_distribution.website resource and add the callback URL module after it.
    // Includes the CloudFront domain plus any custom domain names (aliases) configured via var.custom_domain_names.
    const callbackUrlModule = `

# Add CloudFront domain and any custom domain names to user pool client callback URLs.
# Keyed by statically-known values so for_each keys are resolvable at plan time; the
# CloudFront domain is only known at apply time, so it appears in the value, not the key.
locals {
  callback_urls = merge(
    { cloudfront = "https://\${aws_cloudfront_distribution.website.domain_name}" },
    { for domain in var.custom_domain_names : domain => "https://\${domain}" },
  )
}

module "add_callback_url" {
  source = "../user-identity/add-callback-url"
  for_each = local.callback_urls

  callback_url = each.value

  depends_on = [aws_cloudfront_distribution.website]
}`;

    // Find the CloudFront distribution resource using proper brace counting
    // This handles deeply nested structures correctly
    const resourceStartPattern =
      /resource\s+"aws_cloudfront_distribution"\s+"website"\s*\{/;
    const resourceStartMatch = staticWebsiteModule.match(resourceStartPattern);

    if (resourceStartMatch) {
      const startIndex =
        resourceStartMatch.index! + resourceStartMatch[0].length - 1; // Position at opening brace
      let braceCount = 0;
      let insertionPoint = -1;

      // Count braces to find the end of the resource block
      for (let i = startIndex; i < staticWebsiteModule.length; i++) {
        const char = staticWebsiteModule[i];
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            // Found the closing brace of the CloudFront resource
            insertionPoint = i + 1;
            break;
          }
        }
      }

      if (insertionPoint !== -1) {
        // Insert the callback URL module right after the CloudFront distribution
        const beforeInsertion = staticWebsiteModule.substring(
          0,
          insertionPoint,
        );
        const afterInsertion = staticWebsiteModule.substring(insertionPoint);
        const updatedContent =
          beforeInsertion + callbackUrlModule + afterInsertion;

        tree.write(
          joinPathFragments(
            PACKAGES_DIR,
            SHARED_TERRAFORM_DIR,
            'src',
            'core',
            'static-website',
            'static-website.tf',
          ),
          updatedContent,
        );
      }
    }
  }

  return portsNotAllowListed;
};
