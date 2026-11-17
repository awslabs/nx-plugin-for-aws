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

/** Every key this module redacts, including the authorization code. */
const OAUTH_KEYS = `code|${TOKEN_KEYS}`;

/**
 * Query string, fragment or form body for the token keys: `#id_token=...`,
 * `&amp;access_token=...`, `access_token=...` in a logged form body. The
 * lookbehind keeps compound names such as `my_access_token` out.
 */
const TOKEN_PARAM_PATTERN = new RegExp(
  String.raw`(?<![\w.-])(${TOKEN_KEYS})=[^&#\s"'<>]+`,
  'g',
);

/**
 * The same for `code`, anchored on the start of the input or a line, or on a
 * URL/form separator, because `code` is also an error-code name: prose such
 * as `request failed with error code=E123` keeps its value. The anchor is
 * captured and put back.
 */
const CODE_PARAM_PATTERN = /(^|&amp;|[?#&])code=[^&#\s"'<>]+/gm;

/**
 * JSON: `"id_token":"..."`. The value cannot cross a line break and is capped
 * at 4096 characters, so an unbalanced quote in a truncated HTML or console
 * dump can only swallow the rest of its own line.
 */
const JSON_PATTERN = new RegExp(
  String.raw`("(?:${OAUTH_KEYS})"\s*:\s*")(?:[^"\\\n]|\\.){1,4096}"`,
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

/**
 * An authorization-code-shaped value: at least 20 characters of the code
 * charset. Cognito codes are UUID length, and `code` is also the property
 * name of Node and HTTP errors (`{code: ECONNRESET}`, `{code: 500}`), whose
 * value a maintainer needs when triaging a failed run.
 */
const CODE_VALUE = '[A-Za-z0-9._~+/=%-]{20,}';

const PREVIEW_TOKEN_PATTERN = previewPattern(TOKEN_KEYS, PREVIEW_VALUE);
const PREVIEW_CODE_PATTERN = previewPattern('code', CODE_VALUE);

/**
 * Replaces the values of OAuth authorization codes and tokens (`code`,
 * `id_token`, `id_token_hint`, `access_token`, `refresh_token` and their
 * camelCase spellings) in text that is about to be logged with `[REDACTED]`,
 * keeping the key and the punctuation around it.
 */
export const redactOAuthValues = (text: string): string =>
  text
    .replace(TOKEN_PARAM_PATTERN, '$1=[REDACTED]')
    .replace(CODE_PARAM_PATTERN, '$1code=[REDACTED]')
    .replace(JSON_PATTERN, '$1[REDACTED]"')
    .replace(PREVIEW_TOKEN_PATTERN, '$1$2$3$4:$5[REDACTED]')
    .replace(PREVIEW_CODE_PATTERN, '$1$2$3$4:$5[REDACTED]');
