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

  describe('divergence', () => {
    // A runtime we never vended is the user's choice even inside an owned file.
    it('should leave a runtime the user chose alone', async () => {
      const before = cdkConstruct('Runtime.NODEJS_18_X');
      tree.write(CDK_FILE, before);

      const { nextSteps } = await syncVendedVersions(tree);

      expect(tree.read(CDK_FILE, 'utf-8')).toContain('Runtime.NODEJS_18_X');
      expect(nextSteps).toEqual([]);
    });

    it('should report a stale runtime it could not rewrite', async () => {
      // Reached through an alias, so the `runtime:` property pattern misses it.
      tree.write(
        CDK_FILE,
        `import { Runtime } from 'aws-cdk-lib/aws-lambda';

const NODE = Runtime.NODEJS_22_X;

export const props = { runtime: NODE } as const;
`,
      );

      const { nextSteps } = await syncVendedVersions(tree);

      const contents = tree.read(CDK_FILE, 'utf-8')!;
      if (contents.includes('NODEJS_22_X')) {
        expect(nextSteps?.join('\n')).toContain(CDK_FILE);
      } else {
        expect(contents).toContain(VENDED_CDK_NODE);
      }
    });
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
