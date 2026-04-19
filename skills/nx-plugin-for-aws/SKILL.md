---
name: nx-plugin-for-aws
description: >-
  Scaffold and build cloud-native applications on AWS using @aws/nx-plugin generators.
  Use when the user wants to create workspaces, generate projects, or scaffold infrastructure with the Nx Plugin for AWS.
---

# Nx Plugin for AWS

## Overview

The Nx Plugin for AWS (`@aws/nx-plugin`) is a collection of generators that help you rapidly scaffold and build cloud-native applications on AWS. It provides end-to-end code generation from application code to CDK/Terraform infrastructure, all following AWS best practices.

This power gives AI assistants guided access to the MCP server so they can help you create workspaces, discover generators, and scaffold projects interactively.

Key capabilities:

- Create new Nx workspaces configured for AWS development
- Scaffold TypeScript and Python projects, APIs, websites, and infrastructure
- Generate Lambda functions, MCP servers, Strands Agents, and more
- Connect projects together (e.g. frontend to backend)
- Manage licenses across your workspace

## Onboarding

### Prerequisites

- [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- [Node >= 22](https://nodejs.org/en/download) (We recommend using something like [NVM](https://github.com/nvm-sh/nvm) to manage your node versions)
  - verify by running `node --version`
- [PNPM >= 10](https://pnpm.io/installation#using-npm) (you can also use [Yarn >= 4](https://yarnpkg.com/getting-started/install), [Bun >= 1](https://bun.sh/docs/installation), or [NPM >= 10](https://nodejs.org/en/learn/getting-started/an-introduction-to-the-npm-package-manager) if you prefer)
  - verify by running `pnpm --version`, `yarn --version`, `bun --version` or `npm --version`
- [UV >= 0.5.29](https://docs.astral.sh/uv/getting-started/installation/)
  1. install Python 3.12 by running: `uv python install 3.12.0`
  2. verify with `uv python list --only-installed`
- [AWS Credentials](https://docs.aws.amazon.com/sdkref/latest/guide/access.html) configured to your target AWS account (where your application will be deployed)

### Getting Started

1. Choose a package manager (pnpm is recommended)
2. Choose an IaC provider (CDK is recommended)
3. Create a new workspace using the `create_workspace_command` tool
4. Start scaffolding with generators using `list_generators` and `generator_guide`

### Quick Start Example

To create a new workspace and scaffold a React website with a tRPC API:

```bash
# Create workspace
pnpm create @aws/nx-workspace my-app

# Generate a tRPC API
pnpm nx g @aws/nx-plugin:ts#trpc-api --no-interactive --name=my-api

# Generate a React website
pnpm nx g @aws/nx-plugin:ts#react-website --no-interactive --name=my-website

# Connect the website to the API
pnpm nx g @aws/nx-plugin:connection --no-interactive --sourceProject=my-website --targetProject=my-api

# Generate CDK infrastructure
pnpm nx g @aws/nx-plugin:ts#infra --no-interactive --name=infra
```

Always prompt the user for what name they want to use when executing generators if a --name is a required argument. DO NOT ASSUME THE NAME.

## Common Workflows

### Workflow 1: Create a New Workspace

Use the `create_workspace_command` tool with your preferred package manager. This generates the full command to create an Nx workspace pre-configured with the AWS plugin.

```bash
pnpm create @aws/nx-workspace my-app
```

Be sure to ask the user what their preferred project name is.

### Workflow 2: Discover Available Generators

Use the `list_generators` tool to see all available generators and their parameters. This returns the full list with descriptions and example commands.

### Workflow 3: Get Detailed Generator Guidance

Use the `generator_guide` tool with a specific generator name to get in-depth documentation including:

- All parameters (required and optional)
- Generated file structure
- Post-generation steps
- Best practices and tips

### Workflow 4: Scaffold a Full-Stack Application

A typical full-stack app involves:

1. Create workspace
2. Generate a backend API (`ts#trpc-api`, `ts#smithy-api`, or `py#fast-api`)
3. Generate a React frontend (`ts#react-website`)
4. Connect frontend to backend (`connection`)
5. Generate CDK infrastructure (`ts#infra`)
6. Optionally add auth (`ts#react-website#auth`)

### Workflow 5: Add Components to Existing Projects

Add capabilities to existing projects:

- `ts#lambda-function` / `py#lambda-function` — Add Lambda functions
- `ts#mcp-server` / `py#mcp-server` — Add MCP servers
- `ts#strands-agent` / `py#strands-agent` — Add Strands AI agents
- `ts#nx-generator` — Add custom Nx generators

## Available Generators

| Generator               | Description                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `connection`            | Integrates a source project with a target project                                                                  |
| `license`               | Add LICENSE files and configure source code licence headers                                                        |
| `py#fast-api`           | Generates a FastAPI Python project                                                                                 |
| `py#lambda-function`    | Adds a lambda function to a python project                                                                         |
| `py#mcp-server`         | Generate a Python Model Context Protocol (MCP) server for providing context to Large Language Models               |
| `py#project`            | Generates a Python project                                                                                         |
| `py#strands-agent`      | Add a Strands Agent to a Python project                                                                            |
| `terraform#project`     | Generates a Terraform project                                                                                      |
| `ts#infra`              | Generates a cdk application                                                                                        |
| `ts#lambda-function`    | Generate a TypeScript lambda function                                                                              |
| `ts#mcp-server`         | Generate a TypeScript Model Context Protocol (MCP) server for providing context to Large Language Models           |
| `ts#nx-generator`       | Generator for adding an Nx Generator to an existing TypeScript project                                             |
| `ts#nx-plugin`          | Generate an Nx Plugin of your own! Build custom generators automatically made available for AI vibe-coding via MCP |
| `ts#project`            | Generates a TypeScript project                                                                                     |
| `ts#react-website`      | Generates a React static website                                                                                   |
| `ts#react-website#auth` | Adds auth to an existing React website                                                                             |
| `ts#smithy-api`         | Create an API using Smithy and the Smithy TypeScript Server SDK                                                    |
| `ts#strands-agent`      | Add a Strands Agent to a TypeScript project                                                                        |
| `ts#trpc-api`           | creates a trpc backend                                                                                             |

## Best Practices

- Always use `--no-interactive` flag when running generators programmatically
- Use fully qualified project names (e.g. `@my-scope/my-project`) when referencing projects
- Run `nx sync` after adding dependencies between TypeScript projects
- Install dependencies at the workspace root, not in individual projects
- Use `nx reset` to reset the Nx daemon when unexpected issues arise
- After running generators, use `nx show projects` to verify what was created
- Fix lint issues with `nx run-many --target lint --configuration=fix --all`
- Generate all projects into the `packages/` directory
- Prefer pnpm as the package manager and CDK as the IaC provider

## Troubleshooting

### MCP Server Connection Issues

**Problem:** MCP server won't start or connect
**Solution:**

1. Verify Node.js and npm are installed: `node --version && npm --version`
2. Try running manually: `npx -y @aws/nx-plugin-mcp`
3. If you get `ENOENT npx`, use the full path: replace `npx` with the output of `which npx`
4. Restart Kiro and try again

### Generator Fails

**Problem:** Generator command fails with errors
**Solution:**

1. Ensure you're in an Nx workspace root directory
2. Check that `@aws/nx-plugin` is installed: look for it in `package.json`
3. Run `nx reset` to clear the Nx daemon cache
4. Try running with `--verbose` flag for more details

### TypeScript Import Errors

**Problem:** Import errors after adding project dependencies
**Solution:**

1. Run `nx sync` to update TypeScript project references
2. Check `tsconfig.base.json` for correct path aliases
3. Remember TypeScript aliases use `:` prefix (e.g. `:my-scope/my-lib`)

### Python Dependency Issues

**Problem:** Python imports not resolving
**Solution:**

1. Use `nx run <project>:add <dependency>` to add dependencies
2. Ensure UV is installed and `uv.lock` is up to date
3. Check `pyproject.toml` for correct dependency declarations

## Configuration

**No additional configuration required** — the MCP server works out of the box via npx.

**MCP Server:** `nx-plugin-for-aws`
**Package:** `@aws/nx-plugin`
**Documentation:** [https://awslabs.github.io/nx-plugin-for-aws](https://awslabs.github.io/nx-plugin-for-aws)
