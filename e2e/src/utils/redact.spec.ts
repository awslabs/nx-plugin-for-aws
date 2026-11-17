/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { redactOAuthValues } from './redact';

const KEYS = ['code', 'id_token', 'access_token', 'refresh_token'];

/** An authorization code with the shape Cognito issues: UUID length. */
const CODE = '0b9f1f3a-5c21-4d8e-9a77-3f4b2c1d8e90';

/**
 * The value a key is given in the shared cases. A token key is redacted
 * whatever its value looks like; `code` is only redacted when it is
 * token-shaped, so it gets a real code.
 */
const valueFor = (key: string) => (key === 'code' ? CODE : 'v-1');

/** A token-shaped value of exactly `length` characters. */
const longValue = (length: number) =>
  `${CODE}${'a'.repeat(length - CODE.length)}`;

/**
 * Values of `code` a maintainer needs when triaging a failed run: too short
 * to be a code, or letters and underscores only.
 */
const SURVIVING_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  '500',
  'E123',
  'ResourceNotFoundException',
  'UnrecognizedClientException',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_INVALID_ARG_TYPE',
];

/** Values of `code` that are token-shaped and must never reach a log. */
const REDACTED_CODES = [
  CODE,
  'eyJhbGciOiJub25lIn0.e30.sig',
  'a1b2c3d4e5f6g7h8i9j0k1l2',
];

describe('redactOAuthValues', () => {
  it.each(KEYS)('redacts %s in a query string', (key) => {
    const value = valueFor(key);
    expect(
      redactOAuthValues(`https://app.example.com/?${key}=${value}&state=s1`),
    ).toBe(`https://app.example.com/?${key}=[REDACTED]&state=s1`);
  });

  it.each(KEYS)('redacts %s in a URL fragment', (key) => {
    const value = valueFor(key);
    expect(
      redactOAuthValues(
        `https://app.example.com/#${key}=${value}&token_type=Bearer`,
      ),
    ).toBe(`https://app.example.com/#${key}=[REDACTED]&token_type=Bearer`);
  });

  it.each(KEYS)('redacts %s in JSON', (key) => {
    const value = valueFor(key);
    expect(redactOAuthValues(`{"${key}":"${value}","state":"s1"}`)).toBe(
      `{"${key}":"[REDACTED]","state":"s1"}`,
    );
  });

  it('redacts every value in a string holding several', () => {
    const input =
      'https://app.example.com/#id_token=eyJhbGciOiJub25lIn0.e30.sig' +
      '&access_token=at-111&refresh_token=rt-222 ' +
      `{"code":"${CODE}","access_token":"at-333"}`;
    const output = redactOAuthValues(input);
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(5);
    for (const value of [
      'eyJhbGciOiJub25lIn0.e30.sig',
      'at-111',
      'rt-222',
      CODE,
      'at-333',
    ]) {
      expect(output).not.toContain(value);
    }
  });

  it('redacts JSON with a space after the colon and an escaped quote', () => {
    expect(redactOAuthValues('{"id_token": "a\\"b"}')).toBe(
      '{"id_token": "[REDACTED]"}',
    );
  });

  it('redacts an HTML-escaped query string in an attribute', () => {
    expect(
      redactOAuthValues(
        `<a href="https://app.example.com/?state=s1&amp;code=${CODE}">`,
      ),
    ).toBe('<a href="https://app.example.com/?state=s1&amp;code=[REDACTED]">');
  });

  it('redacts a Chromium object preview', () => {
    expect(redactOAuthValues(`[browser:log] {code: ${CODE}, state: s1}`)).toBe(
      '[browser:log] {code: [REDACTED], state: s1}',
    );
  });

  it.each([
    [`{ code: ${CODE}, state: s1 }`, '{ code: [REDACTED], state: s1 }'],
    [`{code : ${CODE}}`, '{code : [REDACTED]}'],
    [`{code:${CODE}}`, '{code:[REDACTED]}'],
    ['{\n  access_token: at-value\n}', '{\n  access_token: [REDACTED]\n}'],
    [
      '{\n  id_token: eyJhbGciOiJub25lIn0.e30.sig,\n  state: s1\n}',
      '{\n  id_token: [REDACTED],\n  state: s1\n}',
    ],
    [
      '{refresh_token: rt-1 , state: s1}',
      '{refresh_token: [REDACTED] , state: s1}',
    ],
  ])(
    'redacts an object preview whatever the whitespace: %s',
    (input, expected) => {
      expect(redactOAuthValues(input)).toBe(expected);
    },
  );

  it.each([
    [`{ code: '${CODE}' }`, "{ code: '[REDACTED]' }"],
    [`{ code: "${CODE}" }`, '{ code: "[REDACTED]" }'],
  ])('redacts a quoted code in an object preview: %s', (input, expected) => {
    expect(redactOAuthValues(input)).toBe(expected);
  });

  it.each(['id_token_hint', 'idToken', 'accessToken', 'refreshToken'])(
    'redacts %s in a query string, JSON and a preview',
    (key) => {
      expect(
        redactOAuthValues(`https://app.example.com/?${key}=v-1&state=s1`),
      ).toBe(`https://app.example.com/?${key}=[REDACTED]&state=s1`);
      expect(redactOAuthValues(`{"${key}":"v-1"}`)).toBe(
        `{"${key}":"[REDACTED]"}`,
      );
      expect(redactOAuthValues(`{${key}: v-1, state: s1}`)).toBe(
        `{${key}: [REDACTED], state: s1}`,
      );
    },
  );

  it('redacts the id_token_hint the website sends on logout', () => {
    expect(
      redactOAuthValues(
        'https://auth.example.com/logout?id_token_hint=eyJhbGciOiJub25lIn0.e30.sig&client_id=c1',
      ),
    ).toBe(
      'https://auth.example.com/logout?id_token_hint=[REDACTED]&client_id=c1',
    );
  });

  it('redacts a token in a logged form body', () => {
    expect(
      redactOAuthValues('token request body: access_token=at-1&state=s1'),
    ).toBe('token request body: access_token=[REDACTED]&state=s1');
  });

  it.each([
    [
      `token request body: code=${CODE}&state=s1`,
      'token request body: code=[REDACTED]&state=s1',
    ],
    [
      `token request body: grant_type=authorization_code&code=${CODE}`,
      'token request body: grant_type=authorization_code&code=[REDACTED]',
    ],
    [
      `exchanging code=${CODE} for tokens`,
      'exchanging code=[REDACTED] for tokens',
    ],
    [`exchanging\tcode=${CODE}`, 'exchanging\tcode=[REDACTED]'],
  ])('redacts a labeled code outside a URL: %s', (input, expected) => {
    expect(redactOAuthValues(input)).toBe(expected);
  });

  it.each([
    ['access_token=at-1; path=/', 'access_token=[REDACTED]; path=/'],
    [`code=${CODE}; path=/`, 'code=[REDACTED]; path=/'],
    ['(access_token=at-1)', '(access_token=[REDACTED])'],
    [`(code=${CODE})`, '(code=[REDACTED])'],
  ])(
    'keeps the punctuation that follows a parameter value: %s',
    (input, expected) => {
      expect(redactOAuthValues(input)).toBe(expected);
    },
  );

  it.each(SURVIVING_CODES)(
    'keeps the diagnostic code value %s in JSON, a preview and prose',
    (value) => {
      for (const text of [
        `{"code":"${value}"}`,
        `{code: ${value}}`,
        `{ code: '${value}' }`,
        `request failed with error code=${value}`,
      ]) {
        expect(redactOAuthValues(text)).toBe(text);
      }
    },
  );

  it.each(REDACTED_CODES)(
    'redacts the token-shaped code value %s in JSON, a preview and prose',
    (value) => {
      expect(redactOAuthValues(`{"code":"${value}"}`)).toBe(
        '{"code":"[REDACTED]"}',
      );
      expect(redactOAuthValues(`{code: ${value}}`)).toBe('{code: [REDACTED]}');
      expect(redactOAuthValues(`{ code: '${value}' }`)).toBe(
        "{ code: '[REDACTED]' }",
      );
      expect(redactOAuthValues(`exchanging code=${value} now`)).toBe(
        'exchanging code=[REDACTED] now',
      );
    },
  );

  it.each([
    '{code: ECONNRESET, host: app.example.com}',
    '{code: 500, status: ok}',
    '{ code: ETIMEDOUT }',
    'request failed with error code=E123',
    'getaddrinfo ENOTFOUND {code: ENOTFOUND, syscall: getaddrinfo}',
    '{"error_description":"invalid request, code=E123"}',
    `error_code=E1&my_code=${CODE}`,
  ])(
    'keeps a code value that is not token-shaped or not a code: %s',
    (text) => {
      expect(redactOAuthValues(text)).toBe(text);
    },
  );

  it('redacts an unterminated JSON value to the end of its line', () => {
    const input = `x {"code":"${CODE}\nUSEFUL LINE\nMORE" y`;
    const output = redactOAuthValues(input);
    expect(output).toBe('x {"code":"[REDACTED]\nUSEFUL LINE\nMORE" y');
    expect(output).not.toContain(CODE);
  });

  it('redacts an unterminated JSON token value to the end of its line', () => {
    const input = 'x {"access_token":"at-1\nUSEFUL LINE\nMORE" y';
    const output = redactOAuthValues(input);
    expect(output).toBe('x {"access_token":"[REDACTED]\nUSEFUL LINE\nMORE" y');
    expect(output).not.toContain('at-1');
  });

  it('redacts a JSON value on its own line without touching the next line', () => {
    expect(redactOAuthValues(`{"code":"${CODE}"}\nUSEFUL LINE`)).toBe(
      '{"code":"[REDACTED]"}\nUSEFUL LINE',
    );
  });

  it.each([4000, 4096, 4097, 10000])(
    'redacts a %i-character single-line value',
    (length) => {
      const value = longValue(length);
      expect(redactOAuthValues(`{"access_token":"${value}"}`)).toBe(
        '{"access_token":"[REDACTED]"}',
      );
      expect(redactOAuthValues(`{"code":"${value}"}`)).toBe(
        '{"code":"[REDACTED]"}',
      );
    },
  );

  it.each([
    'state=s1&client_id=c1',
    'error_code=E1',
    'codeVerifier=v1&code_challenge=cc1',
    'Enter the code sent to your email. Error code: 500',
    'https://app.example.com/path?foo=bar#section',
    '{"state":"s1","client_id":"c1"}',
  ])('leaves unrelated text unchanged: %s', (text) => {
    expect(redactOAuthValues(text)).toBe(text);
  });

  it('leaves an empty string empty', () => {
    expect(redactOAuthValues('')).toBe('');
  });

  it.each(['code=&state=s1', '{"code":""}'])(
    'leaves a key with no value unchanged: %s',
    (text) => {
      expect(redactOAuthValues(text)).toBe(text);
    },
  );
});
