# Cognito Auth Generator

## Overview

This generator adds AWS Cognito authentication to an existing Cloudscape React application. It sets up the necessary components and infrastructure for user authentication using Amazon Cognito, including sign-in, sign-up, and password recovery flows. The generator integrates seamlessly with the Cloudscape Design System components and configures all required AWS resources through CDK.

## Prerequisites

Before you use this generator, ensure your project meets these requirements:

- The project must have a `main.tsx` file in its source directory.
- The `main.tsx` file must contain a `<RuntimeConfigProvider>` element.
- The project must be a valid Cloudscape application.

Example of the required `main.tsx` structure:

```typescript
import { RuntimeConfigProvider } from './components/RuntimeConfig';

const App = () => (
  <RuntimeConfigProvider>
    {/* Your app components */}
  </RuntimeConfigProvider>
);
```

If these prerequisites are not met, the generator will fail and display an error.

## How to add Cognito authentication

You can add Cognito authentication to your Cloudscape website in two ways.

### Using VSCode IDE

Install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

To add the authentication:

1. Open the NX Console in VSCode.
2. Choose **Generate**.
3. Search for "cloudscape-website#cognito-auth"
4. Fill in the required parameters:
   - **project**: Your existing Cloudscape application name.
   - **allowSignup**: Whether to enable self-signup (optional).
5. Choose **Run**.

### 2. Using the CLI

To add authentication to your existing Cloudscape application:

```bash
nx g @aws/nx-plugin:cloudscape-website#cognito-auth --project=my-cloudscape-app
```

To enable self-signup:

```bash
nx g @aws/nx-plugin:cloudscape-website#cognito-auth --project=my-cloudscape-app --allowSignup=true
```

To perform a dry-run to see what files would be generated without actually creating them.

```bash
nx g @aws/nx-plugin:cloudscape-website#cognito-auth --project=my-cloudscape-app --dry-run
```

All methods will add Cognito authentication to your existing Cloudscape website application with all the necessary components and infrastructure code.

## Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| project* | string | - | The root directory of the Cloudscape application (required) |
| allowSignup | boolean | false | Whether to allow self-signup |

*Required parameters

## Expected output

The generator adds authentication-related components and infrastructure.

### React components

```
<directory>/<project>/
├── src/
│   └── components/
│       └── CognitoAuth/
│           └── index.tsx         # Main authentication component
```

### 2. Infrastructure code

```
common/constructs/
├── src/
│   └── identity/
│       ├── index.ts              # Exports for identity constructs
│       ├── user-identity.ts      # Main identity construct
│       └── userpool-with-mfa.ts  # User pool configuration
```

Additionally, the generator:

- Installs these required dependencies:
  - @aws-northstar/ui
  - aws-cdk-lib
  - constructs
  - @aws-cdk/aws-cognito-identitypool-alpha
- Updates the application's runtime configuration to include Cognito settings, and
- Automatically integrates the authentication component into your application's `main.tsx`.

## Infrastructure architecture

```mermaid
graph TD
    subgraph AWS Cloud
        UP[Cognito User Pool] --> IP[Identity Pool]
        UP --> Client[Web Client]
        IP --> IAM[IAM Roles]
    end
```

The infrastructure stack adds:

**Cognito User Pool**

- User directory management
- Sign-up and sign-in flows
- MFA configuration

**Cognito Identity Pool**

- Federated identities
- AWS credentials mapping
- IAM role assignment

**Web Client**

- User Password and SRP auth flows
- Token handling

## Authentication components

The generator automatically sets up authentication in your application by:

1. Importing the `CognitoAuth` component in `main.tsx`.
2. Wrapping your application with the `CognitoAuth` component inside the `RuntimeConfigProvider` construct.
3. Configuring the authentication UI with:
   - Sign-in form
   - Sign-up form (if enabled)
   - Password recovery
   - Multi-factor authentication (MFA) setup and verification

**Note**: No manual setup is required as the generator handles all the necessary component integration.

## Runtime configuration

The generator automatically integrates with the `RuntimeConfig` system to provide Cognito configuration.

### Infrastructure Usage

```typescript
import { UserIdentity } from ':my-org/common-constructs';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MyWebsiteStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create the Cognito authentication resources
    new UserIdentity(this, 'Identity');
    
    // The runtime config is automatically updated with Cognito settings
  }
}
```

### Frontend Usage

The `CognitoAuth` component automatically uses the runtime configuration.
