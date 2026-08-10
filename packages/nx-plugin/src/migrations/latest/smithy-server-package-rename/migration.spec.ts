/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const PROJECT_ROOT = 'packages/test-api/backend';
const HANDLER = `${PROJECT_ROOT}/src/handler.ts`;
const LOCAL_SERVER = `${PROJECT_ROOT}/src/local-server.ts`;
const MANIFEST = `${PROJECT_ROOT}/package.json`;

/**
 * The handler and local server as the release before the rename generated them,
 * and the dependencies it declared. Hardcoded rather than produced by running the
 * generator: a migration has to keep applying to the shape that shipped, however
 * far the generator's output moves afterwards.
 */
const OLD_HANDLER = `import {
  convertEvent,
  convertVersion1Response,
} from '@aws-smithy/server-apigateway';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import middy from '@middy/core';
import { Service } from './service';
import { getMyApiServiceHandler } from './generated/ssdk/index';

const serviceHandler = getMyApiServiceHandler(Service);

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const httpRequest = convertEvent(event);
  const httpResponse = await serviceHandler.handle(httpRequest, {});
  return convertVersion1Response(httpResponse);
};

export const handler = middy().handler(lambdaHandler);
`;

const OLD_LOCAL_SERVER = `import { IncomingMessage, ServerResponse, createServer } from 'http';
import { convertRequest, writeResponse } from '@aws-smithy/server-node';
import { Service } from './service';
import { getMyApiServiceHandler } from './generated/ssdk/index';

const PORT = 3001;

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const httpRequest = await convertRequest(req);
  const httpResponse = await getMyApiServiceHandler(Service).handle(
    httpRequest,
    {},
  );
  writeResponse(httpResponse, res);
}).listen(PORT);
`;

const OLD_DEPENDENCIES = {
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@middy/core': '7.7.2',
};

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/**
 * A Smithy API project as the release before the rename left it, carrying the
 * metadata that generator records — which is how the migration finds it.
 */
const givenSmithyApi = (
  tree: Tree,
  {
    handler = OLD_HANDLER,
    localServer = OLD_LOCAL_SERVER,
    dependencies = OLD_DEPENDENCIES,
    generator = 'ts#smithy-api',
  }: {
    handler?: string;
    localServer?: string;
    dependencies?: Record<string, string>;
    generator?: string;
  } = {},
): void => {
  addProjectConfiguration(tree, 'test-api-backend', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/src`,
    metadata: { generator } as Record<string, unknown>,
  });
  tree.write(HANDLER, handler);
  tree.write(LOCAL_SERVER, localServer);
  tree.write(
    MANIFEST,
    JSON.stringify({ name: '@test/backend', dependencies }, null, 2),
  );
};

describe('smithy-server-package-rename migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should apply to the shape the generators produce', async () => {
    givenSmithyApi(tree);

    const result = await migration(tree);

    const handler = read(tree, HANDLER);
    expect(handler).not.toContain('@aws-smithy/');
    expect(handler).toContain("from '@smithy/server-apigateway'");
    // The bindings survive the move.
    expect(handler).toContain('convertEvent');
    expect(handler).toContain('convertVersion1Response');

    const localServer = read(tree, LOCAL_SERVER);
    expect(localServer).not.toContain('@aws-smithy/');
    expect(localServer).toContain(
      "import { convertRequest, writeResponse } from '@smithy/server-node'",
    );

    expect(result.nextSteps).toEqual([]);
  });

  it('should move the declarations onto the renamed packages', async () => {
    givenSmithyApi(tree);

    await migration(tree);

    const { dependencies } = readJson(tree, MANIFEST);
    expect(dependencies).not.toHaveProperty('@aws-smithy/server-apigateway');
    expect(dependencies).not.toHaveProperty('@aws-smithy/server-node');
    // The renamed line restarted at 0.x, so carrying the old `1.0.0-alpha.10`
    // across would resolve nothing.
    expect(dependencies['@smithy/server-apigateway']).toBe('0.2.0');
    expect(dependencies['@smithy/server-node']).toBe('0.2.0');
    // A package the migration does not own keeps its version.
    expect(dependencies['@middy/core']).toBe('7.7.2');
  });

  it('should keep bindings a project added of its own', async () => {
    givenSmithyApi(tree, {
      handler: OLD_HANDLER.replace(
        '  convertVersion1Response,\n',
        '  convertVersion1Response,\n  convertVersion2Response,\n',
      ),
    });

    await migration(tree);

    const handler = read(tree, HANDLER);
    expect(handler).toContain("from '@smithy/server-apigateway'");
    expect(handler).toContain('convertVersion2Response');
  });

  it('should rename a declaration hoisted to the workspace root', async () => {
    givenSmithyApi(tree, { dependencies: {} });
    tree.write(
      'package.json',
      JSON.stringify(
        {
          name: 'test-workspace',
          devDependencies: {
            '@aws-smithy/server-node': '1.0.0-alpha.10',
          },
        },
        null,
        2,
      ),
    );

    await migration(tree);

    const { devDependencies } = readJson(tree, 'package.json');
    expect(devDependencies).not.toHaveProperty('@aws-smithy/server-node');
    expect(devDependencies['@smithy/server-node']).toBe('0.2.0');
  });

  it('should skip and report a customised file', async () => {
    // A namespace import is not the generated shape, so it is reported for the
    // user to move by hand rather than rewritten.
    givenSmithyApi(tree, {
      handler: `import * as apigateway from '@aws-smithy/server-apigateway';\n`,
    });

    const result = await migration(tree);

    expect(read(tree, HANDLER)).toContain(
      "import * as apigateway from '@aws-smithy/server-apigateway'",
    );
    expect(result.nextSteps).toEqual([
      expect.stringContaining(`${HANDLER}: still imports a deprecated`),
    ]);
  });

  it('should leave a project this plugin did not generate alone', async () => {
    givenSmithyApi(tree, { generator: 'ts#project' });

    await migration(tree);

    // Scoped to a Smithy API project: a file of the user's own that happens to
    // import these packages is not this migration's to rewrite.
    expect(read(tree, HANDLER)).toContain('@aws-smithy/server-apigateway');
    const { dependencies } = readJson(tree, MANIFEST);
    expect(dependencies).toHaveProperty('@aws-smithy/server-apigateway');
  });

  it('should leave a workspace that already moved itself alone', async () => {
    const migrated = {
      handler: OLD_HANDLER.replaceAll('@aws-smithy/', '@smithy/'),
      localServer: OLD_LOCAL_SERVER.replaceAll('@aws-smithy/', '@smithy/'),
      dependencies: {
        '@smithy/server-apigateway': '0.2.0',
        '@smithy/server-node': '0.2.0',
      },
    };
    givenSmithyApi(tree, migrated);

    const result = await migration(tree);

    expect(read(tree, HANDLER)).toContain("from '@smithy/server-apigateway'");
    expect(readJson(tree, MANIFEST).dependencies).toEqual(
      migrated.dependencies,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    givenSmithyApi(tree);

    await migration(tree);
    const afterFirst = {
      handler: read(tree, HANDLER),
      localServer: read(tree, LOCAL_SERVER),
      manifest: readJson(tree, MANIFEST),
    };
    const result = await migration(tree);

    expect(read(tree, HANDLER)).toEqual(afterFirst.handler);
    expect(read(tree, LOCAL_SERVER)).toEqual(afterFirst.localServer);
    expect(readJson(tree, MANIFEST)).toEqual(afterFirst.manifest);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a workspace with no Smithy API alone', async () => {
    const rootManifest = JSON.stringify(
      {
        name: 'test-workspace',
        devDependencies: { '@aws-smithy/server-node': '1.0.0-alpha.10' },
      },
      null,
      2,
    );
    tree.write('package.json', rootManifest);

    const result = await migration(tree);

    // Nothing generated these, so the declaration is the user's own.
    expect(readJson(tree, 'package.json').devDependencies).toHaveProperty(
      '@aws-smithy/server-node',
    );
    expect(result.nextSteps).toEqual([]);
  });
});
