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
 * Serialize a JSON-compatible value to a TypeScript source code string.
 */
const jsonToCodeString = (obj: unknown): string => {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') {
    const escaped = obj
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `'${escaped}'`;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(jsonToCodeString).join(', ')}]`;
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj).map(([key, value]) => {
      const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
      const keyStr = isValidIdentifier ? key : jsonToCodeString(key);
      return `${keyStr}: ${jsonToCodeString(value)}`;
    });
    return `{ ${entries.join(', ')} }`;
  }
  throw new Error(`Unsupported type: ${typeof obj}`);
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

  // Build the merged object as a TypeScript source string
  const mergedStr = jsonToCodeString(mergedConfig);

  // Use GritQL to replace the export default object with a placeholder,
  // then substitute the placeholder with the actual serialized config.
  // This avoids GritQL interpreting escape sequences in the replacement text.
  const placeholder = '__GRITQL_CONFIG_PLACEHOLDER__';

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

  // Substitute the placeholder with the actual config object
  const content = tree.read(filePath)!.toString();
  tree.write(filePath, content.replace(placeholder, mergedStr));

  // Format the config nicely after an update
  await formatFilesInSubtree(tree, filePath);
};
