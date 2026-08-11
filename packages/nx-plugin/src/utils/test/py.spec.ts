/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import { createInterface, type Interface } from 'readline';
import { OPEN_API_PY_CLIENT_DEPENDENCIES } from '../../open-api/py-client/generator';
import { declaredNames } from '../declared-dependencies';
import { withPyVersions } from '../versions';

const WORKER_PATH = path.join(
  import.meta.dirname,
  'python-worker',
  'worker.py',
);

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
  /**
   * Name of an exception class exported by the generated package. When the call
   * raises, `exception.caught_as` reports whether it is an instance of it, so a
   * test can assert the hierarchy a caller would catch on.
   */
  catchAs?: string;
  /**
   * Extra kwargs for the `httpx.Client` / `httpx.AsyncClient` the generated
   * client is handed, so a test can pin what the caller's own client
   * contributes (headers, params, timeouts).
   */
  httpxClientKwargs?: Record<string, unknown>;
  /**
   * Attach an `httpx.Auth` to the caller's client. `body-digest` signs each
   * request with a digest of its body, so a client that bypassed the auth flow
   * or altered the body cannot produce the expected header.
   */
  auth?: 'body-digest';
  /** Register a request event hook on the caller's client setting this header. */
  eventHookHeader?: string;
  /**
   * Close the generated client before invoking, proving a caller-supplied httpx
   * client outlives it and stays usable.
   */
  closeThenReuse?: boolean;
  /** Turn Python warnings into errors, so a deprecation fails the call. */
  errorOnWarning?: boolean;
}

export interface InvokeResult {
  ok: boolean;
  value?: unknown;
  /**
   * The Python type name of the returned value. A float where the spec declares
   * an integer is JSON-equal to it, so only the type tells them apart.
   */
  pyType?: string;
  /** The Python type name of each element, when the value is a sequence. */
  pyElementTypes?: string[];
  error?: string;
  traceback?: string;
  details?: unknown;
  /** Populated when the generated code raised a typed exception. */
  exception?: {
    type: string;
    error_type?: string;
    error?: unknown;
    status?: number;
    /** Whether the raised exception is an instance of `catchAs`. */
    caught_as?: boolean;
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

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.started && this.process) return this.process;
    // Use the same pinned versions the generator declares so the test
    // environment matches what consumers get at runtime.
    const deps = withPyVersions(
      OPEN_API_PY_CLIENT_DEPENDENCIES,
      declaredNames(OPEN_API_PY_CLIENT_DEPENDENCIES.py),
    ).flatMap((spec) => ['--with', spec]);
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
      } catch {
        resolver({ ok: false, error: `Invalid JSON from worker: ${line}` });
      }
    });
    proc.stderr.on('data', (chunk) => {
      // Forward to test output — helps diagnose worker crashes.
      process.stderr.write(chunk);
    });
    // Without this, a missing `uv` raises an uncaught exception rather than
    // failing the test that asked for the worker.
    proc.on('error', (err) => this.fail(`Could not start worker: ${err}`));
    proc.on('exit', (code, signal) => {
      this.fail(`Worker exited (code=${code} signal=${signal})`);
      this.process = undefined;
      this.started = false;
    });
    this.started = true;
    return proc;
  }

  /** Settle every pending request with the same failure. */
  private fail(error: string): void {
    const pending = this.queue;
    this.queue = [];
    for (const resolve of pending) {
      resolve({ ok: false, error: `${error} with ${pending.length} pending` });
    }
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
      catch_as: options.catchAs ?? null,
      httpx_client_kwargs: options.httpxClientKwargs ?? {},
      auth: options.auth ?? null,
      event_hook_header: options.eventHookHeader ?? null,
      close_then_reuse: !!options.closeThenReuse,
      error_on_warning: !!options.errorOnWarning,
    });
    // The worker speaks snake_case; expose the type fields camelCased alongside.
    const raw = res as InvokeResult & {
      py_type?: string;
      py_element_types?: string[];
    };
    return {
      ...res,
      ...(raw.py_type === undefined ? {} : { pyType: raw.py_type }),
      ...(raw.py_element_types === undefined
        ? {}
        : { pyElementTypes: raw.py_element_types }),
    };
  }

  async shutdown(): Promise<void> {
    const proc = this.process;
    if (!proc) return;
    try {
      proc.stdin.end();
    } catch {
      // Already gone; the exit wait below settles immediately.
    }
    const exited = await new Promise<boolean>((resolve) => {
      proc.once('exit', () => resolve(true));
      setTimeout(() => resolve(false), 2000).unref();
    });
    // Closing stdin normally ends the worker's read loop; kill one that ignored
    // it rather than leaving the process behind for the rest of the run.
    if (!exited) {
      proc.kill('SIGKILL');
    }
    this.process = undefined;
    this.started = false;
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
