# Type Safe API React Generator

## Overview
This generator adds type-safe API integration to your React application, enabling strongly-typed API calls to your backend. It sets up all necessary configuration for connecting to your API, including AWS IAM authentication support. The integration provides full end-to-end type safety between your frontend and backend.

## Prerequisites

Before using this generator, ensure you have:

1. A React application project
2. A Type Safe API hooks library project (generated using the `type-safe-api#rest` generator)

## Usage

You can generate the Type Safe API React integration in two ways:

### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:
1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then add the Type Safe API integration to your React application:
1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "type-safe-api#react"
4. Fill in the required parameters in the form
5. Click "Run"

### 2. Using CLI

Add Type Safe API integration to your React application:
```bash
nx g @aws/nx-plugin:type-safe-api#react --frontendProject=my-app --hooksLibraryProject=my-api-hooks --auth=IAM
```

You can also perform a dry-run to see what files would be generated without actually creating them:
```bash
nx g @aws/nx-plugin:type-safe-api#react --frontendProject=my-app --hooksLibraryProject=my-api-hooks --auth=IAM --dry-run
```

Both methods will add Type Safe API integration to your React application with all the necessary configuration.

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| frontendProject* | string | - | The name of your React application project (required). |
| hooksLibraryProject* | string | - | The name of the Type Safe API generated react hooks library project (required). |
| auth* | string | "IAM" | Authentication strategy. Options: "IAM", "None" |

*Required parameter

## Expected Output

The generator creates the following structure in your React application:

```
src/
├── components/
│   └── [ApiName]HooksProvider.tsx      # API hooks provider configuration
└── hooks/
    └── [apiName]/
        └── useApi.ts     # Hook for using the API client
```

Additionally, it:
1. Sets up the necessary configuration for API authentication (if using IAM auth)
2. Integrates the type-safe hooks library with your React application

## Using the Generated Code

```tsx
import { useSayHello } from ':my-org/my-api-typescript-react-hooks';

// Use the generated hooks
function UserGreeting() {
  const { data, isLoading, error } = useSayHello({
    name: 'World'
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>{data.message}</div>;
}
```

## More Information

See the [TanStack Query documentation](https://tanstack.com/query/latest) for more details on the usage of the generated hooks.
