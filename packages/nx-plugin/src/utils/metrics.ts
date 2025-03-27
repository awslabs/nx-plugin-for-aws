/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, joinPathFragments } from '@nx/devkit';
import { ArrayLiteralExpression, StringLiteral, factory } from 'typescript';
import { replaceIfExists } from './ast';
import { formatFilesInSubtree } from './format';
import { NxGeneratorInfo, getPackageVersion } from './nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from './shared-constructs-constants';

// Used to identify @aws/nx-plugin in AWS metrics
export const METRIC_ID = 'uksb-4wk0bqpg5s';

// File in which the MetricsAspect may exist
export const METRICS_ASPECT_FILE_PATH = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'core',
  'app.ts',
);

// Query to find a particular metrics aspect variable
export const metricsAspectVariableQuery = (
  variableName: string,
  valueQuery: string,
) =>
  `ClassDeclaration[name.name="MetricsAspect"] MethodDeclaration[name.name="visit"] VariableDeclaration:has(Identifier[name="${variableName}"]) ${valueQuery}`;

/**
 * Instruments metrics by updating the MetricsAspect in common/constructs/src/core/app.ts if the file exists
 */
export const addGeneratorMetricsIfApplicable = async (
  tree: Tree,
  generatorInfo: NxGeneratorInfo[],
) => {
  if (tree.exists(METRICS_ASPECT_FILE_PATH)) {
    // Update the id
    replaceIfExists(
      tree,
      METRICS_ASPECT_FILE_PATH,
      metricsAspectVariableQuery('id', 'StringLiteral'),
      (): StringLiteral => {
        return factory.createStringLiteral(METRIC_ID, true);
      },
    );
    // Update the version
    replaceIfExists(
      tree,
      METRICS_ASPECT_FILE_PATH,
      metricsAspectVariableQuery('version', 'StringLiteral'),
      (): StringLiteral => {
        return factory.createStringLiteral(getPackageVersion(), true);
      },
    );
    // Add each generator as a tag
    replaceIfExists(
      tree,
      METRICS_ASPECT_FILE_PATH,
      metricsAspectVariableQuery('tags', 'ArrayLiteralExpression'),
      (node: ArrayLiteralExpression): ArrayLiteralExpression => {
        const existingMetrics = new Set(
          node.elements.map((element) => (element as StringLiteral)?.text),
        );

        return factory.createArrayLiteralExpression([
          ...node.elements,
          ...generatorInfo
            .filter((info) => !existingMetrics.has(info.metric))
            .map((info) => factory.createStringLiteral(info.metric, true)),
        ]);
      },
    );
    await formatFilesInSubtree(tree, METRICS_ASPECT_FILE_PATH);
  }
};
