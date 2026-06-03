/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsRdbSmithyConnectionGenerator } from './generator';

describe('ts#rdb smithy-connection generator', () => {
  let tree: Tree;

  const setupRdbProject = (name = 'db') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          'serve-local': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  const setupSmithyBackend = (name = 'api') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          'serve-local': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
    tree.write(
      `packages/${name}/src/context.ts`,
      `import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

export interface ServiceContext {
  tracer: Tracer;
  logger: Logger;
  metrics: Metrics;
}
`,
    );
    tree.write(
      `packages/${name}/src/local-server.ts`,
      `import { IncomingMessage, ServerResponse, createServer } from 'http';
import { convertRequest, writeResponse } from '@aws-smithy/server-node';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Service } from './service.js';
import { getMyApiServiceHandler } from './generated/ssdk/index.js';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

const serviceHandler = getMyApiServiceHandler(Service);

const server = createServer(async function (req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage }) {
  const httpRequest = convertRequest(req);
  const httpResponse = await serviceHandler.handle(httpRequest, {
    tracer,
    logger,
    metrics,
  });
  return writeResponse(httpResponse, res);
});

server.listen(3000);
`,
    );
    tree.write(
      `packages/${name}/src/handler.ts`,
      `import { convertEvent, convertVersion1Response } from '@aws-smithy/server-apigateway';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Service } from './service.js';
import { getMyApiServiceHandler } from './generated/ssdk/index.js';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

const serviceHandler = getMyApiServiceHandler(Service);

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const httpRequest = convertEvent(event);
  const httpResponse = await serviceHandler.handle(httpRequest, {
    tracer,
    logger,
    metrics,
  });
  return convertVersion1Response(httpResponse);
};
`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb serve-local dependency to smithy backend serve-local', async () => {
    setupSmithyBackend();
    setupRdbProject();

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'api')).toMatchSnapshot();
  });

  it('should inject into context.ts, handler.ts, and local-server.ts', async () => {
    setupSmithyBackend();
    setupRdbProject();

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.read('packages/api/src/context.ts', 'utf-8')).toMatchSnapshot();
    expect(tree.read('packages/api/src/handler.ts', 'utf-8')).toMatchSnapshot();
    expect(
      tree.read('packages/api/src/local-server.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent across context.ts, handler.ts, and local-server.ts', async () => {
    setupSmithyBackend();
    setupRdbProject();

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.read('packages/api/src/context.ts', 'utf-8')).toMatchSnapshot();
    expect(tree.read('packages/api/src/handler.ts', 'utf-8')).toMatchSnapshot();
    expect(
      tree.read('packages/api/src/local-server.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should support multiple rdb connections', async () => {
    setupSmithyBackend();
    setupRdbProject('postgres-db');
    setupRdbProject('mysql-db');

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'postgres-db',
    });
    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'mysql-db',
    });

    expect(tree.read('packages/api/src/context.ts', 'utf-8')).toMatchSnapshot();
    expect(tree.read('packages/api/src/handler.ts', 'utf-8')).toMatchSnapshot();
    expect(
      tree.read('packages/api/src/local-server.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should not add dependency when source has no serve-local', async () => {
    tree.write(
      `packages/api/project.json`,
      JSON.stringify({
        name: 'api',
        root: 'packages/api',
        targets: { build: {} },
      }),
    );
    setupRdbProject();

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    expect(config.targets?.['serve-local']).toBeUndefined();
  });

  it('should skip file injection when context.ts and handler.ts do not exist', async () => {
    tree.write(
      `packages/api/project.json`,
      JSON.stringify({
        name: 'api',
        root: 'packages/api',
        targets: {
          'serve-local': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
    setupRdbProject();

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.exists('packages/api/src/context.ts')).toBe(false);
    expect(tree.exists('packages/api/src/handler.ts')).toBe(false);
  });

  it('should be idempotent for serve-local wiring', async () => {
    setupSmithyBackend();
    setupRdbProject();

    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await tsRdbSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    const deps = (config.targets?.['serve-local']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'serve-local',
    );
    expect(deps).toHaveLength(1);
  });
});
