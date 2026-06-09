/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import { applyGritQL, captureAllGritQL } from './ast';
import { formatFilesInSubtree } from './format';
import { getPackageVersion, type NxGeneratorInfo } from './nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from './shared-constructs-constants';

// Used to identify @aws/nx-plugin in AWS metrics
export const METRIC_ID = 'uksb-4wk0bqpg5s';

// File in which the MetricsAspect may exist (CDK)
export const METRICS_ASPECT_FILE_PATH = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'core',
  'app.ts',
);

// File in which the Terraform metrics CloudFormation stack may exist
export const TERRAFORM_METRICS_FILE_PATH = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
  'metrics',
  'metrics.tf',
);

// GritQL `within` clause to scope matches to the MetricsAspect class body
const WITHIN_METRICS_ASPECT =
  '$old <: within `class MetricsAspect implements $_ { $_ }`';

// Strip the surrounding quotes from a captured string literal (eg 'g1' or "g1")
const unquote = (literal: string): string => literal.slice(1, -1);

// Extracts the existing metric tags from the CDK MetricsAspect tags array
const readCdkMetricTags = async (tree: Tree): Promise<string[]> =>
  (
    await captureAllGritQL(
      tree,
      METRICS_ASPECT_FILE_PATH,
      `\`$tag\` where { $tag <: string(), $tag <: within \`const tags: string[] = $_\` }`,
    )
  ).map(unquote);

// Extracts the existing metric tags from the Terraform metric_tags array
const readTerraformMetricTags = async (tree: Tree): Promise<string[]> =>
  (
    await captureAllGritQL(
      tree,
      TERRAFORM_METRICS_FILE_PATH,
      '`"$tag"` where { $tag <: within `metric_tags = $_` }',
    )
  ).map(unquote);

/**
 * Instruments metrics by updating the MetricsAspect in common/constructs/src/core/app.ts if the file exists,
 * and/or updating the Terraform metrics CloudFormation stack if it exists.
 *
 * Both files are converged to the same tag set (the union of tags already
 * present in either file plus the incoming generators). This keeps the tag set
 * deterministic regardless of the order in which metrics files are created
 * across a multi-generator run, so re-running the same set of generators does
 * not grow the tags.
 */
export const addGeneratorMetricsIfApplicable = async (
  tree: Tree,
  generatorInfo: NxGeneratorInfo[],
) => {
  const cdkExists = tree.exists(METRICS_ASPECT_FILE_PATH);
  const terraformExists = tree.exists(TERRAFORM_METRICS_FILE_PATH);

  if (!cdkExists && !terraformExists) {
    return;
  }

  // Converge both files to the union of all known tags so the set is stable
  // regardless of when each metrics file was created.
  const tags = [
    ...new Set([
      ...(await readCdkMetricTags(tree)),
      ...(await readTerraformMetricTags(tree)),
      ...generatorInfo.map((info) => info.metric),
    ]),
  ];

  if (cdkExists) {
    await updateCdkMetrics(tree, tags);
  }

  if (terraformExists) {
    await updateTerraformMetrics(tree, tags);
  }
};

/**
 * Updates the CDK MetricsAspect with the metric id, version and tags
 */
const updateCdkMetrics = async (tree: Tree, tags: string[]) => {
  // Update the id
  await applyGritQL(
    tree,
    METRICS_ASPECT_FILE_PATH,
    `\`const id = $old\` => \`const id = '${METRIC_ID}'\`` +
      ` where { ${WITHIN_METRICS_ASPECT} }`,
  );

  // Update the version
  await applyGritQL(
    tree,
    METRICS_ASPECT_FILE_PATH,
    `\`const version = $old\` => \`const version = '${getPackageVersion()}'\`` +
      ` where { ${WITHIN_METRICS_ASPECT} }`,
  );

  // Add each tag, leaving existing tags in place to keep re-runs stable
  for (const tag of tags) {
    await applyGritQL(
      tree,
      METRICS_ASPECT_FILE_PATH,
      `\`const tags: string[] = $old\`` +
        ` where { ${WITHIN_METRICS_ASPECT},` +
        ` if ($old <: \`[]\`) { $old => \`['${tag}']\` }` +
        ` else { $old <: \`[$items]\` where { $items += \`, '${tag}'\` } },` +
        ` $old <: not contains \`'${tag}'\` }`,
    );
  }

  await formatFilesInSubtree(tree, METRICS_ASPECT_FILE_PATH);
};

/**
 * Updates the Terraform metrics CloudFormation stack with the metric id, version and tags
 */
const updateTerraformMetrics = async (tree: Tree, tags: string[]) => {
  // Update metric_id
  await applyGritQL(
    tree,
    TERRAFORM_METRICS_FILE_PATH,
    `\`metric_id = $old\` => \`metric_id = "${METRIC_ID}"\``,
  );

  // Update metric_version
  await applyGritQL(
    tree,
    TERRAFORM_METRICS_FILE_PATH,
    `\`metric_version = $old\` => \`metric_version = "${getPackageVersion()}"\``,
  );

  // Add each tag, leaving existing tags in place to keep re-runs stable
  for (const tag of tags) {
    await applyGritQL(
      tree,
      TERRAFORM_METRICS_FILE_PATH,
      `or { \`metric_tags = []\` => \`metric_tags = ["${tag}"]\`,` +
        ` \`metric_tags = [$items]\` where { $items += \`, "${tag}"\` }` +
        ` where { $items <: not contains \`"${tag}"\` } }`,
    );
  }
};
