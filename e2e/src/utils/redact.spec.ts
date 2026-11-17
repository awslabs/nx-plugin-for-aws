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
 * The value a key is given in the shared cases. A credential key is redacted
 * whatever its value looks like; a `code` value is kept when it is one of the
 * diagnostic shapes, so it gets a real code.
 */
const valueFor = (key: string) => (key === 'code' ? CODE : 'v-1');

/** An opaque value of exactly `length` characters. */
const longValue = (length: number) =>
  `${CODE}${'a'.repeat(length - CODE.length)}`;

/**
 * Values of `code` a maintainer needs when triaging a failed run: a short
 * number, a short all-caps code, an underscored all-caps code, or a class
 * name.
 */
const SURVIVING_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPROTONOSUPPORT',
  '500',
  '123456',
  'E123',
  'ResourceNotFoundException',
  'UnrecognizedClientException',
  'TypeError',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_INVALID_ARG_TYPE',
];

/**
 * Values of `code` that are long enough to be a real authorization code and
 * must never reach a log: a UUID, a JWT, a lowercase opaque value, an
 * all-caps hex or base32 value, a long number, and a long underscored value.
 */
const REDACTED_CODES = [
  CODE,
  'eyJhbGciOiJub25lIn0.e30.sig',
  'a1b2c3d4e5f6g7h8i9j0k1l2',
  'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0',
  'MFRGGZDFMZTWQ2LKNNWG23TP',
  '123456789012345678901234',
  'ERR_A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6',
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
    'redacts the opaque code value %s in JSON, a preview and prose',
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
    'keeps a code value that is a diagnostic, or not a code at all: %s',
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
    'code_challenge=cc1&code_challenge_method=S256',
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

  // Every case below is an input an earlier review probed against this
  // helper and found unredacted.

  it.each([
    [`received code="${CODE}"`, 'received code="[REDACTED]"'],
    [`received code='${CODE}'`, "received code='[REDACTED]'"],
    ['token=1 access_token="at-1"', 'token=1 access_token="[REDACTED]"'],
    ["token=1 access_token='at-1'", "token=1 access_token='[REDACTED]'"],
  ])('redacts a quoted parameter value: %s', (input, expected) => {
    expect(redactOAuthValues(input)).toBe(expected);
  });

  it.each([
    [`{"code":"${CODE}\\/x"}`, 'a JSON escape'],
    [`{"code":"${CODE} "}`, 'a trailing space'],
    [`{"code":" ${CODE}"}`, 'a leading space'],
    [`{"code":"${CODE},x"}`, 'a comma'],
    [`{"code":"${CODE}}"}`, 'a closing brace'],
    [`{"code":"${CODE}é"}`, 'a non-ASCII character'],
  ])('redacts a JSON code value holding %s: %s', (input) => {
    const output = redactOAuthValues(input);
    expect(output).toBe('{"code":"[REDACTED]"}');
    expect(output).not.toContain(CODE);
  });

  it.each([
    [`x {"code":"${CODE}\r\nNEXT`, 'x {"code":"[REDACTED]\r\nNEXT'],
    [
      'x {"access_token":"at-1\r\nNEXT',
      'x {"access_token":"[REDACTED]\r\nNEXT',
    ],
  ])(
    'redacts a CRLF-terminated JSON value and keeps the carriage return: %s',
    (input, expected) => {
      expect(redactOAuthValues(input)).toBe(expected);
    },
  );

  it.each([
    ['{"access_token":"secret\\', '{"access_token":"[REDACTED]'],
    ['{"access_token":"secret\\\nNEXT', '{"access_token":"[REDACTED]\nNEXT'],
    [
      '{"access_token":"secret\\\r\nNEXT',
      '{"access_token":"[REDACTED]\r\nNEXT',
    ],
    [`{"code":"${CODE}\\`, '{"code":"[REDACTED]'],
    [`{"code":"${CODE}\\\nNEXT`, '{"code":"[REDACTED]\nNEXT'],
  ])(
    'redacts a JSON value truncated after a lone backslash: %s',
    (input, expected) => {
      expect(redactOAuthValues(input)).toBe(expected);
      expect(redactOAuthValues(input)).not.toContain('secret');
    },
  );

  it.each([
    ['{"access_token":"at-1', '{"access_token":"[REDACTED]'],
    [`{"code":"${CODE}`, '{"code":"[REDACTED]'],
  ])('redacts a JSON value that ends with the input: %s', (input, expected) => {
    expect(redactOAuthValues(input)).toBe(expected);
  });

  it.each([
    [`{ accessToken: '${CODE}' }`, "{ accessToken: '[REDACTED]' }"],
    [`{ accessToken: "${CODE}" }`, '{ accessToken: "[REDACTED]" }'],
    [
      "{ refreshToken: 'rt-1', state: 's1' }",
      "{ refreshToken: '[REDACTED]', state: 's1' }",
    ],
  ])(
    'keeps the quotes around a redacted token in an object preview: %s',
    (input, expected) => {
      expect(redactOAuthValues(input)).toBe(expected);
    },
  );

  it.each([
    `{"id_token":"${CODE} "}`,
    `{"refresh_token":"${CODE}é"}`,
    `{ idToken: '${CODE}' }`,
    `id_token_hint="${CODE}"`,
    `{"accessToken":"${CODE},x"}`,
  ])('redacts a token value whatever its shape: %s', (input) => {
    expect(redactOAuthValues(input)).not.toContain(CODE);
  });

  // A quoted value runs to its matching quote, so a delimiter inside the
  // quotes cannot end the redaction early and leave the rest of the
  // credential in the log.

  it.each([
    ['access_token="abc def"', 'access_token="[REDACTED]"'],
    ["access_token='abc def'", "access_token='[REDACTED]'"],
    ['access_token="abc,def"', 'access_token="[REDACTED]"'],
    ['access_token="abc}def"', 'access_token="[REDACTED]"'],
    ['access_token="abc&def"', 'access_token="[REDACTED]"'],
    ['access_token="abc#def"', 'access_token="[REDACTED]"'],
    ['access_token="abc;def"', 'access_token="[REDACTED]"'],
    ['access_token="abc)def"', 'access_token="[REDACTED]"'],
    ['access_token="abc<def>"', 'access_token="[REDACTED]"'],
    ['access_token="abc\'def"', 'access_token="[REDACTED]"'],
    ["access_token='abc\"def'", "access_token='[REDACTED]'"],
    [`code="${CODE} ${CODE}"`, 'code="[REDACTED]"'],
    [
      'token request body: client_secret="s1 s2"&grant_type=x',
      'token request body: client_secret="[REDACTED]"&grant_type=x',
    ],
  ])(
    'redacts a quoted parameter value holding a delimiter: %s',
    (input, expected) => {
      const output = redactOAuthValues(input);
      expect(output).toBe(expected);
      expect(output).not.toContain('def');
    },
  );

  it.each([
    ["{ accessToken: 'abc def' }", "{ accessToken: '[REDACTED]' }"],
    ["{ accessToken: 'abc,def' }", "{ accessToken: '[REDACTED]' }"],
    ["{ accessToken: 'abc}def' }", "{ accessToken: '[REDACTED]' }"],
    ['{ accessToken: "abc,def" }', '{ accessToken: "[REDACTED]" }'],
    ['{ accessToken: "abc}def" }', '{ accessToken: "[REDACTED]" }'],
    ['{accessToken:"abc def"}', '{accessToken:"[REDACTED]"}'],
    [
      "{ accessToken: 'abc def', state: 's1' }",
      "{ accessToken: '[REDACTED]', state: 's1' }",
    ],
    [`{ code: '${CODE} x' }`, "{ code: '[REDACTED]' }"],
  ])(
    'redacts a quoted preview value holding a delimiter: %s',
    (input, expected) => {
      const output = redactOAuthValues(input);
      expect(output).toBe(expected);
      expect(output).not.toContain('def');
    },
  );

  it.each([
    ['access_token="abc def', 'access_token="[REDACTED]'],
    ["access_token='abc def", "access_token='[REDACTED]"],
    ['access_token="abc def\nNEXT', 'access_token="[REDACTED]\nNEXT'],
    ['access_token="abc def\r\nNEXT', 'access_token="[REDACTED]\r\nNEXT'],
    ["{ accessToken: 'abc def", "{ accessToken: '[REDACTED]"],
    ["{ accessToken: 'abc def\nNEXT", "{ accessToken: '[REDACTED]\nNEXT"],
  ])(
    'redacts a quoted value with no closing quote to the line end: %s',
    (input, expected) => {
      const output = redactOAuthValues(input);
      expect(output).toBe(expected);
      expect(output).not.toContain('def');
    },
  );

  // A backslash escapes the character after it inside a quoted value, so an
  // escaped copy of the surrounding quote is part of the value and cannot end
  // the redaction early and leave the rest of the credential in the log.

  it.each([
    ['access_token="abc\\"def"', 'access_token="[REDACTED]"'],
    ["access_token='abc\\'def'", "access_token='[REDACTED]'"],
    [`code="${CODE}\\"x"`, 'code="[REDACTED]"'],
    ['access_token="abc\\\\"', 'access_token="[REDACTED]"'],
    ['access_token="abc\\"def\\"ghi"', 'access_token="[REDACTED]"'],
  ])(
    'redacts a quoted parameter value holding an escaped quote: %s',
    (input, expected) => {
      const output = redactOAuthValues(input);
      expect(output).toBe(expected);
      expect(output).not.toContain('def');
    },
  );

  it.each([
    ['{ accessToken: "abc\\"def" }', '{ accessToken: "[REDACTED]" }'],
    ["{ accessToken: 'abc\\'def' }", "{ accessToken: '[REDACTED]' }"],
    ['{accessToken:"abc\\"def"}', '{accessToken:"[REDACTED]"}'],
  ])(
    'redacts a quoted preview value holding an escaped quote: %s',
    (input, expected) => {
      const output = redactOAuthValues(input);
      expect(output).toBe(expected);
      expect(output).not.toContain('def');
    },
  );

  it.each([
    ['access_token="abc\\', 'access_token="[REDACTED]'],
    ['access_token="abc\\\nNEXT', 'access_token="[REDACTED]\nNEXT'],
    ["{ accessToken: 'abc\\", "{ accessToken: '[REDACTED]"],
  ])(
    'redacts a quoted value truncated after a lone backslash: %s',
    (input, expected) => {
      const output = redactOAuthValues(input);
      expect(output).toBe(expected);
      expect(output).not.toContain('abc');
    },
  );

  // The diagnostic shapes are bounded short of the length a credential
  // occupies. Each bound is pinned on both sides.

  it.each([
    ['1', true],
    ['500', true],
    ['123456', true],
    ['1234567', false],
    ['123456789012345678901234', false],
    ['1'.repeat(16), false],
    ['E', true],
    ['EPROTONOSUPPORT', true],
    ['A'.repeat(16), true],
    ['A'.repeat(17), false],
    ['MFRGGZDFMZTWQ2LKNNWG23TP', false],
    ['A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0', false],
    ['ERR_TLS_CERT_ALTNAME_INVALID', true],
    [`A_${'1'.repeat(30)}`, true],
    [`A_${'1'.repeat(31)}`, false],
    ['ERR_A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6', false],
    ['ResourceNotFoundException', true],
    [`${'A'.repeat(60)}Error`, true],
    ['accessdenied', false],
    ['AccessDenied', false],
  ])('keeps the code value %s as a diagnostic: %s', (value, kept) => {
    for (const [input, redacted] of [
      [`{"code":"${value}"}`, '{"code":"[REDACTED]"}'],
      [`{code: ${value}}`, '{code: [REDACTED]}'],
      [`{ code: '${value}' }`, "{ code: '[REDACTED]' }"],
      [`failed with code=${value} now`, 'failed with code=[REDACTED] now'],
    ]) {
      expect(redactOAuthValues(input)).toBe(kept ? input : redacted);
    }
  });

  // The client secret and the PKCE verifier are credentials in the same
  // token request as the code, and a bearer credential has no key at all.

  it.each(['client_secret', 'code_verifier', 'clientSecret', 'codeVerifier'])(
    'redacts %s in a query string, JSON and a preview',
    (key) => {
      expect(
        redactOAuthValues(`token request: ${key}=s3cret&grant_type=x`),
      ).toBe(`token request: ${key}=[REDACTED]&grant_type=x`);
      expect(redactOAuthValues(`{"${key}":"s3cret"}`)).toBe(
        `{"${key}":"[REDACTED]"}`,
      );
      expect(redactOAuthValues(`{${key}: s3cret, state: s1}`)).toBe(
        `{${key}: [REDACTED], state: s1}`,
      );
    },
  );

  it.each([
    [
      'Authorization: Bearer eyJhbGciOiJub25lIn0.e30.sig',
      'Authorization: Bearer [REDACTED]',
    ],
    ['authorization: bearer abc.def-123_x', 'authorization: bearer [REDACTED]'],
    [
      '{"Authorization":"Bearer at-1"}',
      '{"Authorization":"Bearer [REDACTED]"}',
    ],
    [
      'curl -H "Authorization: Bearer at-1" https://api.example.com/',
      'curl -H "Authorization: Bearer [REDACTED]" https://api.example.com/',
    ],
    ['Bearer at-1 was rejected', 'Bearer [REDACTED] was rejected'],
    ['Bearer\tat-1', 'Bearer\t[REDACTED]'],
  ])('redacts a bearer credential: %s', (input, expected) => {
    expect(redactOAuthValues(input)).toBe(expected);
  });

  it.each([
    'token_type=Bearer',
    'the scheme is Bearer',
    'DebearerX at-1',
    'Bearer',
  ])('leaves a bearer scheme with no credential after it: %s', (text) => {
    expect(redactOAuthValues(text)).toBe(text);
  });

  it('replaces the word after Bearer whatever it is', () => {
    // The cost of failing closed: a sentence that names the scheme loses its
    // next word.
    expect(redactOAuthValues('Bearer token is required')).toBe(
      'Bearer [REDACTED] is required',
    );
  });
});
