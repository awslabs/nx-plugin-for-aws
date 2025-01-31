/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, joinPathFragments, Tree } from '@nx/devkit';
import { AwsNxPluginConfig } from '.';
import * as ts from 'typescript';
import { jsonToAst, replace } from '../ast';
import { factory } from 'typescript';
import { formatFilesInSubtree } from '../format';
import { importTypeScriptModule } from '../js';

export const AWS_NX_PLUGIN_CONFIG_FILE_NAME = 'aws-nx-plugin.config.mts';

/**
 * Ensure that the config file exists
 */
export const ensureAwsNxPluginConfig = async (
  tree: Tree,
): Promise<AwsNxPluginConfig> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) {
    // Create an empty config file if it doesn't already exist
    generateFiles(tree, joinPathFragments(__dirname, 'files'), '.', {});
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return await readAwsNxPluginConfig(tree)!;
};

/**
 * Read config from the aws nx plugin configuration file
 */
export const readAwsNxPluginConfig = async (
  tree: Tree,
): Promise<AwsNxPluginConfig | undefined> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) {
    return undefined;
  }
  const configTs = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8');
  return await importTypeScriptModule(configTs);
};

/**
 * Update the aws nx plugin config file.
 * Undefined top level keys in the config update will be untouched, otherwise config is replaced
 */
export const updateAwsNxPluginConfig = async (
  tree: Tree,
  configUpdate: Partial<AwsNxPluginConfig>,
): Promise<void> => {
  // Replace the default export
  replace(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    'ExportAssignment ObjectLiteralExpression',
    (node) => {
      const existingObj = node as ts.ObjectLiteralExpression;

      const existingProps = new Map<string, ts.PropertyAssignment>();
      existingObj.properties.forEach((prop) => {
        if (ts.isPropertyAssignment(prop)) {
          existingProps.set(prop.name.getText(), prop);
        }
      });

      const properties: ts.PropertyAssignment[] = [];

      for (const [key, value] of Object.entries(configUpdate)) {
        properties.push(
          factory.createPropertyAssignment(
            key,
            jsonToAst(value) as ts.Expression,
          ),
        );
      }

      existingObj.properties.forEach((prop) => {
        if (ts.isPropertyAssignment(prop)) {
          const name = prop.name.getText();
          if (configUpdate[name] === undefined) {
            properties.push(prop);
          }
        }
      });

      return factory.createObjectLiteralExpression(properties, true);
    },
  );

  // Format the config nicely after an update
  await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
};
