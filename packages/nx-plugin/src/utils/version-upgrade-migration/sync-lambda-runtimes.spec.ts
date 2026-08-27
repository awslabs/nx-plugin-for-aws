/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import {
  cdkLambdaRuntime,
  LAMBDA_RUNTIME_VERSIONS,
  pyenvPythonVersion,
  pyprojectPythonDependency,
  terraformLambdaRuntime,
} from '../versions.js';
import { syncVendedVersions } from './sync-vended-versions.js';

const CDK_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/apis/my-api.ts`;
const TF_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/apis/my-api/my-api.tf`;

// A Lambda in a project the user owns, which must never be rewritten.
const USER_CDK_FILE = 'packages/my-own-infra/src/my-stack.ts';
const USER_TF_FILE = 'packages/my-own-infra/src/my-lambda.tf';

const VENDED_CDK_NODE = cdkLambdaRuntime('node');
const VENDED_TF_NODE = terraformLambdaRuntime('node');

const cdkConstruct = (
  runtime: string,
) => `import { Construct } from 'constructs';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';

export class MyApi extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new Function(this, 'Handler', {
      runtime: ${runtime},
      handler: 'index.handler',
      code: Code.fromAsset('bundle'),
    });
  }
}
`;

const terraformModule = (
  runtime: string,
) => `resource "aws_lambda_function" "api_lambda" {
  function_name = "my-api"
  handler       = "index.handler"
  runtime       = "${runtime}"
}
`;

describe('lambda runtime sync', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'my-own-infra', {
      root: 'packages/my-own-infra',
    });
  });

  it('should move a vended CDK runtime onto the pin', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));

    await syncVendedVersions(tree);

    const contents = tree.read(CDK_FILE, 'utf-8')!;
    expect(contents).toContain(`runtime: ${VENDED_CDK_NODE}`);
    expect(contents).not.toContain('NODEJS_LATEST');
  });

  it('should move a vended Terraform runtime onto the pin', async () => {
    tree.write(TF_FILE, terraformModule('nodejs22.x'));

    await syncVendedVersions(tree);

    expect(tree.read(TF_FILE, 'utf-8')).toMatch(
      new RegExp(`runtime\\s*=\\s*"${VENDED_TF_NODE}"`),
    );
  });

  it('should preserve the lambda namespace prefix', async () => {
    tree.write(
      CDK_FILE,
      cdkConstruct('lambda.Runtime.NODEJS_22_X').replace(
        "import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';",
        "import * as lambda from 'aws-cdk-lib/aws-lambda';",
      ),
    );

    await syncVendedVersions(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toContain(
      `runtime: lambda.${VENDED_CDK_NODE}`,
    );
  });

  it('should leave both providers naming the same runtime', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));
    tree.write(TF_FILE, terraformModule('nodejs22.x'));

    await syncVendedVersions(tree);

    const major = LAMBDA_RUNTIME_VERSIONS.node;
    expect(tree.read(CDK_FILE, 'utf-8')).toContain(`NODEJS_${major}_X`);
    expect(tree.read(TF_FILE, 'utf-8')).toContain(`"nodejs${major}.x"`);
  });

  // The scoping is the part most likely to go wrong: a runtime outside the two
  // directories this plugin owns is the user's, whatever shape it is in.
  describe('scoping', () => {
    it('should leave a user-owned CDK lambda untouched', async () => {
      const before = cdkConstruct('Runtime.NODEJS_22_X');
      tree.write(USER_CDK_FILE, before);

      const { nextSteps } = await syncVendedVersions(tree);

      expect(tree.read(USER_CDK_FILE, 'utf-8')).toEqual(before);
      expect(nextSteps?.join('\n') ?? '').not.toContain(USER_CDK_FILE);
    });

    it('should leave a user-owned Terraform lambda untouched', async () => {
      const before = terraformModule('nodejs22.x');
      tree.write(USER_TF_FILE, before);

      const { nextSteps } = await syncVendedVersions(tree);

      expect(tree.read(USER_TF_FILE, 'utf-8')).toEqual(before);
      expect(nextSteps?.join('\n') ?? '').not.toContain(USER_TF_FILE);
    });

    it('should sync an owned file while leaving a user file on the same runtime alone', async () => {
      tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_22_X'));
      const userBefore = cdkConstruct('Runtime.NODEJS_22_X');
      tree.write(USER_CDK_FILE, userBefore);

      await syncVendedVersions(tree);

      expect(tree.read(CDK_FILE, 'utf-8')).toContain(
        `runtime: ${VENDED_CDK_NODE}`,
      );
      expect(tree.read(USER_CDK_FILE, 'utf-8')).toEqual(userBefore);
    });
  });

  describe('runtimes the sync leaves alone', () => {
    // Ahead of the pin, so it is the user's deliberate choice.
    it('should not move a runtime ahead of the pin backwards', async () => {
      const ahead = `Runtime.NODEJS_${Number(LAMBDA_RUNTIME_VERSIONS.node) + 2}_X`;
      tree.write(CDK_FILE, cdkConstruct(ahead));

      const { nextSteps } = await syncVendedVersions(tree);

      expect(tree.read(CDK_FILE, 'utf-8')).toContain(ahead);
      expect(nextSteps).toEqual([]);
    });

    it('should not move a Terraform runtime ahead of the pin backwards', async () => {
      const ahead = `nodejs${Number(LAMBDA_RUNTIME_VERSIONS.node) + 2}.x`;
      tree.write(TF_FILE, terraformModule(ahead));

      await syncVendedVersions(tree);

      expect(tree.read(TF_FILE, 'utf-8')).toContain(ahead);
    });

    // Only a `runtime` assignment is matched, so a `Runtime` reference used for
    // anything else keeps whatever the user wrote.
    it('should leave a Runtime reference that is not a runtime assignment', async () => {
      const before = `import { Runtime } from 'aws-cdk-lib/aws-lambda';

export const supported = [Runtime.NODEJS_18_X, Runtime.NODEJS_20_X];
`;
      tree.write(CDK_FILE, before);

      await syncVendedVersions(tree);

      expect(tree.read(CDK_FILE, 'utf-8')).toEqual(before);
    });
  });

  // A `_LATEST` alias resolves against whichever aws-cdk-lib is installed rather
  // than this repo's pin, which is the drift the sync exists to close.
  it('should pin a _LATEST alias', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));

    await syncVendedVersions(tree);

    const contents = tree.read(CDK_FILE, 'utf-8')!;
    expect(contents).toContain(`runtime: ${VENDED_CDK_NODE}`);
    expect(contents).not.toContain('NODEJS_LATEST');
  });

  describe('uv project python version', () => {
    it('should move the interpreter and requires-python onto the runtime', async () => {
      tree.write('.python-version', '3.13.0\n');
      tree.write(
        'packages/api/pyproject.toml',
        `[project]
name = "api"
requires-python = ">=3.13"
dependencies = []
`,
      );

      await syncVendedVersions(tree);

      expect(tree.read('.python-version', 'utf-8')?.trim()).toEqual(
        pyenvPythonVersion(),
      );
      expect(tree.read('packages/api/pyproject.toml', 'utf-8')).toContain(
        `requires-python = "${pyprojectPythonDependency()}"`,
      );
    });

    // The Lambda Python runtime and the interpreter uv pins must agree, since
    // wheels are resolved against the latter.
    it('should keep the interpreter in step with the lambda python runtime', () => {
      expect(pyenvPythonVersion()).toMatch(
        new RegExp(`^${LAMBDA_RUNTIME_VERSIONS.python.replace('.', '\\.')}\\.`),
      );
      expect(pyprojectPythonDependency()).toEqual(
        `>=${LAMBDA_RUNTIME_VERSIONS.python}`,
      );
      expect(terraformLambdaRuntime('python')).toEqual(
        `python${LAMBDA_RUNTIME_VERSIONS.python}`,
      );
    });

    // uv writes a `.python-version` per project as well as at the root; one left
    // behind resolves a different interpreter than the function deploys on.
    it('should move a per-project .python-version too', async () => {
      tree.write('.python-version', '3.13.0\n');
      tree.write('packages/api/.python-version', '3.13.0\n');

      await syncVendedVersions(tree);

      expect(
        tree.read('packages/api/.python-version', 'utf-8')?.trim(),
      ).toEqual(pyenvPythonVersion());
    });

    it('should leave a requires-python the user tightened alone', async () => {
      const before = `[project]
name = "api"
requires-python = ">=3.13,<3.14"
dependencies = []
`;
      tree.write('packages/api/pyproject.toml', before);

      await syncVendedVersions(tree);

      expect(tree.read('packages/api/pyproject.toml', 'utf-8')).toContain(
        '>=3.13,<3.14',
      );
    });
  });

  describe('python bundle target', () => {
    const bundleProject = (command: string) => ({
      name: 'api',
      root: 'packages/api',
      targets: {
        'bundle-x86': {
          executor: 'nx:run-commands',
          options: { commands: [command], parallel: false },
        },
      },
    });

    const UV_INSTALL =
      'uv pip install -n --no-deps --python-platform x86_64-manylinux_2_28 --target dist/packages/api/bundle-x86 -r dist/packages/api/bundle-x86/requirements.txt';

    // Earlier releases pinned no `--python-version`, so wheels resolved against
    // the build machine's interpreter rather than the Lambda runtime.
    it('should add a missing --python-version', async () => {
      tree.write(
        'packages/api/project.json',
        JSON.stringify(bundleProject(UV_INSTALL), null, 2),
      );

      await syncVendedVersions(tree);

      expect(tree.read('packages/api/project.json', 'utf-8')).toContain(
        `--python-version ${LAMBDA_RUNTIME_VERSIONS.python}`,
      );
    });

    it('should move a stale --python-version forward', async () => {
      tree.write(
        'packages/api/project.json',
        JSON.stringify(
          bundleProject(
            UV_INSTALL.replace(
              '--python-platform x86_64-manylinux_2_28',
              '--python-platform x86_64-manylinux_2_28 --python-version 3.12',
            ),
          ),
          null,
          2,
        ),
      );

      await syncVendedVersions(tree);

      const contents = tree.read('packages/api/project.json', 'utf-8')!;
      expect(contents).toContain(
        `--python-version ${LAMBDA_RUNTIME_VERSIONS.python}`,
      );
      expect(contents).not.toContain('--python-version 3.12');
    });

    it('should leave an unrelated command alone', async () => {
      const project = bundleProject('echo not a uv install');
      tree.write('packages/api/project.json', JSON.stringify(project, null, 2));

      await syncVendedVersions(tree);

      expect(tree.read('packages/api/project.json', 'utf-8')).not.toContain(
        '--python-version',
      );
    });
  });

  it('should be idempotent', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));
    tree.write(TF_FILE, terraformModule('nodejs22.x'));
    tree.write('.python-version', '3.13.0\n');

    await syncVendedVersions(tree);
    const afterFirst = {
      cdk: tree.read(CDK_FILE, 'utf-8'),
      tf: tree.read(TF_FILE, 'utf-8'),
      python: tree.read('.python-version', 'utf-8'),
    };

    const { nextSteps } = await syncVendedVersions(tree);

    expect({
      cdk: tree.read(CDK_FILE, 'utf-8'),
      tf: tree.read(TF_FILE, 'utf-8'),
      python: tree.read('.python-version', 'utf-8'),
    }).toEqual(afterFirst);
    expect(nextSteps).toEqual([]);
  });
});
