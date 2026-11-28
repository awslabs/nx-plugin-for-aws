/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declareDependencies } from '../declared-dependencies.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../shared-constructs.js';
import {
  importSharedConstructs,
  writeSharedConstructs,
} from '../test/cdk-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import { addIdentityInfra } from './identity-constructs.js';

// Inside this package so aws-cdk-lib resolves; `_tmp_*` is git-ignored.
const TMP_DIR = join(
  import.meta.dirname,
  `_tmp_identity-constructs-${process.pid}`,
);

interface UserIdentityModule {
  readonly UserIdentity: new (
    scope: Construct,
    id: string,
  ) => { addCallbackUrl: (url: string) => void };
}

describe('UserIdentity construct', () => {
  let module: UserIdentityModule;

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    await addIdentityInfra(tree, {
      iac: 'cdk',
      cognitoDomain: 'test',
      allowSignup: true,
      localCallbackPorts: [4200],
    });
    writeSharedConstructs(tree, TMP_DIR);
    module = await importSharedConstructs<UserIdentityModule>(TMP_DIR);
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('should permit sign-in to return to every URL a website names, and to added ones', () => {
    const stack = new Stack(new App(), 'Test');
    const identity = new module.UserIdentity(stack, 'Identity');
    const website = new Construct(stack, 'Website') as unknown as Record<
      symbol,
      string[]
    >;
    website[Symbol.for('@aws/nx-plugin/sign-in-callback-urls')] = [
      'https://site.example.com/prod/',
      'https://app.example.com',
    ];
    // A property of the same name on another construct is not read
    Object.assign(new Construct(stack, 'Other'), {
      signInCallbackUrls: ['https://other.example.com'],
    });
    identity.addCallbackUrl('https://app.example.com');

    const urls = [
      'http://localhost:4200',
      'https://app.example.com',
      'https://site.example.com/prod/',
    ];
    Template.fromStack(stack).hasResourceProperties(
      'AWS::Cognito::UserPoolClient',
      { CallbackURLs: urls, LogoutURLs: urls },
    );
  });

  it.each(['http://app.example.com', 'not a url'])(
    'should refuse the callback URL %s',
    (url) => {
      const identity = new module.UserIdentity(
        new Stack(new App(), 'Test'),
        'Identity',
      );
      expect(() => identity.addCallbackUrl(url)).toThrow();
    },
  );
});
