/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, joinPathFragments, Tree } from '@nx/devkit';
import { AwsNxPluginConfig } from '.';
import { applyGritQL } from '../ast';
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
  const filePath = AWS_NX_PLUGIN_CONFIG_FILE_NAME;

  // Read the current config to merge with the update
  const existingConfig = (await readAwsNxPluginConfig(tree)) ?? {};
  const mergedConfig: Record<string, unknown> = { ...existingConfig };
  for (const [key, value] of Object.entries(configUpdate)) {
    mergedConfig[key] = value;
  }

  // Use GritQL to replace the export default object with a JSON placeholder,
  // then substitute with the actual JSON. This avoids GritQL interpreting
  // escape sequences in the replacement text. Prettier handles final formatting.
  const placeholder = '"__PLACEHOLDER__"';
  const json = JSON.stringify(mergedConfig);

  // Try with `satisfies` first, then fall back to plain `export default`.
  const applied = await applyGritQL(
    tree,
    filePath,
    `\`export default $obj satisfies $type\` => \`export default ${placeholder} satisfies $type\``,
  );
  if (!applied) {
    await applyGritQL(
      tree,
      filePath,
      `\`export default $obj\` => \`export default ${placeholder}\``,
    );
  }

  // Replace the placeholder string with the actual JSON object
  const content = tree.read(filePath)!.toString();
  tree.write(filePath, content.replace(placeholder, json));

  // Prettier formats the JSON object into properly indented TypeScript
  await formatFilesInSubtree(tree, filePath);
};
