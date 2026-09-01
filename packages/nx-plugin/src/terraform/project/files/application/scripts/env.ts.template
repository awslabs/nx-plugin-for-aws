import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Environment variables for Terraform to cache plugins */
export const pluginCacheEnv = (projectRootRel: string): NodeJS.ProcessEnv => {
  const dir =
    process.env.TF_PLUGIN_CACHE_DIR ??
    join(process.cwd(), '.terraform', 'plugin-cache', projectRootRel);
  mkdirSync(dir, { recursive: true });
  return { ...process.env, TF_PLUGIN_CACHE_DIR: dir };
};
