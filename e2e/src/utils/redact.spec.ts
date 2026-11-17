/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { redactOAuthValues } from './redact';

const KEYS = ['code', 'id_token', 'access_token', 'refresh_token'];

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
    expect(redactOAuthValues('[browser:log] {code: abc-123, state: s1}')).toBe(
      '[browser:log] {code: [REDACTED], state: s1}',
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
