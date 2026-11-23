/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectConfiguration } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { addPythonBundleTarget } from './bundle/bundle.js';
import { requiresPythonToRuffTarget } from './format.js';
import { compareRuntimeVersions } from './lambda-runtime-resolution.js';
import {
  AGENT_CORE_RUNTIME_VERSIONS,
  cdkLambdaRuntime,
  LAMBDA_RUNTIME_VERSIONS,
  pyenvPythonVersion,
  pyprojectPythonDependency,
  terraformLambdaRuntime,
} from './versions.js';

/**
 * The Lambda runtime a generator vends must not depend on which IaC provider the
 * user picked, and must not move on its own.
 *
 * Two failure modes are guarded here, both of which shipped silently before:
 *
 * - A template writing a runtime as a literal, which only one provider's copy
 *   ever gets updated. That is how the CDK branch reached `nodejs24.x` (via
 *   `NODEJS_LATEST`) while Terraform stayed on `nodejs22.x`, and how Terraform
 *   came to disagree with itself — the APIs on `nodejs22.x`, the RDB
 *   create-db-user handler on `nodejs24.x`.
 * - A CDK template naming a `_LATEST` alias, whose value is decided by the
 *   pinned `aws-cdk-lib` rather than by this repo. Aligning the two providers
 *   today does not hold: the next `aws-cdk-lib` bump moves CDK and leaves
 *   Terraform behind, with nothing failing to say so.
 *
 * Both are enforced by scanning the templates as text, so a new template that
 * hardcodes a runtime is caught without this file changing.
 */

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..');

/** Every `.template` under the plugin's source tree, as a repo-relative path. */
const templateFiles = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.template')) {
        found.push(path.relative(PLUGIN_SRC, full));
      }
    }
  };
  walk(PLUGIN_SRC);
  return found;
};

const read = (rel: string): string =>
  fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');

describe('vended lambda runtimes', () => {
  it('should name the same runtime under both IaC providers', () => {
    expect(terraformLambdaRuntime('node')).toBe(
      `nodejs${LAMBDA_RUNTIME_VERSIONS.node}.x`,
    );
    expect(cdkLambdaRuntime('node')).toBe(
      `Runtime.NODEJS_${LAMBDA_RUNTIME_VERSIONS.node}_X`,
    );
    expect(terraformLambdaRuntime('python')).toBe(
      `python${LAMBDA_RUNTIME_VERSIONS.python}`,
    );
    expect(cdkLambdaRuntime('python')).toBe(
      `Runtime.PYTHON_${LAMBDA_RUNTIME_VERSIONS.python.replace('.', '_')}`,
    );
  });

  // A generated Python project resolves its wheels against the uv interpreter, so
  // an interpreter on a different minor than the Lambda runtime builds a bundle
  // the deployed function cannot run.
  // Named without a patch, so uv resolves whichever patch of that minor the
  // platform has a build for rather than one that may not exist there.
  it('should pin the uv interpreter to the lambda python runtime', () => {
    expect(pyenvPythonVersion()).toBe(LAMBDA_RUNTIME_VERSIONS.python);
    expect(pyprojectPythonDependency()).toBe(
      `>=${LAMBDA_RUNTIME_VERSIONS.python}`,
    );
  });

  // Ruff derives `target-version` from `requires-python`, so lint targets the
  // version the function runs on.
  it('should derive the ruff target from the lambda python runtime', () => {
    expect(requiresPythonToRuffTarget(pyprojectPythonDependency())).toBe(
      `py${LAMBDA_RUNTIME_VERSIONS.python.replace('.', '')}`,
    );
  });

  // The bundle target must pin `--python-version`, or wheels resolve against
  // whichever interpreter the build machine happens to have.
  it('should pin the python bundle to the lambda python runtime', () => {
    const project: ProjectConfiguration = { root: 'packages/api', name: 'api' };
    addPythonBundleTarget(project);
    const commands = project.targets?.['bundle-x86']?.options
      ?.commands as string[];

    expect(commands.join('\n')).toContain(
      `--python-version ${LAMBDA_RUNTIME_VERSIONS.python}`,
    );
  });

  // The Python interpreter the arm64 bundle installs wheels for comes from the
  // Lambda pin, and the same bundle is what an AgentCore code package ships. A
  // Lambda pin ahead of AgentCore's newest Python therefore deploys cp3XX wheels
  // to an older interpreter, which fails only once the agent runs.
  it('should not target a python newer than the AgentCore runtime', () => {
    expect(
      compareRuntimeVersions(
        LAMBDA_RUNTIME_VERSIONS.python,
        AGENT_CORE_RUNTIME_VERSIONS.python,
      ),
    ).toBeLessThanOrEqual(0);
  });

  // A container-image function runs the interpreter its base image carries, not
  // the managed runtime, and the tag is written in the Dockerfile. Left behind by
  // a runtime bump, the image runs an interpreter the copied bundle was not
  // built for.
  it('should tag the vended lambda base images with the lambda runtimes', () => {
    const expected: Record<string, string> = {
      python: LAMBDA_RUNTIME_VERSIONS.python,
      nodejs: LAMBDA_RUNTIME_VERSIONS.node,
    };
    const offenders: string[] = [];

    for (const rel of templateFiles()) {
      for (const [, language, tag] of read(rel).matchAll(
        /public\.ecr\.aws\/lambda\/(python|nodejs):([\w.-]+)/g,
      )) {
        if (tag !== expected[language]) {
          offenders.push(`${rel}: ${language}:${tag}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // A `_LATEST` alias resolves against whatever `aws-cdk-lib` is pinned, so its
  // value changes on a dependency bump with no edit here and no test failing —
  // which is exactly how CDK drifted ahead of Terraform. An explicit member
  // makes the runtime a reviewable choice in this repo instead.
  it('should not use a Runtime _LATEST alias in any CDK template', () => {
    const offenders = templateFiles().filter((rel) =>
      /\bRuntime\.[A-Z0-9_]*_LATEST\b/.test(read(rel)),
    );

    expect(offenders).toEqual([]);
  });

  // Every runtime a template emits has to come from the shared pin, or the two
  // providers go out of step the next time one of them is bumped.
  it('should not hardcode a lambda runtime in any template', () => {
    const offenders: string[] = [];

    for (const rel of templateFiles()) {
      for (const line of read(rel).split('\n')) {
        // Only a `runtime` assignment, so prose and unrelated identifiers that
        // happen to mention a version are not claimed.
        if (!/\bruntime\s*[:=]/i.test(line)) {
          continue;
        }
        const hardcoded =
          /\bRuntime\.(?:NODEJS|PYTHON)_[A-Z0-9_]+/.exec(line) ??
          /"(?:nodejs[0-9.]+x|python[0-9.]+)"/.exec(line);
        if (hardcoded) {
          offenders.push(`${rel}: ${hardcoded[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
