---
title: '@aws/nx-plugin tutorial'
description: Step by step instructions on how to use @aws/nx-plugin.
---

In this tutorial, you'll build a complete React website and REST API using `@aws/nx-plugin`. You'll learn how to:

- Initialize an Nx workspace with `@aws/nx-plugin`
- Create a React website with [CloudScape](https://cloudscape.design/) and a REST API using [Amazon API Gateway](https://aws.amazon.com/api-gateway/) and [AWS Lambda](https://aws.amazon.com/lambda/)
- Enable authentication with [Amazon Cognito](https://aws.amazon.com/cognito/)
- Deploy the application to AWS

## Prerequisites

Before you begin, ensure you have the following installed:

- [Visual Studio Code](https://code.visualstudio.com/)
- [Node.js](https://nodejs.org)
- [pnpm](https://pnpm.io/)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- A CDK Bootstrapped AWS account ([Instructions](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html))

## Step 1: Initialize a New Nx Workspace

Run the following command to create an Nx workspace:

```sh
pnpm dlx create-nx-workspace demo
```

Follow the prompts:

- **Which stack do you want to use?** - Choose `None`
- **Would you like to use Prettier?** - Choose `Yes`
- **Which CI provider?** - Choose `Do it later`
- **Would you like remote caching?** - Choose `No`

Once complete, navigate to the project directory:

```sh
cd demo
```

## Step 2: Add the Nx Plugin for AWS

Install the plugin with:

```sh
pnpm nx add @aws/nx-plugin
```

Then, open the workspace in VS Code:

```sh
code .
```

> **TIP:** Install the [Nx Console extension](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console) in VS Code for easier interaction with Nx.

## Step 3: Create the Backend REST API

1. Open **Nx Console** in VS Code and select **Generate (UI)** under **Common NX Commands**.
2. Choose `@aws/nx-plugin - trpc#backend`.
3. Set the `apiName` to `demo-api` and click **Generate**.

This will create the API inside the `packages/demo-api` folder.

## Step 4: Create a React Website with API Integration

### Generate the Website

1. In **Nx Console**, select **Generate (UI)**.
2. Choose `@aws/nx-plugin - cloudscape-website#app`.
3. Set the `name` to `demo-website` and click **Generate**.

This scaffolds a new React package with CloudScape UI.

### Enable Cognito Authentication

1. In **Nx Console**, select **Generate (UI)**.
2. Choose `@aws-nx-plugin - cloudscape-website#cognito-auth`.
3. Set a unique `cognitoDomain`, select `@demo/demo-website`, and check `allowSignup`.
4. Click **Generate**.

### Connect Frontend to Backend

1. In **Nx Console**, select **Generate (UI)**.
2. Choose `@aws-nx-plugin - trpc#react`.
3. Select `@demo/demo-website` for `frontendProjectName` and `@demo/demo-api-backend` for `backendProjectName`.
4. Click **Generate**.

## Step 5: Create CDK Infrastructure

### Generate the CDK App

1. In **Nx Console**, select **Generate (UI)**.
2. Choose `@aws/nx-plugin - infra#app`.
3. Set `name` to `infra` and click **Generate**.

### Define Cloud Resources

Open `packages/infra/src/stacks/application-stack.ts` and add the following code:

```typescript
import * as cdk from 'aws-cdk-lib';
import { DemoApi, DemoWebsite, UserIdentity } from ':demo/common-constructs';
import { Construct } from 'constructs';

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const identity = new UserIdentity(this, 'identity');
    const api = new DemoApi(this, 'api');
    api.grantInvokeAccess(identity.identityPool.authenticatedRole);

    new DemoWebsite(this, 'website');
  }
}
```

### Build and Deploy the Infrastructure

1. In **Nx Console**, expand `@demo/infra` under `Projects`.
2. Click the ▶️ button next to `build`.
3. Right the ▶️ button next to `deploy`, select `Execute task with Options` ➡️ `args`, type `--all` and press ⮐ to deploy to AWS.

## Step 6: Run the Frontend Locally

1. Fetch the `runtime-config.json` file:

   ```sh
   pnpm nx run @demo/demo-website:load:runtime-config
   ```

2. In **Nx Console**, expand `@demo/demo-website` under `Projects`.

3. Click the ▶️ button next to `serve`.

Your website will be available at `http://localhost:4200`.

---

Congratulations! 🎉 You have successfully built and deployed a full-stack application using `@aws/nx-plugin`!
