/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import { terraformProjectGenerator } from '../../../terraform/project/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const BOOTSTRAP_FILE = 'packages/infra/scripts/bootstrap.ts';

// Today's vended script, read from the template the generator uses — so this
// suite fails if the template moves on without the migration following it.
const CURRENT_TEMPLATE = readFileSync(
  join(
    import.meta.dirname,
    '../../../terraform/project/files/application/scripts/bootstrap.ts.template',
  ),
  'utf-8',
);

// The script as generated before the fix — verbatim, so the "before" state is
// exactly what users are upgrading from rather than something derived.
const PRE_FIX_BOOTSTRAP = `/**
 * Bootstraps the remote Terraform state bucket.
 *
 * Equivalent to \`cdk bootstrap\` — resolves account + region from the AWS
 * SDK credential chain, pulls any existing bootstrap tfstate from S3,
 * runs \`terraform apply\` in the \`bootstrap\` dir, then pushes the new
 * state back to S3.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { resolveAwsConfig } from './aws-config';

const projectRootRel = process.argv[2];
if (!projectRootRel) {
  throw new Error(
    'Expected the project root as argv[2] — this script is wired up by the generated \`bootstrap\` nx target and should be invoked through it.',
  );
}
const workspaceRoot = process.cwd();
const projectRoot = resolve(workspaceRoot, projectRootRel);
const bootstrapDir = join(projectRoot, 'bootstrap');
const tfStatePath = join(
  workspaceRoot,
  'dist',
  projectRootRel,
  'terraform',
  'bootstrap.tfstate',
);

const main = async () => {
  const { accountId, region } = await resolveAwsConfig();
  const bucket = \`\${accountId}-tf-state-\${region}\`;
  const key = 'bootstrap.tfstate';

  const s3 = new S3Client({ region, credentials: fromNodeProviderChain() });

  mkdirSync(dirname(tfStatePath), { recursive: true });

  // Pull any existing bootstrap tfstate. First-time bootstrap has no
  // remote state yet — fall through and let terraform apply create the
  // bucket.
  try {
    const out = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (out.Body) {
      writeFileSync(tfStatePath, await out.Body.transformToByteArray());
    }
  } catch (err: any) {
    const name = err?.name ?? '';
    const status = err?.\$metadata?.httpStatusCode;
    const firstRun =
      name === 'NoSuchBucket' ||
      name === 'NoSuchKey' ||
      status === 404 ||
      status === 403;
    if (!firstRun) throw err;
  }

  execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });
  execFileSync(
    'terraform',
    [
      'apply',
      '-auto-approve',
      \`-state=\${tfStatePath}\`,
      \`-var=aws_region=\${region}\`,
    ],
    { cwd: bootstrapDir, stdio: 'inherit' },
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(tfStatePath),
    }),
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

/** Generates a terraform application project, then reverts its bootstrap.ts. */
const generateWithPreFixBootstrap = async (tree: Tree) => {
  await terraformProjectGenerator(tree, {
    name: 'infra',
    type: 'application',
    directory: 'packages',
  });
  tree.write(BOOTSTRAP_FILE, PRE_FIX_BOOTSTRAP);
};

describe('terraform-bootstrap-adopt-existing-bucket migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should start from a fixture that lacks the fix', () => {
    // Guards the fixture: if it already contained the fix, every assertion
    // below would pass without the migration doing anything.
    expect(PRE_FIX_BOOTSTRAP).not.toEqual(CURRENT_TEMPLATE);
    expect(PRE_FIX_BOOTSTRAP).not.toContain('HeadBucketCommand');
    expect(PRE_FIX_BOOTSTRAP).not.toContain('haveState');
    expect(PRE_FIX_BOOTSTRAP).not.toContain("'aws_s3_bucket.terraform_state'");
  });

  it('should be a no-op when the workspace has no terraform project', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should produce exactly what the current generator vends', async () => {
    await generateWithPreFixBootstrap(tree);

    const result = await migration(tree);

    // The point of a migration: the workspace ends up byte-identical to one
    // generated from today's generators.
    expect(tree.read(BOOTSTRAP_FILE, 'utf-8')).toEqual(CURRENT_TEMPLATE);
    expect(
      result.nextSteps.some((s) => s.includes(BOOTSTRAP_FILE)),
    ).toBeTruthy();
  });

  it('should leave an already-migrated project untouched and unreported', async () => {
    await terraformProjectGenerator(tree, {
      name: 'infra',
      type: 'application',
      directory: 'packages',
    });

    const result = await migration(tree);

    expect(tree.read(BOOTSTRAP_FILE, 'utf-8')).toEqual(CURRENT_TEMPLATE);
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a customised script', async () => {
    await generateWithPreFixBootstrap(tree);
    // A comment between `init` and the `apply` call breaks the anchor the
    // migration keys off, standing in for any local edit to this region.
    const customised = PRE_FIX_BOOTSTRAP.replace(
      "  execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });\n  execFileSync(",
      "  execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });\n\n  // a local customisation\n  execFileSync(",
    );
    tree.write(BOOTSTRAP_FILE, customised);

    const result = await migration(tree);

    // Reported rather than rewritten — a half-applied edit is worse than none.
    expect(tree.read(BOOTSTRAP_FILE, 'utf-8')).toEqual(customised);
    expect(
      result.nextSteps.some(
        (s) => s.includes(BOOTSTRAP_FILE) && s.includes('diverged'),
      ),
    ).toBeTruthy();
  });

  it('should not touch a terraform library project', async () => {
    await terraformProjectGenerator(tree, {
      name: 'tf-lib',
      type: 'library',
      directory: 'packages',
    });

    const result = await migration(tree);

    // Libraries never vend bootstrap.ts.
    expect(tree.exists('packages/tf-lib/scripts/bootstrap.ts')).toBeFalsy();
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generateWithPreFixBootstrap(tree);

    await migration(tree);
    const afterFirst = tree.read(BOOTSTRAP_FILE, 'utf-8');

    const secondResult = await migration(tree);

    expect(tree.read(BOOTSTRAP_FILE, 'utf-8')).toEqual(afterFirst);
    expect(secondResult.nextSteps).toEqual([]);
  });
});
