/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator.js';
import { tsReactWebsiteAuthGenerator } from '../../react-website/cognito-auth/generator.js';
import { federationNextSteps } from './federation.js';
import {
  TS_WEBSITE_AUTH_GENERATOR_INFO,
  tsWebsiteAuthGenerator,
} from './generator.js';
import type { TsWebsiteAuthGeneratorSchema } from './schema';

describe('ts#website#auth generator', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsReactWebsiteGenerator(tree, {
      name: 'test-website',
      iac: 'cdk',
      ux: 'cloudscape',
    });
  });

  it('should have correct generator info', () => {
    expect(TS_WEBSITE_AUTH_GENERATOR_INFO).toBeDefined();
    expect(TS_WEBSITE_AUTH_GENERATOR_INFO.id).toBe('ts#website#auth');
  });

  it('should delegate to ts#react-website#auth generator', async () => {
    const options: TsWebsiteAuthGeneratorSchema = {
      project: 'test-website',
      allowSignup: false,
      iac: 'cdk',
    };
    await tsWebsiteAuthGenerator(tree, options);
    expect(
      tree.exists('test-website/src/components/CognitoAuth/index.tsx'),
    ).toBeTruthy();
  });
});

const CORE_DIR = 'packages/common/constructs/src/core';
const USER_IDENTITY = `${CORE_DIR}/user-identity.ts`;
const OIDC_FILE = `${CORE_DIR}/oidc-identity-providers.ts`;

/** A tree with a website project that auth can be added to. */
const createWebsiteTree = (): Tree => {
  const tree = createTreeUsingTsSolutionSetup();
  tree.write(
    'packages/test-project/project.json',
    JSON.stringify({
      name: 'test-project',
      sourceRoot: 'packages/test-project/src',
      metadata: { ux: 'Cloudscape' },
    }),
  );
  tree.write(
    'packages/test-project/package.json',
    JSON.stringify({ name: '@proj/test-project', version: '0.0.0' }),
  );
  tree.write(
    'packages/test-project/src/main.tsx',
    `import { RuntimeConfigProvider } from './components/RuntimeConfig';
export function Main() {
  return (
    <RuntimeConfigProvider>
      <App />
    </RuntimeConfigProvider>
  );
}
`,
  );
  return tree;
};

/** Every changed file of the tree, by path. */
const files = (tree: Tree): Record<string, string | null> =>
  Object.fromEntries(
    tree
      .listChanges()
      .map((change) => [change.path, change.content?.toString() ?? null]),
  );

const count = (content: string, text: string): number =>
  content.split(text).length - 1;

describe('ts#website#auth generator federation', () => {
  const options = (
    iac: 'cdk' | 'terraform',
    federation?: 'none' | 'oidc',
  ): TsWebsiteAuthGeneratorSchema => ({
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
    iac,
    ...(federation ? { federation } : {}),
  });

  describe.each(['cdk', 'terraform'] as const)(
    'without federation (%s)',
    (iac) => {
      it('should write the same files as ts#react-website#auth, with or without federation: none', async () => {
        const direct = createWebsiteTree();
        await tsReactWebsiteAuthGenerator(direct, {
          project: 'test-project',
          cognitoDomain: 'test',
          allowSignup: true,
          iac,
        });
        const unset = createWebsiteTree();
        await tsWebsiteAuthGenerator(unset, options(iac));
        const none = createWebsiteTree();
        await tsWebsiteAuthGenerator(none, options(iac, 'none'));

        const expected = files(direct);
        expect(files(unset)).toEqual(expected);
        expect(files(none)).toEqual(expected);
        expect(
          Object.keys(expected).filter((path) =>
            path.includes('oidc-identity-providers'),
          ),
        ).toEqual([]);
      });
    },
  );

  describe('oidc (cdk)', () => {
    let tree: Tree;

    beforeEach(async () => {
      tree = createWebsiteTree();
      await tsWebsiteAuthGenerator(tree, options('cdk', 'oidc'));
    });

    it('should vend the identity providers construct and export it', () => {
      expect(tree.read(OIDC_FILE, 'utf-8')).toMatchSnapshot();
      expect(tree.read(`${CORE_DIR}/index.ts`, 'utf-8')).toContain(
        "export * from './oidc-identity-providers.js';",
      );
    });

    it('should add the oidcIdentityProviders prop to UserIdentity', () => {
      const userIdentity = tree.read(USER_IDENTITY, 'utf-8');
      expect(userIdentity).toContain(
        "import {\n  OidcIdentityProviders,\n  type OidcIdentityProviderProps,\n} from './oidc-identity-providers.js';",
      );
      expect(userIdentity).toContain(
        'readonly oidcIdentityProviders?: OidcIdentityProviderProps[];',
      );
      expect(userIdentity).toContain('oidcIdentityProviders = [],');
      // Created after the domain and before the web client, so the client lists the providers.
      expect(userIdentity).toMatch(
        /this\.userPoolDomain = this\.createUserPoolDomain\(this\.userPool\);\s+new OidcIdentityProviders\(this, 'OidcIdentityProviders', \{\s+userPool: this\.userPool,\s+userPoolDomain: this\.userPoolDomain,\s+providers: oidcIdentityProviders,\s+\}\);\s+this\.userPoolClient = this\.createUserPoolClient\(this\.userPool\);/,
      );
      expect(userIdentity).toMatchSnapshot();
    });

    it('should write the same files as adding auth first and federation later', async () => {
      const later = createWebsiteTree();
      await tsWebsiteAuthGenerator(later, options('cdk'));
      await tsWebsiteAuthGenerator(later, options('cdk', 'oidc'));

      expect(files(later)).toEqual(files(tree));
    });

    it('should change nothing when re-run', async () => {
      const before = files(tree);
      await tsWebsiteAuthGenerator(tree, options('cdk', 'oidc'));

      expect(files(tree)).toEqual(before);
      const userIdentity = tree.read(USER_IDENTITY, 'utf-8');
      expect(count(userIdentity, 'new OidcIdentityProviders(')).toBe(1);
      expect(count(userIdentity, 'readonly oidcIdentityProviders?')).toBe(1);
      expect(count(userIdentity, 'oidcIdentityProviders = []')).toBe(1);
      expect(count(userIdentity, "from './oidc-identity-providers.js'")).toBe(
        1,
      );
    });

    it('should keep federation when auth is re-run without it', async () => {
      const before = files(tree);
      await tsWebsiteAuthGenerator(tree, options('cdk', 'none'));

      expect(files(tree)).toEqual(before);
    });

    it('should keep an edited identity providers construct', async () => {
      tree.write(OIDC_FILE, '// edited\n');
      await tsWebsiteAuthGenerator(tree, options('cdk', 'oidc'));

      expect(tree.read(OIDC_FILE, 'utf-8')).toBe('// edited\n');
    });
  });

  it('should leave a diverged user-identity.ts untouched, warn with the lines to add, and still vend the construct', async () => {
    const tree = createWebsiteTree();
    await tsWebsiteAuthGenerator(tree, options('cdk'));
    const diverged = tree
      .read(USER_IDENTITY, 'utf-8')
      .replace(
        'this.userPoolClient = this.createUserPoolClient(this.userPool);',
        'this.userPoolClient = this.createMyClient(this.userPool);',
      );
    tree.write(USER_IDENTITY, diverged);
    const warn = vi.spyOn(logger, 'warn');

    await tsWebsiteAuthGenerator(tree, options('cdk', 'oidc'));

    // The import, prop and destructure edits apply, then the statement edit fails and all are undone.
    expect(tree.read(USER_IDENTITY, 'utf-8')).toBe(diverged);
    expect(tree.exists(OIDC_FILE)).toBe(true);
    expect(tree.read(`${CORE_DIR}/index.ts`, 'utf-8')).toContain(
      "export * from './oidc-identity-providers.js';",
    );
    const message = warn.mock.calls.map(([m]) => String(m)).join('\n');
    expect(message).toContain(
      `Could not add OpenID Connect identity providers to ${USER_IDENTITY}`,
    );
    expect(message).toContain(
      "import { OidcIdentityProviders, type OidcIdentityProviderProps } from './oidc-identity-providers.js';",
    );
    expect(message).toContain(
      'readonly oidcIdentityProviders?: OidcIdentityProviderProps[];',
    );
    expect(message).toContain('oidcIdentityProviders = [],');
    expect(message).toContain(
      "new OidcIdentityProviders(this, 'OidcIdentityProviders', {",
    );
    warn.mockRestore();
  });

  const TF_DIR = 'packages/common/terraform/src/core/user-identity';
  const TF_MAIN = `${TF_DIR}/main.tf`;
  const TF_IDENTITY = `${TF_DIR}/identity/identity.tf`;
  const TF_OUTER = `${TF_DIR}/oidc-identity-providers.tf`;
  const TF_INNER = `${TF_DIR}/identity/oidc-identity-providers.tf`;
  const TF_ARGUMENT = 'oidc_identity_providers = var.oidc_identity_providers';
  const TF_CLIENT_PROVIDERS =
    'supported_identity_providers = concat(["COGNITO"], [for p in aws_cognito_identity_provider.oidc : p.provider_name])';

  describe('oidc (terraform)', () => {
    let tree: Tree;

    beforeEach(async () => {
      tree = createWebsiteTree();
      await tsWebsiteAuthGenerator(tree, options('terraform', 'oidc'));
    });

    it('should vend the oidc_identity_providers variable and the identity provider resources', () => {
      expect(tree.read(TF_OUTER, 'utf-8')).toMatchSnapshot();
      expect(tree.read(TF_INNER, 'utf-8')).toMatchSnapshot();
    });

    it('should pass the variable to module "identity" and list the providers on the web client', () => {
      const main = tree.read(TF_MAIN, 'utf-8');
      expect(main).toMatch(
        /module "identity" \{[^}]*mfa_second_factor_sms = var\.mfa_second_factor_sms\n {2}oidc_identity_providers = var\.oidc_identity_providers\n\}/,
      );
      expect(main).toMatchSnapshot();
      const identity = tree.read(TF_IDENTITY, 'utf-8');
      expect(identity).toContain(`  ${TF_CLIENT_PROVIDERS}\n`);
      expect(identity).not.toContain(
        'supported_identity_providers = ["COGNITO"]',
      );
    });

    it('should write the same files as adding auth first and federation later', async () => {
      const later = createWebsiteTree();
      await tsWebsiteAuthGenerator(later, options('terraform'));
      await tsWebsiteAuthGenerator(later, options('terraform', 'oidc'));

      expect(files(later)).toEqual(files(tree));
    });

    it('should change nothing when re-run', async () => {
      const before = files(tree);
      await tsWebsiteAuthGenerator(tree, options('terraform', 'oidc'));

      expect(files(tree)).toEqual(before);
      expect(count(tree.read(TF_MAIN, 'utf-8'), TF_ARGUMENT)).toBe(1);
      expect(count(tree.read(TF_IDENTITY, 'utf-8'), TF_CLIENT_PROVIDERS)).toBe(
        1,
      );
    });

    it('should keep federation when auth is re-run without it', async () => {
      const before = files(tree);
      await tsWebsiteAuthGenerator(tree, options('terraform', 'none'));

      expect(files(tree)).toEqual(before);
    });

    it('should keep an edited variable file', async () => {
      tree.write(TF_OUTER, '# edited\n');
      await tsWebsiteAuthGenerator(tree, options('terraform', 'oidc'));

      expect(tree.read(TF_OUTER, 'utf-8')).toBe('# edited\n');
    });
  });

  describe.each([
    {
      file: 'identity.tf',
      diverge: (tree: Tree) =>
        tree.write(
          TF_IDENTITY,
          tree
            .read(TF_IDENTITY, 'utf-8')
            .replace(
              'supported_identity_providers = ["COGNITO"]',
              'supported_identity_providers = ["COGNITO", "Other"]',
            ),
        ),
    },
    {
      file: 'main.tf',
      diverge: (tree: Tree) =>
        tree.write(
          TF_MAIN,
          tree
            .read(TF_MAIN, 'utf-8')
            .replace(
              '  mfa_second_factor_sms = var.mfa_second_factor_sms\n',
              '',
            ),
        ),
    },
  ])('diverged $file (terraform)', ({ diverge }) => {
    it('should leave main.tf and identity.tf untouched, warn with the lines to add, and still vend the new files', async () => {
      const tree = createWebsiteTree();
      await tsWebsiteAuthGenerator(tree, options('terraform'));
      diverge(tree);
      const main = tree.read(TF_MAIN, 'utf-8');
      const identity = tree.read(TF_IDENTITY, 'utf-8');
      const warn = vi.spyOn(logger, 'warn');

      await tsWebsiteAuthGenerator(tree, options('terraform', 'oidc'));

      // Both files are restored, even when the first edit applied.
      expect(tree.read(TF_MAIN, 'utf-8')).toBe(main);
      expect(tree.read(TF_IDENTITY, 'utf-8')).toBe(identity);
      expect(tree.exists(TF_OUTER)).toBe(true);
      expect(tree.exists(TF_INNER)).toBe(true);
      const message = warn.mock.calls.map(([m]) => String(m)).join('\n');
      expect(message).toContain(
        'Could not add OpenID Connect identity providers to the user-identity Terraform module',
      );
      expect(message).toContain(`# In module "identity" in ${TF_MAIN}:`);
      expect(message).toContain(`  ${TF_ARGUMENT}\n`);
      expect(message).toContain(
        `# In resource "aws_cognito_user_pool_client" "web_client" in ${TF_IDENTITY}:`,
      );
      expect(message).toContain(`  ${TF_CLIENT_PROVIDERS}`);
      warn.mockRestore();
    });
  });

  it.each(['cdk', 'terraform'] as const)(
    'should print the %s next steps',
    (iac) => {
      expect(federationNextSteps(iac)).toMatchSnapshot();
    },
  );
});
