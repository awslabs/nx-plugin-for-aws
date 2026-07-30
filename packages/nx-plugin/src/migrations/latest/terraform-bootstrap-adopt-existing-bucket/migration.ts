/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator';
import { formatFilesInSubtree } from '../../../utils/format';

/**
 * Adopt an existing Terraform state bucket in the vended bootstrap script when its state object is missing
 *
 * The state bucket stores its own tfstate inside itself, so if that object is
 * deleted while the bucket survives, `bootstrap` reads the 404 as a first run
 * and asks terraform to create a bucket that already exists — failing with
 * `BucketAlreadyOwnedByYou` on every subsequent run, with no retry that clears
 * it. The vended script now imports the existing bucket instead.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, or consider a
 *   hybrid migration, rather than clobbering the user's changes.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files your
 *   migration wrote are formatted correctly.
 */

// Marks the migrated shape — the guard that decides whether to import.
const MIGRATED_MARKER = 'await bucketExists(s3, bucket)';

// `haveState` records whether the remote state object was actually pulled, so
// the import only runs when terraform has no prior knowledge of the bucket.
const STATE_FLAG_ANCHOR = `  try {
    const out = await s3.send(`;
const STATE_FLAG_REPLACEMENT = `  let haveState = false;
  try {
    const out = await s3.send(`;

const STATE_FLAG_SET_ANCHOR = `      writeFileSync(tfStatePath, await out.Body.transformToByteArray());
    }`;
const STATE_FLAG_SET_REPLACEMENT = `      writeFileSync(tfStatePath, await out.Body.transformToByteArray());
      haveState = true;
    }`;

const HELPER_ANCHOR = `
const main = async () => {`;
const HELPER_REPLACEMENT = `
// S3 answers 404 only when the name is genuinely free; 403 means it exists
// but is not readable with these credentials.
const bucketExists = async (s3: S3Client, bucket: string) => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404) return false;
    if (status === 403) return true;
    throw err;
  }
};

const main = async () => {`;

const IMPORT_ANCHOR = `  execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });
  execFileSync(`;
const IMPORT_REPLACEMENT = `  execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });

  // The bucket holds its own state, so losing the state object while the
  // bucket survives would otherwise wedge bootstrap on a permanent
  // \`BucketAlreadyOwnedByYou\`. Adopt the existing bucket instead.
  if (!haveState && (await bucketExists(s3, bucket))) {
    console.log(
      \`State bucket \${bucket} already exists but its bootstrap state is missing — importing it.\`,
    );
    execFileSync(
      'terraform',
      [
        'import',
        \`-state=\${tfStatePath}\`,
        \`-var=aws_region=\${region}\`,
        'aws_s3_bucket.terraform_state',
        bucket,
      ],
      { cwd: bootstrapDir, stdio: 'inherit' },
    );
  }

  execFileSync(`;

const DOC_ANCHOR = ` * state back to S3.
 */`;
const DOC_REPLACEMENT = ` * state back to S3. Adopts an already-existing state bucket when its
 * state object is missing.
 */`;

// Matches the generator's import order rather than appending, so a migrated
// workspace is byte-identical to a freshly generated one.
const IMPORT_ANCHOR_S3 = `  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';`;
const IMPORT_REPLACEMENT_S3 = `  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  // Terraform application projects are the only ones that vend bootstrap.ts.
  const bootstrapScripts = [...getProjects(tree).values()]
    .filter(
      (project) =>
        (project.metadata as any)?.generator ===
        TERRAFORM_PROJECT_GENERATOR_INFO.id,
    )
    .map((project) => joinPathFragments(project.root, 'scripts/bootstrap.ts'))
    .filter((filePath) => tree.exists(filePath));

  for (const filePath of bootstrapScripts) {
    const contents = tree.read(filePath, 'utf-8') ?? '';

    if (contents.includes(MIGRATED_MARKER)) {
      // Already migrated - silent skip keeps re-runs a no-op.
      continue;
    }

    // Every anchor must be present before writing any of them, so a partially
    // matching (customised) script is left whole rather than half-edited.
    const anchors = [
      IMPORT_ANCHOR_S3,
      STATE_FLAG_ANCHOR,
      STATE_FLAG_SET_ANCHOR,
      HELPER_ANCHOR,
      IMPORT_ANCHOR,
    ];
    if (anchors.some((anchor) => !contents.includes(anchor))) {
      nextSteps.push(
        `${filePath}: the bootstrap script has diverged from the generated shape - left untouched. Manually \`terraform import aws_s3_bucket.terraform_state <bucket>\` before \`terraform apply\` when the state bucket exists but its \`bootstrap.tfstate\` object does not, otherwise bootstrap fails with BucketAlreadyOwnedByYou.`,
      );
      continue;
    }

    tree.write(
      filePath,
      contents
        .replace(DOC_ANCHOR, DOC_REPLACEMENT)
        .replace(IMPORT_ANCHOR_S3, IMPORT_REPLACEMENT_S3)
        .replace(STATE_FLAG_ANCHOR, STATE_FLAG_REPLACEMENT)
        .replace(STATE_FLAG_SET_ANCHOR, STATE_FLAG_SET_REPLACEMENT)
        .replace(HELPER_ANCHOR, HELPER_REPLACEMENT)
        .replace(IMPORT_ANCHOR, IMPORT_REPLACEMENT),
    );

    nextSteps.push(
      `${filePath}: now adopts an existing Terraform state bucket when its bootstrap.tfstate object is missing.`,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
