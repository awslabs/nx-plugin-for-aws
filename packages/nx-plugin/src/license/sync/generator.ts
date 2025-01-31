/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, globAsync, joinPathFragments, Tree } from '@nx/devkit';
import { LANGUAGE_COMMENT_SYNTAX, readLicenseConfig } from '../config';
import {
  CommentSyntax,
  LicenseHeaderConfig,
  LicenseHeaderFormat,
} from '../config-types';
import { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import { basename } from 'path';
import { glob as fastGlob } from 'fast-glob';
import { minimatch } from 'minimatch';
import { getGitIncludedFiles } from '../../utils/git';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../../utils/config/utils';

export const SYNC_GENERATOR_NAME = '@aws/nx-plugin:license#sync';

export async function licenseSyncGenerator(
  tree: Tree,
): Promise<SyncGeneratorResult> {
  const config = await readLicenseConfig(tree);

  if (!config) {
    // Nothing to do when not configured
    return {};
  }

  const licenseHeadersUpdated: string[] = [];

  if (config.header) {
    // Get all candidate project files for header
    const candidateProjectFiles = await getCandidateProjectFilesForHeader(
      tree,
      config.header,
    );

    const headerContentLines = loadHeaderContentLines(tree, config.header);

    // Add headers to project files which match the include pattern
    for (const [includePattern, format] of Object.entries(
      config.header.format,
    )) {
      const files = minimatch.match(candidateProjectFiles, includePattern);

      files.forEach((file) => {
        const didAdd = addHeader(
          tree,
          file,
          headerContentLines,
          config.header,
          format,
        );
        if (didAdd) {
          licenseHeadersUpdated.push(file);
        }
      });
    }
  }

  const licenseFilesAdded: string[] = [];
  const licenseFilesUpdated: string[] = [];

  if (tree.exists('LICENSE')) {
    const rootLicense = tree.read('LICENSE', 'utf-8');

    // Sync subproject license files
    for (const project of getProjects(tree).values()) {
      const projectLicensePath = joinPathFragments(project.root, 'LICENSE');

      // Check that this project is not excluded in config
      if (
        !(config?.files?.exclude ?? []).some(
          (excludePattern) =>
            minimatch(projectLicensePath, excludePattern) ||
            minimatch(project.root, excludePattern),
        )
      ) {
        // Write the license if it doesn't exist, or if it doesn't match the root license
        let shouldWrite = false;
        if (!tree.exists(projectLicensePath)) {
          licenseFilesAdded.push(projectLicensePath);
          shouldWrite = true;
        } else if (tree.read(projectLicensePath, 'utf-8') !== rootLicense) {
          licenseFilesUpdated.push(projectLicensePath);
          shouldWrite = true;
        }

        if (shouldWrite) {
          tree.write(projectLicensePath, rootLicense);
        }
      }
    }
  }

  return {
    outOfSyncMessage: buildOutOfSyncMessage({
      licenseHeadersUpdated,
      licenseFilesAdded,
      licenseFilesUpdated,
    }),
  };
}

/**
 * Build the message to display when the sync generator would make changes to the tree
 */
const buildOutOfSyncMessage = (updates: {
  licenseFilesAdded: string[];
  licenseFilesUpdated: string[];
  licenseHeadersUpdated: string[];
}): string => {
  let outOfSyncMessage = '';

  if (updates.licenseFilesAdded.length > 0) {
    outOfSyncMessage += `Project license files are missing:\n${updates.licenseFilesAdded.map((p) => `- ${p}`).join('\n')}\n\n`;
  }
  if (updates.licenseFilesUpdated.length > 0) {
    outOfSyncMessage += `Project license files are out of sync:\n${updates.licenseFilesUpdated.map((p) => `- ${p}`).join('\n')}\n\n`;
  }
  if (updates.licenseHeadersUpdated.length > 0) {
    outOfSyncMessage += `License headers are out of sync in the following source files:\n${updates.licenseHeadersUpdated.map((p) => `- ${p}`).join('\n')}\n\n`;
  }

  return outOfSyncMessage.trim();
};

/**
 * Load the license header content lines
 */
const loadHeaderContentLines = (
  tree: Tree,
  config: LicenseHeaderConfig,
): string[] => {
  // Load the license header content
  let headerContentLines = [];
  if ('lines' in config.content) {
    headerContentLines = config.content.lines;
  } else {
    if (!tree.exists(config.content.filePath)) {
      throw new Error(
        `Could not find license header content file ${config.content.filePath}`,
      );
    }
    headerContentLines = tree
      .read(config.content.filePath, 'utf-8')
      .split('\n');
  }
  return headerContentLines;
};

/**
 * Returns all files in the given tree - both in-memory only and in the filesystem under the tree root
 */
const getAllFilesInTree = async (tree: Tree): Promise<string[]> => {
  return [
    ...new Set([
      // Get all files in memory in the tree
      ...(await globAsync(tree, ['*'])),
      // Find all files on the filesystem that may not be in memory in the tree
      ...(await fastGlob(['*'], { cwd: tree.root, dot: true })),
    ]),
  ].filter((f) => tree.exists(f));
};

/**
 * Returns the list of project files
 */
const getCandidateProjectFilesForHeader = async (
  tree: Tree,
  config: LicenseHeaderConfig,
): Promise<string[]> => {
  // Prefer, if possible, to treat all non gitignored files as our candidate set such that we honour users .gitignore files
  // If we're not in a git repo, fall back to everything and rely on the user configuring exclusions below
  const projectFiles = tree.exists('.git')
    ? getGitIncludedFiles(tree)
    : await getAllFilesInTree(tree);

  // Remove any files that were excluded in the config
  const ignoredProjectFiles = new Set(
    (config.exclude ?? []).flatMap((pattern) =>
      minimatch.match(projectFiles, pattern),
    ),
  );
  return projectFiles.filter((file) => !ignoredProjectFiles.has(file));
};

/**
 * Renders a header with the given format
 */
const renderHeader = (
  contentLines: string[],
  format: LicenseHeaderFormat,
): string => {
  return `${format.blockStart ? `${format.blockStart}\n` : ''}${contentLines.map((line) => `${format.lineStart ?? ''}${line}${format.lineEnd ?? ''}`).join('\n')}${format.blockEnd ? `\n${format.blockEnd}` : ''}`;
};

/**
 * Validates header format to ensure it produces a valid comment
 */
const validateFormat = (
  fileExtension: string,
  syntax: CommentSyntax,
  format: LicenseHeaderFormat,
  contentLines: string[],
): void => {
  const blockStartOpensBlockComment =
    format.blockStart &&
    syntax.block &&
    format.blockStart.startsWith(syntax.block.start);
  const blockEndClosesBlockComment =
    format.blockEnd &&
    syntax.block &&
    format.blockEnd.endsWith(syntax.block.end);

  // Block start must start with the block start or line comment
  const validBlockStart =
    !format.blockStart ||
    blockStartOpensBlockComment ||
    (syntax.line && format.blockStart.startsWith(syntax.line));
  // Block end must end with the block end, or begin with the line comment
  const validBlockEnd =
    !format.blockEnd ||
    blockEndClosesBlockComment ||
    (syntax.line && format.blockEnd.startsWith(syntax.line));

  // Lines must start with the line comment syntax, unless within a block comment
  const validLineStart =
    !format.lineStart ||
    (syntax.line && format.lineStart.startsWith(syntax.line)) ||
    (blockStartOpensBlockComment && blockEndClosesBlockComment);

  if (!validLineStart || !validBlockStart || !validBlockEnd) {
    throw new Error(
      `Provided format for ${fileExtension} file would generate invalid comment syntax. Configured syntax for ${fileExtension} is ${JSON.stringify(syntax, null, 2)}.`,
    );
  }

  if (blockStartOpensBlockComment && !blockEndClosesBlockComment) {
    throw new Error(
      `Provided format for ${fileExtension} file opens a block comment with "${syntax.block.start}" in blockStart but does not close it with "${syntax.block.end}" in blockEnd`,
    );
  }

  if (
    blockStartOpensBlockComment &&
    contentLines.some((line) => line.includes(syntax.block.end))
  ) {
    throw new Error(
      `Provided license content would close a block comment early and cause a syntax error! Please remove "${syntax.block.end}" from your license text.`,
    );
  }

  if (blockStartOpensBlockComment && blockEndClosesBlockComment) {
    if (
      format.blockEnd.lastIndexOf(syntax.block.end) !==
      format.blockEnd.indexOf(syntax.block.end)
    ) {
      throw new Error(
        `Provided format for ${fileExtension} file may cause syntax errors due to closing a block comment multiple times with "${syntax.block.end}" in blockEnd`,
      );
    }
    if (format.blockStart.includes(syntax.block.end)) {
      throw new Error(
        `Provided format for ${fileExtension} file may cause syntax errors since it closes the block comment with "${syntax.block.end}" in blockStart`,
      );
    }
  }
};

/**
 * Parse the hashbang, header and body from a file.
 * The header is the first block comment, or consecutive series of line comments found in the file, after the hashbang
 */
const parseFile = (
  content: string,
  syntax: CommentSyntax,
): { hashbang: string; header: string; body: string } => {
  const lines = content.split('\n');
  let i = 0;

  // Hashbangs must always go first, so extract this if it exists
  const hashbangLines = [];
  for (; i < lines.length; i++) {
    if (hashbangLines.length === 0) {
      if (lines[i].startsWith('#!')) {
        hashbangLines.push(lines[i]);
      } else {
        break;
      }
    } else {
      if (lines[i].trim().length === 0) {
        // Preserve any empty lines following the hashbang
        hashbangLines.push(lines[i]);
      } else {
        break;
      }
    }
  }

  // After the hashbang, consume the next comment which follows.
  // This could either be all lines of a block comment, or all consecutive line comments until a non line-comment is seen
  const headerLines = [];
  let withinBlockComment = false;
  let withinLineCommentSeries = false;
  for (; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (
      syntax.block &&
      trimmedLine.endsWith(syntax.block.end) &&
      !withinLineCommentSeries
    ) {
      // Comment ends with the block end, so we've completed the header and therefore break out of the loop
      headerLines.push(lines[i]);
      i++; // Increment here to ensure we point to the next line for the body
      break;
    } else if (
      syntax.block &&
      trimmedLine.startsWith(syntax.block.start) &&
      !withinLineCommentSeries
    ) {
      // Line begins a comment block (without also ending it on the same line), so start consuming the block
      withinBlockComment = true;
      headerLines.push(lines[i]);
    } else if (withinBlockComment) {
      // We haven't yet closed the block comment, so consume this line
      headerLines.push(lines[i]);
    } else if (syntax.line && trimmedLine.startsWith(syntax.line)) {
      // Line starts with the line comment syntax, so consume it
      withinLineCommentSeries = true;
      headerLines.push(lines[i]);
    } else {
      break;
    }
  }

  // Body of the file is the rest
  const bodyLines = lines.slice(i);

  return {
    hashbang: hashbangLines.join('\n'),
    header: headerLines.join('\n'),
    body: bodyLines.join('\n'),
  };
};

/**
 * Add a header to the given file according to the header content and license config
 * Returns true if the header was added/updated, and false otherwise.
 */
const addHeader = (
  tree: Tree,
  file: string,
  contentLines: string[],
  config: LicenseHeaderConfig,
  format: LicenseHeaderFormat,
): boolean => {
  const fileName = basename(file);
  const fileNameParts = fileName.split('.');
  const fileExtension = fileNameParts[fileNameParts.length - 1];

  const syntax =
    (config.commentSyntax ?? {})[fileExtension] ??
    LANGUAGE_COMMENT_SYNTAX[fileExtension];
  if (!syntax) {
    throw new Error(`Unknown file extension ${fileExtension}. Please configure commentSyntax in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}, eg:

export default {
  license: {
    header: {
      ...
      commentSyntax: {
        ${fileExtension}: {
          line: "//",
          block: { start: "/*", end: "*/" }
        }
      }
    }
  }
} satisfies AwsNxPluginConfig;
`);
  }

  // Check that we would render a valid comment
  validateFormat(fileExtension, syntax, format, contentLines);

  const existingContent = tree.read(file, 'utf-8');

  const { hashbang, body } = parseFile(existingContent, syntax);

  const newContent = [
    ...(hashbang ? [hashbang] : []),
    renderHeader(contentLines, format),
    body,
  ].join('\n');

  // Sanity check that we wouldn't edit the hashbang or body, only the header
  const { hashbang: newHashbang, body: newBody } = parseFile(
    newContent,
    syntax,
  );
  if (hashbang !== newHashbang || body !== newBody) {
    throw new Error(
      `The license header content, or format for ${fileExtension} files would produce a header that cannot be safely replaced. Please revise license content and format in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
    );
  }

  if (newContent !== existingContent) {
    tree.write(file, newContent);
    return true;
  }

  return false;
};

export default licenseSyncGenerator;
