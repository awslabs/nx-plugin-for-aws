/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** A pin the run moves from one version to another. */
export interface VersionChange {
  name: string;
  oldVersion: string;
  newVersion: string;
}

/** A file the run rewrites. */
export interface TemplateChange {
  path: string;
}

/** Something the run could not do, reported so it reaches the PR body. */
export interface ReportNote {
  note: string;
}

export type ReportChange = VersionChange | TemplateChange | ReportNote;

/** A titled section of the report. */
export interface ChangeGroup {
  title: string;
  changes: ReportChange[];
}

/**
 * The longest line commitlint accepts in a commit body or footer, from rule sets
 * such as `@commitlint/config-conventional`'s rules followed by the repo's
 * overrides. Later rule sets override earlier ones.
 */
export const commitMessageLineLimit = (
  ...ruleSets: readonly Readonly<Record<string, unknown>>[]
): number => {
  const limitOf = (rule: string): number => {
    const value = ruleSets
      .map((rules) => rules[rule])
      .filter((setting) => setting !== undefined)
      .at(-1);
    const limit = Array.isArray(value) ? value[2] : undefined;
    if (typeof limit !== 'number') {
      throw new Error(`commitlint rule ${rule} sets no line limit`);
    }
    return limit;
  };
  // commitlint can parse a wrapped line as the start of the footer.
  return Math.min(
    limitOf('body-max-line-length'),
    limitOf('footer-max-line-length'),
  );
};

/** A list item marker and the spaces after it. */
const LIST_MARKER = /^(\s*)([-+*]|\d{1,9}[.)])( +)/;

/** A word that would start a Markdown block at the start of a continuation. */
const BLOCK_START = /^(?:[-+*]|\d{1,9}[.)]|#{1,6}|[<>`~].*|[-=*_]{3,})$/;

/**
 * Splits a line longer than `limit` at spaces into lines of at most `limit`.
 * A list item continues indented under its text, so Markdown keeps it one item,
 * and no continuation starts with a word that would start a Markdown block. A
 * word longer than `limit`, such as a URL, stays whole on its own line.
 */
export const wrapReportLine = (line: string, limit: number): string[] => {
  if (line.length <= limit) return [line];

  const marker = LIST_MARKER.exec(line)?.[0];
  const first = marker ?? /^\s*/.exec(line)?.[0] ?? '';
  const indent = marker ? ' '.repeat(marker.length) : first;
  const fits = (prefix: string, words: string[]) =>
    prefix.length + words.join(' ').length <= limit;

  const lines: { prefix: string; words: string[] }[] = [
    { prefix: first, words: [] },
  ];
  for (const word of line.slice(first.length).split(/\s+/).filter(Boolean)) {
    const current = lines[lines.length - 1];
    if (
      current.words.length === 0 ||
      fits(current.prefix, [...current.words, word])
    ) {
      current.words.push(word);
      continue;
    }
    const last = current.words[current.words.length - 1];
    if (
      BLOCK_START.test(word) &&
      current.words.length > 1 &&
      !BLOCK_START.test(last) &&
      fits(indent, [last, word])
    ) {
      current.words.pop();
      lines.push({ prefix: indent, words: [last, word] });
    } else {
      lines.push({ prefix: indent, words: [word] });
    }
  }

  return lines.map(({ prefix, words }) => prefix + words.join(' '));
};

/** Wraps each line of `text` with {@link wrapReportLine}. */
export const wrapReport = (text: string, limit: number): string =>
  text
    .split('\n')
    .flatMap((line) => wrapReportLine(line, limit))
    .join('\n');

/**
 * The version update report: each group with changes as a titled list, with
 * lines wrapped to `limit`.
 */
export const formatReport = (
  changeGroups: readonly ChangeGroup[],
  limit: number,
): string => {
  let reportContent = '';

  // Process each change group
  changeGroups.forEach((group, index) => {
    if (group.changes.length > 0) {
      // Add separator between groups
      if (index > 0) {
        reportContent += '\n';
      }

      reportContent += `${group.title}\n`;
      group.changes.forEach((change) => {
        if ('oldVersion' in change) {
          reportContent += `- ${change.name} ${change.oldVersion} -> ${change.newVersion}\n`;
          return;
        }
        if ('note' in change) {
          reportContent += `- ${change.note}\n`;
          return;
        }
        reportContent += `- ${change.path}\n`;
      });
    }
  });

  // If no changes at all
  if (reportContent.length === 0) {
    reportContent = 'No version updates required.\n';
  }

  return wrapReport(reportContent, limit);
};
