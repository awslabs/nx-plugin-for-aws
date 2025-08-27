/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';

interface BackendOptions {
  type: 'trpc' | 'fastapi';
}

export interface TrpcBackendOptions extends BackendOptions {
  type: 'trpc';
  projectAlias: string;
  dir: string;
}

export interface FastApiBackendOptions extends BackendOptions {
  type: 'fastapi';
  moduleName: string;
  dir: string;
}

export interface AddApiGatewayConstructOptions {
  apiNameClassName: string;
  apiNameKebabCase: string;
  constructType: 'http' | 'rest';
  backend: TrpcBackendOptions | FastApiBackendOptions;
  auth: 'IAM' | 'Cognito' | 'None';
}

/**
 * Add an API CDK construct, and update the Runtime Config type to export its url
 */
export const addApiGatewayConstruct = (
  tree: Tree,
  options: AddApiGatewayConstructOptions,
) => {
  const generateCoreApiFile = (name: string) => {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'core', 'api', name),
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'api',
      ),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  };

  // Generate relevant core CDK construct and utilities
  generateCoreApiFile(options.constructType);
  generateCoreApiFile('utils');
  if (options.backend.type === 'trpc') {
    generateCoreApiFile('trpc');
  }

  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app', 'apis', options.constructType),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'apis',
    ),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'apis',
      'index.ts',
    ),
    `./${options.apiNameKebabCase}.js`,
  );
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './apis/index.js',
  );
};
