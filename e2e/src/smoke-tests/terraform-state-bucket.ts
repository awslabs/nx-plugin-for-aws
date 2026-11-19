/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createAwsClient, getRegion } from './deploy-invocations';

/**
 * Whether the Terraform state bucket that the generated `bootstrap` target
 * creates (`<account>-tf-state-<region>`) already exists. It makes two
 * read-only calls: STS `GetCallerIdentity` and S3 `HeadBucket`.
 *
 * It answers `true` only when S3 says the bucket exists: 200, or 403 (it
 * exists but these credentials cannot read it), as the bootstrap script does.
 * Any other answer, including a failed call, is `false`, so a caller that
 * runs `bootstrap` when this is `false` keeps the bootstrap behaviour.
 */
export async function terraformStateBucketExists(): Promise<boolean> {
  const region = getRegion();
  try {
    const sts = await createAwsClient('sts');
    const identity = await sts.fetch(`https://sts.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'Action=GetCallerIdentity&Version=2011-06-15',
    });
    const account = /<Account>(\d{12})<\/Account>/.exec(
      await identity.text(),
    )?.[1];
    if (!identity.ok || !account) {
      console.warn(
        `GetCallerIdentity returned ${identity.status}; running bootstrap`,
      );
      return false;
    }

    const bucket = `${account}-tf-state-${region}`;
    const s3 = await createAwsClient('s3');
    const head = await s3.fetch(
      `https://${bucket}.s3.${region}.amazonaws.com/`,
      {
        method: 'HEAD',
      },
    );
    console.log(`HeadBucket ${bucket}: ${head.status}`);
    return head.status === 200 || head.status === 403;
  } catch (e) {
    console.warn(`State bucket check failed (${e}); running bootstrap`);
    return false;
  }
}
