/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tree } from '@nx/devkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { PY_VERSIONS, pyenvPythonVersion } from '../../utils/versions.js';
import { pyFastApiProjectGenerator } from './generator.js';
import type { PyFastApiProjectGeneratorSchema } from './schema';

/**
 * What the generated container entry point publishes, measured by running it.
 *
 * The API's metrics middleware runs for every HTTP request, so before this the
 * target group's health check every 15 seconds added a `RequestCount` with
 * `route = GET /health` and the container's flush middleware published a
 * document for each: about 5,760 a day per task, mixed in with real traffic.
 * Nothing in the generated tree is asserted here; the test drives the app and
 * reads the embedded-metric documents it wrote to stdout.
 */

const RUN_CHECKS = path.join(
  import.meta.dirname,
  'metrics-runtime',
  'run_checks.py',
);

/** One request's status, the documents it published, and any warnings. */
interface RequestResult {
  status: number;
  documents: { metrics: string[]; dimensions: Record<string, string> }[];
  warnings: string[];
}

type Results = Record<
  'health' | 'echo' | 'echo_again' | 'missing',
  RequestResult
>;

/** Copies every file under `dir` in the tree to the same relative path under `dest`. */
const writeTreeDir = (tree: Tree, dir: string, dest: string) => {
  const visit = (current: string) => {
    for (const child of tree.children(current)) {
      const childPath = `${current}/${child}`;
      if (tree.isFile(childPath)) {
        const target = path.join(dest, path.relative(dir, childPath));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, tree.read(childPath)!);
      } else {
        visit(childPath);
      }
    }
  };
  visit(dir);
};

describe('py#fast-api container metrics', () => {
  const options: PyFastApiProjectGeneratorSchema = {
    name: 'test-api',
    directory: 'apps',
    infra: 'http-ecs',
    auth: 'iam',
    iac: 'cdk',
  };
  let results: Results;

  beforeAll(() => {
    const tree = createTreeUsingTsSolutionSetup();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastapi-metrics-'));
    const projectRoot = path.join(workDir, 'test_api');

    return (async () => {
      await pyFastApiProjectGenerator(tree, options);
      writeTreeDir(tree, 'apps/test_api', projectRoot);

      // The packages the generated app imports, at the versions the generator
      // vends, plus the test client's httpx.
      const withDeps = [
        `fastapi${PY_VERSIONS.fastapi}`,
        `uvicorn${PY_VERSIONS.uvicorn}`,
        `aws-lambda-powertools[tracer]${PY_VERSIONS['aws-lambda-powertools[tracer]']}`,
        'httpx',
      ].flatMap((dep) => ['--with', dep]);

      const output = execFileSync(
        'uv',
        [
          'run',
          '--no-project',
          '--python',
          pyenvPythonVersion(),
          ...withDeps,
          'python',
          RUN_CHECKS,
          projectRoot,
          'proj_test_api.test_api_container',
        ],
        {
          cwd: workDir,
          encoding: 'utf-8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: 540_000,
        },
      );
      const line = output.split('\n').find((l) => l.startsWith('RESULTS '));
      if (!line) {
        throw new Error(
          `No results from the container entry point:\n${output}`,
        );
      }
      results = JSON.parse(line.slice('RESULTS '.length));
    })();
  }, 600_000);

  it('should answer the health check without publishing a metric', () => {
    expect(results.health.status).toBe(200);
    // The health check is not an API request. Before this it published one
    // document per call, every 15 seconds, for the life of the task.
    expect(results.health.documents).toEqual([]);
  });

  it('should publish one document per API request, with its own route', () => {
    for (const result of [results.echo, results.echo_again]) {
      expect(result.status).toBe(200);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].metrics).toEqual(['RequestCount', 'Success']);
      expect(result.documents[0].dimensions.route).toBe('GET /echo');
    }
  });

  it('should count a request to a route that does not exist', () => {
    expect(results.missing.status).toBe(404);
    expect(results.missing.documents).toHaveLength(1);
    expect(results.missing.documents[0].metrics).toEqual(['RequestCount']);
    expect(results.missing.documents[0].dimensions.route).toBe(
      'GET /not-a-route',
    );
  });

  it('should never re-add a dimension it already published', () => {
    // Powertools warns when a dimension is added twice, which is what a metric
    // set carried from one request into the next looks like.
    for (const result of Object.values(results)) {
      expect(result.warnings).toEqual([]);
    }
  });
});
