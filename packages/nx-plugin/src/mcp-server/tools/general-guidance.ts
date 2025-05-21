/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NxGeneratorInfo } from '../../utils/nx';
import { PACKAGE_MANAGERS } from '../schema';
import { buildNxCommand, fetchGuidePages } from '../generator-info';

export const TOOL_SELECTION_GUIDE = `## Tool Selection Guide

- Use the \`general-guidance\` tool for guidance and best practices for working with Nx and the Nx Plugin for AWS.
- Use the \`create-workspace-command\` tool to discover how to create a workspace to start a new project.
- Use the \`list-generators\` tool to discover the available generators and how to run them.
- Use the \`generator-guide\` tool to retrieve detailed information about a specific generator.`;

/**
 * Add a tool which provides general guidance for using Nx and the Nx Plugin for AWS
 */
export const addGeneralGuidanceTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.tool(
    'general-guidance',
    'Tool for guidance and best practices for working with Nx and the Nx Plugin for AWS',
    async () => ({
      content: [
        {
          type: 'text',
          text: `# Nx Plugin for AWS Guidance

${TOOL_SELECTION_GUIDE}

## Getting Started

- Choose a package manager first. You can choose between ${PACKAGE_MANAGERS.join(' ,')}. It's recommended to use "pnpm" if the user has no preference
- Next, you must create an Nx workspace. Use the \`create-workspace-command\` tool for more details, and provide it with your chosen package manager
- After this, you can start scaffolding the main components of your application using generators. Use the \`list-generators\` tool to discover available generators, and the \`generator-guide\` tool for more detailed information about a specific generator

## Nx Primer

- Prefix nx commands with the appropriate prefix for your package manager, for example:
${PACKAGE_MANAGERS.map((pm) => buildNxCommand('<options>', pm)).join(' - \n')}
- Each project in your workspace has a file named \`project.json\` which contains important project information such as its name, and defines the "targets" which can be run for that project, for example building or testing the project
- Use the command \`nx reset\` to reset the Nx daemon when unexpected issues arise
- After adding dependencies between TypeScript projects, use \`nx sync\` to ensure project references are set up correctly

## General Instructions

- Workspaces contain a single \`package.json\` file at the root which defines the dependencies for all projects. Therefore when installing dependencies, you must add these to the root workspace using the appropriate command for your package manager:
  - pnpm add -w -D <package>
  - yarn add -D <package>
  - npm install --legacy-peer-deps -D <package>
  - bun install -D <package>
  - (Omit -D for production dependencies)
- When specifying project names as arguments to generators, prefer the _fully qualified_ project name, for example \`@workspace-name/project-name\`. Check the \`project.json\` file for the specific package to find its fully qualified name
- When no generator exists for a specific framework required, use the base \`ts#project\` and \`py#project\` generators and build on top, unless building a React website in which case use the \`ts#cloudscape-website\` generator and replace CloudScape with your desired UI component library

## Useful Commands

- Fix lint issues with \`nx run-many --target lint --configuration=fix --all --output-style=stream\`
- Build all projects with \`nx run-many --target build --all --output-style=stream\`
- Prefer importing the CDK constructs vended by generators in \`packages/common/constructs\` over writing your own

## Best Practices

- After running a generator, use the \`nx show projects\` command to check which projects have been added (if any)
- Carefully examine the files that have been generated and always refer back to the generator guide when working in a generated project
- Generate all projects into the \`packages/\` directory
- After making changes to your projects, fix linting issues, then run a full build
- When it's time to start testing a project, suggest to the user that infrastructure is deployed to AWS. For websites, if a runtime-config.json is needed, use the load:runtime-config target after a deployment to point a local website at a sandbox stack.

## Language Specific Guidance

Please refer to the below documentation for important details regarding working with any TypeScript or Python projects.

${await fetchGuidePages(['typescript-project', 'python-project'], generators)}

    `,
        },
      ],
    }),
  );
};
