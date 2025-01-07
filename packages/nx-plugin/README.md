# PACE Plugin for Nx

This plugin provides a collection of generators to help you build cloud-native applications with AWS, TypeScript, and React.

## What are Generators?

Generators (also known as schematics) are powerful tools that automate the creation and modification of code. They help maintain consistency across your codebase by following established patterns and best practices. When you run a generator, it:

1. Prompts for necessary configuration options
2. Creates new files from templates
3. Updates existing files when needed
4. Follows project conventions automatically

For more information about generators, see the [Nx Generator documentation](https://nx.dev/plugin-features/use-code-generators).

## Getting started

### Install the plugin

From the root of your workspace run:

```bash
nx add @aws/nx-plugin
```

### IDE Setup

For the best development experience, we recommend installing the Nx Console extension for your IDE:

- VS Code: [Nx Console for VS Code](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)
- JetBrains IDEs: [Nx Console for JetBrains](https://plugins.jetbrains.com/plugin/21060-nx-console)

The Nx Console provides:

- Interactive generator configuration
- Command autocompletion
- Visual project graph
- Integrated task runner

## Using the Generators

Refer to these generator README files for detailed installation instructions.

### Cloudscape website

- [Cloudscape website app](src/cloudscape-website/app/README.md) - Generate a new Cloudscape-based web application.
- [Cognito authentication](src/cloudscape-website/cognito-auth/README.md) - Add AWS Cognito authentication to your Cloudscape website.
- [Runtime configuration](src/cloudscape-website/runtime-config/README.md) - Add runtime configuration capabilities to your Cloudscape website.

### Infrastructure

- [Infrastructure app](src/infra/app/README.md) - Generate AWS CDK infrastructure code for your application

### tRPC

- [tRPC Backend](src/trpc/backend/README.md) - Generate a tRPC backend service with AWS Lambda integration
- [tRPC React](src/trpc/react/README.md) - Add tRPC client integration to your React application

### TypeScript

- [TypeScript library](src/ts/lib/README.md) - Generate a new TypeScript library with best practices and testing setup
- [CJS to ESM](src/ts/cjs-to-esm/README.md) - Convert CommonJS modules to ECMAScript modules
