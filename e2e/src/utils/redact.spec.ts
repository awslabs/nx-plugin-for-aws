/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { redactOAuthValues } from './redact';

const KEYS = ['code', 'id_token', 'access_token', 'refresh_token'];

/** An authorization code with the shape Cognito issues: UUID length. */
const CODE = '0b9f1f3a-5c21-4d8e-9a77-3f4b2c1d8e90';

describe('redactOAuthValues', () => {
  it.each(KEYS)('redacts %s in a query string', (key) => {
    expect(
      redactOAuthValues(`https://app.example.com/?${key}=v-1&state=s1`),
    ).toBe(`https://app.example.com/?${key}=[REDACTED]&state=s1`);
  });

  it.each(KEYS)('redacts %s in a URL fragment', (key) => {
    expect(
      redactOAuthValues(
        `https://app.example.com/#${key}=v-1&token_type=Bearer`,
      ),
    ).toBe(`https://app.example.com/#${key}=[REDACTED]&token_type=Bearer`);
  });

  it.each(KEYS)('redacts %s in JSON', (key) => {
    expect(redactOAuthValues(`{"${key}":"v-1","state":"s1"}`)).toBe(
      `{"${key}":"[REDACTED]","state":"s1"}`,
    );
  });

  it('redacts every value in a string holding several', () => {
    const input =
      'https://app.example.com/#id_token=eyJhbGciOiJub25lIn0.e30.sig' +
      '&access_token=at-111&refresh_token=rt-222 ' +
      '{"code":"abc-123","access_token":"at-333"}';
    const output = redactOAuthValues(input);
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(5);
    for (const value of [
      'eyJhbGciOiJub25lIn0.e30.sig',
      'at-111',
      'rt-222',
      'abc-123',
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
        '<a href="https://app.example.com/?state=s1&amp;code=abc">',
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
    '{code: ECONNRESET, host: app.example.com}',
    '{code: 500, status: ok}',
    '{ code: ETIMEDOUT }',
    'request failed with error code=E123',
    'getaddrinfo ENOTFOUND {code: ENOTFOUND, syscall: getaddrinfo}',
    '{"error_description":"invalid request, code=E123"}',
  ])('keeps a diagnostic code value that is not token-shaped: %s', (text) => {
    expect(redactOAuthValues(text)).toBe(text);
  });

  it('keeps the lines around an unterminated JSON value', () => {
    const input = 'x {"code":"abc\nUSEFUL LINE\nMORE" y';
    expect(redactOAuthValues(input)).toContain('USEFUL LINE');
    expect(redactOAuthValues(input)).toContain('MORE');
  });

  it('redacts a JSON value on its own line without touching the next line', () => {
    expect(redactOAuthValues(`{"code":"${CODE}"}\nUSEFUL LINE`)).toBe(
      '{"code":"[REDACTED]"}\nUSEFUL LINE',
    );
  });

  it('redacts a long single-line token value', () => {
    const token = `eyJ${'a'.repeat(4000)}`;
    expect(redactOAuthValues(`{"access_token":"${token}"}`)).toBe(
      '{"access_token":"[REDACTED]"}',
    );
  });

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
