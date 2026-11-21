/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { tsTrpcApiGenerator } from './generator.js';
import type { TsTrpcApiGeneratorSchema } from './schema';

/**
 * Behaviour of the metrics plugin the generator vends. On AWS Lambda one
 * invocation owns the metric set, so a plugin-wide metrics object was safe.
 * The ECS container entry point is a long-lived `node:http` server that serves
 * requests concurrently, where a shared object lets one request overwrite
 * another's dimensions and publish its metrics. These tests drive two
 * overlapping requests through the vended plugin and check what each one
 * published.
 */

/** What one stubbed metrics object recorded. */
interface RecordedMetrics {
  dimensions: Record<string, string>;
  metrics: string[];
  coldStartCaptures: number;
  publishes: {
    dimensions: Record<string, string>;
    metrics: string[];
  }[];
}

/** The vended plugin's middleware: tRPC calls it once per request. */
type Middleware = (opts: {
  path: string;
  type: string;
  ctx: Record<string, unknown>;
  next: (opts: { ctx: Record<string, unknown> }) => Promise<{ ok: boolean }>;
}) => Promise<{ ok: boolean }>;

/**
 * Loads the vended `middleware/metrics.ts` with `@trpc/server` and powertools
 * stubbed, and returns its middleware plus every metrics object it created.
 *
 * The `@trpc/server` stub makes `t.procedure.use(fn)` hand back `fn`, so the
 * middleware can be called directly. The powertools stub records what the
 * plugin does to each metrics object rather than emitting anything.
 */
const loadMetricsPlugin = (
  source: string,
): { middleware: Middleware; created: RecordedMetrics[] } => {
  const created: RecordedMetrics[] = [];

  class MetricsStub implements RecordedMetrics {
    dimensions: Record<string, string> = {};
    metrics: string[] = [];
    coldStartCaptures = 0;
    publishes: RecordedMetrics['publishes'] = [];

    constructor() {
      created.push(this);
    }

    addDimensions(dimensions: Record<string, string>) {
      Object.assign(this.dimensions, dimensions);
    }

    addMetric(name: string) {
      this.metrics.push(name);
    }

    captureColdStartMetric() {
      this.coldStartCaptures += 1;
    }

    publishStoredMetrics() {
      this.publishes.push({
        dimensions: { ...this.dimensions },
        metrics: [...this.metrics],
      });
      this.metrics = [];
    }
  }

  const modules: Record<string, unknown> = {
    '@trpc/server': {
      initTRPC: {
        context: () => ({
          create: () => ({ procedure: { use: (fn: Middleware) => fn } }),
        }),
      },
    },
    '@aws-lambda-powertools/metrics': {
      Metrics: MetricsStub,
      MetricUnit: { Count: 'Count' },
    },
  };

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', outputText)(
    (id: string) => {
      const stub = modules[id];
      if (!stub) {
        throw new Error(`Unexpected import in the vended plugin: ${id}`);
      }
      return stub;
    },
    module,
    module.exports,
  );

  return { middleware: module.exports.createMetricsPlugin(), created };
};

/** A promise plus the function that settles it, to hold a request open. */
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('ts#trpc-api metrics middleware', () => {
  const options: TsTrpcApiGeneratorSchema = {
    name: 'TestApi',
    directory: 'apps',
    infra: 'http-ecs',
    auth: 'iam',
    iac: 'cdk',
  };
  let source: string;

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await tsTrpcApiGenerator(tree, options);
    source = tree.read('apps/test-api/src/middleware/metrics.ts', 'utf-8')!;
  }, 120_000);

  it('should give two concurrent requests a metrics object each', async () => {
    const { middleware, created } = loadMetricsPlugin(source);
    const inFirstRequest = deferred();
    const firstRequestStarted = deferred();
    let firstMetrics: RecordedMetrics | undefined;
    let secondMetrics: RecordedMetrics | undefined;

    // The first request is held inside `next`, which is where a procedure
    // runs, so the second request's dimensions are added while the first is
    // still open.
    const first = middleware({
      path: 'echo',
      type: 'query',
      ctx: {},
      next: async ({ ctx }) => {
        firstMetrics = ctx.metrics as RecordedMetrics;
        firstRequestStarted.resolve();
        await inFirstRequest.promise;
        return { ok: true };
      },
    });
    await firstRequestStarted.promise;

    await middleware({
      path: 'save',
      type: 'mutation',
      ctx: {},
      next: async ({ ctx }) => {
        secondMetrics = ctx.metrics as RecordedMetrics;
        return { ok: true };
      },
    });
    inFirstRequest.resolve();
    await first;

    expect(firstMetrics).toBeDefined();
    expect(secondMetrics).toBeDefined();
    expect(firstMetrics).not.toBe(secondMetrics);
    // One for the process, one for each request.
    expect(created).toHaveLength(3);
  });

  it('should publish each request with only its own dimensions', async () => {
    const { middleware, created } = loadMetricsPlugin(source);
    const inFirstRequest = deferred();
    const firstRequestStarted = deferred();

    const first = middleware({
      path: 'echo',
      type: 'query',
      ctx: {},
      next: async () => {
        firstRequestStarted.resolve();
        await inFirstRequest.promise;
        return { ok: true };
      },
    });
    await firstRequestStarted.promise;
    await middleware({
      path: 'save',
      type: 'mutation',
      ctx: {},
      next: async () => ({ ok: false }),
    });
    inFirstRequest.resolve();
    await first;

    const published = created.flatMap((m) => m.publishes);
    expect(published).toHaveLength(2);
    // One document per request, in the order the objects were created, and
    // neither names the other request's procedure.
    expect(published[0]).toEqual({
      dimensions: { procedure: 'echo', type: 'query' },
      metrics: ['RequestCount', 'Success'],
    });
    expect(published[1]).toEqual({
      dimensions: { procedure: 'save', type: 'mutation' },
      metrics: ['RequestCount', 'Failure'],
    });
  });

  it('should capture cold start on the process-wide metrics object', async () => {
    const { middleware, created } = loadMetricsPlugin(source);
    for (const path of ['echo', 'save']) {
      await middleware({
        path,
        type: 'query',
        ctx: {},
        next: async () => ({ ok: true }),
      });
    }

    // Powertools decides cold start from state on the metrics object, so the
    // object it is asked on has to outlive the request. On Lambda that keeps
    // the ColdStart metric to one per execution environment.
    const coldStartCaptures = created.map((m) => m.coldStartCaptures);
    expect(coldStartCaptures).toEqual([2, 0, 0]);
    // The process-wide object publishes nothing of its own:
    // `captureColdStartMetric` emits its own document.
    expect(created[0].publishes).toEqual([]);
  });
});
