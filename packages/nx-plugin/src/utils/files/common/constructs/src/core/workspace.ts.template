import * as fs from 'fs';
import * as path from 'path';

/**
 * Find the workspace root by walking up from the given file path
 * until we find nx.json (the marker for an Nx workspace root).
 */
export const findWorkspaceRoot = (startPath: string): string => {
  let dir = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find workspace root (nx.json) from ${startPath}`);
};
