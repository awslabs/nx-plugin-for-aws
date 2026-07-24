/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * user-owned-files smoke test — User-Owned File byte preservation in a
 * generated workspace.
 *
 * Generates the AgentCore Harness (IaC inherited from the cdk workspace),
 * applies representative user edits to BOTH project files (`invoke.ts`,
 * `README.md`) and an IaC file (the generated CDK construct), then reruns
 * the generator with the same options across the three Generator-Owned
 * Wiring states — unique, absent, and duplicated — asserting after each
 * rerun that every edited file's contents equal the exact contents recorded
 * at edit time.
 *
 * INDEPENDENCE (Req 14.3): these preservation fixtures and assertions are
 * deliberately independent from the idempotency smoke test
 * (idempotency.spec.ts):
 *   - separate spec file, separate workspace, separately named case;
 *   - distinct fixtures — per-phase, per-file user-edit marker strings
 *     rather than an unmodified matrix workspace;
 *   - DIRECT full-content byte comparisons (readFileSync string equality
 *     against contents recorded immediately after editing) — never a git
 *     no-diff, tree snapshot, or wiring-count result standing in as
 *     preservation evidence.
 * The wiring counts asserted per phase only verify the wiring state
 * converged (unique -> still one, absent -> restored, duplicated -> not
 * grown); they are secondary to and separate from the byte-preservation
 * assertions.
 *
 * Requirements: 10.2, 10.7, 10.9, 10.11, 14.3, 14.9.
 */
describe('smoke test - user-owned-files', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/user-owned-files-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('preserves edited project and IaC file bytes across unique, absent and duplicated wiring reruns', async () => {
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'e2e-test',
      'cdk',
    );
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    const rerunGenerator = () =>
      runCLI(
        `generate @aws/nx-plugin:agentcore-harness --name=my-harness --no-interactive`,
        opts,
      );

    // Initial generation — `iac` is inherited from the cdk workspace and the
    // default `infra: agentcore` emits the CDK construct and its wiring.
    await rerunGenerator();

    // Representative user-ownable files: two project files and one IaC file.
    // TypeScript files receive comment-style edits so the workspace still
    // compiles for the final build; the README receives plain text.
    const userOwnedFiles = [
      {
        path: `${projectRoot}/packages/my-harness/invoke.ts`,
        editFor: (phase: string) =>
          `// user-owned-files-e2e ${phase}: invoke.ts project-file edit\n`,
      },
      {
        path: `${projectRoot}/packages/my-harness/README.md`,
        editFor: (phase: string) =>
          `user-owned-files-e2e ${phase}: README.md project-file edit\n`,
      },
      {
        path: `${projectRoot}/packages/common/constructs/src/app/harnesses/my-harness/my-harness.ts`,
        editFor: (phase: string) =>
          `// user-owned-files-e2e ${phase}: my-harness.ts IaC-file edit\n`,
      },
    ];
    for (const file of userOwnedFiles) {
      expect(
        existsSync(file.path),
        `expected generation to create ${file.path}`,
      ).toBe(true);
    }

    // Append this phase's marker to every fixture file and record the exact
    // post-edit contents the subsequent rerun must preserve.
    const applyUserEdits = (phase: string): Map<string, string> => {
      const recorded = new Map<string, string>();
      for (const file of userOwnedFiles) {
        writeFileSync(
          file.path,
          `${readFileSync(file.path, 'utf-8')}\n${file.editFor(phase)}`,
        );
        recorded.set(file.path, readFileSync(file.path, 'utf-8'));
      }
      return recorded;
    };

    // Direct byte comparison: full-content string equality against the
    // recorded post-edit contents — never a marker `contains` or a git diff.
    const expectEditedBytesPreserved = (
      phase: string,
      recorded: Map<string, string>,
    ) => {
      for (const [path, contents] of recorded) {
        expect(
          readFileSync(path, 'utf-8'),
          `${phase}: rerun must preserve the edited bytes of ${path}`,
        ).toBe(contents);
      }
    };

    // Generator-Owned Wiring under test: the harness star export in the
    // shared constructs harnesses index. The workspace is created with the
    // default module format (ESM), so the specifier carries a `.js`
    // extension; the extensionless CJS form is tolerated when matching.
    const harnessesIndexPath = `${projectRoot}/packages/common/constructs/src/app/harnesses/index.ts`;
    const harnessExportPattern =
      /^export \* from '\.\/my-harness\/my-harness(\.js)?';$/;
    const readIndexLines = () =>
      readFileSync(harnessesIndexPath, 'utf-8').split('\n');
    const countHarnessExports = () =>
      readIndexLines().filter((line) => harnessExportPattern.test(line.trim()))
        .length;

    // --- Phase A: unique wiring (the state generation leaves behind) ------
    expect(
      countHarnessExports(),
      'Phase A precondition: generation wires exactly one harness export',
    ).toBe(1);
    const phaseABytes = applyUserEdits('phase-a-unique-wiring');
    await rerunGenerator();
    expectEditedBytesPreserved('Phase A (unique wiring)', phaseABytes);
    expect(
      countHarnessExports(),
      'Phase A (unique wiring): rerun must keep a single harness export',
    ).toBe(1);

    // --- Phase B: absent wiring (user removed the export line) ------------
    writeFileSync(
      harnessesIndexPath,
      readIndexLines()
        .filter((line) => !harnessExportPattern.test(line.trim()))
        .join('\n'),
    );
    expect(
      countHarnessExports(),
      'Phase B precondition: harness export removed',
    ).toBe(0);
    const phaseBBytes = applyUserEdits('phase-b-absent-wiring');
    await rerunGenerator();
    expectEditedBytesPreserved('Phase B (absent wiring)', phaseBBytes);
    expect(
      countHarnessExports(),
      'Phase B (absent wiring): rerun must restore exactly one harness export',
    ).toBe(1);

    // --- Phase C: duplicated wiring (user duplicated the export line) -----
    const indexBeforeDuplicate = readFileSync(harnessesIndexPath, 'utf-8');
    const exportLine = readIndexLines().find((line) =>
      harnessExportPattern.test(line.trim()),
    );
    if (!exportLine) {
      throw new Error(
        `Phase C setup: no harness export line found in ${harnessesIndexPath}`,
      );
    }
    writeFileSync(
      harnessesIndexPath,
      `${indexBeforeDuplicate}${
        indexBeforeDuplicate.endsWith('\n') ? '' : '\n'
      }${exportLine}\n`,
    );
    expect(
      countHarnessExports(),
      'Phase C precondition: harness export duplicated',
    ).toBe(2);
    const phaseCBytes = applyUserEdits('phase-c-duplicated-wiring');
    await rerunGenerator();
    expectEditedBytesPreserved('Phase C (duplicated wiring)', phaseCBytes);
    expect(
      countHarnessExports(),
      'Phase C (duplicated wiring): rerun must not grow the duplicate — no third copy',
    ).toBe(2);

    // The duplicated export was injected by this test, not the generator, so
    // restore the unique-wiring snapshot before the final health check. The
    // build then validates the workspace the generator actually produced —
    // with every user edit from all three phases still in place (the
    // comment/README edits keep the workspace compiling).
    writeFileSync(harnessesIndexPath, indexBeforeDuplicate);
    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );
    expectEditedBytesPreserved('Final build', phaseCBytes);
  });
});
