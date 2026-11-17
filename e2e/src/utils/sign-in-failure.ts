/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { redactOAuthValues } from './redact';

/** Printed in place of a URL that is not a readable http(s) URL. */
const UNREADABLE_URL = '[unreadable url]';

/**
 * The origin and path of `url`, with the query string and the fragment left
 * out. Anything the test cannot read as an http(s) URL is reported as
 * `UNREADABLE_URL`: the raw string is never printed, because a URL in an
 * unexpected shape is the case where a credential is most likely to sit
 * somewhere this function does not look. A scheme other than http(s) is
 * treated the same way, because `URL` leaves every other scheme opaque and
 * puts the whole of the rest of the string, query included, in `pathname`.
 */
const originAndPath = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return UNREADABLE_URL;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return UNREADABLE_URL;
  }
  return `${parsed.origin}${parsed.pathname}`;
};

/** What a sign-in step was looking at when it failed. */
export interface SignInFailure {
  /** The sign-in step that failed, as a phrase a maintainer can read. */
  step: string;
  /** The page's URL. Only its origin and path are reported. */
  url: string;
  /** The HTTP status of the page's document response, when one was seen. */
  status?: number;
  /** The page's title, when it could be read. */
  title?: string;
}

/**
 * One line describing a failure during a sign-in flow, holding only the
 * parts of the page that cannot carry a credential.
 *
 * A sign-in flow puts the authorization code and the tokens in URL query
 * strings and fragments, in the page's console output and in its markup, so
 * a failure here reports the step, the origin and path of the URL, the HTTP
 * status and the page title, and nothing else. No markup is dumped. The
 * assembled line passes through `redactOAuthValues` as a backup, in case a
 * path segment or a title carries a labelled value.
 */
export const describeSignInFailure = ({
  step,
  url,
  status,
  title,
}: SignInFailure): string => {
  const parts = [`[login] ${step}`, `url=${originAndPath(url)}`];
  if (status !== undefined) {
    parts.push(`status=${status}`);
  }
  if (title !== undefined) {
    parts.push(`title=${JSON.stringify(title)}`);
  }
  return redactOAuthValues(parts.join(' '));
};
