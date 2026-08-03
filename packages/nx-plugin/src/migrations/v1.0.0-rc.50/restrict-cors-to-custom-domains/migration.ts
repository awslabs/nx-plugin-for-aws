/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import {
  addDestructuredImport,
  addStarExport,
  applyGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { isEsmWorkspace } from '../../../utils/module-format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Include CloudFront custom domain aliases in restrictCorsTo and UserIdentity callback URLs
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, rather than
 *   clobbering the user's changes.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files your
 *   migration wrote are formatted correctly.
 */

const CORE_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core`;
const APIS_APP_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/apis`;
const CLOUDFRONT_CORE_FILE = `${CORE_DIR}/cloudfront.ts`;
const CORE_INDEX_FILE = `${CORE_DIR}/index.ts`;
const USER_IDENTITY_FILE = `${CORE_DIR}/user-identity.ts`;

const CLOUDFRONT_HELPER_CONTENT = `import { CfnDistribution, Distribution } from 'aws-cdk-lib/aws-cloudfront';

/**
 * Finds the domain names associated with a CloudFront distribution.
 *
 * Includes the distribution's default \`*.cloudfront.net\` domain name plus any custom
 * domain names (aliases) configured on it.
 */
export const findCloudFrontDomainNames = (
  distribution: Distribution,
): string[] => {
  const cfnDistribution = distribution.node.defaultChild as CfnDistribution;
  const distributionConfig =
    cfnDistribution.distributionConfig as CfnDistribution.DistributionConfigProperty;
  return [distribution.domainName, ...(distributionConfig.aliases ?? [])];
};
`;

// Rewrites the `restrictCorsTo` body as produced by generators prior to this fix.
const RESTRICT_CORS_TO_GRITQL_PATTERN =
  "`origins.map(($o) => typeof $o === 'string' ? $o : 'cloudFrontDistribution' in $o ? $branch1 : $branch2)` where { $branch1 <: contains `distributionDomainName`, $branch2 <: contains `distributionDomainName` } => raw`origins.flatMap(($o) => typeof $o === 'string' ? [$o] : findCloudFrontDomainNames('cloudFrontDistribution' in $o ? $o.cloudFrontDistribution : $o).map((domain) => \\`https://${domain}\\`))`";

// Rewrites UserIdentity's callback/logout URL logic as produced by generators
// prior to this fix.
const USER_IDENTITY_CALLBACK_URLS_GRITQL_PATTERN =
  '`this.findCloudFrontDomainNames()` => `Stack.of(this).node.findAll().filter((child): child is Distribution => child instanceof Distribution).flatMap(findCloudFrontDomainNames)`';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(CORE_INDEX_FILE)) {
    // No common/constructs shared library in this workspace - nothing to migrate.
    return { nextSteps };
  }

  const esm = isEsmWorkspace(tree);
  const apiCloudFrontImportSpecifier = esm
    ? '../../core/cloudfront.js'
    : '../../core/cloudfront';
  const coreCloudFrontImportSpecifier = esm
    ? './cloudfront.js'
    : './cloudfront';

  if (!tree.exists(CLOUDFRONT_CORE_FILE)) {
    tree.write(CLOUDFRONT_CORE_FILE, CLOUDFRONT_HELPER_CONTENT);
  }
  await addStarExport(tree, CORE_INDEX_FILE, './cloudfront.js');

  const apiAppFiles: string[] = [];
  visitNotIgnoredFiles(tree, APIS_APP_DIR, (filePath) => {
    apiAppFiles.push(filePath);
  });

  for (const filePath of apiAppFiles) {
    if (!filePath.endsWith('.ts') || filePath.endsWith('/index.ts')) {
      continue;
    }
    const rewrote = await applyGritQL(
      tree,
      filePath,
      RESTRICT_CORS_TO_GRITQL_PATTERN,
    );
    if (rewrote) {
      await addDestructuredImport(
        tree,
        filePath,
        ['findCloudFrontDomainNames'],
        apiCloudFrontImportSpecifier,
      );
      nextSteps.push(
        `${filePath}: restrictCorsTo now includes CloudFront custom domain aliases automatically.`,
      );
      continue;
    }
    const contents = tree.read(filePath, 'utf-8') ?? '';
    if (!contents.includes('findCloudFrontDomainNames(')) {
      nextSteps.push(
        `${filePath}: restrictCorsTo has diverged from the generated shape - left untouched. Manually apply the CloudFront custom domain fix (see findCloudFrontDomainNames in common/constructs/src/core/cloudfront.ts).`,
      );
    }
    // Otherwise already migrated - silent skip.
  }

  if (tree.exists(USER_IDENTITY_FILE)) {
    const rewrote = await applyGritQL(
      tree,
      USER_IDENTITY_FILE,
      USER_IDENTITY_CALLBACK_URLS_GRITQL_PATTERN,
    );
    if (rewrote) {
      await applyGritQL(
        tree,
        USER_IDENTITY_FILE,
        "`import { CfnDistribution, Distribution } from 'aws-cdk-lib/aws-cloudfront'` => `import { Distribution } from 'aws-cdk-lib/aws-cloudfront';`",
      );
      await applyGritQL(
        tree,
        USER_IDENTITY_FILE,
        "or { `// Includes each distribution's default domain name plus any custom domain names (aliases) configured on it.` => ., `private findCloudFrontDomainNames = (): string[] => $body` => . }",
      );
      await addDestructuredImport(
        tree,
        USER_IDENTITY_FILE,
        ['findCloudFrontDomainNames'],
        coreCloudFrontImportSpecifier,
      );
      nextSteps.push(
        `${USER_IDENTITY_FILE}: now reuses the shared findCloudFrontDomainNames helper.`,
      );
    } else {
      const contents = tree.read(USER_IDENTITY_FILE, 'utf-8') ?? '';
      if (!contents.includes('.flatMap(findCloudFrontDomainNames)')) {
        nextSteps.push(
          `${USER_IDENTITY_FILE}: the callback URL logic has diverged from the generated shape - left untouched. Manually apply the shared findCloudFrontDomainNames helper (see common/constructs/src/core/cloudfront.ts).`,
        );
      }
      // Otherwise already migrated - silent skip.
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
