/**
 * Bootstraps the remote Terraform state bucket.
 *
 * Equivalent to `cdk bootstrap` — resolves account + region from the AWS
 * SDK credential chain, pulls any existing bootstrap tfstate from S3,
 * runs `terraform apply` in the `bootstrap` dir, then pushes the new
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
    'Expected the project root as argv[2] — this script is wired up by the generated `bootstrap` nx target and should be invoked through it.',
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
  const bucket = `${accountId}-tf-state-${region}`;
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
    const status = err?.$metadata?.httpStatusCode;
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
      `-state=${tfStatePath}`,
      `-var=aws_region=${region}`,
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
