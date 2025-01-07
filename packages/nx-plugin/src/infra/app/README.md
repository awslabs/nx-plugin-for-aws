# Infrastructure App Generator

## Overview

This generator creates a new AWS CDK infrastructure application. The generated application includes security best practices through PDK Nag checks and provides infrastructure visualization. The codebase is structured using TypeScript and ES Modules (ESM) for modern development practices.

## How to generate an infrastructure application

You can generate a new infrastructure application in two ways:

### Using VSCode IDE

Install the NX Console extension for VSCode:

1. Open VSCode.
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X).
3. Search for "Nx Console".
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console).

To generate your application:

1. Open the NX Console in VSCode.
2. Choose **Generate**.
3. Search for "infra#app"
4. Fill in the required parameters in the form and choose **Run**.

### Using the CLI

To generate the application:

```bash
nx g @aws/nx-plugin:infra#app my-infra --directory=apps/infrastructure
```

To perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:infra#app my-infra --directory=apps/infrastructure --dry-run
```

## Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| name* | string | - | The name of the application (required). Must start with a letter and not contain colons. |
| directory | string | "packages" | The directory to store the application in. |
| unitTestRunner | string | "vitest" | Test runner for unit tests. Options: jest, vitest, none |

*Required parameters

## Expected output

The generator creates an infrastructure application with the following structure:

```
<directory>/<name>/
├── src/
│   ├── main.ts           # Application entry point with CDK and PDK setup
│   └── stacks/          # CDK stack definitions
│       └── application-stack.ts  # Main application stack
├── cdk.json            # CDK configuration
├── tsconfig.json       # TypeScript configuration
└── project.json       # Project configuration and build targets
```

Additionally, the generator:

1. Configures build settings for CDK synthesis and deployment.
2. Installs these required dependencies:
   - @aws/pdk
   - aws-cdk-lib
   - aws-cdk
   - constructs
   - esbuild
   - source-map-support
   - tsx (dev dependency)

## Features

### PDK integration

The generated application includes PDK (Project Development Kit) integration which provides:

- Security best practices through PDK Nag checks.
- Infrastructure visualization with CDK Graph.
- Threat modeling capabilities through Threat Composer.

### Infrastructure visualization

The application automatically generates infrastructure diagrams using CDK Graph:

```typescript
const graph = new CdkGraph(app, {
  plugins: [
    new CdkGraphDiagramPlugin({
      defaults: {
        filterPlan: {
          preset: FilterPreset.COMPACT,
          filters: [{ store: Filters.pruneCustomResources() }],
        },
      },
    }),
    new CdkGraphThreatComposerPlugin(),
  ],
});
```

### Security checks

PDK Nag is configured with AWS Prototyping Checks to ensure infrastructure security:

```typescript
const app = PDKNag.app({
  nagPacks: [new AwsPrototypingChecks()],
});
```

### Build and deploy targets

The generator configures two main targets in your `project.json`.

**Build Target**

- Synthesizes CDK templates
- Caches results for faster subsequent builds
- Outputs to `dist/<directory>/cdk.out`

**Deploy Target**

- Deploys infrastructure to AWS
- Configures automatic approval for CI/CD pipelines
- Uses synthesized templates from the build target

## Working with the generated application

### Adding resources

To add AWS resources to your stack in `src/stacks/application-stack.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserIdentity, StaticWebsite, MyApi } from ':my-org/common-constructs'
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const identity = new UserIdentity(this, 'UserIdentity');
    const myapi = new MyApi(this, 'MyApi', {
      defaultAuthorizer: new HttpIamAuthorizer(),
    });
    myapi.grantInvokeAccess(identity.identityPool.authenticatedRole);
    new StaticWebsite(this, 'Website');
  }
}
```

The generated code serves as a starting point that you can adapt to your specific infrastructure requirements while maintaining security best practices.

### Building the application

To create a production build:

```bash
nx build my-infra
```

All built code is located in the `dist` folder at the root of your workspace. For example, if your infrastructure application is in `apps/infrastructure/my-infra`, the built code will be in `dist/apps/infrastructure/my-infra`. This includes:

- Compiled TypeScript files
- CDK synthesized templates in `dist/apps/infrastructure/my-infra/cdk.out`
- Generated infrastructure diagrams
- Source maps for debugging

### Deploying to AWS

To deploy your infrastructure:

```bash
nx deploy my-infra
```

This command will deploy your infrastructure to AWS using the account and region configured in your AWS CLI.

You can also perform a hotswap deployment if you are only making modifications to existing resources via the following command:

```bash
nx deploy my-infra --hotswap
```