/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { describeSignInFailure } from './sign-in-failure';

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
});
