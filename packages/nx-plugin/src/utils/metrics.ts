/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, joinPathFragments } from '@nx/devkit';
import { applyGritQL } from './ast';
import { formatFilesInSubtree } from './format';
import { NxGeneratorInfo, getPackageVersion } from './nx';
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

/**
 * Instruments metrics by updating the MetricsAspect in common/constructs/src/core/app.ts if the file exists,
 * or updating the Terraform metrics CloudFormation stack if it exists
 */
export const addGeneratorMetricsIfApplicable = async (
  tree: Tree,
  generatorInfo: NxGeneratorInfo[],
) => {
  // Handle CDK metrics
  if (tree.exists(METRICS_ASPECT_FILE_PATH)) {
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

    // Add each generator as a tag
    for (const info of generatorInfo) {
      await applyGritQL(
        tree,
        METRICS_ASPECT_FILE_PATH,
        `\`const tags: string[] = $old\`` +
          ` where { ${WITHIN_METRICS_ASPECT},` +
          ` if ($old <: \`[]\`) { $old => \`['${info.metric}']\` }` +
          ` else { $old <: \`[$items]\` where { $items += \`, '${info.metric}'\` } },` +
          ` $old <: not contains \`'${info.metric}'\` }`,
      );
    }

    await formatFilesInSubtree(tree, METRICS_ASPECT_FILE_PATH);
  }

  // Handle Terraform metrics
  if (tree.exists(TERRAFORM_METRICS_FILE_PATH)) {
    await updateTerraformMetrics(tree, generatorInfo);
  }
};

/**
 * Updates the Terraform metrics CloudFormation stack with generator information
 */
const updateTerraformMetrics = async (
  tree: Tree,
  generatorInfo: NxGeneratorInfo[],
) => {
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

  // Update metric_tags
  for (const info of generatorInfo) {
    await applyGritQL(
      tree,
      TERRAFORM_METRICS_FILE_PATH,
      `or { \`metric_tags = []\` => \`metric_tags = ["${info.metric}"]\`,` +
        ` \`metric_tags = [$items]\` where { $items += \`, "${info.metric}"\` }` +
        ` where { $items <: not contains \`"${info.metric}"\` } }`,
    );
  }
};
