/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { importTypeScriptModule } from './js';

// Load the actual template files and strip EJS tags for import
const loadTemplate = (relativePath: string): string => {
  const content = readFileSync(
    join(__dirname, 'files', 'common', 'scripts', 'src', relativePath),
    'utf-8',
  );
  // Remove EJS template expressions (e.g., <%= scopeAlias %>) and replace
  // import lines that reference template vars with empty lines
  return content.replace(/^import.*<%.*%>.*$/gm, '').replace(/<%.*?%>/g, '');
};

describe('stage name parsing', () => {
  let parseStageName: (firstArg: string | undefined) => string | undefined;

  beforeAll(async () => {
    const mod = await importTypeScriptModule<any>(
      loadTemplate('stage-credentials/stage-parser.ts.template'),
    );
    parseStageName = mod.parseStageName;
  });

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

describe('CDK command construction', () => {
  let buildCdkCommand: (action: string, remainingArgs: string[]) => string[];

  beforeAll(async () => {
    const mod = await importTypeScriptModule<any>(
      loadTemplate('stage-credentials/cdk-command.ts.template'),
    );
    buildCdkCommand = mod.buildCdkCommand;
  });

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

describe('credential lookup priority', () => {
  let lookupCredentials: (
    config: any,
    projectPath: string,
    stageName: string,
  ) => { credentials: any; source: string };

  beforeAll(async () => {
    const mod = await importTypeScriptModule<any>(
      loadTemplate('stage-credentials/credentials.ts.template'),
    );
    lookupCredentials = mod.lookupCredentials;
  });

  const projectCreds = {
    type: 'profile',
    profile: 'proj-profile',
  };
  const sharedCreds = {
    type: 'profile',
    profile: 'shared-profile',
  };

  it('should return project-specific credentials when they exist', () => {
    const config = {
      projects: {
        'packages/infra': {
          stages: {
            dev: { credentials: projectCreds, region: 'us-east-1' },
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
    const config = {
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
    const config = { projects: {}, shared: { stages: {} } };
    const result = lookupCredentials(config, 'packages/infra', 'prod');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });

  it('should return environment fallback when config is undefined', () => {
    const result = lookupCredentials(undefined, 'packages/infra', 'dev');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });

  it('should handle assumeRole credentials', () => {
    const roleCreds = {
      type: 'assumeRole',
      assumeRole: 'arn:aws:iam::123456789012:role/Deploy',
    };
    const config = {
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
    const config = {
      projects: {
        'packages/my-infra': {
          stages: {
            dev: { credentials: projectCreds, region: 'us-east-1' },
          },
        },
      },
    };
    expect(
      lookupCredentials(config, 'packages/infra', 'dev').credentials,
    ).toBeUndefined();
    expect(
      lookupCredentials(config, 'packages/my-infra', 'dev').credentials,
    ).toEqual(projectCreds);
  });

  it('should fall back to shared when project exists but stage does not', () => {
    const config = {
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
    const config = {
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

  it('should handle empty stages config object', () => {
    const config = {};
    const result = lookupCredentials(config, 'packages/infra', 'dev');
    expect(result.credentials).toBeUndefined();
    expect(result.source).toBe('environment fallback');
  });
});
