/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  describeSignInFailure,
  signInIncompleteError,
  signInStepError,
} from './sign-in-failure';

/** An authorization code with the shape Cognito issues. */
const CODE = '0b9f1f3a-5c21-4d8e-9a77-3f4b2c1d8e90';

/** A token with the shape the hosted UI returns in a fragment. */
const TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1LTEifQ.c2lnbmF0dXJl';

/**
 * Every URL the sign-in flow can be on when a step fails, each carrying a
 * credential where the flow puts it: the query of the redirect back to the
 * app, the fragment of an implicit response, both at once, and a URL the
 * test cannot read.
 */
const CREDENTIAL_URLS = [
  `https://app.example.com/?code=${CODE}&state=s1`,
  `https://app.example.com/#access_token=${TOKEN}&token_type=Bearer`,
  `https://app.example.com/cb?code=${CODE}#id_token=${TOKEN}`,
  `https://e2e-idp.auth.us-west-2.amazoncognito.com/oauth2/authorize?client_id=c1&code_verifier=${CODE}`,
  `http://localhost:4200/?code=${CODE}`,
  `not a url at all ?code=${CODE}`,
  `https://app.example.com:abc/?code=${CODE}`,
  `data:text/html,code=${CODE}`,
  `javascript:fetch('/t?code=${CODE}')`,
];

describe('describeSignInFailure', () => {
  it('reports the step, the origin and path, the status and the title', () => {
    expect(
      describeSignInFailure({
        step: 'login form not fillable',
        url: `https://app.example.com/cb?code=${CODE}#id_token=${TOKEN}`,
        status: 502,
        title: 'Signin',
      }),
    ).toBe(
      '[login] login form not fillable url=https://app.example.com/cb status=502 title="Signin"',
    );
  });

  it('keeps the port of an origin', () => {
    expect(
      describeSignInFailure({ step: 'step', url: 'http://localhost:4200/x' }),
    ).toBe('[login] step url=http://localhost:4200/x');
  });

  it('leaves out a status and a title it was not given', () => {
    expect(
      describeSignInFailure({ step: 'step', url: 'https://app.example.com/' }),
    ).toBe('[login] step url=https://app.example.com/');
  });

  it('reports a status of zero rather than leaving it out', () => {
    expect(
      describeSignInFailure({
        step: 'step',
        url: 'https://app.example.com/',
        status: 0,
      }),
    ).toBe('[login] step url=https://app.example.com/ status=0');
  });

  it('keeps an empty title, as the sign of a page that rendered nothing', () => {
    expect(
      describeSignInFailure({
        step: 'step',
        url: 'https://app.example.com/',
        title: '',
      }),
    ).toBe('[login] step url=https://app.example.com/ title=""');
  });

  it.each([
    ['not a url at all', '[unreadable url]'],
    ['', '[unreadable url]'],
    ['https://app.example.com:abc/', '[unreadable url]'],
    ['about:blank', '[unreadable url]'],
    ['data:text/html,hello', '[unreadable url]'],
    ["javascript:fetch('/t')", '[unreadable url]'],
    ['chrome-error://chromewebdata/', '[unreadable url]'],
  ])('reports %s as a placeholder', (url, expected) => {
    expect(describeSignInFailure({ step: 'step', url })).toBe(
      `[login] step url=${expected}`,
    );
  });

  it.each(CREDENTIAL_URLS)('prints no query and no fragment of %s', (url) => {
    const line = describeSignInFailure({
      step: 'no E2eIdp sign-in button on the managed login page',
      url,
      status: 200,
      title: 'Signin',
    });
    expect(line).not.toContain(CODE);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain('?');
    expect(line).not.toContain('#');
    expect(line).not.toContain('code');
    expect(line).not.toContain('token');
  });

  it.each(CREDENTIAL_URLS)('prints no raw URL of %s', (url) => {
    const line = describeSignInFailure({ step: 'step', url });
    expect(line).not.toContain(url);
    expect(line.split('\n')).toHaveLength(1);
  });

  it('redacts a credential carried in a path segment', () => {
    const line = describeSignInFailure({
      step: 'step',
      url: `https://app.example.com/cb;code=${CODE}`,
    });
    expect(line).toBe(
      '[login] step url=https://app.example.com/cb;code=[REDACTED]',
    );
  });

  it('redacts a credential carried in a title', () => {
    const line = describeSignInFailure({
      step: 'step',
      url: 'https://app.example.com/',
      title: `access_token=${TOKEN}`,
    });
    expect(line).toBe(
      '[login] step url=https://app.example.com/ title="access_token=[REDACTED]"',
    );
  });

  it('keeps a multi-line title on one line', () => {
    expect(
      describeSignInFailure({
        step: 'step',
        url: 'https://app.example.com/',
        title: 'line one\nline two',
      }),
    ).toBe(
      '[login] step url=https://app.example.com/ title="line one\\nline two"',
    );
  });

  // The title is redacted as the page wrote it, before it is quoted, so the
  // quotes the redactor needs to find the end of a value have not yet been
  // escaped.

  it('redacts a credential in a title that quotes its value', () => {
    expect(
      describeSignInFailure({
        step: 'step',
        url: 'https://app.example.com/',
        title: `access_token="${TOKEN}"`,
      }),
    ).toBe(
      '[login] step url=https://app.example.com/ title="access_token=\\"[REDACTED]\\""',
    );
  });

  it('redacts a credential in a title that quotes its value with a single quote', () => {
    expect(
      describeSignInFailure({
        step: 'step',
        url: 'https://app.example.com/',
        title: `{ accessToken: '${TOKEN}' }`,
      }),
    ).toBe(
      '[login] step url=https://app.example.com/ title="{ accessToken: \'[REDACTED]\' }"',
    );
  });
});

/**
 * A `page.waitForURL` timeout as Playwright writes it: the log it appends
 * quotes every URL the page visited while waiting, which across the hosted-UI
 * redirect back to the app carries the authorization code and the tokens.
 */
const WAIT_FOR_URL_TIMEOUT = [
  'page.waitForURL: Timeout 120000ms exceeded.',
  '=========================== logs ===========================',
  'waiting for navigation until "load"',
  `  navigated to "https://app.example.com/?code=${CODE}&state=s1"`,
  `  navigated to "https://app.example.com/#id_token=${TOKEN}&token_type=Bearer"`,
  '============================================================',
].join('\n');

describe('signInStepError', () => {
  it('names the step and keeps the rest of the message', () => {
    expect(
      signInStepError('login form not fillable', new Error('boom')).message,
    ).toBe('[login] login form not fillable: boom');
  });

  it('redacts every credential a navigation-wait timeout quotes', () => {
    const { message } = signInStepError(
      'step',
      new Error(WAIT_FOR_URL_TIMEOUT),
    );
    expect(message).not.toContain(CODE);
    expect(message).not.toContain(TOKEN);
    expect(message).toContain('code=[REDACTED]');
    expect(message).toContain('id_token=[REDACTED]');
  });

  it('carries no cause and no copy of the original stack', () => {
    const original = new Error(WAIT_FOR_URL_TIMEOUT);
    const error = signInStepError('step', original);
    expect(error.cause).toBeUndefined();
    expect(error.stack ?? '').not.toContain(CODE);
    expect(error.stack ?? '').not.toContain(TOKEN);
    expect(error).not.toBe(original);
  });

  it('describes a value that was thrown without being an error', () => {
    expect(signInStepError('step', `code=${CODE}`).message).toBe(
      '[login] step: code=[REDACTED]',
    );
  });
});

describe('signInIncompleteError', () => {
  it('reports only the step and the origin and path of the page', () => {
    const error = signInIncompleteError(
      'the run button never rendered',
      `https://app.example.com/cb?code=${CODE}#id_token=${TOKEN}`,
    );
    expect(error.message).toBe(
      '[login] the run button never rendered url=https://app.example.com/cb',
    );
    expect(error.cause).toBeUndefined();
  });

  it.each(CREDENTIAL_URLS)('prints no query and no fragment of %s', (url) => {
    const { message } = signInIncompleteError('step', url);
    expect(message).not.toContain(CODE);
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain('?');
    expect(message).not.toContain('#');
  });
});
