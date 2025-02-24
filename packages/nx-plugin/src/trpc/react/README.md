# tRPC React Generator

## Overview

This generator adds tRPC client integration to your React application, enabling type-safe API calls to your tRPC backend. It sets up all necessary configuration for connecting to your tRPC backends, including AWS IAM authentication support and proper error handling. The integration provides full end-to-end type safety between your frontend and tRPC backend(s).

## Prerequisites

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

## Usage

You can generate the tRPC React integration in two ways:

### 1. Using VSCode IDE

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

### 2. Using CLI

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

## Expected Output

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

## Using the Generated Code

### Using the tRPC Hook

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

### Error Handling

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

## Best Practices

### 1. Handle Loading States

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

### 2. Optimistic Updates

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

### 3. Prefetching Data

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

### 4. Infinite Queries

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

## Type Safety

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

## More Information

For more information, please refer to the [tRPC TanStack React Query documentation](https://trpc.io/docs/client/tanstack-react-query/usage).
