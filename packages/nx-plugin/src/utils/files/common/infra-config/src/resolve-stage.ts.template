import type { StageConfig, StagesConfig } from './stages.types.js';
import stagesConfig from './stages.config.js';

// Widen the narrow `as const` type to StagesConfig for dynamic key access
const config: StagesConfig = stagesConfig;

/**
 * Resolves stage config for a given project and stage name.
 * Project-specific fields take priority over shared ones.
 *
 * @param projectPath - Project path relative to workspace root (e.g., 'packages/infra')
 * @param stageName - CDK stage name (e.g., 'my-app-dev')
 * @returns Merged StageConfig or undefined if no config exists for this stage
 */
export function resolveStage(
  projectPath: string,
  stageName: string,
): StageConfig | undefined {
  const shared = config.shared?.stages?.[stageName];
  const project = config.projects?.[projectPath]?.stages?.[stageName];
  if (!shared && !project) return undefined;
  return { ...shared, ...project } as StageConfig;
}
