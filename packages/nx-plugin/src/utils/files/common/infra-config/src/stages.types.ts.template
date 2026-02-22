/**
 * Type definitions for stage and project configuration.
 *
 * These types are used by both stages.config.ts and the infra-deploy/
 * infra-destroy scripts. They live in a shared package so any
 * project in the workspace can import them.
 */

/** Use an AWS CLI profile from ~/.aws/config */
export type ProfileCredentials = {
  type: 'profile';
  /** AWS CLI profile name */
  profile: string;
};

/** Assume an IAM role via STS, optionally using a profile as the source credentials */
export type AssumeRoleCredentials = {
  type: 'assumeRole';
  /** IAM Role ARN to assume */
  assumeRole: string;
  /** Optional: AWS CLI profile to use as source credentials for the AssumeRole call */
  profile?: string;
  /** Optional: External ID required by the role's trust policy */
  externalId?: string;
  /** Optional: Session duration in seconds (default: 3600). Increase for long deployments. */
  sessionDuration?: number;
};

/**
 * Credentials for deploying to a specific CDK stage.
 * The `type` field determines which credential strategy is used.
 */
export type StageCredentials = ProfileCredentials | AssumeRoleCredentials;

/**
 * Configuration for a single CDK stage.
 * Includes credentials, region, and optionally account.
 */
export type StageConfig = {
  /** How to authenticate when deploying this stage */
  credentials: StageCredentials;
  /** AWS region for this stage (e.g., 'us-east-1') */
  region: string;
  /** AWS account ID. If omitted, CDK infers it from the active credentials. */
  account?: string;
};

/**
 * Configuration for a single infrastructure project.
 * The key in the parent map is the project path relative to workspace root
 * (e.g., 'packages/infra').
 */
export type ProjectConfig = {
  /** Map of CDK stage names to their configuration */
  stages: { [stageName: string]: StageConfig };
};

/** Top-level configuration mapping projects and stages to their settings. */
export type StagesConfig = {
  /** Project-specific config. Key is the project path relative to workspace root. */
  projects?: { [projectPath: string]: ProjectConfig };
  /** Shared stage config available to all projects. */
  shared?: {
    stages: { [stageName: string]: StageConfig };
  };
};
