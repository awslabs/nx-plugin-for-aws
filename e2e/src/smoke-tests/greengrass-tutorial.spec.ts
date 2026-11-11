/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import {
  buildPackageManagerShortCommand,
  createTestWorkspace,
  pinAwsScopeToLocalRegistry,
  runCLI,
  runInstall,
  tmpProjPath,
} from '../utils';

/**
 * Executes the command, edit, build and synth steps of the Greengrass tutorial
 * under `docs/src/content/docs/en/get_started/tutorials/greengrass/`. The
 * tutorial renders its edits as diffs between the `*.original.template` and
 * `*.template` fixtures beside this suite, so the fixtures are the single
 * source for both the page and the test.
 *
 * Device provisioning, MQTT delivery and cleanup need an AWS account and a core
 * device, so they stay a manual walkthrough.
 */

const isUpdateSnapshot = () =>
  (globalThis as any).__vitest_worker__?.config?.snapshotOptions
    ?.updateSnapshot === 'all';

const tutorialFile = (...segments: string[]) =>
  join(__dirname, '../files/greengrass-tutorial', ...segments);

/**
 * Asserts that the generated file matches the "before" template the tutorial
 * diffs against. With `-u`, the template is refreshed from the generated file.
 */
const expectFileMatchesOldTemplate = (
  generatedFilePath: string,
  oldTemplatePath: string,
) => {
  const actual = readFileSync(generatedFilePath, 'utf-8');
  if (isUpdateSnapshot()) {
    if (actual !== readFileSync(oldTemplatePath, 'utf-8')) {
      console.log(`Updating template: ${oldTemplatePath}`);
      writeFileSync(oldTemplatePath, actual);
    }
  } else {
    expect(actual).toEqual(readFileSync(oldTemplatePath, 'utf-8'));
  }
};

const writeFromTemplate = (destination: string, template: string) =>
  writeFileSync(destination, readFileSync(tutorialFile(template), 'utf-8'));

interface CfnResource {
  Type: string;
  Properties?: Record<string, any>;
  DependsOn?: string | string[];
}

interface CfnTemplate {
  Parameters?: Record<string, unknown>;
  Resources: Record<string, CfnResource>;
}

/** Every template in the cloud assembly, including nested stage assemblies. */
const readTemplates = (dir: string): CfnTemplate[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return readTemplates(path);
    }
    return entry.name.endsWith('.template.json')
      ? [JSON.parse(readFileSync(path, 'utf-8')) as CfnTemplate]
      : [];
  });

const resourcesOfType = (template: CfnTemplate, type: string) =>
  Object.entries(template.Resources).filter(
    ([, resource]) => resource.Type === type,
  );

const readApplicationTemplate = (projectRoot: string): CfnTemplate => {
  const templates = readTemplates(
    `${projectRoot}/dist/packages/infra/cdk.out`,
  ).filter(
    (template) =>
      resourcesOfType(template, 'AWS::GreengrassV2::Deployment').length > 0,
  );
  expect(templates).toHaveLength(1);
  return templates[0];
};

describe('smoke test - greengrass-tutorial', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/greengrass-tutorial-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    ensureDirSync(targetDir);
    pinAwsScopeToLocalRegistry(targetDir);
  });

  it('runs the documented generate, edit, build and synth steps', async () => {
    // Module 1: workspace, Python host, component and CDK infrastructure.
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'greengrass-tutorial',
      'cdk',
    );
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };
    const componentDir = `${projectRoot}/packages/telemetry/greengrass/pulse`;
    const testPath = `${projectRoot}/packages/telemetry/tests/greengrass/test_pulse.py`;
    const stackPath = `${projectRoot}/packages/infra/src/stacks/application-stack.ts`;

    await runCLI(
      'generate @aws/nx-plugin:py#project --name=telemetry --no-interactive',
      opts,
    );
    await runCLI(
      'generate @aws/nx-plugin:greengrass#component --project=telemetry --name=pulse --language=python --componentName=com.example.Pulse --componentVersion=NEXT_PATCH --platform=linux-amd64 --ipc=true --infra=component-version --iac=cdk --no-interactive',
      opts,
    );
    await runCLI(
      'generate @aws/nx-plugin:ts#infra --name=infra --no-interactive',
      opts,
    );

    // The tutorial shows each edit as a diff against generator output.
    expectFileMatchesOldTemplate(
      `${componentDir}/main.py`,
      tutorialFile('main.py.original.template'),
    );
    expectFileMatchesOldTemplate(
      `${componentDir}/recipe.yaml`,
      tutorialFile('recipe.yaml.original.template'),
    );
    expectFileMatchesOldTemplate(
      testPath,
      tutorialFile('test_pulse.py.original.template'),
    );
    expectFileMatchesOldTemplate(
      stackPath,
      tutorialFile('application-stack.ts.original.template'),
    );

    // Module 1: switch the component from local pub/sub to AWS IoT Core MQTT.
    writeFromTemplate(`${componentDir}/main.py`, 'main.py.template');
    writeFromTemplate(`${componentDir}/recipe.yaml`, 'recipe.yaml.template');
    writeFromTemplate(testPath, 'test_pulse.py.template');

    // Module 3: compose the repository, grant, component and deployment.
    writeFromTemplate(stackPath, 'application-stack.ts.template');

    // The documented sequence: sync, lint, then build. `build` on the infra
    // project runs `synth`, and the shared constructs depend on the host
    // project's build, so this also runs the component's pytest suite.
    await runCLI('sync --verbose', opts);
    await runInstall(opts);
    await runCLI(buildPackageManagerShortCommand(pkgMgr, 'lint'), {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --skip-nx-cache --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );

    const buildDir = `${projectRoot}/dist/packages/telemetry/greengrass/pulse/greengrass-build`;
    expect(
      existsSync(
        `${buildDir}/artifacts/com.example.Pulse/NEXT_PATCH/pulse.zip`,
      ),
    ).toBe(true);
    const recipes = readdirSync(`${buildDir}/recipes`);
    expect(recipes).toHaveLength(1);
    expect(
      readFileSync(`${buildDir}/recipes/${recipes[0]}`, 'utf-8'),
    ).toContain('aws.greengrass#PublishToIoTCore');

    // The synthesized deployment wiring.
    const initial = readApplicationTemplate(projectRoot);
    expect(Object.keys(initial.Parameters ?? {})).toEqual(
      expect.arrayContaining(['TokenExchangeRoleArn', 'ThingGroupArn']),
    );

    const componentVersions = resourcesOfType(
      initial,
      'AWS::GreengrassV2::ComponentVersion',
    );
    expect(componentVersions).toHaveLength(1);
    const [componentVersionId, componentVersion] = componentVersions[0];
    const inlineRecipe = JSON.stringify(
      componentVersion.Properties?.InlineRecipe,
    );
    expect(inlineRecipe).toContain('com.example.Pulse');
    expect(inlineRecipe).toContain('aws.greengrass#PublishToIoTCore');
    expect(inlineRecipe).toContain('tutorial/greengrass/heartbeat');
    expect(inlineRecipe).not.toContain('aws.greengrass#PublishToTopic');

    const resolvers = resourcesOfType(initial, 'Custom::GreengrassNextVersion');
    expect(resolvers).toHaveLength(1);
    const [, resolver] = resolvers[0];
    expect(resolver.Properties?.Strategy).toBe('patch');
    expect(resolver.Properties?.ContentSha256).toMatch(/^[0-9a-f]{64}$/);

    const [, deployment] = resourcesOfType(
      initial,
      'AWS::GreengrassV2::Deployment',
    )[0];
    expect(deployment.Properties?.TargetArn).toEqual({ Ref: 'ThingGroupArn' });
    // NEXT_PATCH: the deployment carries the published resource's attribute,
    // not a literal, and an explicit ordering edge onto that resource.
    expect(deployment.Properties?.Components).toEqual({
      'com.example.Pulse': {
        ComponentVersion: {
          'Fn::GetAtt': [componentVersionId, 'ComponentVersion'],
        },
      },
    });
    expect([deployment.DependsOn ?? []].flat()).toContain(componentVersionId);
    // The stack targets the existing group the setup script created.
    expect(resourcesOfType(initial, 'AWS::IoT::ThingGroup')).toHaveLength(0);

    // The token exchange role read grant, scoped to this component's prefix.
    const grants = resourcesOfType(initial, 'AWS::IAM::Policy').map(
      ([, policy]) => JSON.stringify(policy.Properties?.PolicyDocument),
    );
    expect(
      grants.some(
        (document) =>
          document.includes('s3:GetObject') &&
          document.includes('com.example.Pulse/*'),
      ),
    ).toBe(true);

    // Module 3: a source-only change. `synth` depends on the host project's
    // assemble, so the artifact is rebuilt and NEXT_PATCH sees new content.
    writeFromTemplate(`${componentDir}/main.py`, 'main.py.updated.template');
    await runCLI(
      'run @greengrass-tutorial/infra:synth --output-style=stream --skip-nx-cache --verbose',
      opts,
    );
    const updated = readApplicationTemplate(projectRoot);
    const [, updatedResolver] = resourcesOfType(
      updated,
      'Custom::GreengrassNextVersion',
    )[0];
    expect(updatedResolver.Properties?.ContentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(updatedResolver.Properties?.ContentSha256).not.toBe(
      resolver.Properties?.ContentSha256,
    );
    const [, updatedComponentVersion] = resourcesOfType(
      updated,
      'AWS::GreengrassV2::ComponentVersion',
    )[0];
    expect(
      JSON.stringify(updatedComponentVersion.Properties?.InlineRecipe),
    ).not.toBe(inlineRecipe);

    // Clean up: the revision that removes the component from the device
    // keeps the published version and deploys an empty component map.
    writeFromTemplate(stackPath, 'application-stack.ts.removed.template');
    await runCLI(
      'run @greengrass-tutorial/infra:synth --output-style=stream --skip-nx-cache --verbose',
      opts,
    );
    const removal = readApplicationTemplate(projectRoot);
    const [, emptyDeployment] = resourcesOfType(
      removal,
      'AWS::GreengrassV2::Deployment',
    )[0];
    expect(emptyDeployment.Properties?.Components).toBeUndefined();
    expect(
      resourcesOfType(removal, 'AWS::GreengrassV2::ComponentVersion'),
    ).toHaveLength(1);
  });
});
