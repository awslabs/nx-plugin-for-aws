/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// playwright and the Cognito SDK are installed on demand into an isolated
// directory (see `ensureIntegrationDeps`) rather than added to the workspace
// root, whose dependency graph is sensitive enough that adding any dep
// reshuffles the pinned `@nx/*` peer resolution and breaks unrelated snapshot
// tests. They are loaded with a dedicated `require` at runtime, so this file
// has no compile-time dependency on either package.

const INTEGRATION_DEPS_DIR = join(__dirname, '..', '..', '.integration-deps');
const PLAYWRIGHT_VERSION = '1.56.1';
const COGNITO_SDK_VERSION = '3.1068.0';

// Minimal structural types for the runtime-loaded modules — just enough for
// the helper to be type-checked without depending on the packages' own types.
type Browser = { newPage: () => Promise<Page>; close: () => Promise<void> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
interface IntegrationDeps {
  chromium: { launch: () => Promise<Browser> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cognito: Record<string, any>;
}

/**
 * Install playwright and the Cognito SDK (plus the Chromium browser) into an
 * isolated directory, and return modules resolved from it. Idempotent — the
 * npm install and browser download are skipped once present.
 */
let cachedDeps: IntegrationDeps | undefined;

const ensureIntegrationDeps = async (): Promise<IntegrationDeps> => {
  if (cachedDeps) return cachedDeps;

  mkdirSync(INTEGRATION_DEPS_DIR, { recursive: true });
  const pkgJsonPath = join(INTEGRATION_DEPS_DIR, 'package.json');
  if (!existsSync(join(INTEGRATION_DEPS_DIR, 'node_modules'))) {
    writeFileSync(
      pkgJsonPath,
      JSON.stringify(
        {
          name: 'website-integration-deps',
          private: true,
          dependencies: {
            playwright: PLAYWRIGHT_VERSION,
            '@aws-sdk/client-cognito-identity-provider': COGNITO_SDK_VERSION,
          },
        },
        null,
        2,
      ),
    );
    execSync('npm install --no-package-lock --no-audit --no-fund', {
      cwd: INTEGRATION_DEPS_DIR,
      stdio: 'inherit',
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  // Install the Chromium browser. Prefer `--with-deps` (installs the OS
  // libraries Chromium needs, requires root) and fall back to a plain install
  // where root/apt is unavailable but the libraries are already present.
  const playwrightExec = (cmd: string) =>
    execSync(`npx --yes playwright ${cmd}`, {
      cwd: INTEGRATION_DEPS_DIR,
      stdio: 'inherit',
      maxBuffer: 50 * 1024 * 1024,
    });
  try {
    playwrightExec('install --with-deps chromium');
  } catch {
    playwrightExec('install chromium');
  }

  const require = createRequire(join(INTEGRATION_DEPS_DIR, 'index.js'));
  const playwright = require('playwright');
  const cognito = require('@aws-sdk/client-cognito-identity-provider');
  cachedDeps = { chromium: playwright.chromium, cognito };
  return cachedDeps;
};

/**
 * Browser-driven website ↔ API/agent integration test.
 *
 * Rather than hitting the deployed/served backends directly, this drives the
 * generated website's OWN vended clients (API hooks, agent hooks, the SigV4
 * auth hook) from a real browser via an example page added to the website. A
 * green run proves the end-to-end path a user's browser actually takes:
 * runtime-config → auth → generated client → backend.
 *
 * The same example page and runner are shared by the serve-local (no auth) and
 * cdk/terraform deploy (Cognito + SigV4) smoke tests so all three stay in
 * lock-step as the generators evolve.
 */

const REGION = process.env.AWS_REGION || 'us-west-2';

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
 * connected API (discovered generically from runtime-config) and the given
 * agents using the website's vended hooks, rendering each result into the DOM
 * for the browser runner to assert on. Returns the route path to navigate to.
 */
export const writeIntegrationTestPage = (
  websiteRoot: string,
  agents: AgentSpec[],
): string => {
  const routesDir = join(websiteRoot, 'src', 'routes');
  mkdirSync(routesDir, { recursive: true });

  // Each agent contributes an import, a hook call, and an invocation. The
  // hooks must be imported statically and called at the top level, so they are
  // templated in per connected agent.
  const tsHttp = agents.filter((a) => a.kind === 'ts-http');
  const pyHttp = agents.filter((a) => a.kind === 'py-http');
  const aguiAgents = agents.filter(
    (a) => a.kind === 'ts-agui' || a.kind === 'py-agui',
  );

  const imports = [
    ...tsHttp.map(
      (a) =>
        `import { use${a.className}AgentClient } from '../hooks/use${a.className}Agent';`,
    ),
    ...pyHttp.map(
      (a) =>
        `import { ${a.className}ClientContext } from '../components/${a.className}Provider';`,
    ),
    ...aguiAgents.map(
      (a) =>
        `import { useAgui${a.className} } from '../hooks/useAgui${a.className}';`,
    ),
  ].join('\n');

  const hookCalls = [
    ...tsHttp.map(
      (a) => `  const ${a.className}Client = use${a.className}AgentClient();`,
    ),
    ...pyHttp.map(
      (a) =>
        `  const ${a.className}Client = useContext(${a.className}ClientContext)!;`,
    ),
    ...aguiAgents.map(
      (a) => `  const ${a.className}Agents = useAgui${a.className}();`,
    ),
  ].join('\n');

  const invocations = [
    ...tsHttp.map(
      (a) =>
        `      ['agent:${a.className}', () => invokeTrpcAgent(${a.className}Client)],`,
    ),
    ...pyHttp.map(
      (a) =>
        `      ['agent:${a.className}', () => invokeJsonlAgent(${a.className}Client)],`,
    ),
    ...aguiAgents.map(
      (a) =>
        `      ['agent:${a.className}', () => invokeAguiAgent(${a.className}Agents)],`,
    ),
  ].join('\n');

  const source = `/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useContext, useState } from 'react';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { useSigV4 } from '../hooks/useSigV4';
${imports}

export const Route = createFileRoute('/integration-test')({
  component: IntegrationTest,
});

// Invoke a tRPC-over-WebSocket agent's \`invoke\` subscription and collect the
// streamed reply.
function invokeTrpcAgent(client: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = '';
    client.invoke.subscribe(
      { message: 'hello' },
      {
        onData: (c: any) => (acc += typeof c === 'string' ? c : (c?.data ?? '')),
        onComplete: () => resolve(acc),
        onError: reject,
      },
    );
  });
}

// Invoke an HTTP agent whose vended OpenAPI client streams JSONL chunks.
async function invokeJsonlAgent(client: any): Promise<string> {
  let acc = '';
  for await (const chunk of client.invoke({ message: 'hello' })) {
    acc += chunk?.content ?? '';
  }
  return acc;
}

// Invoke an AG-UI agent via its vended @ag-ui/client agent (CopilotKit).
async function invokeAguiAgent(agents: Record<string, any>): Promise<string> {
  const agent = Object.values(agents)[0];
  agent.messages = [{ id: 'm1', role: 'user', content: 'hello' }];
  const res = await agent.runAgent({});
  return (res?.newMessages ?? []).map((m: any) => m.content ?? '').join('');
}

function IntegrationTest() {
  const runtimeConfig = useRuntimeConfig();
  const sigv4 = useSigV4();
${hookCalls}
  const [results, setResults] = useState<Record<string, string>>({});

  const run = useCallback(async () => {
    const record = async (key: string, fn: () => Promise<string>) => {
      try {
        const text = await fn();
        setResults((r) => ({ ...r, [key]: text.length > 0 ? 'OK' : 'EMPTY' }));
      } catch (e) {
        setResults((r) => ({
          ...r,
          [key]: 'ERROR:' + (e instanceof Error ? e.message : String(e)),
        }));
      }
    };

    // APIs — discovered generically from runtime-config. Every generated API
    // exposes GET /echo; tRPC wraps the reply in result.data.message, REST and
    // Smithy return it at the top level.
    const apis: Record<string, string> = runtimeConfig.apis ?? {};
    for (const [name, baseUrl] of Object.entries(apis)) {
      await record('api:' + name, async () => {
        const trimmed = baseUrl.replace(/\\/$/, '');
        const trpc = await sigv4.fetch(
          trimmed + '/echo?input=' + encodeURIComponent(JSON.stringify({ message: name })),
        );
        if (trpc.ok) {
          const body = await trpc.json();
          const msg = body?.result?.data?.message ?? body?.message;
          if (msg === name) return msg;
        }
        const rest = await sigv4.fetch(trimmed + '/echo?message=' + encodeURIComponent(name));
        const body = await rest.json();
        const msg = body?.message ?? body?.result?.data?.message;
        if (msg !== name) throw new Error('unexpected echo: ' + JSON.stringify(body));
        return msg;
      });
    }

    // Agents — invoked through their vended hooks/clients.
    const agentInvocations: [string, () => Promise<string>][] = [
${invocations}
    ];
    for (const [key, fn] of agentInvocations) {
      await record(key, fn);
    }

    setResults((r) => ({ ...r, done: 'true' }));
  }, [runtimeConfig, sigv4]);

  return (
    <div>
      <button data-testid="run-integration-test" onClick={run}>
        Run
      </button>
      <pre data-testid="integration-test-results">{JSON.stringify(results)}</pre>
    </div>
  );
}
`;

  writeFileSync(join(routesDir, 'integration-test.tsx'), source);
  return '/integration-test';
};

/**
 * Ensure the Playwright Chromium browser and the integration test's other
 * runtime dependencies are installed. Idempotent — safe to call from a smoke
 * test's setup before the workspace build.
 */
export const installChromium = async (): Promise<void> => {
  await ensureIntegrationDeps();
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
  const {
    cognito: {
      CognitoIdentityProviderClient,
      AdminCreateUserCommand,
      AdminSetUserPasswordCommand,
    },
  } = await ensureIntegrationDeps();
  const client = new CognitoIdentityProviderClient({ region: REGION });
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
  expectedApiCount: number;
  expectedAgents: AgentSpec[];
  login?: CognitoLogin;
}): Promise<void> => {
  const { baseUrl, expectedApiCount, expectedAgents, login } = options;

  const { chromium } = await ensureIntegrationDeps();
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
      // hosted UI. Complete the login form, then wait to land back on the app
      // and for the post-login OAuth code exchange to settle.
      await page.waitForURL(/amazoncognito\.com/, { timeout: 120_000 });
      await page
        .locator('input[name="username"], input[id*="signInFormUsername"]')
        .first()
        .fill(login.username);
      await page
        .locator('input[name="password"], input[id*="signInFormPassword"]')
        .first()
        .fill(login.password);
      await page
        .locator('input[type="submit"], button[type="submit"]')
        .first()
        .click();
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
      ...expectedAgents.map((a) => `agent:${a.className}`),
    ];
    await page.waitForFunction(
      ({ keys, apiCount }) => {
        const el = document.querySelector(
          '[data-testid="integration-test-results"]',
        );
        if (!el?.textContent) return false;
        const obj = JSON.parse(el.textContent);
        const apiKeys = Object.keys(obj).filter((k) => k.startsWith('api:'));
        return keys.every((k) => k in obj) && apiKeys.length >= apiCount;
      },
      { keys: expectedKeys, apiCount: expectedApiCount },
      { timeout: 180_000 },
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
    const apiResults = Object.keys(results).filter((k) => k.startsWith('api:'));
    expect(apiResults.length).toBeGreaterThanOrEqual(expectedApiCount);
  } finally {
    await browser.close();
  }
};
