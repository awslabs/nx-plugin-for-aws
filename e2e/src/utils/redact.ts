/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keys whose value is a credential whatever it looks like, so every value
 * they carry is replaced. Longer keys come before the shorter keys they start
 * with, because the alternation built from this list is matched in order and
 * `code_verifier` must win over `code`.
 */
const TOKEN_KEYS = [
  'id_token(?:_hint)?',
  'access_token',
  'refresh_token',
  'client_secret',
  'code_verifier',
  'idToken',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'codeVerifier',
];

/** Every key this module reads, the credential keys plus the OAuth `code`. */
const KEYS = [...TOKEN_KEYS, 'code'].join('|');

const REDACTED = '[REDACTED]';

/**
 * A bare status or errno number: `500`, `-4058`. Six digits is more than any
 * HTTP status or errno needs and far short of a numeric code worth stealing.
 */
const DIAGNOSTIC_NUMBER = /^[0-9]{1,6}$/;

/**
 * An all-caps code held together by underscores: `ERR_TLS_CERT_ALTNAME_INVALID`
 * (28 characters), `ERR_INVALID_ARG_TYPE`. The underscores are what tell a
 * Node, HTTP or AWS code apart from an opaque value, so this shape is allowed
 * 32 characters where one with no underscore is not. It has to start with a
 * letter, so a long number is judged by `DIAGNOSTIC_NUMBER` alone.
 */
const DIAGNOSTIC_UNDERSCORED_NAME = /^[A-Z][A-Z0-9_]{0,31}$/;

/**
 * A short all-caps code with no underscore: `ECONNRESET`, `ETIMEDOUT`, `E123`.
 * Sixteen characters covers the longest errno name Node defines
 * (`EPROTONOSUPPORT`, 15) and is too short to hold the 20 or more characters
 * an authorization code, a base32 secret or a hex digest needs. It has to
 * start with a letter, so a long number is judged by `DIAGNOSTIC_NUMBER`
 * alone.
 */
const DIAGNOSTIC_SHORT_NAME = /^[A-Z][A-Z0-9]{0,15}$/;

/** An error class name: `ResourceNotFoundException`, `TypeError`. */
const DIAGNOSTIC_CLASS = /^[A-Za-z_][A-Za-z0-9_]*(?:Exception|Error)$/;

/**
 * Whether a `code` value is a diagnostic rather than an authorization code.
 * `code` names the OAuth parameter and also the property Node, HTTP and AWS
 * SDK errors put their failure identifier in, which a maintainer needs when
 * triaging a failed run, so the four shapes above are kept.
 *
 * The rule says what is safe to log instead of what a credential looks like,
 * and every shape is bounded short of the length a credential occupies. An
 * authorization code that arrives in an unexpected shape is redacted because
 * it is not on this list, rather than surviving because it failed to match a
 * pattern. The one unbounded shape is the class name, which is kept for its
 * `Exception` or `Error` suffix rather than for its length.
 */
const isDiagnosticCode = (value: string): boolean =>
  DIAGNOSTIC_NUMBER.test(value) ||
  (value.includes('_')
    ? DIAGNOSTIC_UNDERSCORED_NAME.test(value)
    : DIAGNOSTIC_SHORT_NAME.test(value)) ||
  DIAGNOSTIC_CLASS.test(value);

/**
 * Whether the value of `key` has to be replaced. An empty value holds no
 * credential, and `code` is the only key with values worth keeping.
 */
const mustRedact = (key: string, value: string): boolean => {
  if (value === '') {
    return false;
  }
  return key !== 'code' || !isDiagnosticCode(value);
};

/**
 * The value of a quoted `key="value"` or `key: 'value'`, as two alternatives
 * one per quote character. A quoted value runs to the matching quote, a line
 * end or the end of the input, so a space, comma or brace inside the quotes
 * is part of the value and cannot end the match early. Each value class
 * excludes its own terminators, so the pattern has nothing to backtrack over.
 */
const QUOTED_VALUE = String.raw`"([^"\r\n]*)("|(?=[\r\n]|$))|'([^'\r\n]*)('|(?=[\r\n]|$))`;

/** The quote and the inner value of whichever quoted alternative matched. */
const quotedValue = (
  doubleQuoted: string | undefined,
  doubleClose: string | undefined,
  singleQuoted: string | undefined,
  singleClose: string | undefined,
): { quote: string; value: string; close: string } | undefined => {
  if (doubleQuoted !== undefined) {
    return { quote: '"', value: doubleQuoted, close: doubleClose ?? '' };
  }
  if (singleQuoted !== undefined) {
    return { quote: "'", value: singleQuoted, close: singleClose ?? '' };
  }
  return undefined;
};

/**
 * `key=value` in a query string, a URL fragment, a logged form body or
 * prose. The lookbehind keeps compound names such as `my_access_token` and
 * `error_code` out.
 *
 * An unquoted value runs to the next `&`, `#`, whitespace, quote or angle
 * bracket, so no character inside it can end the match early and leave the
 * rest in the log. `;` and `)` are left alone so a cookie attribute or a
 * closing bracket after the value stays readable. A quoted value instead
 * runs to its matching quote, and the quotes are printed again, which is
 * what makes `code="<value>"` and `access_token="<two words>"` redact whole.
 */
const PARAM_PATTERN = new RegExp(
  String.raw`(?<![\w.-])(${KEYS})=(?:${QUOTED_VALUE}|([^&#\s"'<>;)]*))`,
  'g',
);

const redactParam = (
  match: string,
  key: string,
  doubleQuoted: string | undefined,
  doubleClose: string | undefined,
  singleQuoted: string | undefined,
  singleClose: string | undefined,
  bare: string | undefined,
): string => {
  const quoted = quotedValue(
    doubleQuoted,
    doubleClose,
    singleQuoted,
    singleClose,
  );
  const value = quoted?.value ?? bare ?? '';
  if (!mustRedact(key, value)) {
    return match;
  }
  return `${key}=${quoted?.quote ?? ''}${REDACTED}${quoted?.close ?? ''}`;
};

/**
 * A JSON property: `"access_token":"<value>"`. The value runs to the closing
 * unescaped quote, a line end or the end of the input, and a backslash with
 * nothing after it is consumed as well.
 *
 * Every character other than those terminators belongs to the value, so a
 * JSON escape, a space, a comma, a brace or a non-ASCII byte inside it
 * cannot stop the match — a mangled or truncated dump has its value redacted
 * to the end of its own line while the lines after it stay readable and keep
 * their `\r`. Each branch of the value starts on a different character, so
 * the pattern has nothing to backtrack over.
 */
const JSON_PATTERN = new RegExp(
  String.raw`("(${KEYS})"\s*:\s*")((?:[^"\\\r\n]|\\[^\r\n]|\\(?=[\r\n]|$))*)("|(?=[\r\n]|$))`,
  'g',
);

const redactJson = (
  match: string,
  prefix: string,
  key: string,
  value: string,
  close: string,
): string => (mustRedact(key, value) ? `${prefix}${REDACTED}${close}` : match);

/**
 * A logged object as Chromium and `util.inspect` print it:
 * `{ accessToken: 'at-1', code: <value> }`. Browser console text is not a
 * stable serialization format, so the delimiter before the key and the
 * whitespace around the key and the colon are matched loosely and printed
 * again unchanged. A quoted value runs to its matching quote and keeps the
 * quotes it arrived in; an unquoted one runs to the next comma, closing
 * brace or line end.
 */
const PREVIEW_PATTERN = new RegExp(
  String.raw`(^|[{,])(\s*)(${KEYS})(\s*):(\s*)(?:${QUOTED_VALUE}|([^,}\r\n]*))`,
  'gm',
);

const redactPreview = (
  match: string,
  delimiter: string,
  beforeKey: string,
  key: string,
  afterKey: string,
  afterColon: string,
  doubleQuoted: string | undefined,
  doubleClose: string | undefined,
  singleQuoted: string | undefined,
  singleClose: string | undefined,
  bare: string | undefined,
): string => {
  const prefix = `${delimiter}${beforeKey}${key}${afterKey}:${afterColon}`;
  const quoted = quotedValue(
    doubleQuoted,
    doubleClose,
    singleQuoted,
    singleClose,
  );
  if (quoted) {
    return mustRedact(key, quoted.value)
      ? `${prefix}${quoted.quote}${REDACTED}${quoted.close}`
      : match;
  }
  // An unquoted value ends at the last character that is not whitespace;
  // what follows it separates the value from the delimiter and is printed
  // again.
  const rest = bare ?? '';
  const value = rest.trimEnd();
  if (!mustRedact(key, value)) {
    return match;
  }
  return `${prefix}${REDACTED}${rest.slice(value.length)}`;
};

/**
 * A bearer credential, in an `Authorization` header or in prose: `Bearer
 * <token>` in any case the HTTP scheme name can be written in. The token
 * runs to the first character outside the base64url and JWT alphabet, so
 * the punctuation and the words around it stay readable, and the scheme
 * name is printed back as it arrived.
 */
const BEARER_PATTERN = /\b(Bearer)(\s+)([A-Za-z0-9._~+/=-]+)/gi;

const redactBearer = (_match: string, scheme: string, space: string): string =>
  `${scheme}${space}${REDACTED}`;

/**
 * Replaces credentials in text that is about to be logged with
 * `[REDACTED]`, keeping the key and the punctuation around it.
 *
 * What is covered: the values of `code`, `id_token`, `id_token_hint`,
 * `access_token`, `refresh_token`, `client_secret`, `code_verifier` and
 * their camelCase spellings, written as a `key=value` parameter (quoted or
 * not), a JSON property or a `key: value` object preview, and a `Bearer
 * <token>` credential wherever it appears. Every credential key loses its
 * value whatever the value is; a `code` value is kept only when it is one
 * of the diagnostic shapes `isDiagnosticCode` lists.
 *
 * What is not covered: a credential under any other key, one with no key at
 * all, a key spelled in another case (`ACCESS_TOKEN=`) or separated from its
 * value by anything but `=` or `:`, and the tail of a value broken across
 * lines, which is redacted only as far as the line end. A `code` value
 * ending in `Exception` or `Error` is kept at any length.
 *
 * This is a backup for text that reaches a log by a path a maintainer did
 * not choose, such as browser console output. It is not a licence to log a
 * credential and rely on the replacement.
 */
export const redactOAuthValues = (text: string): string =>
  text
    .replace(PARAM_PATTERN, redactParam)
    .replace(JSON_PATTERN, redactJson)
    .replace(PREVIEW_PATTERN, redactPreview)
    .replace(BEARER_PATTERN, redactBearer);
