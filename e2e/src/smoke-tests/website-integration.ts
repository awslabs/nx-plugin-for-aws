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
import { resolveWithin } from '../utils/deadline';
import { redactOAuthValues } from '../utils/redact';
import {
  describeSignInFailure,
  signInIncompleteError,
  signInStepError,
} from '../utils/sign-in-failure';
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
 *
 * Only attach this once any sign-in is complete. While a sign-in flow runs,
 * the browser console carries the authorization code and the tokens, and the
 * redaction here covers the keys and forms `redactOAuthValues` lists rather
 * than every shape a console message can take.
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
 * Records the HTTP status of the page's most recent main-frame document
 * response, so a failure during sign-in can report the status of the page it
 * was looking at. Only the number is kept: no URL, header or body is stored
 * or logged.
 */
const trackDocumentStatus = (page: Page): (() => number | undefined) => {
  let status: number | undefined;
  page.on('response', (response) => {
    if (
      response.frame() === page.mainFrame() &&
      response.request().resourceType() === 'document'
    ) {
      status = response.status();
    }
  });
  return () => status;
};

/**
 * Printed in place of a page title that could not be read in time, and how
 * long the failure handler waits for it. `Page.title()` asks the renderer
 * with no deadline of its own, so an unresponsive renderer would hold the
 * failure handler for the whole of the suite's timeout and the original error
 * would never be thrown.
 */
const TITLE_UNAVAILABLE = '<title unavailable>';
const TITLE_TIMEOUT_MS = 5_000;

/**
 * The line a failed sign-in step prints: the step, the origin and path of the
 * page's URL, its HTTP status and its title. The sign-in flow carries the
 * authorization code and the tokens in the URL query and fragment and in the
 * page markup, so none of those are read.
 */
const logSignInFailure = async (
  page: Page,
  step: string,
  documentStatus: () => number | undefined,
): Promise<void> => {
  console.log(
    describeSignInFailure({
      step,
      url: page.url(),
      status: documentStatus(),
      title: await resolveWithin(
        () => page.title(),
        TITLE_UNAVAILABLE,
        TITLE_TIMEOUT_MS,
      ),
    }),
  );
};

/**
 * Wait for the page's URL to satisfy `url`, reporting a failure as an error
 * that has been through `redactOAuthValues`.
 *
 * A navigation-wait timeout quotes every URL the page visited while waiting,
 * and during a sign-in flow those carry the authorization code and the
 * tokens, so the wait's own error never reaches the test log.
 */
const waitForUrl = async (
  page: Page,
  step: string,
  url: string | RegExp | ((url: URL) => boolean),
): Promise<void> => {
  try {
    await page.waitForURL(url, { timeout: 120_000 });
  } catch (e) {
    throw signInStepError(step, e);
  }
};

/**
 * Fill and submit the sign-in form of a Cognito managed login page. On
 * failure prints the safe sign-in failure line; the page is a login page, so
 * its markup and console output are never dumped.
 */
const fillCognitoLoginForm = async (
  page: Page,
  username: string,
  password: string,
  documentStatus: () => number | undefined,
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
  const step = 'login form not fillable';
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
    await logSignInFailure(page, step, documentStatus);
    throw signInStepError(step, e);
  }
};

/**
 * Wait to land back on the website after a Cognito sign-in, then open the
 * integration-test page and wait for its run button to render.
 *
 * Returns only once that button has rendered, which is what proves the
 * sign-in completed and the page no longer holds a credential. A flow that
 * ran out of attempts throws instead, so a caller can treat a normal return
 * as the point from which browser output is safe to forward.
 */
const waitForSignedIn = async (page: Page, target: string): Promise<void> => {
  await waitForUrl(
    page,
    'did not land back on the website after sign-in',
    (url) => !url.href.includes('amazoncognito.com'),
  );
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
      if (await button.count()) {
        return;
      }
    }
    await page.waitForTimeout(2_000);
  }
  throw signInIncompleteError(
    'the integration-test page never rendered its run button after sign-in',
    page.url(),
  );
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
    // The browser's console output is not forwarded to the test log while the
    // sign-in flow runs: its console messages carry the authorization code
    // and the tokens, and nothing is buffered to be replayed later.
    // Forwarding starts once `waitForSignedIn` has proved the sign-in
    // completed. A failed step before that prints the safe description built
    // by `describeSignInFailure` instead.
    const documentStatus = trackDocumentStatus(page);

    const target = integrationTestUrl(baseUrl);
    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await waitForUrl(
      page,
      'no redirect to the managed login page',
      /amazoncognito\.com/,
    );
    await page.waitForLoadState('networkidle').catch(() => {});
    const idpButton = page
      .getByRole('button', { name: /E2eIdp/i })
      .or(page.getByRole('link', { name: /E2eIdp/i }))
      .first();
    const idpButtonStep = 'no E2eIdp sign-in button on the managed login page';
    try {
      await idpButton.waitFor({ state: 'visible', timeout: 60_000 });
      await idpButton.click();
    } catch (e) {
      await logSignInFailure(page, idpButtonStep, documentStatus);
      throw signInStepError(idpButtonStep, e);
    }

    const idpHost = `${idp.names.domainPrefix}.auth.${idp.region}.amazoncognito.com`;
    await waitForUrl(
      page,
      "no redirect to the identity provider's managed login page",
      (url) => url.hostname === idpHost,
    );
    await fillCognitoLoginForm(
      page,
      idp.username,
      idp.password,
      documentStatus,
    );
    await waitForSignedIn(page, target);
    logBrowserMessages(page);
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
  const documentStatus = trackDocumentStatus(page);
  // With a login, console output is forwarded only once sign-in is complete,
  // because the hosted-UI redirect and the code-for-token exchange put the
  // authorization code and the tokens on the console. Without one, no
  // credential passes through the browser, so the output is forwarded from
  // the start.
  if (!login) {
    logBrowserMessages(page);
  }

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
      await waitForUrl(
        page,
        'no redirect to the managed login page',
        /amazoncognito\.com/,
      );
      await fillCognitoLoginForm(
        page,
        login.username,
        login.password,
        documentStatus,
      );
      await waitForSignedIn(page, target);
      logBrowserMessages(page);
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
