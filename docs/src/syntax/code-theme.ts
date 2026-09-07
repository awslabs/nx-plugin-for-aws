/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';

/**
 * The syntax highlighting palette for code samples.
 *
 * Hues are set relative to the site's accent (a royal purple at hue 292), so a
 * code block reads as part of the page rather than a window onto another app:
 * functions carry the accent itself, and the rest of the palette is spaced
 * around the wheel from it — scarlet for the words that drive control flow,
 * gold for literal text, ember for numbers, teal for types, azure for the keys
 * and properties that name things, and orchid for the escapes and
 * interpolations that break out of a string.
 *
 * Each colour is an OKLCH value converted to hex (hex is what a TextMate theme
 * accepts), picked for a contrast ratio of at least 4.6:1 against the code
 * background of its own mode.
 */
const palette = {
  dark: {
    /** oklch(0.900 0.012 290) */
    text: '#dedde6',
    /** oklch(0.885 0.020 250) */
    variable: '#d0dae6',
    /** oklch(0.740 0.022 290) */
    punctuation: '#aaa9b8',
    /** oklch(0.680 0.038 300) */
    comment: '#9c93ad',
    /** oklch(0.675 0.180 016) — scarlet */
    keyword: '#f05e70',
    /** oklch(0.815 0.115 082) — gold */
    string: '#e8bb67',
    /** oklch(0.755 0.135 048) — ember */
    number: '#f4935f',
    /** oklch(0.745 0.155 296) — accent violet */
    function: '#b597ff',
    /** oklch(0.815 0.095 190) — teal */
    type: '#72d6d0',
    /** oklch(0.830 0.075 248) — azure */
    property: '#a1ccf6',
    /** oklch(0.775 0.130 340) — orchid */
    special: '#ed94d0',
    /** oklch(0.780 0.140 155) — emerald */
    inserted: '#63d18f',
    /** oklch(0.695 0.180 022) */
    deleted: '#f86668',
    /** oklch(0.690 0.205 025) */
    invalid: '#ff5c58',
    /** oklch(0.660 0.220 292) — drives the marker backgrounds */
    marker: '#9874ff',
  },
  light: {
    /** oklch(0.300 0.015 290) */
    text: '#2d2d35',
    /** oklch(0.340 0.030 250) */
    variable: '#2c3947',
    /** oklch(0.470 0.020 290) */
    punctuation: '#5a5966',
    /** oklch(0.520 0.032 300) */
    comment: '#6b6579',
    /** oklch(0.450 0.190 018) — scarlet */
    keyword: '#a1002c',
    /** oklch(0.470 0.105 075) — gold */
    string: '#7b5100',
    /** oklch(0.490 0.145 045) — ember */
    number: '#9e3f00',
    /** oklch(0.435 0.200 296) — accent violet */
    function: '#6025af',
    /** oklch(0.445 0.085 195) — teal */
    type: '#006161',
    /** oklch(0.435 0.110 252) — azure */
    property: '#1a538b',
    /** oklch(0.465 0.140 345) — orchid */
    special: '#8d316b',
    /** oklch(0.445 0.120 155) — emerald */
    inserted: '#006537',
    /** oklch(0.455 0.185 022) */
    deleted: '#a40022',
    /** oklch(0.470 0.215 025) */
    invalid: '#ac011a',
    /** oklch(0.480 0.260 292) — drives the marker backgrounds */
    marker: '#6b11df',
  },
} as const;

type Palette = (typeof palette)['dark'];

/**
 * The scopes each colour claims, written once and shared by both modes.
 *
 * Ordering matters: TextMate resolves a token against the most specific scope
 * that matches, and settles ties with the last rule to mention it. So the broad
 * families come first and the exceptions follow — `keyword.operator` is dimmed
 * to punctuation after `keyword` has claimed the whole family, and the word
 * operators (`typeof`, `in`, `is`) are then pulled back out.
 */
const tokenColors = (c: Palette) => [
  {
    scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
    settings: { foreground: c.comment, fontStyle: 'italic' },
  },
  {
    scope: [
      'punctuation',
      'meta.brace',
      'meta.delimiter',
      'punctuation.separator',
      'punctuation.terminator',
      'punctuation.section',
      'punctuation.accessor',
      'keyword.operator',
      'storage.type.function.arrow',
    ],
    settings: { foreground: c.punctuation },
  },
  {
    scope: [
      'keyword',
      'keyword.control',
      'keyword.other',
      'storage',
      'storage.type',
      'storage.modifier',
      'variable.language',
      'entity.name.tag',
      'support.type.builtin',
      'markup.deleted.diff',
    ],
    settings: { foreground: c.keyword },
  },
  {
    scope: [
      'keyword.operator.new',
      'keyword.operator.expression',
      'keyword.operator.word',
      'keyword.operator.logical.python',
    ],
    settings: { foreground: c.keyword },
  },
  {
    scope: [
      'string',
      'string.quoted',
      'string.template',
      'string.unquoted',
      'punctuation.definition.string',
      'markup.inline.raw',
      'markup.fenced_code',
    ],
    settings: { foreground: c.string },
  },
  {
    scope: [
      'constant.numeric',
      'constant.language',
      'constant.other',
      'support.constant',
      'variable.other.constant',
      'constant.other.caps',
      'entity.name.constant',
    ],
    settings: { foreground: c.number },
  },
  {
    scope: [
      'entity.name.function',
      'support.function',
      'variable.function',
      'meta.function-call.generic',
      'meta.function-call.python',
      'entity.name.function.decorator',
      'meta.decorator',
      'support.function.builtin',
      'markup.heading',
    ],
    settings: { foreground: c.function },
  },
  {
    scope: [
      'entity.name.type',
      'entity.name.class',
      'entity.name.namespace',
      'entity.other.inherited-class',
      'support.type',
      'support.class',
      'support.type.primitive',
      'meta.type.annotation entity.name.type',
    ],
    settings: { foreground: c.type },
  },
  {
    scope: [
      'variable.other.property',
      'variable.other.member',
      'variable.other.object.property',
      'meta.object-literal.key',
      'support.type.property-name',
      'entity.other.attribute-name',
      'entity.name.tag.yaml',
      'meta.mapping.key string',
      'meta.mapping.key variable.other.readwrite',
      'variable.other.enummember',
      'support.variable',
    ],
    settings: { foreground: c.property },
  },
  {
    scope: [
      'variable',
      'variable.other',
      'variable.other.readwrite',
      'variable.parameter',
      'meta.definition.variable',
    ],
    settings: { foreground: c.variable },
  },
  {
    scope: [
      'constant.character.escape',
      'constant.character.escaped',
      'string.regexp',
      'constant.regexp',
      'punctuation.definition.template-expression',
      'punctuation.section.embedded',
      'constant.character.format.placeholder',
      'keyword.other.interpolation',
      'keyword.other.template',
      'meta.template.expression punctuation.definition',
    ],
    settings: { foreground: c.special },
  },
  {
    scope: ['markup.inserted', 'markup.inserted.diff'],
    settings: { foreground: c.inserted },
  },
  {
    scope: ['markup.deleted', 'markup.deleted.diff'],
    settings: { foreground: c.deleted },
  },
  {
    scope: ['markup.changed', 'markup.changed.diff'],
    settings: { foreground: c.number },
  },
  {
    scope: ['meta.diff.header', 'meta.diff.index', 'meta.separator.diff'],
    settings: { foreground: c.comment, fontStyle: 'italic' },
  },
  { scope: ['meta.diff.range'], settings: { foreground: c.special } },
  { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
  { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
  {
    scope: ['markup.underline.link', 'string.other.link'],
    settings: { foreground: c.property, fontStyle: 'underline' },
  },
  {
    scope: ['invalid', 'invalid.illegal', 'invalid.deprecated'],
    settings: { foreground: c.invalid },
  },
];

/**
 * Highlights, and the two halves of a diff, in the palette's own colours —
 * Starlight otherwise renders a highlight as a neutral grey wash.
 *
 * The washes stay faint: the accent bar and the `+`/`-` gutter carry the
 * meaning, so the background only has to tint the line. A stronger one would
 * sink the syntax colour nearest to it — scarlet keywords on a deleted line.
 */
const markerColors = (c: Palette) => ({
  markBackground: `color-mix(in oklab, ${c.marker} 15%, transparent)`,
  markBorderColor: c.marker,
  insBackground: `color-mix(in oklab, ${c.inserted} 13%, transparent)`,
  insBorderColor: c.inserted,
  insDiffIndicatorColor: c.inserted,
  delBackground: `color-mix(in oklab, ${c.deleted} 11%, transparent)`,
  delBorderColor: c.deleted,
  delDiffIndicatorColor: c.deleted,
});

const buildTheme = (type: 'dark' | 'light') => {
  const c = palette[type];
  const theme = new ExpressiveCodeTheme({
    name: `nx-plugin-for-aws-${type}`,
    type,
    // Starlight replaces the surfaces and chrome with the site's own tokens; these
    // stand in for the contrast checks it runs before that happens.
    colors: {
      'editor.foreground': c.text,
      'editor.background': type === 'dark' ? '#23272f' : '#f6f7f9',
    },
    settings: [{ settings: { foreground: c.text } }, ...tokenColors(c)],
  });
  theme.styleOverrides.textMarkers = markerColors(c);
  return theme;
};

export const codeThemeDark = buildTheme('dark');
export const codeThemeLight = buildTheme('light');

/**
 * Re-applies the marker colours after Starlight has swapped in its own, which it
 * does on every theme it is handed.
 */
export const restoreMarkerColors = (theme: ExpressiveCodeTheme) => {
  theme.styleOverrides.textMarkers = markerColors(
    palette[theme.type === 'light' ? 'light' : 'dark'],
  );
  return theme;
};
