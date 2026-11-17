/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Keys whose value is always a token, whatever the value looks like. */
const TOKEN_KEYS = [
  'id_token(?:_hint)?',
  'access_token',
  'refresh_token',
  'idToken',
  'accessToken',
  'refreshToken',
].join('|');

/** The characters an authorization code can be made of. */
const CODE_CHARS = '[A-Za-z0-9._~+/=%-]';

/**
 * An authorization-code-shaped value: at least 20 code characters, of which
 * at least one is not a letter or an underscore. `code` is also the property
 * name of Node, HTTP and AWS SDK errors, whose value a maintainer needs when
 * triaging a failed run, so the shape keeps those: `ECONNRESET`, `500` and
 * `E123` are too short, and `ResourceNotFoundException` or
 * `ERR_TLS_CERT_ALTNAME_INVALID` are letters and underscores only. A Cognito
 * code is UUID length and always carries digits and hyphens.
 *
 * The length test is a fixed-width lookahead rather than `{20,}`, and the
 * leading run uses a character class disjoint from the one that must follow
 * it, so the pattern cannot backtrack across a long value.
 */
const CODE_VALUE = `(?=${CODE_CHARS}{20})[A-Za-z_]*[0-9.~+/=%-]${CODE_CHARS}*`;

/**
 * Query string, fragment or form body for the token keys: `#id_token=...`,
 * `&amp;access_token=...`, `access_token=...` in a logged form body. The
 * lookbehind keeps compound names such as `my_access_token` out. A `;` or
 * `)` ends the value, so a cookie attribute or a closing bracket after the
 * token stays readable.
 */
const TOKEN_PARAM_PATTERN = new RegExp(
  String.raw`(?<![\w.-])(${TOKEN_KEYS})=[^&#\s"'<>;)]+`,
  'g',
);

/**
 * The same for `code`, guarded by the value shape instead of by the position
 * in the text, because `code` is also an error-code name. Prose such as
 * `request failed with error code=E123` keeps its value, while a logged
 * token-request body redacts whatever the parameter order is.
 */
const CODE_PARAM_PATTERN = new RegExp(
  String.raw`(?<![\w.-])code=${CODE_VALUE}`,
  'g',
);

/**
 * JSON: `"id_token":"..."`. The value cannot cross a line break and the
 * closing quote is optional, so a truncated HTML or console dump has its
 * value redacted to the end of its own line and the lines after it stay
 * readable.
 */
const JSON_TOKEN_PATTERN = new RegExp(
  String.raw`("(?:${TOKEN_KEYS})"\s*:\s*")(?:[^"\\\n]|\\.)*("|(?=\n|$))`,
  'g',
);

/** The same for `code`, with the shape guard every `code` path applies. */
const JSON_CODE_PATTERN = new RegExp(
  String.raw`("code"\s*:\s*")${CODE_VALUE}("|(?=\n|$))`,
  'g',
);

/**
 * Chromium object preview of a logged object. Browser console text is not a
 * stable serialization format, so the delimiter before the key and the
 * whitespace around the key and colon are matched loosely and put back
 * unchanged. The value stays on one line.
 */
const previewPattern = (keys: string, value: string) =>
  new RegExp(String.raw`(^|[{,])(\s*)(${keys})(\s*):(\s*)${value}`, 'gm');

/** A single-line value, without the whitespace that surrounds it. */
const PREVIEW_VALUE = String.raw`[^\s,}\n](?:[^,}\n]*[^\s,}\n])?`;

const PREVIEW_TOKEN_PATTERN = previewPattern(TOKEN_KEYS, PREVIEW_VALUE);

/**
 * Node prints a string property quoted, as in `{ code: '<uuid>' }`, so the
 * quotes are optional around the shape and are put back unchanged.
 */
const PREVIEW_CODE_PATTERN = previewPattern(
  'code',
  `(['"]?)${CODE_VALUE}(['"]?)`,
);

/**
 * Replaces the values of OAuth authorization codes and tokens (`code`,
 * `id_token`, `id_token_hint`, `access_token`, `refresh_token` and their
 * camelCase spellings) in text that is about to be logged with `[REDACTED]`,
 * keeping the key and the punctuation around it. A `code` value is only
 * redacted when it is token-shaped, so diagnostic error codes survive.
 */
export const redactOAuthValues = (text: string): string =>
  text
    .replace(TOKEN_PARAM_PATTERN, '$1=[REDACTED]')
    .replace(CODE_PARAM_PATTERN, 'code=[REDACTED]')
    .replace(JSON_TOKEN_PATTERN, '$1[REDACTED]$2')
    .replace(JSON_CODE_PATTERN, '$1[REDACTED]$2')
    .replace(PREVIEW_TOKEN_PATTERN, '$1$2$3$4:$5[REDACTED]')
    .replace(PREVIEW_CODE_PATTERN, '$1$2$3$4:$5$6[REDACTED]$7');
