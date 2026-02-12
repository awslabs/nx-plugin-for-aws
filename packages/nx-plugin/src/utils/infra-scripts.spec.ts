/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types and functions copied from the infra-scripts templates.
// The templates can't be imported directly (they contain EJS syntax).
// The canonical type definitions live in stages.types.ts.template.
//
// ⚠️  If you change the template files, update these copies too.
//     Canonical sources:
//       - packages/nx-plugin/src/utils/files/common/infra-config/src/stages.types.ts.template
//       - packages/nx-plugin/src/utils/files/common/infra-scripts/src/lib/stage-parser.ts.template
//       - packages/nx-plugin/src/utils/files/common/infra-scripts/src/lib/credentials.ts.template
//       - packages/nx-plugin/src/utils/files/common/infra-scripts/src/lib/cdk-command.ts.template
// ---------------------------------------------------------------------------

type ProfileCredentials = {
  type: 'profile';
  profile: string;
};

type AssumeRoleCredentials = {
  type: 'assumeRole';
  assumeRole: string;
  profile?: string;
  externalId?: string;
  sessionDuration?: number;
};

type StageCredentials = ProfileCredentials | AssumeRoleCredentials;

type StageConfig = {
  credentials: StageCredentials;
  region: string;
  account?: string;
};

type ProjectConfig = {
  stages: { [stageName: string]: StageConfig };
};

type StagesConfig = {
  projects?: { [projectPath: string]: ProjectConfig };
  shared?: { stages: { [stageName: string]: StageConfig } };
};

function parseStageName(firstArg: string | undefined): string | undefined {
  if (!firstArg || firstArg.startsWith('-')) return undefined;
  return firstArg.includes('/') ? firstArg.split('/')[0] : firstArg;
}

function lookupCredentials(
  config: StagesConfig | undefined,
  projectPath: string,
  stageName: string,
): { credentials: StageCredentials | undefined; source: string } {
  const projectCreds =
    config?.projects?.[projectPath]?.stages?.[stageName]?.credentials;
  if (projectCreds) {
    return { credentials: projectCreds, source: 'project-specific' };
  }
  const sharedCreds = config?.shared?.stages?.[stageName]?.credentials;
  if (sharedCreds) {
    return { credentials: sharedCreds, source: 'shared' };
  }
  return { credentials: undefined, source: 'environment fallback' };
}

function buildCdkCommand(action: string, remainingArgs: string[]): string[] {
  const hasRequireApproval = remainingArgs.some(
    (a) => a === '--require-approval' || a.startsWith('--require-approval='),
  );
  return hasRequireApproval
    ? ['cdk', action, ...remainingArgs]
    : ['cdk', action, '--require-approval=never', ...remainingArgs];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stage name parsing', () => {
  it('should extract stage name before /', () => {
    expect(parseStageName('my-app-dev/*')).toBe('my-app-dev');
  });

  it('should use full arg when no / present', () => {
    expect(parseStageName('my-app-dev')).toBe('my-app-dev');
  });

  it('should return undefined when arg is undefined', () => {
    expect(parseStageName(undefined)).toBeUndefined();
  });

  it('should return undefined when first arg is a flag', () => {
    expect(parseStageName('--verbose')).toBeUndefined();
  });

  it('should return undefined for short flags', () => {
    expect(parseStageName('-c')).toBeUndefined();
  });

  it('should handle multiple / characters', () => {
    expect(parseStageName('my-app-dev/stack/nested')).toBe('my-app-dev');
  });

  it('should return empty string for input starting with /', () => {
    expect(parseStageName('/*')).toBe('');
  });

  it('should return empty string for empty string input', () => {
    expect(parseStageName('')).toBeUndefined();
  });

  it('should handle stage name with special characters', () => {
    expect(parseStageName('my-app_v2.0/*')).toBe('my-app_v2.0');
  });
});

describe('credential lookup priority', () => {
  const projectCreds: StageCredentials = {
    type: 'profile',
    profile: 'proj-profile',
  };
  const sharedCreds: StageCredentials = {
    type: 'profile',
    profile: 'shared-profile',
  };

  it('should return project-specific credentials when they exist', () => {
    const config: StagesConfig = {
      projects: {
        'packages/infra': {
          stages: {
            dev: {
              credentials: projectCreds,
              region: 'us-east-1',
            },
          },
        },
      },
      shared: {
        stages: {
          dev: { credentials: sharedCreds, region: 'us-east-1' },
        },
      },
    };
    const result = lookupCredentials(config, 'packages/infra', 'dev');
    expect(result.credentials).toEqual(projectCreds);
    expect(result.source).toBe('project-specific');
  });

  it('should return shared credentials when no project-specific entry exists', () => {
    const config: StagesConfig = {
      projects: {},
      shared: {
        stages: {
          sandbox: { credentials: sharedCreds, region: 'us-east-1' },
        },
      },
    };
    const result = lookupCredentials(config, 'packages/infra', 'sandbox');
    expect(result.credentials).toEqual(sharedCreds);
    expect(result.source).toBe('shared');
  });

  it('should return environment fallback when no entry exists', () => {
    const config: StagesConfig = { projects: {}, shared: { stages: {} } };
    const result = lookupCredentials(config, 'packages/infra', 'prod');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });

  it('should return environment fallback when config is undefined', () => {
    const result = lookupCredentials(undefined, 'packages/infra', 'dev');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });

  it('should not match inherited object properties', () => {
    const config: StagesConfig = { projects: {}, shared: { stages: {} } };
    const result = lookupCredentials(config, 'packages/infra', 'toString');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });

  it('should handle assumeRole credentials', () => {
    const roleCreds: StageCredentials = {
      type: 'assumeRole',
      assumeRole: 'arn:aws:iam::123456789012:role/Deploy',
    };
    const config: StagesConfig = {
      projects: {
        'packages/infra': {
          stages: {
            prod: { credentials: roleCreds, region: 'us-west-2' },
          },
        },
      },
    };
    const result = lookupCredentials(config, 'packages/infra', 'prod');
    expect(result.credentials).toEqual(roleCreds);
    expect(result.source).toBe('project-specific');
  });

  it('should use project path as key, not project name', () => {
    const config: StagesConfig = {
      projects: {
        'packages/my-infra': {
          stages: {
            dev: { credentials: projectCreds, region: 'us-east-1' },
          },
        },
      },
    };
    // Wrong path should not match
    expect(
      lookupCredentials(config, 'packages/infra', 'dev').credentials,
    ).toBeUndefined();
    // Correct path should match
    expect(
      lookupCredentials(config, 'packages/my-infra', 'dev').credentials,
    ).toEqual(projectCreds);
  });

  it('should fall back to shared when project exists but stage does not', () => {
    const config: StagesConfig = {
      projects: {
        'packages/infra': {
          stages: {
            dev: { credentials: projectCreds, region: 'us-east-1' },
          },
        },
      },
      shared: {
        stages: {
          sandbox: { credentials: sharedCreds, region: 'eu-west-1' },
        },
      },
    };
    const result = lookupCredentials(config, 'packages/infra', 'sandbox');
    expect(result.credentials).toEqual(sharedCreds);
    expect(result.source).toBe('shared');
  });

  it('should handle config with no shared section', () => {
    const config: StagesConfig = {
      projects: {
        'packages/infra': {
          stages: {
            dev: { credentials: projectCreds, region: 'us-east-1' },
          },
        },
      },
    };
    const result = lookupCredentials(config, 'packages/infra', 'sandbox');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });

  it('should handle config with no projects section', () => {
    const config: StagesConfig = {
      shared: {
        stages: {
          sandbox: { credentials: sharedCreds, region: 'eu-west-1' },
        },
      },
    };
    const result = lookupCredentials(config, 'packages/infra', 'sandbox');
    expect(result.credentials).toEqual(sharedCreds);
    expect(result.source).toBe('shared');
  });

  it('should handle empty stages config object', () => {
    const config: StagesConfig = {};
    const result = lookupCredentials(config, 'packages/infra', 'dev');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });
});

describe('CDK command construction', () => {
  it('should build basic deploy command with default --require-approval', () => {
    expect(buildCdkCommand('deploy', ['my-app-dev/*'])).toEqual([
      'cdk',
      'deploy',
      '--require-approval=never',
      'my-app-dev/*',
    ]);
  });

  it('should build destroy command', () => {
    expect(buildCdkCommand('destroy', ['my-app-dev/*', '--force'])).toEqual([
      'cdk',
      'destroy',
      '--require-approval=never',
      'my-app-dev/*',
      '--force',
    ]);
  });

  it('should respect user-provided --require-approval=value', () => {
    expect(
      buildCdkCommand('deploy', [
        '--require-approval=broadening',
        'my-app-dev/*',
      ]),
    ).toEqual([
      'cdk',
      'deploy',
      '--require-approval=broadening',
      'my-app-dev/*',
    ]);
  });

  it('should respect bare --require-approval flag', () => {
    expect(
      buildCdkCommand('deploy', ['--require-approval', 'my-app-dev/*']),
    ).toEqual(['cdk', 'deploy', '--require-approval', 'my-app-dev/*']);
  });

  it('should handle empty remaining args', () => {
    expect(buildCdkCommand('deploy', [])).toEqual([
      'cdk',
      'deploy',
      '--require-approval=never',
    ]);
  });

  it('should preserve all other flags', () => {
    expect(
      buildCdkCommand('deploy', ['my-app-dev/*', '--verbose', '--ci']),
    ).toEqual([
      'cdk',
      'deploy',
      '--require-approval=never',
      'my-app-dev/*',
      '--verbose',
      '--ci',
    ]);
  });

  it('should handle --require-approval=never explicitly', () => {
    expect(
      buildCdkCommand('deploy', ['--require-approval=never', 'my-app-dev/*']),
    ).toEqual(['cdk', 'deploy', '--require-approval=never', 'my-app-dev/*']);
  });

  it('should work with any action string', () => {
    expect(buildCdkCommand('synth', ['my-app-dev/*'])).toEqual([
      'cdk',
      'synth',
      '--require-approval=never',
      'my-app-dev/*',
    ]);
  });
});
