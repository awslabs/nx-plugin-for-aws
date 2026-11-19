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
 * status and the page title, and nothing else. No markup is dumped.
 *
 * The two fields the page controls, the URL and the title, each pass through
 * `redactOAuthValues` as a backup, in case a path segment or a title carries
 * a labelled value. The title is redacted before it is quoted, so the
 * redactor reads it as the page wrote it: a title that quotes its own value
 * (`access_token="<value>"`) is then redacted whole, where the escapes
 * `JSON.stringify` adds would hide the end of that value from it.
 */
export const describeSignInFailure = ({
  step,
  url,
  status,
  title,
}: SignInFailure): string => {
  const parts = [
    `[login] ${step}`,
    `url=${redactOAuthValues(originAndPath(url))}`,
  ];
  if (status !== undefined) {
    parts.push(`status=${status}`);
  }
  if (title !== undefined) {
    parts.push(`title=${JSON.stringify(redactOAuthValues(title))}`);
  }
  return parts.join(' ');
};

/** The message of a thrown value, whether or not it is an `Error`. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The error a failed sign-in step throws in place of the one it caught.
 *
 * Playwright's navigation-wait timeouts quote every URL the page visited
 * while waiting, which across the hosted-UI redirect back to the app is the
 * URL carrying the authorization code in its query and the tokens in its
 * fragment. The replacement holds the step and the caught message with every
 * credential replaced, and nothing else: no `cause` and no copy of the
 * original stack, either of which would print the unredacted message again.
 */
export const signInStepError = (step: string, error: unknown): Error =>
  new Error(`[login] ${step}: ${redactOAuthValues(messageOf(error))}`);

/**
 * The error a sign-in flow throws when it ran out of attempts without
 * completing. It names the step and the page the flow gave up on, described
 * by `describeSignInFailure`, so it holds the origin and path of the URL and
 * never its query or its fragment.
 */
export const signInIncompleteError = (step: string, url: string): Error =>
  new Error(describeSignInFailure({ step, url }));
