/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import {
  cdkLambdaRuntime,
  terraformLambdaRuntime,
} from '../../../utils/versions.js';
import migration from './migration.js';

const CDK_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/apis/my-api.ts`;
const TERRAFORM_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/apis/my-api/my-api.tf`;

const CDK_RUNTIME = cdkLambdaRuntime('node');
const TERRAFORM_RUNTIME = terraformLambdaRuntime('node');

/** The CDK construct an older release vended, on the given runtime. */
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

/** The Terraform module an older release vended, on the given runtime. */
const terraformModule = (
  runtime: string,
) => `resource "aws_lambda_function" "api_lambda" {
  function_name = "my-api"
  role          = aws_iam_role.lambda_execution_role.arn
  handler       = "index.handler"
  runtime       = "${runtime}"
  timeout       = 30
}
`;

describe('align-lambda-runtimes migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should replace the CDK _LATEST alias with the pinned runtime', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));

    const { nextSteps } = await migration(tree);

    const contents = tree.read(CDK_FILE, 'utf-8')!;
    expect(contents).toContain(`runtime: ${CDK_RUNTIME}`);
    expect(contents).not.toContain('NODEJS_LATEST');
    expect(nextSteps).toEqual([]);
  });

  it('should move an older CDK runtime onto the pin', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_22_X'));

    await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toContain(`runtime: ${CDK_RUNTIME}`);
  });

  // A namespace-imported template writes `lambda.Runtime.X`, whose prefix has to survive.
  it('should preserve the lambda namespace prefix', async () => {
    tree.write(
      CDK_FILE,
      cdkConstruct('lambda.Runtime.NODEJS_22_X').replace(
        "import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';",
        "import * as lambda from 'aws-cdk-lib/aws-lambda';",
      ),
    );

    await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toContain(
      `runtime: lambda.${CDK_RUNTIME}`,
    );
  });

  it('should move the Terraform runtime onto the pin', async () => {
    tree.write(TERRAFORM_FILE, terraformModule('nodejs22.x'));

    const { nextSteps } = await migration(tree);

    const contents = tree.read(TERRAFORM_FILE, 'utf-8')!;
    expect(contents).toMatch(
      new RegExp(`runtime\\s*=\\s*"${TERRAFORM_RUNTIME}"`),
    );
    expect(contents).not.toContain('nodejs22.x');
    expect(nextSteps).toEqual([]);
  });

  // The two providers disagreeing is the bug, so both halves of one workspace
  // must land on the same value.
  it('should leave both providers naming the same runtime', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));
    tree.write(TERRAFORM_FILE, terraformModule('nodejs22.x'));

    await migration(tree);

    const major = TERRAFORM_RUNTIME.replace(/^nodejs|\.x$/g, '');
    expect(tree.read(CDK_FILE, 'utf-8')).toContain(`NODEJS_${major}_X`);
    expect(tree.read(TERRAFORM_FILE, 'utf-8')).toContain(`"nodejs${major}.x"`);
  });

  // Only values our own templates vended are recognised, so a runtime the user
  // picked is theirs to keep.
  it('should leave a runtime the user chose alone', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_18_X'));
    tree.write(TERRAFORM_FILE, terraformModule('nodejs18.x'));

    const { nextSteps } = await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toContain('Runtime.NODEJS_18_X');
    expect(tree.read(TERRAFORM_FILE, 'utf-8')).toContain('"nodejs18.x"');
    expect(nextSteps).toEqual([]);
  });

  // A stale runtime is either rewritten or reported, never silently left behind.
  it('should report a stale runtime reached through an alias', async () => {
    tree.write(
      CDK_FILE,
      `import { Runtime } from 'aws-cdk-lib/aws-lambda';

const NODE = Runtime.NODEJS_LATEST;

export const props = { runtime: NODE } as const;
`,
    );

    const { nextSteps } = await migration(tree);

    const contents = tree.read(CDK_FILE, 'utf-8')!;
    if (contents.includes('NODEJS_LATEST')) {
      expect(nextSteps?.join('\n')).toContain(CDK_FILE);
    } else {
      expect(contents).toContain(CDK_RUNTIME);
    }
  });

  it('should be idempotent', async () => {
    tree.write(CDK_FILE, cdkConstruct('Runtime.NODEJS_LATEST'));
    tree.write(TERRAFORM_FILE, terraformModule('nodejs22.x'));

    await migration(tree);
    const afterFirst = {
      cdk: tree.read(CDK_FILE, 'utf-8'),
      terraform: tree.read(TERRAFORM_FILE, 'utf-8'),
    };

    const { nextSteps } = await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toEqual(afterFirst.cdk);
    expect(tree.read(TERRAFORM_FILE, 'utf-8')).toEqual(afterFirst.terraform);
    expect(nextSteps).toEqual([]);
  });

  it('should be a no-op on a workspace with no infrastructure', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
  });
});
