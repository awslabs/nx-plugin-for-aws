/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  SetUserPoolMfaConfigCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateFiles } from '@nx/devkit';
import { FsTree, flushChanges } from 'nx/src/generators/tree';
import { type Browser, chromium, type Page } from 'playwright';
import { formatFilesInSubtree } from '../../../packages/nx-plugin/src/utils/format';

/**
 * Browser-driven website ↔ API/agent integration test.
 *
 * Rather than hitting the deployed/served backends directly, this drives the
 * generated website's OWN vended clients (API hooks, agent hooks, the SigV4
 * auth hook) from a real browser via an example page added to the website. A
 * green run proves the end-to-end path a user's browser actually takes:
 * runtime-config → auth → generated client → backend.
 *
 * The same example page and runner are shared by the local-dev (no auth) and
 * cdk/terraform deploy (Cognito + SigV4) smoke tests so all three stay in
 * lock-step as the generators evolve.
 */

const REGION = process.env.AWS_REGION || 'us-west-2';

/** A website→API connection the example page should exercise. */
export interface ApiSpec {
  /**
   * Protocol of the connected API, which determines how its vended client is
   * invoked from the browser (tRPC clients expose `echo` as a query, OpenAPI
   * REST/Smithy clients as a method).
   */
  kind: 'trpc' | 'openapi';
  /** The API's class name, matching its vended `use<ClassName>Client` hook. */
  className: string;
}

/** A website→agent connection the example page should exercise. */
export interface AgentSpec {
  /**
   * Protocol of the connected agent, which determines how its vended client is
   * invoked from the browser.
   */
  kind: 'ts-http' | 'py-http' | 'ts-agui' | 'py-agui';
  /** The agent's class name as it appears in runtimeConfig.agentRuntimes. */
  className: string;
}

/**
 * Write an example page into the website's `src/routes` that invokes every
 * connected API and agent using the website's vended hooks/clients, rendering
 * each result into the DOM for the browser runner to assert on. Returns the
 * route path to navigate to.
 *
 * The page is rendered from `files/website-integration` via the same
 * `generateFiles` + `Tree` machinery the generators use, so only the hooks for
 * the connected APIs/agents are imported and called (satisfying the website's
 * `noUnusedLocals` build). It is also formatted with the plugin's own
 * formatter, matching what the generators do, so the website's `format` check
 * (wired into `build`) passes on the generated page.
 */
export const writeIntegrationTestPage = async (
  websiteRoot: string,
  apis: ApiSpec[],
  agents: AgentSpec[],
): Promise<string> => {
  const tree = new FsTree(websiteRoot, false);
  generateFiles(
    tree,
    join(__dirname, '..', 'files', 'website-integration'),
    'src',
    {
      apis,
      tsHttp: agents.filter((a) => a.kind === 'ts-http'),
      pyHttp: agents.filter((a) => a.kind === 'py-http'),
      aguiAgents: agents.filter(
        (a) => a.kind === 'ts-agui' || a.kind === 'py-agui',
      ),
    },
  );
  await formatFilesInSubtree(tree);
  flushChanges(websiteRoot, tree.listChanges());
  return '/integration-test';
};

/**
 * Install the Playwright Chromium browser binary. The `playwright` package is a
 * dev dependency, but the browser itself is downloaded separately. Idempotent —
 * safe to call from a smoke test's setup before the workspace build. Prefers
 * `--with-deps` (installs the OS libraries Chromium needs, requires root) and
 * falls back to a plain install where the libraries are already present.
 */
export const installChromium = async (): Promise<void> => {
  try {
    execSync('npx --yes playwright install --with-deps chromium', {
      stdio: 'inherit',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    execSync('npx --yes playwright install chromium', {
      stdio: 'inherit',
      maxBuffer: 50 * 1024 * 1024,
    });
  }
};

export interface CognitoLogin {
  userPoolId: string;
  userPoolWebClientId: string;
  username: string;
  password: string;
}

/**
 * Create a confirmed Cognito user with a permanent password (MFA off) so the
 * browser runner can complete the hosted-UI login. Returns the credentials.
 */
export const createCognitoTestUser = async (
  userPoolId: string,
  userPoolWebClientId: string,
): Promise<CognitoLogin> => {
  const client = new CognitoIdentityProviderClient({ region: REGION });

  // The generated user pool requires MFA. Turn it off for the test so the
  // browser login does not get diverted to the MFA setup flow.
  await client.send(
    new SetUserPoolMfaConfigCommand({
      UserPoolId: userPoolId,
      MfaConfiguration: 'OFF',
    }),
  );

  // The user pool uses email as a sign-in alias, so the username itself must
  // not be an email; the email is supplied as a separate (verified) attribute.
  const suffix = Math.random().toString(36).substring(2, 10);
  const username = `e2e-test-${suffix}`;
  const password = `Test-${suffix}-A1!`;

  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: `${username}@example.com` },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    }),
  );

  return { userPoolId, userPoolWebClientId, username, password };
};

/**
 * Drive the website's integration-test page in a real browser and assert every
 * API and agent responded. When `login` is provided the site is treated as a
 * deployed Cognito-protected site: navigating triggers a hosted-UI redirect,
 * which the runner completes before driving the page.
 */
export const runWebsiteIntegrationTest = async (options: {
  baseUrl: string;
  expectedApis: ApiSpec[];
  expectedAgents: AgentSpec[];
  login?: CognitoLogin;
}): Promise<void> => {
  const { baseUrl, expectedApis, expectedAgents, login } = options;

  const browser: Browser = await chromium.launch();
  const page: Page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('AuthProvider context is undefined')) {
      console.log(`[browser:${m.type()}] ${t}`);
    }
  });
  page.on('pageerror', (e) => console.log(`[browser:pageerror] ${e.message}`));

  try {
    const target = `${baseUrl.replace(/\/$/, '')}/integration-test`;
    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });

    if (login) {
      // The deployed site auto-redirects unauthenticated users to the Cognito
      // managed login UI. Complete the login form, then wait to land back on
      // the app and for the post-login OAuth code exchange to settle.
      await page.waitForURL(/amazoncognito\.com/, { timeout: 120_000 });
      // Cognito Managed Login is a React app that mounts the form a moment
      // after navigation and can briefly re-render it; wait for the network to
      // settle, then fill the username/password by their stable field names.
      await page.waitForLoadState('networkidle').catch(() => {});
      const username = page
        .locator(
          'input[name="username"], input[id*="signInFormUsername"], input[type="email"]',
        )
        .first();
      const password = page
        .locator(
          'input[name="password"], input[id*="signInFormPassword"], input[type="password"]',
        )
        .first();
      const submit = page
        .locator(
          'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Continue"), button:has-text("Next")',
        )
        .first();
      try {
        await username.waitFor({ state: 'visible', timeout: 60_000 });
        await username.click();
        await username.fill(login.username);
        // Managed Login may present username and password together, or as two
        // steps (username -> Continue -> password). Submit once to advance if
        // the password field is not yet visible, then fill it.
        if (!(await password.isVisible().catch(() => false))) {
          await submit.click().catch(() => {});
        }
        await password.waitFor({ state: 'visible', timeout: 60_000 });
        await password.fill(login.password);
        await submit.click();
      } catch (e) {
        console.log('[login] login form not fillable. Page HTML follows:');
        console.log((await page.content()).slice(0, 6000));
        throw e;
      }
      await page.waitForURL((url) => !url.href.includes('amazoncognito.com'), {
        timeout: 120_000,
      });
      // react-oidc-context completes the code exchange on the redirect back to
      // the app origin. Navigate to the example route and retry until the run
      // button renders (a premature load before the exchange finishes would
      // bounce back to the hosted UI).
      await page.waitForLoadState('networkidle').catch(() => {});
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!page.url().includes('amazoncognito.com')) {
          await page
            .goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 })
            .catch(() => {});
          const button = page.getByTestId('run-integration-test');
          if (await button.count()) break;
        }
        await page.waitForTimeout(2_000);
      }
    }

    await page.getByTestId('run-integration-test').click({ timeout: 120_000 });

    // Wait for every expected result to be populated.
    const expectedKeys = [
      'done',
      ...expectedApis.map((a) => `api:${a.className}`),
      ...expectedAgents.map((a) => `agent:${a.className}`),
    ];
    await page.waitForFunction(
      (keys) => {
        const el = document.querySelector(
          '[data-testid="integration-test-results"]',
        );
        if (!el?.textContent) return false;
        const obj = JSON.parse(el.textContent);
        return keys.every((k) => k in obj);
      },
      expectedKeys,
      { timeout: 300_000 },
    );

    const results = JSON.parse(
      (await page.getByTestId('integration-test-results').textContent()) ??
        '{}',
    );
    console.log('Website integration results:', JSON.stringify(results));

    const failures = Object.entries(results).filter(
      ([k, v]) => k !== 'done' && v !== 'OK',
    );
    if (failures.length > 0) {
      throw new Error(
        `Website integration failures: ${JSON.stringify(failures)}`,
      );
    }
    // Every connected API and agent must have produced a result.
    for (const api of expectedApis) {
      expect(results[`api:${api.className}`]).toBe('OK');
    }
    for (const agent of expectedAgents) {
      expect(results[`agent:${agent.className}`]).toBe('OK');
    }
  } finally {
    await browser.close();
  }
};
