/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { runCLI, tmpProjPath } from '../utils';
import { runSmokeTest } from './smoke-test';

/**
 * Trivy image scanning is intentionally decoupled from `build` (its result
 * depends on the ever-changing vulnerability database), so it is not covered
 * by the package-manager smoke lanes. This lane generates the full matrix,
 * builds it, then runs `nx run-many --target trivy` — the same command the
 * vended `trivy` root script runs — to scan every generated container image
 * for HIGH/CRITICAL vulnerabilities.
 */
describe('smoke test - trivy', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/trivy`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should scan every generated image with trivy', async () => {
    // Generate the full matrix and build it (also builds the images trivy scans).
    const { opts } = await runSmokeTest(targetDir, pkgMgr);

    // Scan every image built by the matrix. Fails on HIGH/CRITICAL findings.
    await runCLI(
      `run-many --target trivy --all --output-style=stream --verbose`,
      opts,
    );
  });
});
