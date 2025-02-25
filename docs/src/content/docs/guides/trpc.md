---
title: tRPC
description: Reference documentation for tRPC
---

[tRPC](https://trpc.io/) is a framework for building APIs in TypeScript with end-to-end type safety. Using tRPC, updates to API operation inputs and outputs are immediately reflected in client code and are visible in your IDE without the need to rebuild your project.

The AWS Plugin for Nx makes building APIs with tRPC on AWS easy by providing two main generators:

- [`ts#trpc-api`](#trpc-api) - Generates the backend code to implement a tRPC API as well as infrastructure to deploy it with API Gateway
- [`api-connection`](#api-connection-trpc-react) - Supports integrating a tRPC API with a React website

## tRPC API

The tRPC API generator creates a new tRPC API with AWS CDK infrastructure setup. The generated backend uses AWS Lambda for serverless deployment and includes schema validation using [Zod](https://zod.dev/). It sets up [AWS Lambda Powertools](https://docs.powertools.aws.dev/lambda/typescript/latest/) for observability, including logging, AWS X-Ray tracing and Cloudwatch Metrics.

### Generating a new tRPC API

You can generate a new tRPC API in two ways:

#### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then generate your API:

1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "ts#trpc-api"
4. Fill in the required parameters in the form
5. Click "Run"

#### 2. Using CLI

Generate the API:

```bash
nx g @aws/nx-plugin:ts#trpc-api my-api --directory=apps/api
```

You can also perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:ts#trpc-api my-api --directory=apps/api --dry-run
```

Both methods will create a new tRPC backend API in the specified directory with all the necessary configuration and infrastructure code.

#### Input Parameters

| Parameter | Type   | Default    | Description                                                                  |
| --------- | ------ | ---------- | ---------------------------------------------------------------------------- |
| apiName\* | string | -          | The name of the API (required). Used to generate class names and file paths. |
| directory | string | "packages" | The directory to store the application in.                                   |

\*Required parameter

### Implementing your tRPC API

The generator will create the following project structure in the `<directory>/<api-name>` directory:

```
<directory>/<api-name>/
├── schema/
│   ├── src/
│   │   ├── index.ts           # Schema entrypoint
│   │   └── procedures/
│   │       └── echo.ts      # Shared schema definitions for the "echo" procedure using Zod
│   ├── tsconfig.json        # TypeScript configuration
│   └── project.json        # Project configuration and build targets
│
└── backend/
    ├── src/
    │   ├── init.ts           # Backend trpc initialisation
    │   ├── router.ts         # tRPC router definition (Lambda handler API entrypoint)
    │   ├── local-server.ts   # tRPC standalone adapter entrypoint for local dev server
    │   ├── client/
    │   │   └── index.ts       # Type-safe client for machine to machine API calls
    │   ├── procedures/       # Procedures (or operations) exposed by your API
    │   │   └── echo.ts       # Echo procedure
    │   └── middleware/
    │       ├── error.ts      # Middleware for error handling
    │       ├── logger.ts      # Middleware for configuring AWS Powertools for Lambda logging
    │       ├── tracer.ts      # Middleware for configuring AWS Powertools for Lambda tracing
    │       └── metrics.ts      # Middleware for configuring AWS Powertools for Lambda metrics
    ├── tsconfig.json        # TypeScript configuration
    └── project.json        # Project configuration and build targets
```

#### Schema

The schema package defines the types that are shared between your client and server code. In this package, these types are defined using [Zod](https://zod.dev/), a TypeScript-first schema declaration and validation library.

An example schema might look as follows:

```ts
import { z } from 'zod';

// Schema definition
export const UserSchema = z.object({
  name: z.string(),
  height: z.number(),
  dateOfBirth: z.string().datetime(),
});

// Corresponding TypeScript type
export type User = z.TypeOf<typeof UserSchema>;
```

Given the above schema, the `User` type is equivalent to the following TypeScript:

```ts
interface User {
  name: string;
  height: number;
  dateOfBirth: string;
}
```

Schemas are shared by both server and client code, providing a single place to update when making changes to the structures used in your API.

Schemas are automatically validated by your tRPC API at runtime, which saves hand-crafting custom validation logic in your backend.

Zod provides powerful utilities to combine or derive schemas such as `.merge`, `.pick`, `.omit` and more. You can find more information on the [Zod documentation website](https://zod.dev/?id=basic-usage).

#### Server Code

The nested `backend` folder contains your API implementation, where you define your API operations and their input, output and implementation.

You can find the entry point to your api in `src/router.ts`. This file contains the lambda handler which routes requests to "procedures" based on the operation being invoked. Each procedure defines the expected input, output, and implementation.

The sample router generated for you has a single operation, called `echo`:

```ts
import { echo } from './procedures/echo.js';

export const appRouter = router({
  echo,
});
```

The example `echo` procedure is generated for you in `src/procedures/echo.ts`:

```ts
export const echo = publicProcedure
  .input(EchoInputSchema)
  .output(EchoOutputSchema)
  .query((opts) => ({ result: opts.input.message }));
```

To break down the above:

- `publicProcedure` defines a public method on the API, including the middleware set up in `src/middleware`. This middleware includes AWS Lambda Powertools integration for logging, tracing and metrics.
- `input` accepts a Zod schema which defines the expected input for the operation. Requests sent for this operation are automatically validated against this schema.
- `output` accepts a Zod schema which defines the expected output for the operation. You will see type errors in your implementation if you don't return an output which conforms to the schema.
- `query` accepts a function which defines the implementation for your API. This implementation receives `opts`, which contains the `input` passed to your operation, as well as other context set up by middleware, available in `opts.ctx`. The function passed to `query` must return an output which conforms to the `output` schema.

The use of `query` to define the implementation indicates that the operation is not mutative. Use this to define methods to retrieve data. To implement a mutative operation, use the `mutation` method instead.

If you add a new operation, make sure you register it by adding it to the router in `src/router.ts`.

##### Errors

In your implementation, you can return error responses to clients by throwing a `TRPCError`. These accept a `code` which indicates the type of error, for example:

```ts
throw new TRPCError({
  code: 'NOT_FOUND',
  message: 'The requested resource could not be found',
});
```

##### Organising Your Operations

As your API grows, you may wish to group related operations together.

You can group operations together using nested routers, for example:

```ts
import { getUser } from './procedures/users/get.js';
import { listUsers } from './procedures/users/list.js';

const appRouter = router({
   users: router({
      get: getUser,
      list: listUsers,
   }),
   ...
})
```

Clients then receive this grouping of operations, for example invoking the `listUsers` operation in this case might look as follows:

```ts
client.users.list.query();
```

##### Logging

The AWS Lambda Powertools logger is configured in `src/middleware/logger.ts`, and can be accessed in an API implementation via `opts.ctx.logger`. You can use this to log to CloudWatch Logs, and/or control additional values to include in every structured log message. For example:

```ts
export const echo = publicProcedure
   .input(...)
   .output(...)
   .query(async (opts) => {
      opts.ctx.logger.info('Operation called with input', opts.input);

      return ...;
   });
```

For more information about the logger, please refer to the [AWS Lambda Powertools Logger documentation](https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger/).

##### Recording Metrics

AWS Lambda Powertools metrics are configured in `src/middleware/metrics.ts`, and can be accessed in an API implementation via `opts.ctx.metrics`. You can use this to record metrics in CloudWatch without the need to import and use the AWS SDK, for example:

```ts
export const echo = publicProcedure
   .input(...)
   .output(...)
   .query(async (opts) => {
      opts.ctx.metrics.addMetric('Invocations', 'Count', 1);

      return ...;
   });
```

For more information, please refer to the [AWS Lambda Powertools Metrics documentation](https://docs.powertools.aws.dev/lambda/typescript/latest/core/metrics/).

##### Fine-tuning X-Ray Tracing

The AWS Lambda Powertools tracer is configured in `src/middleware/tracer.ts`, and can be accessed in an API implementation via `opts.ctx.tracer`. You can use this to add traces with AWS X-Ray to provide detailed insights into the performance and flow of API requests. For example:

```ts
export const echo = publicProcedure
   .input(...)
   .output(...)
   .query(async (opts) => {
      const subSegment = opts.ctx.tracer.getSegment()!.addNewSubsegment('MyAlgorithm');
      // ... my algorithm logic to capture
      subSegment.close();

      return ...;
   });
```

For more information, please refer to the [AWS Lambda Powertools Tracer documentation](https://docs.powertools.aws.dev/lambda/typescript/latest/core/tracer/).

##### Implementing Custom Middleware

You can add additional values to the context provided to procedures by implementing middleware.

As an example, let's implement some middlware to extract some details about the calling user from our API in `src/middleware/identity.ts`.

First, we define what we'll add to the context:

```ts
export interface IIdentityContext {
  identity?: {
    sub: string;
    username: string;
  };
}
```

Note that we define an additional _optional_ property to the context. tRPC manages ensuring that this is defined in procedures which have correctly configured this middleware.

Next, we'll implement the middlware itself. This has the following structure:

```ts
export const createIdentityPlugin = () => {
   const t = initTRPC.context<IIdentityContext>().create();
   return t.procedure.use(async (opts) => {
      // Add logic here to run before the procedure

      const response = await opts.next(...);

      // Add logic here to run after the procedure

      return response;
   });
};
```

In our case, we want to extract details about the calling Cognito user. We'll do that by extracting the user's subject ID (or "sub") from the API gateway event, and retrieving user details from Cognito:

```ts
import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';

export const createIdentityPlugin = () => {
  const t = initTRPC.context<IIdentityContext>().create();

  const cognito = new CognitoIdentityProvider();

  return t.procedure.use(async (opts) => {
    const cognitoIdentity = opts.ctx.event.requestContext?.authorizer?.iam?.cognitoIdentity as unknown as
      | {
          amr: string[];
        }
      | undefined;

    const sub = (cognitoIdentity?.amr ?? [])
      .flatMap((s) => (s.includes(':CognitoSignIn:') ? [s] : []))
      .map((s) => {
        const parts = s.split(':');
        return parts[parts.length - 1];
      })?.[0];

    if (!sub) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Unable to determine calling user`,
      });
    }

    const { Users } = await cognito.listUsers({
      // Assumes user pool id is configured in lambda environment
      UserPoolId: process.env.USER_POOL_ID!,
      Limit: 1,
      Filter: `sub="${sub}"`,
    });

    if (!Users || Users.length !== 1) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `No user found with subjectId ${sub}`,
      });
    }

    // Provide the identity to other procedures in the context
    return await opts.next({
      ctx: {
        ...opts.ctx,
        identity: {
          sub,
          username: Users[0].Username!,
        },
      },
    });
  });
};
```

### Deploying your tRPC API

The tRPC backend generator generates a CDK construct for deploying your API in the `common/constructs` folder. You can consume this in a CDK application, for example:

```ts
import { MyApi } from ':my-scope/common-constructs`;

export class ExampleStack extends Stack {
   constructor(scope: Construct, id: string) {
      // Add the api to your stack
      const api = new MyApi(this, 'MyApi');
   }
}
```

This sets up your API infrastructure, including an AWS API Gateway HTTP API, AWS Lambda function for business logic, and IAM authentication.

#### Granting Access

You can use the `grantInvokeAccess` method to grant access to your API, for example you might wish to grant authenticated Cognito users access to your API:

```ts
api.grantInvokeAccess(myIdentityPool.authenticatedRole);
```

### Local tRPC Server

You can use the `serve` target to run a local server for your api, for example:

```
nx run @my-scope/my-api-backend:serve
```

The entry point for the local server is `src/local-server.ts`.

### Invoking your tRPC API

You can create a tRPC client to invoke your API in a type-safe manner. If you are calling your tRPC API from another backend, you can use the client in `src/client/index.ts`, for example:

```ts
import { createMyApiClient } from ':my-scope/my-api-backend';

const client = createMyApiClient({ url: 'https://my-api-url.example.com/' });

await client.echo.query({ message: 'Hello world!' });
```

If you are calling your API from a React website, consider using the [API Connection](#api-connection-trpc-react) generator to configure the client.

## API Connection: tRPC React

AWS Plugin for Nx provides a generator to quickly integrate your tRPC API with a React website. It sets up all necessary configuration for connecting to your tRPC backends, including AWS IAM authentication support and proper error handling. The integration provides full end-to-end type safety between your frontend and tRPC backend(s).

### Prerequisites

Before using this generator, ensure your React application has:

1. A `main.tsx` file that renders your application
2. An `<App/>` JSX element where the tRPC provider will be automatically injected
3. A working tRPC backend (generated using the tRPC backend generator)

Example of required `main.tsx` structure:

```tsx
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './app/app';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### Usage

You can generate the tRPC React integration in two ways:

#### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then add tRPC to your React application:

1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "api-connection"
4. Fill in the required parameters in the form
5. Click "Run"

#### 2. Using CLI

Add tRPC to your React application:

```bash
nx g @aws/nx-plugin:api-connection --sourceProject=my-app --targetProject=my-api --auth=IAM
```

You can also perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:api-connection --sourceProject=my-app --targetProject=my-api --auth=IAM --dry-run
```

Both methods will add tRPC client integration to your React application with all the necessary configuration.

### Input Parameters

| Parameter       | Type   | Default | Description                                            |
| --------------- | ------ | ------- | ------------------------------------------------------ |
| sourceProject\* | string | -       | The name of your React application project (required). |
| targetProject\* | string | -       | The name of your tRPC backend project (required).      |
| auth\*          | string | "IAM"   | Authentication strategy. Options: "IAM", "None"        |

\*Required parameter

### Expected Output

The generator creates the following structure in your React application:

```
src/
├── components/
│   └── TrpcClients/
│       └── index.tsx
│       └── IsolatedTrpcProvider.tsx  # Supports add connections to multiple tRPC APIs
│       └── TrpcApis.tsx              # Object containing all of your trpc API connections
│       └── TrpcClientProviders.tsx   # Sets up the trpc clients and bindings to your backend schema(s)
└── hooks/
    └── useSigV4.tsx                  # Custom hook for signing HTTP(s) requests with SigV4 (IAM only)
    └── use<ApiName>.tsx              # Adds a hook for the given backend API. ApiName will resolve to the name of the api.
```

Additionally, it:

1. Installs required dependencies:
   - @trpc/client
   - @trpc/tanstack-react-query
   - @tanstack/react-query
   - aws4fetch (if using IAM auth)

### Using the Generated Code

#### Using the tRPC Hook

The generator provides a `use<ApiName>` hook that gives you access to the type-safe tRPC client:

```tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { useMyApi } from './hooks/useMyApi';

function MyComponent() {
  const trpc = useMyApi();

  // Example query
  const { data, isLoading, error } = useQuery(trpc.users.list.queryOptions());

  // Example mutation
  const mutation = useMutation(trpc.users.create.mutationOptions());

  const handleCreate = () => {
    mutation.mutate({
      name: 'John Doe',
      email: 'john@example.com',
    });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <ul>
      {data.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

#### Error Handling

The integration includes built-in error handling that properly processes tRPC errors:

```tsx
function MyComponent() {
  const trpc = useMyApi();

  const { data, error } = useQuery(trpc.users.list.queryOptions());

  if (error) {
    return (
      <div>
        <h2>Error occurred:</h2>
        <p>{error.message}</p>
        {error.data?.code && <p>Code: {error.data.code}</p>}
      </div>
    );
  }

  return (
    <ul>
      {data.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

### Best Practices

#### 1. Handle Loading States

Always handle loading and error states for a better user experience:

```tsx
function UserList() {
  const trpc = useMyApi();

  const users = useQuery(trpc.users.list.queryOptions());

  if (users.isLoading) {
    return <LoadingSpinner />;
  }

  if (users.error) {
    return <ErrorMessage error={users.error} />;
  }

  return (
    <ul>
      {users.data.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

#### 2. Optimistic Updates

Use optimistic updates for a better user experience:

```tsx
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';

function UserList() {
  const trpc = useMyApi();
  const users = useQuery(trpc.users.list.queryOptions());
  const queryClient = useQueryClient();

  const deleteMutation = useMutation(
    trpc.users.delete.mutationOptions({
      onMutate: async (userId) => {
        // Cancel outgoing fetches
        await queryClient.cancelQueries(trpc.users.list.queryFilter());

        // Get snapshot of current data
        const previousUsers = queryClient.getQueryData(trpc.users.list.queryKey());

        // Optimistically remove the user
        queryClient.setQueryData(trpc.users.list.queryKey(), (old) => old?.filter((user) => user.id !== userId));

        return { previousUsers };
      },
      onError: (err, userId, context) => {
        // Restore previous data on error
        queryClient.setQueryData(trpc.users.list.queryKey(), context?.previousUsers);
      },
    }),
  );

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>
          {user.name}
          <button onClick={() => deleteMutation.mutate(user.id)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
```

#### 3. Prefetching Data

Prefetch data for better performance:

```tsx
function UserList() {
  const trpc = useMyApi();
  const users = useQuery(trpc.users.list.queryOptions());
  const queryClient = useQueryClient();

  // Prefetch user details on hover
  const prefetchUser = async (userId: string) => {
    await queryClient.prefetchQuery(trpc.users.getById.queryOptions(userId));
  };

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id} onMouseEnter={() => prefetchUser(user.id)}>
          <Link to={`/users/${user.id}`}>{user.name}</Link>
        </li>
      ))}
    </ul>
  );
}
```

#### 4. Infinite Queries

Handle pagination with infinite queries:

```tsx
function UserList() {
  const trpc = useMyApi();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    trpc.users.list.infiniteQueryOptions(
      { limit: 10 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  return (
    <div>
      {data?.pages.map((page) => page.users.map((user) => <UserCard key={user.id} user={user} />))}

      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

It is important to note that infinite queries can only be used for procedures with an input property named `cursor`.

### Type Safety

The integration provides complete end-to-end type safety. Your IDE will provide full autocompletion and type checking for all your API calls:

```tsx
function UserForm() {
  const trpc = useMyApi();

  // ✅ Input is fully typed
  const createUser = trpc.users.create.useMutation();

  const handleSubmit = (data: CreateUserInput) => {
    // ✅ Type error if input doesn't match schema
    createUser.mutate(data);
  };

  return <form onSubmit={handleSubmit}>{/* ... */}</form>;
}
```

The types are automatically inferred from your backend's router and schema definitions, ensuring that any changes to your API are immediately reflected in your frontend code without the need to build.

### More Information

For more information, please refer to the [tRPC TanStack React Query documentation](https://trpc.io/docs/client/tanstack-react-query/usage).
