/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineEcConfig } from '@astrojs/starlight/expressive-code';

import {
  codeThemeDark,
  codeThemeLight,
  restoreMarkerColors,
} from './src/syntax/code-theme.ts';

/**
 * Syntax highlighting for code samples. This lives here rather than in
 * `astro.config.mjs` because the `<Code>` component the docs render diffs and
 * commands with needs options it can reach at runtime, and themes and callbacks
 * don't survive the trip through the Astro config.
 */
export default defineEcConfig({
  themes: [codeThemeDark, codeThemeLight],
  /** Keeps the frames, tab bars and scrollbars on the site's own tokens. */
  useStarlightUiThemeColors: true,
  customizeTheme: restoreMarkerColors,
  /**
   * The palette is built to clear 4.6:1 against each mode's code background; the
   * default floor of 5.5 would lighten the deeper colours back out of the range
   * they were chosen in.
   */
  minSyntaxHighlightingColorContrast: 4.5,
});
