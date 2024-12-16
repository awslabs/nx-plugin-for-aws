# Type-Safe REST API Generator

## Overview
This generator creates a [type-safe REST API](https://aws.github.io/aws-pdk/developer_guides/type-safe-api/) with AWS CDK infrastructure setup. It supports modeling your API using either TypeSpec or OpenAPI, generates type-safe infrastructure code, Lambda handlers with built-in observability, and React hooks powered by TanStack Query. The generator focuses on maintaining end-to-end type safety from your API definition through to the client implementation.

## Usage

You can generate a new type-safe REST API in two ways:

### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:
1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then generate your API:
1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "type-safe-api#rest"
4. Fill in the required parameters in the form
5. Click "Run"

### 2. Using CLI

Generate the API:
```bash
nx g @aws/nx-plugin:type-safe-api#rest my-api \
  --modelLanguage=typespec \
  --infrastructureLanguage=typescript \
  --handlerLanguages=typescript \
  --libraries=typescript-react-hooks \
  --directory=packages
```

You can also perform a dry-run to see what files would be generated without actually creating them:
```bash
nx g @aws/nx-plugin:type-safe-api#rest my-api \
  --modelLanguage=typespec \
  --dry-run
```

Note: if you wish to add more handler languages or libraries after initially generating, you can re-run the generator with the additional configuration.

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| name* | string | - | The name of the API (required). Used to generate class names and file paths. |
| modelLanguage* | string | "typespec" | The language to model your API in. Options: "typespec", "openapi" |
| infrastructureLanguage* | string | "typescript" | The language to write CDK infrastructure in. Currently only supports "typescript" |
| handlerLanguages | string[] | ["typescript"] | Languages to write Lambda handlers in. Currently only supports "typescript" |
| libraries | string[] | ["typescript-react-hooks"] | Client libraries to generate. Currently supports "typescript-react-hooks" |
| runtimeLanguages | string[] | [] | Additional languages for client/server code |
| directory | string | "packages" | Parent directory where the API model is placed |
| scope | string | - | Scope for API packages (e.g. @my-company). If omitted, will be inferred |
| subDirectory | string | API name | The sub directory the API is placed in |

*Required parameter

## Project Structure

The generator creates several components organized in a modular structure:

### 1. API Model
```
<directory>/<api-name>/model/
└── src/
    ├── main.tsp          # TypeSpec API definition (if using TypeSpec)
    └── main.yaml         # OpenAPI definition (if using OpenAPI)

```

### 2. Lambda Handlers
```
<directory>/<api-name>/handlers/typescript/
├── src/
│   ├── index.ts         # Handler exports
│   ├── say-hello.ts     # Handler implementation
│   └── say-hello.test.ts # Handler tests
├── eslint.config.js    # ESLint configuration
├── vite.config.ts      # Vite/Vitest configuration
├── tsconfig.json
└── project.json
```

### 3. Generated Code

#### Generated Runtime
```
<directory>/<api-name>/generated/runtime/typescript/
├── src/
│   ├── apis/           # Generated API clients and Lambda handler wrappers
│   ├── interceptors/   # Request/response interceptors
│   │   ├── cors.ts     # CORS handling
│   │   ├── powertools/ # AWS Lambda Powertools integration
│   │   │   ├── logger.ts   # Structured logging
│   │   │   ├── metrics.ts  # CloudWatch metrics
│   │   │   └── tracer.ts   # X-Ray tracing
│   │   └── try-catch.ts # Error handling
│   ├── models/         # Generated TypeScript types
│   └── response/       # Response handling utilities
└── project.json
```

#### Generated Infrastructure
```
<directory>/<api-name>/generated/infrastructure/typescript/
├── src/
│   ├── api.ts          # CDK construct to deploy your API
│   ├── functions.ts    # Lambda function constructs configured to point to your handlers
│   ├── mock-integrations.ts # Mock integrations based on your API model
│   └── index.ts        # Infrastructure exports
├── mocks/             # Mock response files
│   ├── get-hello-200.json
│   ├── get-hello-400.json
│   └── ...
└── project.json
```

#### Generated React Hooks Library
```
<directory>/<api-name>/generated/libraries/typescript-react-hooks/
├── src/
│   ├── apis/
│   │   ├── DefaultApi.ts                # API client implementation
│   │   ├── DefaultApiClientProvider.tsx # React context provider
│   │   ├── DefaultApiHooks.ts          # Generated hooks
│   │   └── index.ts
│   ├── models/                         # Shared type definitions
│   └── index.ts
├── tsconfig.json
└── project.json
```

## API Modeling

### Using TypeSpec

TypeSpec is the recommended way to model your API. It provides a powerful type system and excellent tooling support.

```typescript
import "@typespec/http";
import "@typespec/openapi";
import "./types/errors.tsp";
import "./decorators/handler.tsp";

using Http;
using OpenAPI;

@service({ title: "Api" })
@info({ version: "1.0" })
namespace Api;

@get
@route("/hello")
@handler({ language: "typescript" })
op SayHello(@query name: string):
  | {
      message: string;
    }
  | BadRequestError
  | NotAuthorizedError
  | NotFoundError
  | InternalFailureError;
```

### Using OpenAPI

Alternatively, you can use OpenAPI to define your API:

```yaml
openapi: 3.0.3
info:
  title: Api
  version: 1.0.0
paths:
  /hello:
    get:
      operationId: sayHello
      parameters:
        - name: name
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/NotAuthorized'
        '404':
          $ref: '#/components/responses/NotFound'
        '500':
          $ref: '#/components/responses/InternalFailure'
```

## Using Generated Code

Every time you update your model, you can rebuild the project to regenerate the latest runtimes, infrastructure, libraries and lambda handler stubs.

### Lambda Handlers

The generator creates type-safe Lambda handler stubs with built-in observability.

```typescript
import {
  sayHelloHandler,
  SayHelloChainedHandlerFunction,
  INTERCEPTORS,
  Response,
  LoggingInterceptor,
} from "@my-org/api-runtime-typescript";

/**
 * Type-safe handler for the SayHello operation
 */
export const sayHello: SayHelloChainedHandlerFunction = async (request) => {
  LoggingInterceptor.getLogger(request).info("Start SayHello Operation");

  const { input } = request;
  return Response.success({
    message: `Hello ${input.requestParameters.name}`,
  });
};

/**
 * Entry point for the AWS Lambda handler
 * Includes automatic request/response handling and observability
 */
export const handler = sayHelloHandler(...INTERCEPTORS, sayHello);
```

### React Hooks

The generator creates React hooks powered by TanStack Query:

```typescript
import { useSayHello } from '@my-org/api-typescript-react-hooks';
import { DefaultApiClientProvider } from '@my-org/api-typescript-react-hooks';

// Wrap your app with the provider
function App() {
  return (
    <DefaultApiClientProvider>
      <UserGreeting />
    </DefaultApiClientProvider>
  );
}

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

## Infrastructure

The generator creates a CDK construct that you can use in your infrastructure:

```typescript
import { Stack } from 'aws-cdk-lib';
import { MyApi } from '@my-org/common-constructs';
import { SayHelloFunction } from '@my-org/my-api-infrastructure-typescript';
import { Authorizers, Integrations } from '@aws/pdk/type-safe-api/index.js';

export class MyStack extends Stack {
  constructor(scope: App, id: string) {
    super(scope, id);

    // Create the API. An integration must be specified for every operation defined in your model.
    const api = new MyApi(this, 'MyApi', {
      defaultAuthorizer: Authorizers.iam(),
      integrations: {
        sayHello: {
          integration: Integrations.lambda(
            new SayHelloFunction(this, 'SayHello')
          ),
        },
      },
    });
  }
}
```


## Building

To build all components of your API:

```bash
nx build @my-org/my-api-model
nx build @my-org/my-api-runtime-typescript
nx build @my-org/my-api-infrastructure-typescript
nx build @my-org/my-api-handlers-typescript
nx build @my-org/my-api-typescript-react-hooks
```

The built artifacts will be in the `dist` directory:
- Model: `dist/<directory>/<api-name>/model`
- Runtime: `dist/<directory>/<api-name>/generated/runtime/typescript`
- Infrastructure: `dist/<directory>/<api-name>/generated/infrastructure/typescript`
- Handlers: `dist/<directory>/<api-name>/handlers/typescript-lambda`
- React Hooks: `dist/<directory>/<api-name>/generated/libraries/typescript-react-hooks`

## Best Practices

1. **API Modeling**
   - Keep your API model clean and focused
   - Use TypeSpec for better tooling support and type safety
   - Document your API thoroughly with comments

2. **Handler Implementation**
   - Keep handlers small and focused
   - Use the generated types for type safety
   - Implement proper error handling
   - Add logging for observability

3. **Client Usage**
   - Use the generated hooks in your React components
   - Handle loading and error states
   - Implement proper error boundaries
   - Use TypeScript for full type safety

4. **Infrastructure**
   - Follow AWS best practices
   - Implement proper security measures
   - Use environment-specific configurations
   - Monitor API usage and performance

## More Information

See the PDK [Type Safe API documentation](https://aws.github.io/aws-pdk/developer_guides/type-safe-api/) for more in-depth details on building APIs with Type Safe API.
