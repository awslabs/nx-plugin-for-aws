/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';
import { runGeneratorMatrix } from './generator-matrix';

/**
 * idempotency smoke test — runs the full generator matrix, commits the result,
 * then runs the exact same matrix again and asserts there is no git diff.
 *
 * Generators must be idempotent: re-running with the same options must not
 * overwrite user-touched files, duplicate wiring, or otherwise mutate the
 * workspace. A non-empty git status after the second pass means some generator
 * is not idempotent.
 */
describe('smoke test - idempotency', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/idempotency-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should produce no git diff when the generator matrix is re-run', async () => {
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'e2e-test',
      'cdk',
    );
    const opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
        NODE_OPTIONS: '--max-old-space-size=8192',
      },
    };

    const git = (command: string): string =>
      execSync(`git ${command}`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });

    // Install after every generator (preferInstallDependencies: true) so all
    // lockfiles — including `uv.lock`, which is only synced by an install — are
    // complete before the baseline snapshot. Deferring would leave lockfiles
    // partially written, and re-running would complete them, producing a diff
    // that looks like a (false) idempotency failure.

    // CDK-specific infrastructure projects (mirrors runSmokeTest).
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
      opts,
    );

    // First pass — scaffold the full matrix.
    await runGeneratorMatrix(opts, { preferInstallDependencies: true });

    // Terraform project alongside CDK (mirrors runSmokeTest).
    await runCLI(
      `generate @aws/nx-plugin:terraform#project --name=tf-infra --no-interactive`,
      opts,
    );

    // Commit the generated workspace as the baseline. The workspace is created
    // with git already initialised, so just stage and commit on top of its
    // initial commit. The generated .gitignore keeps node_modules / build
    // output out of the snapshot. --no-verify skips the git-secrets hook.
    git('add -A');
    git(
      '-c user.name=e2e -c user.email=e2e@example.com commit -m baseline --no-verify',
    );

    // Second pass — re-run the exact same matrix on the committed workspace.
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
      opts,
    );
    await runGeneratorMatrix(opts, { preferInstallDependencies: true });
    await runCLI(
      `generate @aws/nx-plugin:terraform#project --name=tf-infra --no-interactive`,
      opts,
    );

    // Any change (modified, added or deleted tracked files) means a generator
    // mutated the workspace on re-run and is therefore not idempotent.
    const status = git('status --porcelain').trim();
    if (status) {
      // Surface the offending files and the actual diff in the failure output.
      const diff = git('diff');
      throw new Error(
        `Generators were not idempotent — re-running the matrix changed the workspace:\n\n${status}\n\n${diff}`,
      );
    }
  });

  /**
   * The matrix re-run above cannot catch two whole classes of defect, because it
   * re-runs the *same* options over *untouched* files:
   *
   *  - a generator that overwrites user-owned files (the re-run rewrites them
   *    with byte-identical content, so there is no diff), and
   *  - a codemod that corrupts a file only on the Nth *distinct* invocation
   *    (e.g. appending to an array once the formatter has wrapped it).
   *
   * So this case edits the user-owned files first, then adds further distinct
   * connections, and asserts the edits survived and everything still builds.
   */
  it('should preserve user edits and stay buildable across distinct re-runs', async () => {
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'e2e-test',
      'cdk',
    );
    const opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
        NODE_OPTIONS: '--max-old-space-size=8192',
      },
    };

    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#agent --project=ts-project --name=host --infra=none --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#rdb --name=user-db --infra=aurora --engine=postgres --framework=prisma --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#rdb --name=py-user-db --infra=none --engine=postgres --framework=sqlmodel --no-interactive`,
      opts,
    );

    // Edit the files a user owns: their schema, their models, their connection
    // module. A re-run must leave every one of these exactly as written.
    //
    // The Python edits append rather than replace, keeping the symbols the
    // generated barrels re-export so the workspace still builds — which is what
    // modelling a real schema on top of the generated example looks like.
    const PY_MODULE = 'packages/py_user_db/e2e_test_py_user_db';
    const userOwned: Record<string, string> = {
      'packages/user-db/prisma/models/example.prisma':
        'model UserOwnedModel {\n  id String @id\n}\n',
      [`${PY_MODULE}/models/example.py`]: `\n\nclass UserOwnedModel(SQLModel, table=True):\n    """USER OWNED PY MODEL"""\n\n    id: int | None = Field(default=None, primary_key=True)\n`,
      [`${PY_MODULE}/connection.py`]: '\n\n# USER OWNED PY CONNECTION\n',
    };
    // Snapshot what each file should look like after the edit, so the assertion
    // below compares against the exact expected bytes.
    const expectedAfterEdit: Record<string, string> = {};
    for (const [relPath, addition] of Object.entries(userOwned)) {
      const full = `${projectRoot}/${relPath}`;
      if (!existsSync(full)) {
        throw new Error(`Expected generated file is missing: ${relPath}`);
      }
      // The Prisma model file is replaced outright (it has no barrel to satisfy);
      // the Python files are appended to.
      const contents = relPath.endsWith('.prisma')
        ? addition
        : readFileSync(full, 'utf-8') + addition;
      writeFileSync(full, contents);
      expectedAfterEdit[relPath] = contents;
    }

    // Re-run both rdb generators, this time escalating py#rdb's infrastructure —
    // the most common reason to re-run a generator at all.
    await runCLI(
      `generate @aws/nx-plugin:ts#rdb --name=user-db --infra=aurora --engine=postgres --framework=prisma --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#rdb --name=py-user-db --infra=aurora --engine=postgres --framework=sqlmodel --no-interactive`,
      opts,
    );

    for (const [relPath, contents] of Object.entries(expectedAfterEdit)) {
      const actual = readFileSync(`${projectRoot}/${relPath}`, 'utf-8');
      if (actual !== contents) {
        throw new Error(
          `Generator overwrote user-owned ${relPath}.\nExpected:\n${contents}\nActual:\n${actual}`,
        );
      }
    }

    // Now add a series of DISTINCT A2A connections. Long names push the host's
    // `tools` array past the formatter's line width, so it wraps and gains a
    // trailing comma — the shape under which a naive array append injects a
    // sparse hole (`[a, b, , c]`), which is `undefined` at runtime.
    const remotes = [
      'billing-reconciliation-agent',
      'fraud-detection-agent',
      'customer-support-escalation-agent',
    ];
    for (const remote of remotes) {
      await runCLI(
        `generate @aws/nx-plugin:ts#agent --project=ts-project --name=${remote} --protocol=a2a --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=host --targetProject=ts-project --targetComponent=${remote} --no-interactive`,
        opts,
      );
    }

    const hostAgent = readFileSync(
      `${projectRoot}/packages/ts-project/src/host/agent.ts`,
      'utf-8',
    );
    // A hole shows up as two commas separated only by whitespace.
    if (/,\s*,/.test(hostAgent)) {
      throw new Error(
        `Connection generator left a sparse array hole in the tools array:\n\n${hostAgent}`,
      );
    }
    for (const remote of remotes) {
      const toolVar = remote.replace(/-([a-z])/g, (_m, c: string) =>
        c.toUpperCase(),
      );
      if (!hostAgent.includes(toolVar)) {
        throw new Error(
          `Connection to ${remote} did not wire its tool into the agent:\n\n${hostAgent}`,
        );
      }
    }

    // The compiler is the real arbiter: a sparse array fails to typecheck, and a
    // clobbered Prisma schema or Python model fails to build.
    await runCLI(`sync`, opts);
    await runCLI(`run-many --target build --all --output-style=stream`, opts);
  });
});
