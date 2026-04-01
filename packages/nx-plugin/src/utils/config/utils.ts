/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, joinPathFragments, Tree } from '@nx/devkit';
import { AwsNxPluginConfig } from '.';
import { applyGritQL, matchGritQL } from '../ast';
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

const PLACEHOLDER = '"__PLACEHOLDER__"';

/**
 * Use GritQL to set a top-level property in the export default object,
 * then substitute the placeholder with the JSON-serialized value.
 * Preserves all other properties (including JS expressions) untouched.
 */
const setConfigProperty = async (
  tree: Tree,
  filePath: string,
  key: string,
  value: unknown,
): Promise<void> => {
  const json = JSON.stringify(value);

  // Check if the property already exists using a named metavariable
  // to avoid ambiguity with anonymous $_ in nested where clauses
  const existsInSatisfies = await matchGritQL(
    tree,
    filePath,
    `\`${key}: $val\` where { $val <: within \`export default $_ satisfies $_\` }`,
  );
  const existsInPlain =
    !existsInSatisfies &&
    (await matchGritQL(
      tree,
      filePath,
      `\`${key}: $val\` where { $val <: within \`export default $_\` }`,
    ));

  if (existsInSatisfies || existsInPlain) {
    // Replace only this property's value, scoped to the export default
    const within = existsInSatisfies
      ? `within \`export default $_ satisfies $_\``
      : `within \`export default $_\``;
    await applyGritQL(
      tree,
      filePath,
      `\`${key}: $old\` => \`${key}: ${PLACEHOLDER}\` where { $old <: ${within} }`,
    );
  } else {
    // Add the new property using GritQL's += (accumulate) operator.
    // For non-empty objects, += appends correctly without double commas.
    // For empty objects, += fails so we fall back to a direct replacement.
    let added = await applyGritQL(
      tree,
      filePath,
      `\`export default { $props } satisfies $type\` where { $props += \`, ${key}: ${PLACEHOLDER}\` }`,
    );

    if (!added) {
      added = await applyGritQL(
        tree,
        filePath,
        `\`export default { } satisfies $type\` => \`export default { ${key}: ${PLACEHOLDER} } satisfies $type\``,
      );
    }

    if (!added) {
      added = await applyGritQL(
        tree,
        filePath,
        `\`export default { $props }\` where { $props += \`, ${key}: ${PLACEHOLDER}\` }`,
      );
    }

    if (!added) {
      await applyGritQL(
        tree,
        filePath,
        `\`export default { }\` => \`export default { ${key}: ${PLACEHOLDER} }\``,
      );
    }
  }

  // Substitute the placeholder with the actual JSON value
  const content = tree.read(filePath)!.toString();
  tree.write(filePath, content.replace(PLACEHOLDER, json));
};

/**
 * Update the aws nx plugin config file.
 * Only the specified top-level keys are replaced; all other properties
 * (including those containing JS expressions) are left untouched in source.
 */
export const updateAwsNxPluginConfig = async (
  tree: Tree,
  configUpdate: Partial<AwsNxPluginConfig>,
): Promise<void> => {
  const filePath = AWS_NX_PLUGIN_CONFIG_FILE_NAME;

  for (const [key, value] of Object.entries(configUpdate)) {
    await setConfigProperty(tree, filePath, key, value);
  }

  // Prettier formats the result into properly indented TypeScript
  await formatFilesInSubtree(tree, filePath);
};
