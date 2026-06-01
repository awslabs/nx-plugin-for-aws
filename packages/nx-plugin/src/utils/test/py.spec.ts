/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import { createInterface, Interface } from 'readline';
import { OPEN_API_PY_CLIENT_PYTHON_DEP_SPECS } from '../../open-api/py-client/generator';

const WORKER_PATH = path.join(__dirname, 'python-worker', 'worker.py');

export interface MockResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  jsonl_lines?: string[];
  bytes_b64?: string;
}

export interface MockEntry {
  method?: string;
  url_contains?: string;
  url_equals?: string;
  path?: string;
  response: MockResponseSpec;
}

export interface InvokeOptions {
  module: 'sync' | 'async';
  method: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
  stream?: boolean;
  mock?: MockEntry[];
  baseUrl?: string;
  clientKwargs?: Record<string, unknown>;
  /** Name of the package directory (default "generated"). */
  packageName?: string;
}

export interface InvokeResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  traceback?: string;
  details?: unknown;
  /** Populated when the generated code raised a typed exception. */
  exception?: {
    type: string;
    error_type?: string;
    error?: unknown;
    status?: number;
  };
  calls?: Array<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  }>;
}

/**
 * Long-lived Python worker used to both compile and invoke generated clients.
 */
export class PythonVerifier {
  private process?: ChildProcessWithoutNullStreams;
  private stdout?: Interface;
  private queue: Array<(r: InvokeResult) => void> = [];
  private started = false;
  private startupError?: Error;

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.started && this.process) return this.process;
    // Use the same pinned versions the generator advertises so the test
    // environment matches what consumers get at runtime.
    const deps = OPEN_API_PY_CLIENT_PYTHON_DEP_SPECS.flatMap((spec) => [
      '--with',
      spec,
    ]);
    const proc = spawn('uv', ['run', ...deps, 'python', '-u', WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = proc;
    this.stdout = createInterface({ input: proc.stdout });
    this.stdout.on('line', (line) => {
      const resolver = this.queue.shift();
      if (!resolver) return;
      try {
        resolver(JSON.parse(line));
      } catch (err) {
        resolver({ ok: false, error: `Invalid JSON from worker: ${line}` });
      }
    });
    proc.stderr.on('data', (chunk) => {
      // Forward to test output — helps diagnose worker crashes.
      process.stderr.write(chunk);
    });
    proc.on('exit', (code, signal) => {
      if (this.queue.length > 0) {
        this.queue.forEach((r) =>
          r({
            ok: false,
            error: `Worker exited (code=${code} signal=${signal}) with ${this.queue.length} pending requests`,
          }),
        );
        this.queue = [];
      }
      this.process = undefined;
    });
    this.started = true;
    return proc;
  }

  private request(payload: Record<string, unknown>): Promise<InvokeResult> {
    const proc = this.ensureStarted();
    return new Promise((resolve) => {
      this.queue.push(resolve);
      proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  /**
   * Write the given files into a tmpdir and py_compile+import them.
   * `basePath` is stripped from each tree path so that the remainder becomes
   * the file's location inside the generated package.
   */
  async expectPythonToCompile(
    tree: Tree,
    paths: string[],
    basePath = '',
    pkg = 'generated',
  ): Promise<void> {
    const files: Record<string, string> = {};
    const prefix = basePath ? basePath.replace(/\/$/, '') + '/' : '';
    for (const rel of paths) {
      const body = tree.read(rel, 'utf-8');
      if (body === null) throw new Error(`file not in tree: ${rel}`);
      const inPkg = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
      files[inPkg] = body;
    }
    const res = await this.request({ cmd: 'compile', files, package: pkg });
    if (!res.ok) {
      const details = res.details
        ? `\n  ${JSON.stringify(res.details, null, 2)}`
        : '';
      throw new Error(
        `Python compile failed: ${res.error}${details}\n${res.traceback ?? ''}`,
      );
    }
  }

  /**
   * Invoke a method on the previously compiled client.  Assumes `expectPythonToCompile` has been called.
   */
  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const res = await this.request({
      cmd: 'invoke',
      module: options.module,
      method: options.method,
      args: options.args ?? [],
      kwargs: options.kwargs ?? {},
      stream: !!options.stream,
      mock: options.mock ?? [],
      base_url: options.baseUrl ?? 'http://mock',
      client_kwargs: options.clientKwargs ?? {},
      package: options.packageName ?? 'generated',
    });
    return res;
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      try {
        this.process.stdin.end();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        this.process?.once('exit', () => resolve());
        setTimeout(resolve, 2000).unref();
      });
      this.process = undefined;
      this.started = false;
    }
  }
}

/**
 * Convenience wrapper for one-shot compile checks.
 */
export const expectPythonToCompile = async (
  tree: Tree,
  paths: string[],
  basePath = '',
): Promise<void> => {
  const verifier = new PythonVerifier();
  try {
    await verifier.expectPythonToCompile(tree, paths, basePath);
  } finally {
    await verifier.shutdown();
  }
};

describe('PythonVerifier', () => {
  it('needs a test to be a .spec.ts file', () => {
    // The file name ends in .spec.ts so vitest picks it up as a test file but we
    // only want to export helpers.  Mirrors ts.spec.ts.
  });
});
