/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import {
  addDestructuredImport,
  applyGritQL,
  captureGritQL,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Order the S3 server access log delivery source after the bucket policy.
 *
 * S3 rejects concurrent configuration writes against the same bucket with a 409
 * (OperationAborted). The generated StaticWebsite construct left the delivery
 * source and the bucket policy unordered, so CloudFormation could submit both at
 * once and fail the stack.
 */

const STATIC_WEBSITE_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/static-website.ts`;

const BUCKET_ARN_SUFFIX = '.bucketArn';

/**
 * The bucket whose policy the delivery source must be ordered after is the one
 * the delivery source itself targets, so read it off `resourceArn` rather than
 * assuming the generated parameter name. Returns undefined unless exactly one
 * simple identifier is found, so a diverged helper is left alone.
 */
const findDeliverySourceBucket = async (
  tree: Tree,
  filePath: string,
): Promise<string | undefined> => {
  const captured = await captureGritQL(
    tree,
    filePath,
    '`resourceArn: $bucket.bucketArn`',
  );
  if (!captured) return undefined;

  const bucket = captured
    .slice(captured.indexOf(':') + 1)
    .replace(BUCKET_ARN_SUFFIX, '')
    .trim();

  // Only a plain identifier can be cast and dereferenced safely in the
  // statement this migration writes.
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(bucket) ? bucket : undefined;
};

/**
 * Confirm the bucket the delivery source targets is declared as a parameter of
 * the enclosing helper, so the statement this migration writes references a
 * variable that is actually in scope.
 */
const isBucketDeclaredParameter = async (
  tree: Tree,
  filePath: string,
  bucket: string,
): Promise<boolean> =>
  await matchGritQL(
    tree,
    filePath,
    `\`private deliverAccessLogsToCloudWatch($params) { $_ }\` where {
      $params <: contains \`${bucket}: $bucketType\`,
      $bucketType <: or { \`IBucket\`, \`Bucket\` }
    }`,
  );

// Inserts the bucket policy dependency between the delivery source and the
// delivery destination, matching the shape generators produced prior to this
// fix. Anchored on the destination declaration so the source's own (multi-line,
// Lazy-valued) arguments don't need to be matched.
const addDependencyPattern = (bucket: string) =>
  `\`const $dest: CfnDeliveryDestination = new CfnDeliveryDestination($destArgs)\` as $decl where {
  $dest <: \`destination\`
} => \`const bucketPolicy = (${bucket} as Bucket).policy;
    if (bucketPolicy) {
      source.node.addDependency(bucketPolicy);
    }
    $decl\``;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(STATIC_WEBSITE_FILE)) {
    // No vended StaticWebsite construct in this workspace - nothing to migrate.
    return { nextSteps };
  }

  const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
  if (contents.includes('source.node.addDependency(bucketPolicy)')) {
    // Already migrated.
    return { nextSteps };
  }

  const divergedMessage = `${STATIC_WEBSITE_FILE}: deliverAccessLogsToCloudWatch has diverged from the generated shape - left untouched. Manually order the S3 server access log delivery source after the bucket policy of the bucket it targets (\`source.node.addDependency(bucketPolicy)\`), avoiding a 409 (OperationAborted) from concurrent bucket configuration writes.`;

  // The rewrite is anchored on the delivery destination but references the
  // `source` variable, so only apply it when the delivery source still has the
  // generated shape.
  const hasGeneratedSource = await matchGritQL(
    tree,
    STATIC_WEBSITE_FILE,
    '`const source: CfnDeliverySource = new CfnDeliverySource($_)`',
  );

  const bucket = hasGeneratedSource
    ? await findDeliverySourceBucket(tree, STATIC_WEBSITE_FILE)
    : undefined;

  if (
    !bucket ||
    !(await isBucketDeclaredParameter(tree, STATIC_WEBSITE_FILE, bucket))
  ) {
    nextSteps.push(divergedMessage);
    return { nextSteps };
  }

  const rewrote = await applyGritQL(
    tree,
    STATIC_WEBSITE_FILE,
    addDependencyPattern(bucket),
  );

  if (!rewrote) {
    nextSteps.push(divergedMessage);
    return { nextSteps };
  }

  // The inserted statement casts to the concrete Bucket to reach its policy,
  // which the helper's own `IBucket` parameter type does not expose.
  await addDestructuredImport(
    tree,
    STATIC_WEBSITE_FILE,
    ['Bucket'],
    'aws-cdk-lib/aws-s3',
  );

  nextSteps.push(
    `${STATIC_WEBSITE_FILE}: the S3 server access log delivery source is now created after the policy of the bucket it targets, avoiding a 409 (OperationAborted) from concurrent bucket configuration writes.`,
  );

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
