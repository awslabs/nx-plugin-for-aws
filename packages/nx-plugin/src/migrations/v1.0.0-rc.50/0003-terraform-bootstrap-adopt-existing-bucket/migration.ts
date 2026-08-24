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
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import {
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Adopt an existing Terraform state bucket in the vended bootstrap script when its state object is missing
 *
 * The state bucket stores its own tfstate inside itself, so if that object is
 * deleted while the bucket survives, `bootstrap` reads the 404 as a first run
 * and asks terraform to create a bucket that already exists — failing with
 * `BucketAlreadyOwnedByYou` on every subsequent run, with no retry that clears
 * it. The vended script now imports the existing bucket instead.
 *
 * Every edit is expressed as a GritQL rewrite so the script is matched on its
 * AST rather than its formatting.
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

// Guards the whole migration: present only once the import step exists.
const MIGRATED_PATTERN = '`bucketExists($_, $_)`';

// Every edit site, matched structurally so formatting and argument layout
// don't affect whether the script is recognised.
const STATE_FETCH_TRY_PATTERN =
  'try_statement() as $try where { $try <: contains `GetObjectCommand` }';
const STATE_FLAG_SET_PATTERN = '`if (out.Body) { $body }`';
const HELPER_PATTERN = '`const main = async () => { $body }`';
const INIT_PATTERN = "`execFileSync('terraform', ['init'], $opts)`";
const S3_IMPORT_PATTERN =
  "`import { $before, GetObjectCommand, $after } from '@aws-sdk/client-s3'`";
const HEADER_COMMENT_PATTERN =
  'comment() as $c where { $c <: includes "state back to S3." }';

// GritQL snippets are parsed as backtick-quoted patterns, so any backtick in
// the inserted source has to survive that layer escaped.
const BUCKET_EXISTS_HELPER = `// S3 answers 404 only when the name is genuinely free; 403 means it exists
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
};`;

const IMPORT_STEP = `// The bucket holds its own state, so losing the state object while the
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
  }`;

// Rewritten wholesale rather than appended to, since the summary sentence
// changes rather than gaining a clause.
const NEW_HEADER_COMMENT = `/**
 * Bootstraps the remote Terraform state bucket.
 *
 * Equivalent to \\\`cdk bootstrap\\\` — resolves account + region from the AWS
 * SDK credential chain, pulls any existing bootstrap tfstate from S3,
 * runs \\\`terraform apply\\\` in the \\\`bootstrap\\\` dir, then pushes the new
 * state back to S3. Adopts an already-existing state bucket when its
 * state object is missing.
 */`;

const DIVERGED_NEXT_STEP = (filePath: string) =>
  `${filePath}: the bootstrap script has diverged from the generated shape - left untouched. Manually \`terraform import aws_s3_bucket.terraform_state <bucket>\` before \`terraform apply\` when the state bucket exists but its \`bootstrap.tfstate\` object does not, otherwise bootstrap fails with BucketAlreadyOwnedByYou.`;

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
    if (await matchGritQL(tree, filePath, MIGRATED_PATTERN)) {
      // Already migrated - silent skip keeps re-runs a no-op.
      continue;
    }

    // Confirm every edit site is present before writing any of them, so a
    // script that only partly matches is left whole rather than half-edited.
    const allSitesPresent = (
      await Promise.all(
        [
          STATE_FETCH_TRY_PATTERN,
          STATE_FLAG_SET_PATTERN,
          HELPER_PATTERN,
          INIT_PATTERN,
          S3_IMPORT_PATTERN,
          HEADER_COMMENT_PATTERN,
        ].map((pattern) => matchGritQL(tree, filePath, pattern)),
      )
    ).every(Boolean);

    if (!allSitesPresent) {
      nextSteps.push(DIVERGED_NEXT_STEP(filePath));
      continue;
    }

    // `haveState` distinguishes "no remote state" from "no bucket", so the
    // import only runs when terraform has no prior knowledge of the bucket.
    await insertViaGritQL(
      tree,
      filePath,
      `${STATE_FETCH_TRY_PATTERN} => \`${GRIT_INSERT_PLACEHOLDER}\n  $try\``,
      'let haveState = false;',
    );
    await applyGritQL(
      tree,
      filePath,
      `${STATE_FLAG_SET_PATTERN} => \`if (out.Body) {\n      $body\n      haveState = true;\n    }\``,
    );
    await insertViaGritQL(
      tree,
      filePath,
      `${HELPER_PATTERN} => \`${GRIT_INSERT_PLACEHOLDER}\n\nconst main = async () => { $body }\``,
      BUCKET_EXISTS_HELPER,
    );
    await insertViaGritQL(
      tree,
      filePath,
      `${INIT_PATTERN} => \`execFileSync('terraform', ['init'], $opts);\n\n  ${GRIT_INSERT_PLACEHOLDER}\n\``,
      IMPORT_STEP,
    );

    // Placed in the generator's import position rather than appended, so a
    // migrated workspace matches a freshly generated one.
    await applyGritQL(
      tree,
      filePath,
      `${S3_IMPORT_PATTERN} => \`import { $before, GetObjectCommand, HeadBucketCommand, $after } from '@aws-sdk/client-s3'\``,
    );

    await applyGritQL(
      tree,
      filePath,
      `${HEADER_COMMENT_PATTERN} => \`${NEW_HEADER_COMMENT}\``,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
