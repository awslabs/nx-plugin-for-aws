/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { tsReactWebsiteGenerator } from '../../../ts/react-website/app/generator';
import { tsWebsiteAuthGenerator } from '../../../ts/website/auth/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const CDK_FILE = 'packages/common/constructs/src/core/user-identity.ts';
const TERRAFORM_FILE =
  'packages/common/terraform/src/core/user-identity/identity/identity.tf';

const SSRF_RULE = 'EC2MetaDataSSRF_QUERYARGUMENTS';

/**
 * Generate a website with auth, then rewind the Web ACL to the shape the
 * generators vended before this fix — so the "before" state is derived from
 * today's output rather than a fixture that can drift away from it.
 */
const generateAndRewind = async (tree: Tree, iac: 'cdk' | 'terraform') => {
  await tsReactWebsiteGenerator(tree, {
    name: 'test-website',
    iac,
    ux: 'cloudscape',
  });
  await tsWebsiteAuthGenerator(tree, {
    project: 'test-website',
    allowSignup: false,
    iac,
  });

  const filePath = iac === 'cdk' ? CDK_FILE : TERRAFORM_FILE;
  const current = tree.read(filePath, 'utf-8') ?? '';

  // Cut from the end of the vendor name line to the statement's closing brace,
  // matched by indentation so nothing after the override is left orphaned.
  const [anchor, closer, replacement] =
    iac === 'cdk'
      ? ["              vendorName: 'AWS',\n", '\n            },\n', '']
      : ['        vendor_name = "AWS"\n', '\n      }\n', ''];

  const start = current.indexOf(anchor) + anchor.length;
  const end = current.indexOf(closer, start);
  const rewound =
    current.slice(0, start) + replacement + current.slice(end + 1);

  tree.write(filePath, rewound);
  return { filePath, current, rewound };
};

describe('user-identity-waf-allow-localhost-callback migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no user identity', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  describe.each(['cdk', 'terraform'] as const)('%s', (iac) => {
    it('should start from a fixture that lacks the override', async () => {
      // Guards the rewind: if it left the override in place, every assertion
      // below would pass without the migration doing anything.
      const { current, rewound } = await generateAndRewind(tree, iac);
      expect(current).toContain(SSRF_RULE);
      expect(rewound).not.toContain(SSRF_RULE);
    });

    it('should produce exactly what the current generator vends', async () => {
      const { filePath, current } = await generateAndRewind(tree, iac);

      const result = await migration(tree);

      // The point of a migration: the workspace ends up byte-identical to one
      // generated from today's generators.
      expect(tree.read(filePath, 'utf-8')).toEqual(current);
      expect(result.nextSteps.some((s) => s.includes(filePath))).toBeTruthy();
    });

    it('should leave an already-migrated workspace untouched and unreported', async () => {
      await tsReactWebsiteGenerator(tree, {
        name: 'test-website',
        iac,
        ux: 'cloudscape',
      });
      await tsWebsiteAuthGenerator(tree, {
        project: 'test-website',
        allowSignup: false,
        iac,
      });
      const filePath = iac === 'cdk' ? CDK_FILE : TERRAFORM_FILE;
      const before = tree.read(filePath, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(filePath, 'utf-8')).toEqual(before);
      expect(result.nextSteps).toEqual([]);
    });

    it('should not touch the KnownBadInputs rule group', async () => {
      const { filePath } = await generateAndRewind(tree, iac);

      await migration(tree);
      const migrated = tree.read(filePath, 'utf-8') ?? '';

      // The override belongs to the common rule set only. Sliced from the
      // KnownBadInputs rule group's own statement rather than the first mention
      // of its name, which appears in the doc comment above the Web ACL.
      const knownBadInputs = migrated.slice(
        migrated.lastIndexOf('AWSManagedRulesKnownBadInputsRuleSet'),
      );
      expect(knownBadInputs).not.toContain(SSRF_RULE);
      // Once in the explanatory comment, once as the overridden rule name.
      expect(migrated.match(new RegExp(SSRF_RULE, 'g'))).toHaveLength(2);
    });

    it('should skip and report a Web ACL which has diverged', async () => {
      const { filePath, rewound } = await generateAndRewind(tree, iac);
      // A user who swapped the managed rule group for their own — the edit site
      // the migration looks for is gone.
      tree.write(
        filePath,
        rewound.replace(
          /AWSManagedRulesCommonRuleSet/g,
          'MyOrgCustomRuleGroup',
        ),
      );

      const result = await migration(tree);

      expect(tree.read(filePath, 'utf-8')).not.toContain(SSRF_RULE);
      expect(
        result.nextSteps.some(
          (s) => s.includes(filePath) && s.includes('diverged'),
        ),
      ).toBeTruthy();
    });
  });

  it('should migrate a customised Web ACL without disturbing the customisation', async () => {
    const { filePath, rewound } = await generateAndRewind(tree, 'cdk');
    // An extra rule alongside the managed groups — the kind of local change
    // that defeats literal matching but not an AST rewrite.
    tree.write(
      filePath,
      rewound.replace(
        "        {\n          name: 'KnownBadInputsRule',",
        "        {\n          name: 'MyOrgRateLimit',\n          priority: 2,\n          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },\n          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RateLimit', sampledRequestsEnabled: true },\n          action: { block: {} },\n        },\n        {\n          name: 'KnownBadInputsRule',",
      ),
    );

    const result = await migration(tree);
    const migrated = tree.read(filePath, 'utf-8') ?? '';

    expect(migrated).toContain(SSRF_RULE);
    expect(migrated).toContain('MyOrgRateLimit');
    expect(migrated).toContain('rateBasedStatement');
    expect(result.nextSteps.some((s) => s.includes(filePath))).toBeTruthy();
  });
});
