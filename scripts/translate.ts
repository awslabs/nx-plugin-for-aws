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
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Agent } from 'https';

// Define supported languages
const SUPPORTED_LANGUAGES = [
  'en',
  'jp',
  'ko',
  'es',
  'pt',
  'fr',
  'it',
  'zh',
  'vi',
];
const SOURCE_LANGUAGE = 'en';
const DOCS_DIR = path.resolve(process.cwd(), 'docs/src/content/docs');
const BATCH_SIZE = 3; // Number of concurrent Bedrock API calls

// Interface for file translation context
interface FileToTranslate {
  path: string;
  sourceLanguageContent: string;
  sourceLanguageDiff: string;
  existingTranslations: { [code: string]: string };
}

// Interface for queued Bedrock request
interface QueuedRequest {
  params: InvokeModelCommandInput;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

/**
 * Queue manager for batching Bedrock API calls
 */
class BedrockQueue {
  private queue: QueuedRequest[] = [];
  private activeRequests = 0;
  private client: BedrockRuntimeClient;

  constructor(client: BedrockRuntimeClient) {
    this.client = client;
  }

  /**
   * Add a request to the queue and return a promise that resolves when the request completes
   */
  async enqueue(params: InvokeModelCommandInput): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ params, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process queued requests up to the batch size limit
   */
  private async processQueue(): Promise<void> {
    while (this.activeRequests < BATCH_SIZE && this.queue.length > 0) {
      const request = this.queue.shift();
      if (!request) break;

      this.activeRequests++;

      // Execute the request
      this.executeRequest(request).finally(() => {
        this.activeRequests--;
        this.processQueue(); // Process next item in queue
      });
    }
  }

  /**
   * Execute a single Bedrock request
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    try {
      const command = new InvokeModelCommand(request.params);
      const response = await this.client.send(command);
      request.resolve(response);
    } catch (error) {
      request.reject(error);
    }
  }

  /**
   * Wait for all active requests to complete
   */
  async waitForCompletion(): Promise<void> {
    while (this.activeRequests > 0 || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// Define the command line interface
const program = new Command();

program
  .name('translate')
  .description('Translate documentation files using AWS Bedrock')
  .option('-a, --all', 'Translate all documentation files')
  .option(
    '-l, --languages <languages>',
    'Comma-separated list of target languages',
    'jp,ko,es,pt,fr,it,zh,vi',
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

const sectionTranslationModelId =
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const frontmatterTranslationModelId =
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

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

    // Create Bedrock queue for batching API calls
    const bedrockQueue = new BedrockQueue(bedrockClient);

    // Get files to translate
    const filesToTranslate = await getFilesToTranslate();

    if (filesToTranslate.length === 0) {
      log.info('No files to translate');
      return;
    }

    log.info(`Found ${filesToTranslate.length} files to translate`);

    // Process all files in parallel
    const translationPromises: Promise<void>[] = [];

    for (const fileObj of filesToTranslate) {
      log.info(`Processing file: ${fileObj.path}`);

      // Split the content by h2 headers
      const sections = splitByHeaders(fileObj.sourceLanguageContent);

      log.verbose(`Split file into ${sections.length} sections`);

      // Process each target language in parallel
      for (const targetLang of targetLanguages) {
        translationPromises.push(
          translateFile(fileObj, sections, targetLang, bedrockQueue),
        );
      }
    }

    // Wait for all translations to complete
    await Promise.all(translationPromises);

    // Wait for any remaining queued requests
    await bedrockQueue.waitForCompletion();

    log.success('Translation completed successfully');
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.indexOf(
        "You don't have access to the model with the specified model ID",
      ) > -1
    ) {
      errorMessage += ` Approve model access for ${frontmatterTranslationModelId} and ${sectionTranslationModelId} at http://console.aws.amazon.com/bedrock/home?#/modelaccess`;
    }
    log.error(`Translation failed: ${errorMessage}`);
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
      requestHandler: new NodeHttpHandler({
        httpsAgent: new Agent({
          maxSockets: 500,
        }),
      }),
    });
  } catch (error) {
    throw new Error(
      `Failed to initialize AWS Bedrock client: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the git diff for a specific file
 */
async function getFileDiff(
  filePath: string,
  baseCommit: string,
): Promise<string> {
  try {
    const git = simpleGit();
    const relativePath = path.relative(process.cwd(), filePath);

    // Get the diff for this specific file
    const diff = await git.diff([`${baseCommit}..HEAD`, '--', relativePath]);

    return diff || '';
  } catch (error) {
    log.verbose(
      `Could not get diff for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return '';
  }
}

/**
 * Get existing translations for a file
 */
async function getExistingTranslations(
  sourceFile: string,
  targetLanguages: string[],
): Promise<{ [code: string]: string }> {
  const existingTranslations: { [code: string]: string } = {};

  const relativePath = path.relative(
    `${DOCS_DIR}/${SOURCE_LANGUAGE}`,
    sourceFile,
  );

  for (const lang of targetLanguages) {
    const translatedFile = path.join(DOCS_DIR, lang, relativePath);

    try {
      if (await fs.pathExists(translatedFile)) {
        const content = await fs.readFile(translatedFile, 'utf-8');
        existingTranslations[lang] = content;
      } else {
        existingTranslations[lang] = '';
      }
    } catch (error) {
      log.verbose(
        `Could not read existing translation for ${lang}: ${error instanceof Error ? error.message : String(error)}`,
      );
      existingTranslations[lang] = '';
    }
  }

  return existingTranslations;
}

/**
 * Get the list of files to translate based on command options
 */
async function getFilesToTranslate(): Promise<FileToTranslate[]> {
  try {
    // Base pattern for markdown/mdx files in the source language directory
    const basePattern = `${DOCS_DIR}/${SOURCE_LANGUAGE}/**/*.{md,mdx}`;

    if (options.all) {
      // Translate all files
      log.info('Translating all documentation files');
      const files = await glob(basePattern);

      // For --all mode, we don't have diffs, so return empty diffs
      const fileObjects: FileToTranslate[] = [];
      for (const file of files) {
        const sourceContent = await fs.readFile(file, 'utf-8');
        const targetLanguages = options.languages
          .split(',')
          .map((lang: string) => lang.trim())
          .filter(
            (lang: string) =>
              SUPPORTED_LANGUAGES.includes(lang) && lang !== SOURCE_LANGUAGE,
          );
        const existingTranslations = await getExistingTranslations(
          file,
          targetLanguages,
        );

        fileObjects.push({
          path: file,
          sourceLanguageContent: sourceContent,
          sourceLanguageDiff: '',
          existingTranslations,
        });
      }

      return fileObjects;
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

      const diffResult = await git.diff([
        `${baseCommit}..HEAD`,
        '--name-only',
        '--diff-filter=d',
      ]);
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
        return [];
      }

      log.verbose(`Detected ${changedFiles.length} changed files`);

      // Build file objects with content, diff, and existing translations
      const targetLanguages = options.languages
        .split(',')
        .map((lang: string) => lang.trim())
        .filter(
          (lang: string) =>
            SUPPORTED_LANGUAGES.includes(lang) && lang !== SOURCE_LANGUAGE,
        );

      const fileObjects: FileToTranslate[] = [];
      for (const file of changedFiles) {
        const sourceContent = await fs.readFile(file, 'utf-8');
        const diff = await getFileDiff(file, baseCommit);
        const existingTranslations = await getExistingTranslations(
          file,
          targetLanguages,
        );

        fileObjects.push({
          path: file,
          sourceLanguageContent: sourceContent,
          sourceLanguageDiff: diff,
          existingTranslations,
        });
      }

      return fileObjects;
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
function splitByHeaders(content: string, depth: number = 1): string[] {
  let headerRegex;

  switch (depth) {
    case 1:
      headerRegex = /^## .+$/gm;
      break;
    case 2:
      headerRegex = /^### .+$/gm;
      break;
    case 3:
      headerRegex = /^#### .+$/gm;
      break;
    case 4:
      headerRegex = /^##### .+$/gm;
      break;
    default:
      throw new Error(
        `Invalid depth: ${depth}. Depth must be between 1 and 4.`,
      );
  }

  const sections: string[] = [];

  // Handle frontmatter separately (content between --- markers)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let remainingContent = content;

  if (frontmatterMatch) {
    sections.push(frontmatterMatch[0]);
    remainingContent = content.substring(frontmatterMatch[0].length);
  }

  const matches = [...remainingContent.matchAll(headerRegex)];

  if (matches.length === 0) {
    // No h2 headers, treat the whole content as one section
    if (remainingContent.trim()) {
      sections.push(remainingContent);
    }
    return sections;
  }

  if (depth > 1) {
    // only do this for h3 or finer
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
  } else {
    sections.push(remainingContent);
  }

  return sections.map((s) => s.trim());
}

/**
 * Translate a file to the target language
 */
async function translateFile(
  fileObj: FileToTranslate,
  sections: string[],
  targetLang: string,
  bedrockQueue: BedrockQueue,
): Promise<void> {
  try {
    // Create the target file path
    const relativePath = path.relative(
      `${DOCS_DIR}/${SOURCE_LANGUAGE}`,
      fileObj.path,
    );
    const targetFile = path.join(DOCS_DIR, targetLang, relativePath);

    log.info(`Translating to ${targetLang}: ${relativePath}`);

    // Create the target directory if it doesn't exist
    await fs.ensureDir(path.dirname(targetFile));

    if (options.dryRun) {
      log.info(`[DRY RUN] Would translate ${fileObj.path} to ${targetFile}`);
      return;
    }

    // Get the existing translation for this language
    const existingTranslation = fileObj.existingTranslations[targetLang] || '';

    // Translate all sections in parallel using the queue
    const translationPromises = sections.map((section) =>
      translateSection(
        section,
        targetLang,
        bedrockQueue,
        fileObj.sourceLanguageDiff,
        existingTranslation,
      ),
    );

    const translatedSections = await Promise.all(translationPromises);

    // Combine the translated sections
    const translatedContent = translatedSections.join('\n\n');

    // Write the translated content to the target file
    await fs.writeFile(targetFile, translatedContent, 'utf-8');

    log.success(`Translated ${relativePath} to ${targetLang}`);
  } catch (error) {
    throw new Error(
      `Failed to translate file ${fileObj.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Translate a section of content using AWS Bedrock
 */
async function translateSection(
  section: string,
  targetLang: string,
  bedrockQueue: BedrockQueue,
  diff: string = '',
  existingTranslation: string = '',
  depth: number = 1,
): Promise<string> {
  // Skip empty sections
  if (!section.trim()) {
    return section;
  }

  // Check if this is a frontmatter section (between --- markers)
  const isFrontmatter = section.startsWith('---') && section.includes('\n---');

  if (isFrontmatter) {
    // Handle frontmatter translation differently to preserve structure
    return await translateFrontmatter(
      section,
      targetLang,
      bedrockQueue,
      diff,
      existingTranslation,
    );
  }

  let contextInfo = '';

  // Add diff context if available
  if (diff && diff.trim()) {
    contextInfo += `
IMPORTANT CONTEXT - Changes Made to Source Material:
The following git diff shows what changed in the source ${getLanguageName(SOURCE_LANGUAGE)} documentation. Focus your translation efforts on the changed sections (marked with + and -), and leave unchanged sections as they were in the existing translation.

<git-diff>
${diff}
</git-diff>
`;
  }

  // Add existing translation context if available (excluding frontmatter to avoid confusion)
  if (existingTranslation && existingTranslation.trim()) {
    // Remove frontmatter from existing translation for regular sections
    let translationWithoutFrontmatter = existingTranslation;
    const frontmatterMatch = existingTranslation.match(
      /^---\n[\s\S]*?\n---\n*/,
    );
    if (frontmatterMatch) {
      translationWithoutFrontmatter = existingTranslation.substring(
        frontmatterMatch[0].length,
      );
    }

    if (translationWithoutFrontmatter.trim()) {
      contextInfo += `
EXISTING TRANSLATION REFERENCE:
Below is the existing ${getLanguageName(targetLang)} translation of this document. Use this as a reference to maintain consistency in terminology and style. For sections where the source material hasn't changed (not shown in the git diff above), keep the existing translation as-is.

<existing-translation>
${translationWithoutFrontmatter}
</existing-translation>
`;
    }
  }

  const prompt = `
You are a technical documentation translator. Translate the following text in <documentation-to-translate> xml tags into ${getLanguageName(targetLang)}.
${contextInfo}
CRITICAL REQUIREMENTS:
1. DO NOT translate:
  - Personal names (leave them exactly as is)
  - URLS and links
  - Code blocks and commands
  - Technical terms in backticks
2. Keep ALL mdx formatting exactly as is
3. Keep the exact same structure and layout
4. Translate naturally while maintaining technical accuracy
5. Only return translated text and never add commentary about the rest of the document.
6. Preserve all import statements and component usage (never wrap things in backticks if they aren't already).
7. Do NOT wrap your translated content in backticks (eg \`\`\`mdx ...\`\`\`), this will be inserted into an mdx file directly.
8. Do not output any frontmatter.
9. EFFICIENCY: If you have both a git diff and existing translation:
   - For unchanged sections (not in the diff), reuse the existing translation verbatim
   - Only translate sections that have actually changed in the source material
   - This reduces unnecessary translation work and maintains consistency
`;

  const params: InvokeModelCommandInput = {
    modelId: sectionTranslationModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_beta: ['context-1m-2025-08-07'],
      anthropic_version: 'bedrock-2023-05-31',
      temperature: 0.7,
      max_tokens: 64000,
      system: prompt,
      messages: [
        {
          role: 'user',
          content: `Here is the mdx content to translate:

<documentation-to-translate>
${section}
</documentation-to-translate>`,
        },
      ],
    }),
  };

  const response = await bedrockQueue.enqueue(params);

  // Parse the response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Check if we hit the token limit
  if (responseBody.stop_reason === 'max_tokens') {
    log.warn('Translation hit token limit. Splitting into smaller chunks.');

    const sections = splitByHeaders(section, depth);

    const translationPromises = sections.map((section) =>
      translateSection(
        section,
        targetLang,
        bedrockQueue,
        diff,
        existingTranslation,
        depth + 1,
      ),
    );

    const translatedSections = await Promise.all(translationPromises);
    return translatedSections.join('\n\n');
  }

  const translatedText = responseBody.content[0].text;
  return translatedText;
}

/**
 * Translate frontmatter while preserving its structure
 */
async function translateFrontmatter(
  frontmatter: string,
  targetLang: string,
  bedrockQueue: BedrockQueue,
  diff: string = '',
  existingTranslation: string = '',
): Promise<string> {
  try {
    // Extract the content between --- markers
    const match = frontmatter.match(/^---\n([\s\S]*?)\n---/);

    if (!match) {
      return frontmatter;
    }

    const content = match[1];

    let contextInfo = '';

    // Add diff context if available
    if (diff && diff.trim()) {
      contextInfo += `
IMPORTANT CONTEXT - Changes Made to Source Material:
The following git diff shows what changed in the source ${getLanguageName(SOURCE_LANGUAGE)} documentation. Focus your translation efforts on the changed sections (marked with + and -), and leave unchanged sections as they were in the existing translation.

<git-diff>
${diff}
</git-diff>
`;
    }

    // Add existing translation context if available
    if (existingTranslation && existingTranslation.trim()) {
      // Extract existing frontmatter from the translation
      const existingMatch = existingTranslation.match(/^---\n([\s\S]*?)\n---/);
      if (existingMatch) {
        contextInfo += `
EXISTING TRANSLATION REFERENCE:
Below is the existing ${getLanguageName(targetLang)} translation of this frontmatter. Use this as a reference to maintain consistency in terminology and style. For fields where the source material hasn't changed (not shown in the git diff above), keep the existing translation as-is.

<existing-frontmatter-translation>
${existingMatch[1]}
</existing-frontmatter-translation>
`;
      }
    }

    // Create a prompt specifically for frontmatter
    const prompt = `
You are a technical documentation translator. Your task is to translate the following YAML frontmatter in <frontmatter> xml tags from ${getLanguageName(SOURCE_LANGUAGE)} to ${getLanguageName(targetLang)}.
${contextInfo}
Rules:
1. Only translate the values, not the keys.
2. Preserve all formatting, including indentation, spaces, newlines and special characters.
3. Add quotes around title and description fields.
4. Do not translate date, authors or template fields.
5. Do not translate code blocks, variable names, or technical terms that should remain in ${getLanguageName(SOURCE_LANGUAGE)}.
6. If any localized links are present, translate the path appropriately (e.g., ${SOURCE_LANGUAGE}/foo -> ${targetLang}/foo).
7. NEVER include any explanatory text, notes, or phrases like "The following content remains unchanged".
8. NEVER explain your translation choices or add any commentary.
9. If you cannot translate something, simply return it as is without explanation.
10. EFFICIENCY: If you have both a git diff and existing translation:
    - For unchanged fields (not in the diff), reuse the existing translation verbatim
    - Only translate fields that have actually changed in the source material
    - This reduces unnecessary translation work and maintains consistency

CRITICAL: Your response must contain ONLY the translated YAML content with no additional text whatsoever. Do not include \`\`\`yaml or \`\`\` markers in your response.
`;

    const params: InvokeModelCommandInput = {
      modelId: frontmatterTranslationModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_beta: ['context-1m-2025-08-07'],
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 64000,
        temperature: 0.1,
        system: prompt,
        messages: [
          {
            role: 'user',
            content: `Here is the frontmatter to translate:

<frontmatter>
${content}
</frontmatter>`,
          },
        ],
      }),
    };

    const response = await bedrockQueue.enqueue(params);

    // Parse the response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Check if we hit the token limit
    if (responseBody.stop_reason === 'max_tokens') {
      throw Error(
        'Unable to translate frontmatter due to translation token limit being hit.',
      );
    }

    let translatedContent = responseBody.content[0].text;

    // Clean up the response (remove any code block markers)
    translatedContent = translatedContent.replace(/```yaml|```/g, '').trim();

    if (translatedContent.match(/^---\n([\s\S]*?)\n---/)) {
      return translatedContent;
    }

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
 * Get the full language name from the language code
 */
function getLanguageName(langCode: string): string {
  const languageMap: Record<string, string> = {
    en: 'English',
    jp: 'Japanese',
    fr: 'French',
    it: 'Italian',
    es: 'Spanish',
    pt: 'Portugese',
    zh: 'Chinese',
    ko: 'Korean',
    vi: 'Vietnamese',
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
