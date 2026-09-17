/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Route predicates for the pages starlight-blog owns, mirroring its own slug
 * matching. Starlight applies a single override per component, so ours win over
 * the plugin's and have to tell the blog routes apart themselves.
 */
const BLOG = /(?:^|\/)blog(?:\/|$)/;
const BLOG_ROOT = /(?:^|\/)blog\/?$/;
const BLOG_PAGINATION = /(?:^|\/)blog\/\d+\/?$/;
const BLOG_TAG_OR_AUTHOR = /(?:^|\/)blog\/(?:tags|authors)\/.+$/;

/** Every page starlight-blog owns: the post list, the posts, tags and authors. */
const isBlogRoute = (id: string): boolean => BLOG.test(id);

/** The paginated post list, which renders its own heading in place of a page title. */
export const isBlogPostListRoute = (id: string): boolean =>
  BLOG_ROOT.test(id) || BLOG_PAGINATION.test(id);

/** An individual post, which carries a date and authors under its title. */
export const isBlogPostRoute = (id: string): boolean =>
  isBlogRoute(id) && !isBlogPostListRoute(id) && !BLOG_TAG_OR_AUTHOR.test(id);
