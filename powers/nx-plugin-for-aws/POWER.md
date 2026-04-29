---
name: 'nx-plugin-for-aws'
displayName: 'Nx Plugin for AWS'
description: 'Scaffold and build cloud-native applications on AWS using @aws/nx-plugin generators. Covers workspace creation, project scaffolding with TypeScript, Python, React, CDK, Terraform, and more.'
keywords: ['nx-plugin-for-aws', 'aws-nx-plugin', 'nx', 'aws', 'cdk', 'terraform']
author: 'AWS'
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

- Node.js and npm installed ([installation guide](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm))
- A package manager: pnpm (recommended), yarn, npm, or bun
- For Python generators: [UV](https://docs.astral.sh/uv/) package manager
- For infrastructure deployment: AWS CLI configured with credentials

### Getting Started

1. Choose a package manager (pnpm is recommended)
2. Choose an IaC provider (CDK is recommended)
3. Create a new workspace using the `create_workspace_command` tool
4. Start scaffolding with generators using `list_generators` and `generator_guide`

### Quick Start Example

To create a new workspace and scaffold a React website with a tRPC API:

```bash
# Create workspace (pass `.` as the name to create in the current empty directory)
pnpm create @aws/nx-workspace my-app --no-interactive

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
pnpm create @aws/nx-workspace my-app --no-interactive
```

If you are already inside an empty directory intended for this project, pass `.` as the workspace name to create the workspace in the current directory:

```bash
pnpm create @aws/nx-workspace . --no-interactive
```

Be sure to ask the user what their preferred project name is, unless already within an empty directory intended for the project.

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

| Generator               | Description                           |
| ----------------------- | ------------------------------------- |
| `ts#project`            | TypeScript library or application     |
| `ts#infra`              | AWS CDK infrastructure project        |
| `ts#react-website`      | React website with Vite               |
| `ts#react-website#auth` | Add Cognito auth to React website     |
| `ts#trpc-api`           | tRPC backend with API Gateway/Lambda  |
| `ts#smithy-api`         | Smithy API with TypeScript Server SDK |
| `ts#lambda-function`    | TypeScript Lambda function            |
| `ts#mcp-server`         | TypeScript MCP server                 |
| `ts#strands-agent`      | TypeScript Strands AI agent           |
| `ts#nx-generator`       | Custom Nx generator                   |
| `ts#nx-plugin`          | Custom Nx plugin with MCP             |
| `py#project`            | Python project with UV                |
| `py#fast-api`           | FastAPI backend with Powertools       |
| `py#lambda-function`    | Python Lambda function                |
| `py#mcp-server`         | Python MCP server                     |
| `py#strands-agent`      | Python Strands AI agent               |
| `terraform#project`     | Terraform project                     |
| `connection`            | Connect projects together             |
| `license`               | Manage LICENSE files and headers      |

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
