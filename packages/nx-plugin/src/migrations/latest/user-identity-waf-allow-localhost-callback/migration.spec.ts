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
 * Each entry reverses one of the migration's edits, so the "before" state is
 * derived from today's generator output rather than a fixture which can drift
 * away from it.
 */
const REWINDS: Record<'cdk' | 'terraform', Array<[string, string]>> = {
  cdk: [
    [
      `const WEB_CLIENT_ID = 'WebClient';\n\n/** Local dev server origins permitted to complete the sign-in redirect */\nconst LOCAL_CALLBACK_URLS = ['http://localhost:4200', 'http://localhost:4300'];`,
      `const WEB_CLIENT_ID = 'WebClient';`,
    ],
    [
      'LOCAL_CALLBACK_URLS.concat(',
      "['http://localhost:4200', 'http://localhost:4300'].concat(",
    ],
    [
      'this.createWebAcl(\n        id,\n        this.userPool,\n        LOCAL_CALLBACK_URLS.length > 0,\n      )',
      'this.createWebAcl(id, this.userPool)',
    ],
    [
      'private createWebAcl = (\n    id: string,\n    userPool: UserPool,\n    allowsLocalCallback: boolean,\n  ) =>',
      'private createWebAcl = (id: string, userPool: UserPool) =>',
    ],
    [
      `              // ${SSRF_RULE} treats the loopback redirect_uri the\n              // Hosted UI receives during local sign-in as an SSRF attempt. Counted\n              // only while a local callback URL is allowed; every other rule blocks.\n              ruleActionOverrides: allowsLocalCallback\n                ? [\n                    {\n                      name: '${SSRF_RULE}',\n                      actionToUse: { count: {} },\n                    },\n                  ]\n                : undefined,\n`,
      '',
    ],
  ],
  terraform: [
    [
      'data "aws_region" "current" {}\n\nlocals {\n  # Local dev server origins permitted to complete the sign-in redirect\n  local_callback_urls = [\n    "http://localhost:4200",\n    "http://localhost:4300"\n  ]\n}',
      'data "aws_region" "current" {}',
    ],
    [
      'callback_urls = concat(local.local_callback_urls, var.callback_urls)',
      'callback_urls = concat([\n    "http://localhost:4200",\n    "http://localhost:4300"\n  ], var.callback_urls)',
    ],
    [
      'logout_urls = concat(local.local_callback_urls, var.logout_urls)',
      'logout_urls = concat([\n    "http://localhost:4200",\n    "http://localhost:4300"\n  ], var.logout_urls)',
    ],
    [
      `\n\n        # ${SSRF_RULE} treats the loopback redirect_uri the\n        # Hosted UI receives during local sign-in as an SSRF attempt. Counted\n        # only while a local callback URL is allowed; every other rule blocks.\n        dynamic "rule_action_override" {\n          for_each = length(local.local_callback_urls) > 0 ? [1] : []\n\n          content {\n            name = "${SSRF_RULE}"\n\n            action_to_use {\n              count {}\n            }\n          }\n        }`,
      '',
    ],
  ],
};

const generateWithAuth = async (tree: Tree, iac: 'cdk' | 'terraform') => {
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
  return iac === 'cdk' ? CDK_FILE : TERRAFORM_FILE;
};

const generateAndRewind = async (tree: Tree, iac: 'cdk' | 'terraform') => {
  const filePath = await generateWithAuth(tree, iac);
  const current = tree.read(filePath, 'utf-8') ?? '';

  let rewound = current;
  for (const [from, to] of REWINDS[iac]) {
    if (!rewound.includes(from)) {
      throw new Error(
        `Rewind for ${iac} no longer matches the generated file. Missing:\n${from}`,
      );
    }
    rewound = rewound.replace(from, to);
  }

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
      const filePath = await generateWithAuth(tree, iac);
      const before = tree.read(filePath, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(filePath, 'utf-8')).toEqual(before);
      expect(result.nextSteps).toEqual([]);
    });

    it('should make the override conditional on a local callback URL', async () => {
      const { filePath } = await generateAndRewind(tree, iac);

      await migration(tree);
      const migrated = tree.read(filePath, 'utf-8') ?? '';

      // The override is derived from the local callback URLs rather than
      // restating the condition, so removing them restores the rule to Block.
      if (iac === 'cdk') {
        expect(migrated).toContain('const LOCAL_CALLBACK_URLS');
        expect(migrated).toContain(
          'ruleActionOverrides: allowsLocalCallback\n',
        );
        expect(migrated).toContain('LOCAL_CALLBACK_URLS.length > 0');
      } else {
        expect(migrated).toContain('local_callback_urls = [');
        expect(migrated).toContain(
          'for_each = length(local.local_callback_urls) > 0 ? [1] : []',
        );
      }
    });

    it('should not touch the KnownBadInputs rule group', async () => {
      const { filePath } = await generateAndRewind(tree, iac);

      await migration(tree);
      const migrated = tree.read(filePath, 'utf-8') ?? '';

      // Sliced from the KnownBadInputs rule group's own statement rather than
      // the first mention of its name, which appears in the doc comment above.
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
