/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, visitNotIgnoredFiles } from '@nx/devkit';
import { applyGritQL, captureAllGritQLVariable } from '../ast.js';
import {
  cdkLambdaRuntime,
  type ILambdaRuntime,
  LAMBDA_RUNTIME_VERSIONS,
  terraformLambdaRuntime,
} from '../versions.js';
import { isVendedUpgrade } from './vended-upgrade.js';

/**
 * Sync the Lambda runtimes vended into the projects this plugin owns.
 *
 * The runtimes present are read from each file rather than compared against a
 * list of what past releases vended, which would need maintaining by hand for the
 * same reason the pin itself does.
 */

/** The IaC provider a vended file belongs to, decided by the directory it sits in. */
export type VendedIac = 'cdk' | 'terraform';

/** A Lambda runtime a vended file declares. */
interface DeclaredRuntime {
  /** The runtime as written, e.g. `lambda.Runtime.NODEJS_22_X` or `"nodejs22.x"`. */
  readonly value: string;
  readonly language: ILambdaRuntime;
  /**
   * Version the runtime names, or undefined for an alias like `NODEJS_LATEST`
   * whose value `aws-cdk-lib` decides rather than this repo.
   */
  readonly version?: string;
}

/**
 * GritQL binding the value of a `runtime` assignment.
 *
 * Structure is matched here and nowhere else: the binding is the runtime alone, so
 * no caller re-derives the assignment around it, and a `runtime` that isn't a real
 * property or attribute — inside a comment, say — never matches.
 */
const RUNTIME_ASSIGNMENT: Record<VendedIac, string> = {
  cdk: '`runtime: $value`',
  terraform: 'language hcl\n`runtime = $value`',
};

/** `NODEJS_22_X` -> `22`, `PYTHON_3_14` -> `3.14`; undefined for an alias. */
const cdkMemberVersion = (member: string): string | undefined =>
  /^NODEJS_(\d+)_X$/.exec(member)?.[1] ??
  /^PYTHON_(\d+)_(\d+)$/.exec(member)?.slice(1).join('.');

/**
 * Read a bound CDK runtime, or undefined when the value is not a versioned managed
 * runtime.
 *
 * GritQL has already established this is a `runtime` property and isolated its
 * value, so the regex only reads that scalar.
 */
const readCdkRuntime = (value: string): DeclaredRuntime | undefined => {
  const member = /^(?:lambda\.)?Runtime\.((?:NODEJS|PYTHON)_[A-Z0-9_]+)$/.exec(
    value.trim(),
  )?.[1];
  if (!member) {
    return undefined;
  }
  return {
    value: value.trim(),
    language: member.startsWith('NODEJS') ? 'node' : 'python',
    version: cdkMemberVersion(member),
  };
};

/** Read a bound Terraform runtime, or undefined for a non-runtime value. */
const readTerraformRuntime = (value: string): DeclaredRuntime | undefined => {
  const identifier = /^"((?:nodejs|python)[0-9][^"]*)"$/.exec(
    value.trim(),
  )?.[1];
  if (!identifier) {
    return undefined;
  }
  return {
    value: value.trim(),
    language: identifier.startsWith('nodejs') ? 'node' : 'python',
    version:
      /^nodejs([\d.]+?)\.x$/.exec(identifier)?.[1] ??
      /^python([\d.]+)$/.exec(identifier)?.[1],
  };
};

/**
 * Every runtime a vended file assigns, or undefined when the pattern could not be
 * applied to it.
 *
 * The two are distinguished so a file the parser rejected is reported rather than
 * mistaken for one with nothing to do, which would make this a silent no-op.
 */
const declaredRuntimes = async (
  tree: Tree,
  path: string,
  iac: VendedIac,
): Promise<DeclaredRuntime[] | undefined> => {
  const values = await captureAllGritQLVariable(
    tree,
    path,
    RUNTIME_ASSIGNMENT[iac],
    'value',
  );
  if (values === undefined) {
    return undefined;
  }

  const read = iac === 'terraform' ? readTerraformRuntime : readCdkRuntime;
  return values.flatMap((value) => {
    const runtime = read(value);
    return runtime ? [runtime] : [];
  });
};

/**
 * The runtime this release vends, written the way the declared one was.
 *
 * A namespace-imported construct writes `lambda.Runtime.X`, so the prefix on the
 * declared value is carried over rather than dropped.
 */
const vendedRuntime = (iac: VendedIac, declared: DeclaredRuntime): string => {
  if (iac === 'terraform') {
    return `"${terraformLambdaRuntime(declared.language)}"`;
  }
  const namespace = declared.value.startsWith('lambda.') ? 'lambda.' : '';
  return `${namespace}${cdkLambdaRuntime(declared.language)}`;
};

/**
 * Sync the Lambda runtimes in the directories this plugin owns.
 *
 * A runtime below the pin is ours to move, as is a `_LATEST` alias — its value is
 * decided by `aws-cdk-lib`, which is the drift this closes. A runtime at or ahead
 * of the pin is the user's and is left, as is any Lambda outside these
 * directories. One the rewrite cannot reach is reported instead.
 *
 * @returns the files changed, and the owned files still holding an older runtime
 */
export const syncLambdaRuntimes = async (
  tree: Tree,
  dirs: Readonly<Record<VendedIac, string>>,
): Promise<{ updated: string[]; diverged: string[] }> => {
  const updated: string[] = [];
  const diverged: string[] = [];

  for (const [iac, dir] of Object.entries(dirs) as [VendedIac, string][]) {
    if (!tree.exists(dir)) {
      continue;
    }
    const extension = iac === 'terraform' ? '.tf' : '.ts';
    const files: string[] = [];
    // Started at the owned directory, so the provider follows from where a file
    // sits rather than being inferred from it.
    visitNotIgnoredFiles(tree, dir, (path) => {
      if (path.endsWith(extension)) {
        files.push(path);
      }
    });

    for (const path of files) {
      const declared = await declaredRuntimes(tree, path, iac);
      if (declared === undefined) {
        diverged.push(path);
        continue;
      }

      let changed = false;
      let stale = false;

      // Deduped: one rewrite covers every occurrence of the same value.
      const seen = new Set<string>();
      for (const runtime of declared) {
        if (seen.has(runtime.value)) {
          continue;
        }
        seen.add(runtime.value);

        const vended = vendedRuntime(iac, runtime);
        if (runtime.value === vended) {
          continue;
        }
        // An alias carries no version to compare, and is always ours to pin.
        if (
          runtime.version !== undefined &&
          !isVendedUpgrade(
            LAMBDA_RUNTIME_VERSIONS[runtime.language],
            runtime.version,
          )
        ) {
          continue;
        }

        const assignment = iac === 'terraform' ? 'runtime = ' : 'runtime: ';
        const prefix = iac === 'terraform' ? 'language hcl\n' : '';
        if (
          await applyGritQL(
            tree,
            path,
            `${prefix}\`${assignment}${runtime.value}\` => \`${assignment}${vended}\``,
          )
        ) {
          changed = true;
        } else {
          stale = true;
        }
      }

      if (changed) {
        updated.push(path);
      }
      if (stale) {
        diverged.push(path);
      }
    }
  }

  return { updated, diverged };
};
