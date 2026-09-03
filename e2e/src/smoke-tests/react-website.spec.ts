/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
// eslint-disable-next-line
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
  SHARED_SHADCN_NAME,
} from '../../../packages/nx-plugin/src/utils/shared-constructs-constants';
// eslint-disable-next-line
import { TS_VERSIONS } from '../../../packages/nx-plugin/src/utils/versions';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

describe('smoke test - react-website', () => {
  const pkgMgr = 'pnpm';
  const workspaceName = 'react-website';
  const targetDir = `${tmpProjPath()}/react-website-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      workspaceName,
      'cdk',
    );
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive`,
      opts,
    );

    const permutations = [
      { name: 'website-none', ux: 'none', tanstackRouter: true },
      {
        name: 'website-shadcn',
        ux: 'shadcn',
        tanstackRouter: true,
      },
      {
        name: 'website-cloudscape',
        ux: 'cloudscape',
        tanstackRouter: true,
      },
      {
        name: 'website-none-no-router',
        ux: 'none',
        tanstackRouter: false,
      },
      {
        name: 'website-shadcn-no-router',
        ux: 'shadcn',
        tanstackRouter: false,
      },
      {
        name: 'website-cloudscape-no-router',
        ux: 'cloudscape',
        tanstackRouter: false,
      },
    ] as const;

    for (const { name, ux, tanstackRouter } of permutations) {
      const args = [
        `generate @aws/nx-plugin:ts#website`,
        `--name=${name}`,
        `--ux=${ux}`,
        `--tanstackRouter=${tanstackRouter}`,
        `--no-interactive`,
      ];

      await runCLI(args.join(' '), opts);

      await runCLI(
        `generate @aws/nx-plugin:ts#website#auth --project=${name} --cognitoDomain=${name} --no-interactive --allowSignup=false`,
        opts,
      );

      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=${name} --targetProject=my-api --no-interactive`,
        opts,
      );
    }

    // The shadcn CLI resolves `components.json`'s aliases through the shared
    // package's `imports`/`exports` maps rather than a tsconfig `paths` entry.
    // Both documented invocations are covered: a wrong alias shape makes the
    // CLI join the alias against its own cwd and write the component to a
    // doubled path (`packages/common/shadcn/packages/common/shadcn/...`)
    // instead of the package's `src`.
    const shadcnDir = `${PACKAGES_DIR}/${SHARED_SHADCN_DIR}`;
    const shadcnRoot = join(projectRoot, shadcnDir);
    const shadcnAddCommand = `pnpm dlx shadcn@${TS_VERSIONS.shadcn} add`;

    await runCLI(`${shadcnAddCommand} dialog -c ${shadcnDir} --yes`, {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });

    // Run from inside the package too — its README documents this form, and the
    // CLI resolves relative to a different cwd each way.
    await runCLI(`${shadcnAddCommand} popover --yes`, {
      ...opts,
      cwd: shadcnRoot,
      prefixWithPackageManagerCmd: false,
    });

    for (const component of ['dialog', 'popover']) {
      const componentPath = join(
        shadcnRoot,
        'src',
        'components',
        'ui',
        `${component}.tsx`,
      );
      expect(existsSync(componentPath), componentPath).toBe(true);
      // Aliases resolve to the package-local `#...` specifiers, not the
      // public `<scope>/common-shadcn/...` name. The CLI writes its own quote
      // style, so match either.
      expect(readFileSync(componentPath, 'utf-8')).toMatch(
        /from ['"]#lib\/utils['"]/,
      );
    }

    expect(existsSync(join(shadcnRoot, 'packages'))).toBe(false);

    // The shadcn CLI writes its own formatting, so the added components need a
    // format pass before the shared package's `format` target is satisfied.
    await runCLI(
      `run @${workspaceName}/${SHARED_SHADCN_NAME}:format --configuration=fix`,
      opts,
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );
  });
});
