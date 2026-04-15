/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { kebabCase } from '../utils/names';
import {
  buildCreateNxWorkspaceCommand,
  buildInstallCommand,
  buildPackageManagerExecCommand,
  buildPackageManagerShortCommand,
} from '../utils/commands';
import { NxGeneratorInfo } from '../utils/nx';
import fs from 'fs';

/**
 * Build a command to run nx
 */
export const buildNxCommand = (command: string, pm?: string) =>
  pm ? buildPackageManagerExecCommand(pm, `nx ${command}`) : `nx ${command}`;

const renderSchema = (schema: any) =>
  Object.entries(schema.properties)
    .map(
      ([parameter, parameterSchema]: [string, any]) =>
        `- ${parameter} [type: ${parameterSchema.type}]${parameterSchema.enum ? ` [options: ${parameterSchema.enum.join(', ')}]` : ''}${(schema.required ?? []).includes(parameter) ? ` (required)` : ''} ${parameterSchema.description}`,
    )
    .join('\n');

const renderGeneratorCommand = (
  generatorId: string,
  schema: any,
  packageManager?: string,
) => `\`\`\`bash
${buildNxCommand(
  `g @aws/nx-plugin:${generatorId} --no-interactive ${Object.entries(
    schema.properties,
  )
    .filter(([parameter]) => (schema.required ?? []).includes(parameter))
    .map(([parameter]: [string, any]) => `--${parameter}=<${parameter}>`)
    .join(' ')}`,
  packageManager,
)}
\`\`\``;

/**
 * Render summary information about a generator
 */
export const renderGeneratorInfo = (
  packageManager: string,
  info: NxGeneratorInfo,
): string => {
  const schema = JSON.parse(fs.readFileSync(info.resolvedSchemaPath, 'utf-8'));

  return `${info.id}

Description: ${info.description}

Available Parameters:
${renderSchema(schema)}

Command:
${renderGeneratorCommand(info.id, schema, packageManager)}
`;
};

/**
 * Retrieve the markdown guide pages for a generator from github.
 * If the generator has guidePages in generators.json we fetch all of those, otherwise we
 * try to fetch a guide with the generator name kebab-cased.
 */
export const fetchGuidePagesForGenerator = async (
  info: NxGeneratorInfo,
  generators: NxGeneratorInfo[],
  packageManager?: string,
  snippetContentProvider?: SnippetContentProvider,
): Promise<string> => {
  return await fetchGuidePages(
    info.guidePages ?? [kebabCase(info.id)],
    generators,
    packageManager,
    snippetContentProvider,
  );
};

/**
 * Fetch markdown guide pages from github
 */
export const fetchGuidePages = async (
  guidePages: string[],
  generators: NxGeneratorInfo[],
  packageManager?: string,
  snippetContentProvider?: SnippetContentProvider,
): Promise<string> => {
  const guides = await Promise.allSettled(
    guidePages.map(
      async (guide) =>
        await (
          await fetch(
            `https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/refs/heads/main/docs/src/content/docs/en/guides/${guide}.mdx`,
          )
        ).text(),
    ),
  );
  const fulfilled = guides.filter((result) => result.status === 'fulfilled');
  const processed = await Promise.all(
    fulfilled.map((result) =>
      postProcessGuide(
        result.value,
        generators,
        packageManager,
        snippetContentProvider,
      ),
    ),
  );
  return processed.join('\n\n');
};

/**
 * A function which retrieves snippet content given a snippet name.
 */
export type SnippetContentProvider = (
  snippetName: string,
) => Promise<string> | string;

const SNIPPET_BASE_URL =
  'https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/refs/heads/main/docs/src/content/docs/en/snippets';

/**
 * Fetch a snippet's content from github
 */
export const fetchSnippet: SnippetContentProvider = async (
  snippetName: string,
): Promise<string> => {
  try {
    const response = await fetch(`${SNIPPET_BASE_URL}/${snippetName}.mdx`);
    if (!response.ok) {
      return '';
    }
    return await response.text();
  } catch {
    return '';
  }
};

const findGeneratorAndSchema = (
  generators: NxGeneratorInfo[],
  generatorId: string,
) => {
  const generator = generators.find((info) => info.id === generatorId);
  if (!generator) {
    return undefined;
  }

  try {
    const schema = JSON.parse(
      fs.readFileSync(generator.resolvedSchemaPath, 'utf-8'),
    );
    return { generator, schema };
  } catch {
    return undefined;
  }
};

/**
 * Post-process a guide page to "inline" relevant components
 */
export const postProcessGuide = async (
  guide: string,
  generators: NxGeneratorInfo[],
  packageManager?: string,
  snippetContentProvider?: SnippetContentProvider,
): Promise<string> => {
  const getSnippetContent = snippetContentProvider ?? fetchSnippet;

  // Replace <Snippet /> with fetched snippet content
  // Use a regex that matches the full self-closing tag, allowing / in attribute values
  const snippetRegex = /<Snippet\s+((?:[^/]|\/(?!>))+)\s*\/>/g;
  const snippetMatches = [...guide.matchAll(snippetRegex)];

  let processedGuide = guide;

  if (snippetMatches.length > 0) {
    // Fetch all snippets in parallel
    const snippetResults = await Promise.all(
      snippetMatches.map(async (match) => {
        const nameMatch = match[1].match(/name=["']([^"']+)["']/);
        if (!nameMatch) {
          return { original: match[0], replacement: match[0] };
        }
        const snippetName = nameMatch[1];
        const snippetContent = await getSnippetContent(snippetName);
        if (!snippetContent) {
          return { original: match[0], replacement: match[0] };
        }
        // Recursively post-process the snippet content
        const processedContent = await postProcessGuide(
          snippetContent.trim(),
          generators,
          packageManager,
          getSnippetContent,
        );
        return {
          original: match[0],
          replacement: `<Snippet name="${snippetName}">\n${processedContent}\n</Snippet>`,
        };
      }),
    );

    for (const { original, replacement } of snippetResults) {
      processedGuide = processedGuide.replace(original, replacement);
    }
  }

  // Replace <NxCommands /> with markdown code blocks
  processedGuide = processedGuide.replace(
    /<NxCommands\s+commands={([^}]+)}\s*\/>/g,
    (match, commandsMatch) => {
      try {
        const commands = JSON.parse(
          commandsMatch
            .replaceAll("\\'", '__ESCAPED_SINGLE_QUOTE__')
            .replaceAll("'", '"')
            .replaceAll('__ESCAPED_SINGLE_QUOTE__', "\\'"),
        );
        return `\`\`\`bash\n${commands.map((command) => buildNxCommand(command, packageManager)).join('\n')}\n\`\`\``;
      } catch {
        return match;
      }
    },
  );

  // Replace <RunGenerator /> with renderGeneratorCommand
  processedGuide = processedGuide.replace(
    /<RunGenerator\s+((?:[^/]|\/(?!>))+)\s*\/>/g,
    (match, attributes) => {
      // Extract generator parameter
      const generatorMatch = attributes.match(/generator=["']([^"']+)["']/);
      if (!generatorMatch) {
        return match; // If no generator parameter, leave as is
      }

      const generatorId = generatorMatch[1];

      const info = findGeneratorAndSchema(generators, generatorId);

      if (!info) {
        return match;
      }

      return renderGeneratorCommand(generatorId, info.schema, packageManager);
    },
  );

  // Replace <GeneratorParameters /> with renderSchema
  processedGuide = processedGuide.replace(
    /<GeneratorParameters\s+((?:[^/]|\/(?!>))+)\s*\/>/g,
    (match, attributes) => {
      // Extract generator parameter
      const generatorMatch = attributes.match(/generator=["']([^"']+)["']/);
      if (!generatorMatch) {
        return match; // If no generator parameter, leave as is
      }

      const generatorId = generatorMatch[1];

      const info = findGeneratorAndSchema(generators, generatorId);

      if (!info) {
        return match;
      }

      return renderSchema(info.schema);
    },
  );

  // Replace <CreateNxWorkspaceCommand /> with npx create-nx-workspace command
  processedGuide = processedGuide.replace(
    /<CreateNxWorkspaceCommand\s+((?:[^/]|\/(?!>))+)\s*\/>/g,
    (match, attributes) => {
      const workspaceMatch = attributes.match(/workspace=["']([^"']+)["']/);
      if (!workspaceMatch) return match;
      const workspace = workspaceMatch[1];
      const iacMatch = attributes.match(/iacProvider=["']([^"']+)["']/);
      const iacProvider = iacMatch
        ? (iacMatch[1] as 'CDK' | 'Terraform')
        : undefined;
      const pm = packageManager ?? 'pnpm';
      return `\`\`\`bash\n${buildCreateNxWorkspaceCommand(pm, workspace, iacProvider)}\n\`\`\``;
    },
  );

  // Replace <InstallCommand /> with install command
  processedGuide = processedGuide.replace(
    /<InstallCommand\s+((?:[^/]|\/(?!>))+)\s*\/>/g,
    (match, attributes) => {
      const pkgMatch = attributes.match(/pkg=(?:["']([^"']+)["']|\{([^}]+)\})/);
      if (!pkgMatch) return match;
      const pkg = pkgMatch[1] || pkgMatch[2];
      const isDev = /dev/.test(attributes);
      const pm = packageManager ?? 'pnpm';
      return `\`\`\`bash\n${buildInstallCommand(pm, pkg, isDev)}\n\`\`\``;
    },
  );

  // Replace <PackageManagerShortCommand /> with short command
  processedGuide = processedGuide.replace(
    /<PackageManagerShortCommand\s+commands={([^}]+)}\s*\/>/g,
    (match, commandsMatch) => {
      try {
        const commands = JSON.parse(
          commandsMatch
            .replaceAll("\\'", '__ESCAPED_SINGLE_QUOTE__')
            .replaceAll("'", '"')
            .replaceAll('__ESCAPED_SINGLE_QUOTE__', "\\'"),
        );
        const pm = packageManager ?? 'pnpm';
        return `\`\`\`bash\n${commands.map((command: string) => buildPackageManagerShortCommand(pm, command)).join('\n')}\n\`\`\``;
      } catch {
        return match;
      }
    },
  );

  // Replace <PackageManagerExecCommand /> with exec command
  processedGuide = processedGuide.replace(
    /<PackageManagerExecCommand\s+commands={([^}]+)}\s*\/>/g,
    (match, commandsMatch) => {
      try {
        const commands = JSON.parse(
          commandsMatch
            .replaceAll("\\'", '__ESCAPED_SINGLE_QUOTE__')
            .replaceAll("'", '"')
            .replaceAll('__ESCAPED_SINGLE_QUOTE__', "\\'"),
        );
        const pm = packageManager ?? 'pnpm';
        return `\`\`\`bash\n${commands.map((command: string) => buildPackageManagerExecCommand(pm, command)).join('\n')}\n\`\`\``;
      } catch {
        return match;
      }
    },
  );

  return processedGuide;
};
