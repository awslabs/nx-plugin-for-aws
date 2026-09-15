/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The glyph a command card wears: a terminal window with a prompt in it.
 *
 * Held here rather than inline in either component so the guides' card and the
 * graph builder's output panel draw the same mark.
 */
export const TERMINAL_GLYPH_PATHS = [
  'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z',
  'M7 10.2 9.4 12.5 7 14.8',
  'M12.4 15h4.2',
] as const;
