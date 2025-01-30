---
sidebar_position: 1
---

# PACE Nx Plugin

The PACE Nx Plugin includes several useful [Nx Generators](https://nx.dev/features/generate-code), which provides a way to quickly bootstrap and build AWS projects.

Benefits of using the PACE Nx Plugin:

- Quickly bootstrap and add components to your project
- Integrated `nx monorepo` for better dev cycles
- No projen components (customers found this layer of abstraction complex)
- Full customization of projects

**Why are we releasing the PACE Nx Plugin?**

Addressing collated PDK feedback: [APJ PACE Developer Experience](https://quip-amazon.com/bXVHAYgO6IxM/APJ-PACE-Developer-Experience)

## Getting started

### Prerequisites

#### Nx Console IDE Plugin

While optional, we recommend installing the Nx Console in VSCode plugin (or equivalent for your IDE if available).

- [Install NX Console for VSCode](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)
- [Install NX Console for JetBrains/IntelliJ](https://plugins.jetbrains.com/plugin/21060-nx-console)

#### PNPM

You can choose your own package manager, but we recommend using `pnpm`. Install with:

```bash
npm i -g pnpm
```

:::info
PNPM version must be 8.7 or higher! We recommend 9.
:::

### Create an Nx integrated monorepo

To create an Nx monorepo, using your CLI editor, type in the following:

```
pnpm dlx create-nx-workspace <my-prototype> --ci=skip --preset=ts

cd <my-prototype>
```

All associated files and dependencies needed for the monorepo are created in the specified folder.

For more information on how to use Nx:

- For instructions on how to use React with Nx in a monorepo setup, refer to the [React monorepo tutorial](https://nx.dev/getting-started/tutorials/react-monorepo-tutorial).
- View the [Getting Started with Integrated Repos](https://www.youtube.com/watch?v=weZ7NAzB7PM) video tutorial.

### Add the PACE Nx plugin

To install the PACE Nx plugin, using your CLI editor, type in the following:

```
pnpm nx add @aws/nx-plugin
```

This will make the Nx generators defined by the plugin available in your monorepo.

### Add components to your project

To add components to your project, you can use either the UI in your IDE (Nx Console) or the CLI.

#### Using the VSCode NX Console

1. Select the **Nx** console plugin on the left, and click **Generate (UI)**. The component generator selection list is displayed.
   ![VSCode Generate UI](/img/nx-generate-ui.png)
2. Choose the generator for the component you want to add. For example, `infra#app`.
   ![Component generator](/img/nx-component-generator.png)
3. Fill in the details. The terminal window in the bottom runs a dry run and shows you what files will be created.
4. To proceed, click **Generate**.
   ![Generate action](/img/nx-infra-app-generate.png)

5. In the terminal, run the following to build everything:

   ```
   pnpm nx run-many --target build --all
   ```

#### Using the CLI:

1. In the terminal, type the following to run the generator:

   ```
   pnpm exec nx generate <generator>
   ```

   For example for infra:

   ```
   pnpm exec nx generate @aws/nx-plugin:infra#app
   ```

2. Follow the prompts to generate the component and add it to your project.

3. In the terminal, run the following to install and build everything:

   ```
   pnpm nx run-many --target build --all
   ```

## Guides

### tRPC API

For more information on how to use tRPC API for typesafe APIs, refer to the [tRPC documentation](https://trpc.io/). Note that a generator for PDK's Type Safe API is coming soon!

### CDK Infrastructure

To synthesize your CDK infrastructure, simply build the package:

```
pnpm exec nx run <my-infra-project>:build
```

To deploy, you can use the `deploy` target:

```
pnpm exec nx run <my-infra-project>:deploy
```

## Troubleshooting

- If projects don't show up, you may need to refresh the `nx workspace` periodically.
  - VSCode: To refresh NX workspace, `cmd + shift + p → NX`
- If your IDE is showing red for missing packages, restart the typescript server.
  - VSCode: To restart the TS server, `cmd + shift + p → TypeScript`
- If the site fails to generate,
  - Copy/paste the script used to generate and add the `--verbose` flag to get more details.
  - Try running `pnpm i` after running a previous generator.
