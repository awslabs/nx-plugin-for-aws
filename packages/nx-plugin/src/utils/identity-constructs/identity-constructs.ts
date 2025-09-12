/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';
import { IacProvider } from '../iac';

export interface AddIdentityInfraOptions {
  cognitoDomain: string;
  allowSignup: boolean;
}

/**
 * Add infrastructure for a static website
 */
export const addIdentityInfra = (
  tree: Tree,
  options: AddIdentityInfraOptions & { iacProvider: IacProvider },
) => {
  if (options.iacProvider === 'CDK') {
    addIdentityCdkConstructs(tree, options);
  } else if (options.iacProvider === 'Terraform') {
    addIdentityTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iacProvider ${options.iacProvider}`);
  }
};

const addIdentityCdkConstructs = (
  tree: Tree,
  options: AddIdentityInfraOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  addStarExport(
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
};

const addIdentityTerraformModules = (
  tree: Tree,
  options: AddIdentityInfraOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'terraform', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

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
    // Find the aws_cloudfront_distribution.website resource and add the callback URL module after it
    const callbackUrlModule = `

# Add CloudFront domain to user pool client callback URLs
module "add_callback_url" {
  source = "../user-identity/add-callback-url"

  callback_url = "https://\${aws_cloudfront_distribution.website.domain_name}"

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
};
