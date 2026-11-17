/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keys whose value is a bearer credential whatever it looks like, so every
 * value they carry is replaced.
 */
const TOKEN_KEYS = [
  'id_token(?:_hint)?',
  'access_token',
  'refresh_token',
  'idToken',
  'accessToken',
  'refreshToken',
];

/** Every key this module reads, the token keys plus the OAuth `code`. */
const KEYS = [...TOKEN_KEYS, 'code'].join('|');

const REDACTED = '[REDACTED]';

/** An all-caps Node, HTTP or AWS error code: `ECONNRESET`, `E123`. */
const DIAGNOSTIC_NAME = /^[A-Z0-9_]{1,40}$/;

/** A bare status or error number: `500`. */
const DIAGNOSTIC_NUMBER = /^[0-9]+$/;

/** An error class name: `ResourceNotFoundException`, `TypeError`. */
const DIAGNOSTIC_CLASS = /^[A-Za-z_][A-Za-z0-9_]*(?:Exception|Error)$/;

/**
 * Whether a `code` value is a diagnostic rather than an authorization code.
 * `code` names the OAuth parameter and also the property Node, HTTP and AWS
 * SDK errors put their failure identifier in, which a maintainer needs when
 * triaging a failed run, so the three shapes above are kept.
 *
 * The rule says what is safe to log instead of what a credential looks like.
 * An authorization code that arrives in an unexpected shape is redacted
 * because it is not on this list, rather than surviving because it failed to
 * match a pattern.
 */
const isDiagnosticCode = (value: string): boolean =>
  DIAGNOSTIC_NAME.test(value) ||
  DIAGNOSTIC_NUMBER.test(value) ||
  DIAGNOSTIC_CLASS.test(value);

/**
 * Splits one pair of surrounding quotes off a value, so the quotes Node and
 * Chromium print around a string are judged and printed as punctuation
 * rather than as part of the value.
 */
const unquote = (value: string): { quote: string; inner: string } => {
  const quote = value.charAt(0);
  if (
    (quote === '"' || quote === "'") &&
    value.length > 1 &&
    value.endsWith(quote)
  ) {
    return { quote, inner: value.slice(1, -1) };
  }
  return { quote: '', inner: value };
};

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
 * `key=value` in a query string, a URL fragment, a logged form body or
 * prose. The lookbehind keeps compound names such as `my_access_token` and
 * `error_code` out.
 *
 * The value runs to the next `&`, `#`, whitespace, quote or angle bracket,
 * so no character inside it can end the match early and leave the rest in
 * the log. `;` and `)` are left alone so a cookie attribute or a closing
 * bracket after the value stays readable. A surrounding quote is captured
 * and printed again, which is what makes `code="<value>"` redact.
 */
const PARAM_PATTERN = new RegExp(
  String.raw`(?<![\w.-])(${KEYS})=(["']?)([^&#\s"'<>;)]*)(["']?)`,
  'g',
);

const redactParam = (
  match: string,
  key: string,
  open: string,
  value: string,
  close: string,
): string =>
  mustRedact(key, value) ? `${key}=${open}${REDACTED}${close}` : match;

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
 * again unchanged. The value runs to the next comma, closing brace or line
 * end, and keeps the quotes it arrived in.
 */
const PREVIEW_PATTERN = new RegExp(
  String.raw`(^|[{,])(\s*)(${KEYS})(\s*):(\s*)([^,}\r\n]*)`,
  'gm',
);

const redactPreview = (
  match: string,
  delimiter: string,
  beforeKey: string,
  key: string,
  afterKey: string,
  afterColon: string,
  rest: string,
): string => {
  // The value ends at the last character that is not whitespace; what
  // follows it separates the value from the delimiter and is printed again.
  const value = rest.trimEnd();
  const { quote, inner } = unquote(value);
  if (!mustRedact(key, inner)) {
    return match;
  }
  const trailing = rest.slice(value.length);
  return `${delimiter}${beforeKey}${key}${afterKey}:${afterColon}${quote}${REDACTED}${quote}${trailing}`;
};

/**
 * Replaces the values of OAuth tokens and authorization codes (`code`,
 * `id_token`, `id_token_hint`, `access_token`, `refresh_token` and their
 * camelCase spellings) in text that is about to be logged with
 * `[REDACTED]`, keeping the key and the punctuation around it.
 *
 * Redaction fails closed: a token key loses its value whatever the value
 * is, and a `code` value is kept only when it is one of the diagnostic
 * shapes `isDiagnosticCode` lists.
 */
export const redactOAuthValues = (text: string): string =>
  text
    .replace(PARAM_PATTERN, redactParam)
    .replace(JSON_PATTERN, redactJson)
    .replace(PREVIEW_PATTERN, redactPreview);
