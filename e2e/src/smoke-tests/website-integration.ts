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
import { redactOAuthValues } from '../utils/redact';
import { IDP_PROVIDER_NAME, type TestIdp } from '../utils/test-idp';

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

/** URL of the integration-test page on the given site. */
const integrationTestUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/$/, '')}/integration-test`;

/**
 * Prints the page's console messages and errors to the test log, with OAuth
 * codes and tokens redacted.
 */
const logBrowserMessages = (page: Page): void => {
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('AuthProvider context is undefined')) {
      console.log(`[browser:${m.type()}] ${redactOAuthValues(t)}`);
    }
  });
  page.on('pageerror', (e) =>
    console.log(`[browser:pageerror] ${redactOAuthValues(e.message)}`),
  );
};

/**
 * Fill and submit the sign-in form of a Cognito managed login page. Prints
 * the page HTML, with OAuth codes and tokens redacted, when the form cannot
 * be filled.
 */
const fillCognitoLoginForm = async (
  page: Page,
  username: string,
  password: string,
): Promise<void> => {
  // Cognito Managed Login is a React app that mounts the form a moment
  // after navigation and can briefly re-render it; wait for the network to
  // settle, then fill the username/password by their stable field names.
  await page.waitForLoadState('networkidle').catch(() => {});
  const usernameInput = page
    .locator(
      'input[name="username"], input[id*="signInFormUsername"], input[type="email"]',
    )
    .first();
  const passwordInput = page
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
    await usernameInput.waitFor({ state: 'visible', timeout: 60_000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    // Managed Login may present username and password together, or as two
    // steps (username -> Continue -> password). Submit once to advance if
    // the password field is not yet visible, then fill it.
    if (!(await passwordInput.isVisible().catch(() => false))) {
      await submit.click().catch(() => {});
    }
    await passwordInput.waitFor({ state: 'visible', timeout: 60_000 });
    await passwordInput.fill(password);
    await submit.click();
  } catch (e) {
    console.log('[login] login form not fillable. Page HTML follows:');
    console.log(redactOAuthValues(await page.content()).slice(0, 6000));
    throw e;
  }
};

/**
 * Wait to land back on the website after a Cognito sign-in, then open the
 * integration-test page and wait for its run button to render.
 */
const waitForSignedIn = async (page: Page, target: string): Promise<void> => {
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
};

/** Claims of the ID token react-oidc-context keeps in session storage after sign-in. */
const readIdTokenClaims = async (
  page: Page,
): Promise<Record<string, unknown>> => {
  // A string expression, because the e2e tsconfig has no DOM types.
  const stored = await page.evaluate<string[]>(
    "Object.keys(sessionStorage).filter((k) => k.startsWith('oidc.user:')).map((k) => sessionStorage.getItem(k))",
  );
  if (stored.length !== 1) {
    throw new Error(
      `Expected one oidc.user entry in session storage, found ${stored.length}`,
    );
  }
  const idToken = (JSON.parse(stored[0]) as { id_token?: string }).id_token;
  if (!idToken) {
    throw new Error('The oidc.user entry in session storage has no ID token');
  }
  return JSON.parse(
    Buffer.from(idToken.split('.')[1], 'base64url').toString('utf-8'),
  );
};

/**
 * Sign in to the deployed website through the external identity provider and
 * check the result. Clicks the identity provider's button on the main user
 * pool's managed login page, signs in on the identity provider's own managed
 * login page, and checks the ID token the website receives: it names the
 * identity provider, has a federated user name, and carries the email and
 * names mapped from the identity provider's user.
 */
export const runFederatedSignInTest = async (
  baseUrl: string,
  idp: TestIdp,
): Promise<void> => {
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page: Page = await context.newPage();
    logBrowserMessages(page);

    const target = integrationTestUrl(baseUrl);
    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForURL(/amazoncognito\.com/, { timeout: 120_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    const idpButton = page
      .getByRole('button', { name: /E2eIdp/i })
      .or(page.getByRole('link', { name: /E2eIdp/i }))
      .first();
    try {
      await idpButton.waitFor({ state: 'visible', timeout: 60_000 });
      await idpButton.click();
    } catch (e) {
      console.log('[login] no E2eIdp sign-in button. Page HTML follows:');
      console.log(redactOAuthValues(await page.content()).slice(0, 6000));
      throw e;
    }

    const idpHost = `${idp.names.domainPrefix}.auth.${idp.region}.amazoncognito.com`;
    await page.waitForURL((url) => url.hostname === idpHost, {
      timeout: 120_000,
    });
    await fillCognitoLoginForm(page, idp.username, idp.password);
    await waitForSignedIn(page, target);
    await page
      .getByTestId('run-integration-test')
      .waitFor({ state: 'visible', timeout: 120_000 });

    const claims = await readIdTokenClaims(page);
    const identities = claims.identities as
      | { providerName?: string }[]
      | undefined;
    console.log(
      `Federated sign-in as ${String(claims['cognito:username'])} through ${identities?.[0]?.providerName}`,
    );
    expect(identities?.[0]?.providerName).toBe(IDP_PROVIDER_NAME);
    expect(String(claims['cognito:username'])).toMatch(/^e2eidp_/);
    expect(claims.email).toBe(idp.email);
    expect(claims.given_name).toBe(idp.givenName);
    expect(claims.family_name).toBe(idp.familyName);
  } finally {
    await browser.close();
  }
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
  logBrowserMessages(page);

  try {
    const target = integrationTestUrl(baseUrl);
    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });

    if (login) {
      // The deployed site auto-redirects unauthenticated users to the Cognito
      // managed login UI. Complete the login form, then wait to land back on
      // the app and for the post-login OAuth code exchange to settle.
      await page.waitForURL(/amazoncognito\.com/, { timeout: 120_000 });
      await fillCognitoLoginForm(page, login.username, login.password);
      await waitForSignedIn(page, target);
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
    console.log(
      'Website integration results:',
      redactOAuthValues(JSON.stringify(results)),
    );

    const failures = Object.entries(results).filter(
      ([k, v]) => k !== 'done' && v !== 'OK',
    );
    if (failures.length > 0) {
      throw new Error(
        redactOAuthValues(
          `Website integration failures: ${JSON.stringify(failures)}`,
        ),
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
