/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const OAUTH_KEYS = ['code', 'id_token', 'access_token', 'refresh_token'].join(
  '|',
);

// Query string, fragment or form body: `?code=...`, `#id_token=...`, `&amp;code=...`
const PARAM_PATTERN = new RegExp(
  `(?<![\\w.-])(${OAUTH_KEYS})=[^&#\\s"'<>]+`,
  'g',
);

// JSON: `"id_token":"..."`
const JSON_PATTERN = new RegExp(
  `("(?:${OAUTH_KEYS})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)+"`,
  'g',
);

// Chromium object preview of a logged object: `{code: ..., state: ...}`
const PREVIEW_PATTERN = new RegExp(`(?<=\\{|, )(${OAUTH_KEYS}): [^,}]+`, 'g');

/**
 * Replaces the values of OAuth authorization codes and tokens (`code`,
 * `id_token`, `access_token`, `refresh_token`) in text that is about to be
 * logged with `[REDACTED]`, keeping the key.
 */
export const redactOAuthValues = (text: string): string =>
  text
    .replace(PARAM_PATTERN, '$1=[REDACTED]')
    .replace(JSON_PATTERN, '$1[REDACTED]"')
    .replace(PREVIEW_PATTERN, '$1: [REDACTED]');
