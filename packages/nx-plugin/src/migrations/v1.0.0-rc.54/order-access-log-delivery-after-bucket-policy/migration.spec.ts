/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const STATIC_WEBSITE_FILE =
  'packages/common/constructs/src/core/static-website.ts';

/**
 * The `deliverAccessLogsToCloudWatch` helper as generated prior to this fix.
 * `bucketParam` renames the bucket the delivery source targets, and
 * `bucketImport` controls whether the concrete `Bucket` type is imported, so
 * tests can vary both independently of the rest of the shape.
 */
const oldStaticWebsiteFile = ({
  bucketParam = 'bucket',
  bucketImport = "import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';",
}: {
  bucketParam?: string;
  bucketImport?: string;
} = {}) =>
  `import { Lazy, Names } from 'aws-cdk-lib';
${bucketImport}
import {
  CfnDelivery,
  CfnDeliveryDestination,
  CfnDeliverySource,
  LogGroup,
} from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class StaticWebsite extends Construct {
  /**
   * Delivers a bucket's S3 server access logs to a CloudWatch log group using
   * CloudWatch Logs vended log delivery.
   */
  private deliverAccessLogsToCloudWatch(
    id: string,
    ${bucketParam}: IBucket,
    logGroup: LogGroup,
  ) {
    const source: CfnDeliverySource = new CfnDeliverySource(
      this,
      \`\${id}AccessLogsSource\`,
      {
        name: Lazy.string({
          produce: () => Names.uniqueResourceName(source, { maxLength: 60 }),
        }),
        logType: 'S3_SERVER_ACCESS_LOGS',
        resourceArn: ${bucketParam}.bucketArn,
      },
    );
    const destination: CfnDeliveryDestination = new CfnDeliveryDestination(
      this,
      \`\${id}AccessLogsDestination\`,
      {
        name: Lazy.string({
          produce: () => Names.uniqueResourceName(destination, { maxLength: 60 }),
        }),
        destinationResourceArn: logGroup.logGroupArn,
      },
    );
    const delivery = new CfnDelivery(this, \`\${id}AccessLogsDelivery\`, {
      deliverySourceName: source.name,
      deliveryDestinationArn: destination.attrArn,
    });
    delivery.addDependency(source);
  }
}
`;

const OLD_STATIC_WEBSITE_FILE = oldStaticWebsiteFile();

describe('order-access-log-delivery-after-bucket-policy migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the static website construct does not exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(STATIC_WEBSITE_FILE)).toBeFalsy();
  });

  it('should order the delivery source after the bucket policy', async () => {
    tree.write(STATIC_WEBSITE_FILE, OLD_STATIC_WEBSITE_FILE);

    const result = await migration(tree);

    const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
    expect(contents).toContain(
      'const bucketPolicy = (bucket as Bucket).policy',
    );
    expect(contents).toContain('source.node.addDependency(bucketPolicy)');

    // The dependency must be added after the delivery source is constructed,
    // and before the delivery is created.
    const sourceIdx = contents.indexOf('resourceArn: bucket.bucketArn');
    const depIdx = contents.indexOf('source.node.addDependency(bucketPolicy)');
    const deliveryIdx = contents.indexOf('new CfnDelivery(');
    expect(sourceIdx).toBeLessThan(depIdx);
    expect(depIdx).toBeLessThan(deliveryIdx);

    // The rest of the helper is preserved.
    expect(contents).toContain('delivery.addDependency(source)');
    expect(contents).toContain('CfnDeliveryDestination');

    // Nothing left for the user to do, so nothing is reported.
    expect(result.nextSteps).toEqual([]);
  });

  it('should not add a comment above the dependency', async () => {
    tree.write(STATIC_WEBSITE_FILE, OLD_STATIC_WEBSITE_FILE);

    await migration(tree);

    const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
    const lines = contents.split('\n');
    const depLine = lines.findIndex((l) =>
      l.includes('const bucketPolicy = (bucket as Bucket).policy'),
    );
    expect(depLine).toBeGreaterThan(-1);
    // The statement directly follows the delivery source declaration, with no
    // explanatory comment introduced above it.
    expect(lines[depLine - 1].trim()).toEqual(');');
    expect(contents).not.toContain('OperationAborted');
  });

  describe('bucket the delivery targets', () => {
    it('should use the bucket the delivery source targets when renamed', async () => {
      // A user who renamed the helper's bucket parameter must still get a
      // dependency on *that* bucket's policy, not a hardcoded `bucket`.
      tree.write(
        STATIC_WEBSITE_FILE,
        oldStaticWebsiteFile({ bucketParam: 'targetBucket' }),
      );

      const result = await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      expect(contents).toContain(
        'const bucketPolicy = (targetBucket as Bucket).policy',
      );
      expect(contents).not.toContain('(bucket as Bucket)');
      expect(contents).toContain('source.node.addDependency(bucketPolicy)');
      expect(result.nextSteps).toEqual([]);
    });

    it('should reference the same bucket the delivery source targets', async () => {
      tree.write(
        STATIC_WEBSITE_FILE,
        oldStaticWebsiteFile({ bucketParam: 'assetsBucket' }),
      );

      await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      // The bucket cast in the inserted statement and the bucket whose ARN the
      // delivery source targets must be one and the same.
      const target = /resourceArn: (\w+)\.bucketArn/.exec(contents)?.[1];
      const cast = /const bucketPolicy = \((\w+) as Bucket\)\.policy/.exec(
        contents,
      )?.[1];
      expect(target).toEqual('assetsBucket');
      expect(cast).toEqual(target);
    });

    it('should cover every delivery source in the helper', async () => {
      // The generated helper is called once per bucket (website and
      // distribution logs), so ordering the single delivery source it builds
      // covers both. Guard that assumption: if a workspace grew a second
      // delivery source targeting a different bucket, the migration must not
      // silently order only the first.
      tree.write(STATIC_WEBSITE_FILE, OLD_STATIC_WEBSITE_FILE);

      await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      const sources = contents.match(/new CfnDeliverySource\(/g) ?? [];
      const deps =
        contents.match(/source\.node\.addDependency\(bucketPolicy\)/g) ?? [];
      expect(sources).toHaveLength(1);
      expect(deps).toHaveLength(sources.length);
    });

    it('should skip when the targeted bucket is not a declared parameter', async () => {
      // The delivery source targets a bucket that is not in scope in the
      // helper, so the migration must not write a reference to it.
      const diverged = OLD_STATIC_WEBSITE_FILE.replace(
        'resourceArn: bucket.bucketArn,',
        'resourceArn: someOtherBucket.bucketArn,',
      );
      tree.write(STATIC_WEBSITE_FILE, diverged);

      const result = await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      expect(contents).not.toContain('source.node.addDependency(bucketPolicy)');
      expect(contents).not.toContain('someOtherBucket as Bucket');
      expect(
        result.nextSteps.some((s) => s.includes(STATIC_WEBSITE_FILE)),
      ).toBeTruthy();
    });

    it('should skip when the delivery source targets a member expression', async () => {
      // `this.websiteBucket.bucketArn` cannot be cast and dereferenced by the
      // simple statement this migration writes, so leave the file alone.
      const diverged = OLD_STATIC_WEBSITE_FILE.replace(
        'resourceArn: bucket.bucketArn,',
        'resourceArn: this.websiteBucket.bucketArn,',
      );
      tree.write(STATIC_WEBSITE_FILE, diverged);

      const result = await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      expect(contents).not.toContain('source.node.addDependency(bucketPolicy)');
      expect(
        result.nextSteps.some((s) => s.includes(STATIC_WEBSITE_FILE)),
      ).toBeTruthy();
    });

    it('should skip when the delivery source has no bucket ARN', async () => {
      const diverged = OLD_STATIC_WEBSITE_FILE.replace(
        'resourceArn: bucket.bucketArn,',
        "resourceArn: 'arn:aws:s3:::hardcoded-bucket',",
      );
      tree.write(STATIC_WEBSITE_FILE, diverged);

      const result = await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      expect(contents).not.toContain('source.node.addDependency(bucketPolicy)');
      expect(
        result.nextSteps.some((s) => s.includes(STATIC_WEBSITE_FILE)),
      ).toBeTruthy();
    });
  });

  describe('Bucket type import', () => {
    it('should add the Bucket import when only IBucket is imported', async () => {
      // The inserted cast needs the concrete Bucket type, which the generated
      // helper's IBucket parameter does not provide.
      tree.write(
        STATIC_WEBSITE_FILE,
        oldStaticWebsiteFile({
          bucketImport: "import { IBucket } from 'aws-cdk-lib/aws-s3';",
        }),
      );

      await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      expect(contents).toContain('(bucket as Bucket).policy');
      expect(contents).toMatch(
        /import \{[^}]*\bBucket\b[^}]*\} from 'aws-cdk-lib\/aws-s3'/,
      );
      // IBucket is still needed by the parameter type.
      expect(contents).toMatch(
        /import \{[^}]*\bIBucket\b[^}]*\} from 'aws-cdk-lib\/aws-s3'/,
      );
    });

    it('should not duplicate an existing Bucket import', async () => {
      tree.write(STATIC_WEBSITE_FILE, OLD_STATIC_WEBSITE_FILE);

      await migration(tree);

      const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
      const s3Imports = contents.match(/from 'aws-cdk-lib\/aws-s3'/g) ?? [];
      expect(s3Imports).toHaveLength(1);
      const bucketNames =
        /import \{([^}]*)\} from 'aws-cdk-lib\/aws-s3'/
          .exec(contents)?.[1]
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n === 'Bucket') ?? [];
      expect(bucketNames).toHaveLength(1);
    });
  });

  it('should be idempotent', async () => {
    tree.write(STATIC_WEBSITE_FILE, OLD_STATIC_WEBSITE_FILE);

    await migration(tree);
    const afterFirst = tree.read(STATIC_WEBSITE_FILE, 'utf-8');

    const result = await migration(tree);
    const afterSecond = tree.read(STATIC_WEBSITE_FILE, 'utf-8');

    expect(afterSecond).toEqual(afterFirst);
    // The dependency is added exactly once.
    expect(
      afterSecond?.match(/source\.node\.addDependency\(bucketPolicy\)/g),
    ).toHaveLength(1);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent for a renamed bucket parameter', async () => {
    tree.write(
      STATIC_WEBSITE_FILE,
      oldStaticWebsiteFile({ bucketParam: 'targetBucket' }),
    );

    await migration(tree);
    const afterFirst = tree.read(STATIC_WEBSITE_FILE, 'utf-8');

    await migration(tree);

    expect(tree.read(STATIC_WEBSITE_FILE, 'utf-8')).toEqual(afterFirst);
    expect(
      afterFirst?.match(/const bucketPolicy = \(targetBucket as Bucket\)/g),
    ).toHaveLength(1);
  });

  it('should skip and report a customised helper', async () => {
    // A user who renamed the delivery source variable no longer matches the
    // generated shape, so the migration must leave the file alone.
    const customised = OLD_STATIC_WEBSITE_FILE.replace(
      /const source: CfnDeliverySource = new CfnDeliverySource\(\n {6}this,\n {6}`\$\{id\}AccessLogsSource`,/,
      [
        'const logSource: CfnDeliverySource = new CfnDeliverySource(',
        '      this,',
        // `${id}` here is CDK source text the construct interpolates at synth
        // time, so it is assembled rather than written as a literal.
        `      \`$\{id}CustomAccessLogsSource\`,`,
      ].join('\n'),
    );
    tree.write(STATIC_WEBSITE_FILE, customised);

    const result = await migration(tree);

    const contents = tree.read(STATIC_WEBSITE_FILE, 'utf-8') ?? '';
    expect(contents).not.toContain('source.node.addDependency(bucketPolicy)');
    expect(contents).toContain('CustomAccessLogsSource');
    expect(
      result.nextSteps.some((s) => s.includes(STATIC_WEBSITE_FILE)),
    ).toBeTruthy();
  });
});
