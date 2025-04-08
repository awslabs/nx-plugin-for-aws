/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk'; // ESM import
import { simpleGit } from 'simple-git';
import glob from 'fast-glob';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import {
  fromNodeProviderChain,
  fromTemporaryCredentials,
} from '@aws-sdk/credential-providers';

// Define supported languages
const SUPPORTED_LANGUAGES = ['en', 'jp', 'ko'];
const SOURCE_LANGUAGE = 'en';
const DOCS_DIR = path.resolve(process.cwd(), 'docs/src/content/docs');

// Define the command line interface
const program = new Command();

program
  .name('translate')
  .description('Translate documentation files using AWS Bedrock')
  .option('-a, --all', 'Translate all documentation files')
  .option(
    '-l, --languages <languages>',
    'Comma-separated list of target languages',
    'jp,ko',
  )
  .option(
    '-m, --model <model>',
    'AWS Bedrock model ID',
    'anthropic.claude-3-5-haiku-20241022-v1:0',
  )
  .option(
    '-d, --dry-run',
    'Show what would be translated without actually translating',
  )
  .option('-v, --verbose', 'Show verbose output')
  .parse(process.argv);

const options = program.opts();

// Configure logging
const log = {
  info: (message: string) => console.log(chalk.blue('INFO: ') + message),
  success: (message: string) => console.log(chalk.green('SUCCESS: ') + message),
  warn: (message: string) => console.log(chalk.yellow('WARNING: ') + message),
  error: (message: string) => console.error(chalk.red('ERROR: ') + message),
  verbose: (message: string) =>
    options.verbose && console.log(chalk.gray('DEBUG: ') + message),
};

/**
 * Main function to run the translation process
 */
async function main() {
  try {
    log.info('Starting documentation translation process');

    // Parse target languages
    const targetLanguages = options.languages
      .split(',')
      .map((lang: string) => lang.trim())
      .filter(
        (lang: string) =>
          SUPPORTED_LANGUAGES.includes(lang) && lang !== SOURCE_LANGUAGE,
      );

    if (targetLanguages.length === 0) {
      log.error(
        `No valid target languages specified. Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`,
      );
      process.exit(1);
    }

    log.info(`Target languages: ${targetLanguages.join(', ')}`);

    // Initialize AWS Bedrock client
    const bedrockClient = await initializeBedrockClient();

    // Get files to translate
    const filesToTranslate = await getFilesToTranslate();

    if (filesToTranslate.length === 0) {
      log.info('No files to translate');
      return;
    }

    log.info(`Found ${filesToTranslate.length} files to translate`);

    // Process each file
    await Promise.all(
      filesToTranslate.map(async (file) => {
        log.info(`Processing file: ${file}`);

        // Read the source file
        const sourceContent = await fs.readFile(file, 'utf-8');

        // Split the content by h2 headers
        const sections = splitByH2Headers(sourceContent);

        log.verbose(`Split file into ${sections.length} sections`);

        // Process each target language
        await Promise.all(
          targetLanguages.map(async (targetLang: string) => {
            await translateFile(file, sections, targetLang, bedrockClient);
          }),
        );
      }),
    );

    log.success('Translation completed successfully');
  } catch (error) {
    log.error(
      `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

/**
 * Initialize the AWS Bedrock client with appropriate credentials
 */
async function initializeBedrockClient(): Promise<BedrockRuntimeClient> {
  try {
    log.info('Using default AWS credential provider chain');

    return new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: fromNodeProviderChain(),
    });
  } catch (error) {
    throw new Error(
      `Failed to initialize AWS Bedrock client: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the list of files to translate based on command options
 */
async function getFilesToTranslate(): Promise<string[]> {
  try {
    // Base pattern for markdown/mdx files in the source language directory
    const basePattern = `${DOCS_DIR}/${SOURCE_LANGUAGE}/**/*.{md,mdx}`;

    if (options.all) {
      // Translate all files
      log.info('Translating all documentation files');
      return await glob(basePattern);
    } else {
      // Translate only changed files since the last translation commit
      const git = simpleGit();

      // Get current branch name
      let currentBranch: string;
      let mainBranch: string;
      if (process.env.GITHUB_HEAD_REF) {
        currentBranch = `origin/${process.env.GITHUB_HEAD_REF}`;
        mainBranch = 'origin/main';
      } else {
        currentBranch = (await git.branch()).current;
        mainBranch = 'main';
      }
      log.verbose(`Current branch: ${currentBranch}`);
      log.verbose(`Using ${mainBranch} as the base branch`);

      await git.raw(['rev-parse', '--verify', mainBranch]);

      // Find the merge base (where this branch branched off from main/master)
      const mergeBase = (
        await git.raw(['merge-base', mainBranch, currentBranch])
      ).trim();
      log.verbose(`Branch created at commit: ${mergeBase}`);

      // Find the last translation commit since the branch was created
      const translationCommits = (
        await git.log({
          from: mergeBase,
          to: 'HEAD',
        })
      ).all.filter((commit) =>
        commit.message.includes('docs: update translations'),
      );

      let changedFiles: string[] = [];
      let baseCommit: string;

      if (translationCommits.length > 0) {
        // Get the most recent translation commit
        const lastTranslationCommit = translationCommits[0].hash;
        log.info(
          `Detecting changed files since last translation commit: ${lastTranslationCommit.substring(0, 7)}`,
        );

        // Get files changed since the last translation commit
        baseCommit = lastTranslationCommit;
      } else {
        // If no translation commit found, get files changed since branch creation
        log.info(
          `No translation commits found. Detecting changed files since branch creation at ${mergeBase.substring(0, 7)}`,
        );

        // Get files changed since the branch was created
        baseCommit = mergeBase;
      }

      const diffResult = await git.diff([`${baseCommit}..HEAD`, '--name-only']);
      changedFiles = diffResult
        .split('\n')
        .filter(
          (file) =>
            file.startsWith(`docs/src/content/docs/${SOURCE_LANGUAGE}/`) &&
            (file.endsWith('.md') || file.endsWith('.mdx')),
        )
        .map((file) => path.resolve(process.cwd(), file));
      
      // Also include any uncommitted changes
      const { files: uncommittedFiles } = await git.status();
      const uncommittedChanges = uncommittedFiles
        .filter(
          (file: { path: string }) =>
            file.path.startsWith(`docs/src/content/docs/${SOURCE_LANGUAGE}/`) &&
            (file.path.endsWith('.md') || file.path.endsWith('.mdx')),
        )
        .map((file: { path: string }) =>
          path.resolve(process.cwd(), file.path),
        );
      
      // Combine and deduplicate the files
      changedFiles = [...new Set([...changedFiles, ...uncommittedChanges])];

      if (changedFiles.length === 0) {
        log.warn('No changed documentation files detected');
      } else {
        log.verbose(`Detected ${changedFiles.length} changed files`);
      }

      return changedFiles;
    }
  } catch (error) {
    throw new Error(
      `Failed to get files to translate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Split content by h2 headers for more efficient translation
 */
function splitByH2Headers(content: string): string[] {
  // Split by h2 headers (## Header)
  const h2Regex = /^## .+$/gm;
  const sections: string[] = [];

  // Handle frontmatter separately (content between --- markers)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let remainingContent = content;

  if (frontmatterMatch) {
    sections.push(frontmatterMatch[0]);
    remainingContent = content.substring(frontmatterMatch[0].length);
  }

  // Find all h2 header positions
  const matches = [...remainingContent.matchAll(h2Regex)];

  if (matches.length === 0) {
    // No h2 headers, treat the whole content as one section
    if (remainingContent.trim()) {
      sections.push(remainingContent);
    }
    return sections;
  }

  // Add content before the first h2 header
  if (matches[0].index! > 0) {
    sections.push(remainingContent.substring(0, matches[0].index));
  }

  // Add sections between h2 headers
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];

    if (nextMatch) {
      sections.push(
        remainingContent.substring(currentMatch.index!, nextMatch.index),
      );
    } else {
      // Last section
      sections.push(remainingContent.substring(currentMatch.index!));
    }
  }

  return sections.map((s) => s.trim());
}

/**
 * Translate a file to the target language
 */
async function translateFile(
  sourceFile: string,
  sections: string[],
  targetLang: string,
  bedrockClient: BedrockRuntimeClient,
): Promise<void> {
  try {
    // Create the target file path
    const relativePath = path.relative(
      `${DOCS_DIR}/${SOURCE_LANGUAGE}`,
      sourceFile,
    );
    const targetFile = path.join(DOCS_DIR, targetLang, relativePath);

    log.info(`Translating to ${targetLang}: ${relativePath}`);

    // Create the target directory if it doesn't exist
    await fs.ensureDir(path.dirname(targetFile));

    if (options.dryRun) {
      log.info(`[DRY RUN] Would translate ${sourceFile} to ${targetFile}`);
      return;
    }

    // Translate each section
    const translatedSections = await Promise.all(
      sections.map((section) =>
        translateSection(section, targetLang, bedrockClient),
      ),
    );

    // Combine the translated sections
    const translatedContent = translatedSections.join('\n\n');

    // Write the translated content to the target file
    await fs.writeFile(targetFile, translatedContent, 'utf-8');

    log.success(`Translated ${relativePath} to ${targetLang}`);
  } catch (error) {
    throw new Error(
      `Failed to translate file ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Translate a section of content using AWS Bedrock
 */
async function translateSection(
  section: string,
  targetLang: string,
  bedrockClient: BedrockRuntimeClient,
): Promise<string> {
  // Skip empty sections
  if (!section.trim()) {
    return section;
  }

  // Check if this is a frontmatter section (between --- markers)
  const isFrontmatter = section.startsWith('---') && section.includes('\n---');

  if (isFrontmatter) {
    // Handle frontmatter translation differently to preserve structure
    return await translateFrontmatter(section, targetLang, bedrockClient);
  }

  // For regular content, translate the whole section
  const prompt = createTranslationPrompt(section, targetLang);

  const params: InvokeModelCommandInput = {
    modelId: options.model,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  };

  const command = new InvokeModelCommand(params);
  const response = await bedrockClient.send(command);

  // Parse the response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const translatedText = responseBody.content[0].text;

  return translatedText;
}

/**
 * Translate frontmatter while preserving its structure
 */
async function translateFrontmatter(
  frontmatter: string,
  targetLang: string,
  bedrockClient: BedrockRuntimeClient,
): Promise<string> {
  try {
    // Extract the content between --- markers
    const match = frontmatter.match(/^---\n([\s\S]*?)\n---/);

    if (!match) {
      return frontmatter;
    }

    const content = match[1];

    // Create a prompt specifically for frontmatter
    const prompt = `
You are a technical documentation translator. Translate the following YAML frontmatter from English to ${getLanguageName(targetLang)}.
Only translate the values, not the keys. The files are mdx files and as such you must preserve all formatting, including indentation, spaces, newlines and special characters. Add quotes around title and description field in any encountered frontmatter blocks. Do not change translate date, authors or template field in frontmatter.
Do not translate code blocks, variable names, or technical terms that should remain in English. if any localized links are present in frontmatter, translate to appropriate route i.e: en/foo -> jp/bar
Respond with ONLY the translated YAML content, nothing else. If there is nothing to translate, just return the passed in input. Never respond with a question.

Here is the frontmatter to translate:

\`\`\`yaml
${content}
\`\`\`
`;

    const params: InvokeModelCommandInput = {
      modelId: options.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    };

    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);

    // Parse the response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    let translatedContent = responseBody.content[0].text;

    // Clean up the response (remove any code block markers)
    translatedContent = translatedContent.replace(/```yaml|```/g, '').trim();

    // Reconstruct the frontmatter
    return `---\n${translatedContent}\n---`;
  } catch (error) {
    log.error(
      `Frontmatter translation error: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Return the original frontmatter if translation fails
    return frontmatter;
  }
}

/**
 * Create a prompt for the translation model
 */
function createTranslationPrompt(content: string, targetLang: string): string {
  return `
You are a technical documentation translator. Translate the following from English to ${getLanguageName(targetLang)}.
Preserve all formatting, escape characters, including headers, links, code blocks, and special characters.
Do not translate code blocks, variable names, or technical terms that should remain in English.
Preserve all HTML tags and their attributes.
Preserve all import statements and component usage.
Always return translated content and if nothing is to be translated simply return the input.

Here is the content to translate:

${content}

Respond with ONLY the translated content, nothing else.
`;
}

/**
 * Get the full language name from the language code
 */
function getLanguageName(langCode: string): string {
  const languageMap: Record<string, string> = {
    en: 'English',
    jp: 'Japanese',
    fr: 'French',
    es: 'Spanish',
    de: 'German',
    zh: 'Chinese',
    ko: 'Korean',
  };

  return languageMap[langCode] || langCode;
}

// Run the main function
main().catch((error) => {
  log.error(
    `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
