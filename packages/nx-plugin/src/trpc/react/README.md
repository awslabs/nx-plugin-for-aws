# tRPC React Generator

## Overview

This generator adds tRPC client integration to your React application, enabling type-safe API calls to your tRPC backend. It sets up all necessary configuration for connecting to your tRPC backend, including AWS IAM authentication support, and proper error handling. The integration provides full end-to-end type safety between your frontend and backend.

## Prerequisites

Before using this generator, ensure your React application has:

- A `main.tsx` file that renders your application.
- An `<App/>` JSX element where the tRPC provider will be automatically injected.
- A working tRPC backend (generated using the tRPC backend generator).

Example of required `main.tsx` structure:

```tsx
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './app/app';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

## How to generate the tRPC React intergration

You can generate the tRPC React integration in two ways.

### Using VSCode IDE

Install the NX Console extension for VSCode:

1. Open VSCode.
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X).
3. Search for "Nx Console".
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console).

To add tRPC to your React application:

1. Open the NX Console in VSCode.
2. Choose **Generate**.
3. Search for "trpc#react"
4. Fill in the required parameters in the form, and choose **Run**.

### Using the CLI

To add tRPC to your React application:

```bash
nx g @aws/nx-plugin:trpc#react --frontendProjectName=my-app --backendProjectName=my-api --auth=IAM
```

To perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:trpc#react --frontendProjectName=my-app --backendProjectName=my-api --auth=IAM --dry-run
```

Both methods add tRPC client integration to your React application with all the necessary configuration.

## Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| frontendProjectName* | string | - | The name of your React application project (required). |
| backendProjectName* | string | - | The name of your tRPC backend project (required). |
| auth* | string | "IAM" | Authentication strategy. Options: "IAM", "None" |

*Required parameters

## Expected output

The generator creates the following structure in your React application.

```
src/
├── components/
│   └── TRPCClientProvider/
│       └── index.tsx      # tRPC client configuration and provider
└── hooks/
    └── useTrpc.tsx       # Custom hook for using tRPC client
```

Additionally, the generator installs these required dependencies:

- @trpc/client
- @trpc/react-query
- @tanstack/react-query
- aws4fetch (if using IAM auth)

## Using the generated code

### Using the tRPC hook

The generator provides a `useTrpc` hook that gives you access to the type-safe tRPC client.

```tsx
import { useTrpc } from './hooks/useTrpc';

function MyComponent() {
  const trpc = useTrpc();

  // Example query
  const { data, isLoading } = trpc.users.list.useQuery();

  // Example mutation
  const mutation = trpc.users.create.useMutation();

  const handleCreate = () => {
    mutation.mutate({
      name: 'John Doe',
      email: 'john@example.com'
    });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      {/* Your component JSX */}
    </div>
  );
}
```

### Error handling

The integration includes built-in error handling that properly processes tRPC errors.

```tsx
function MyComponent() {
  const trpc = useTrpc();

  const { data, error } = trpc.users.list.useQuery();

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
    <div>
      {/* Your component JSX */}
    </div>
  );
}
```

## Best practices

### Handle loading states

Always handle loading states for a better user experience.

```tsx
function UserList() {
  const { users } = useUsers();

  if (users.isLoading) {
    return <LoadingSpinner />;
  }

  if (users.error) {
    return <ErrorMessage error={users.error} />;
  }

  return (
    <ul>
      {users.data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

### Optimistic updates

Use optimistic updates for a better user experience.

```tsx
function UserList() {
  const trpc = useTrpc();
  const utils = trpc.useUtils();

  const deleteMutation = trpc.users.delete.useMutation({
    onMutate: async (userId) => {
      // Cancel outgoing fetches
      await utils.users.list.cancel();

      // Get snapshot of current data
      const previousUsers = utils.users.list.getData();

      // Optimistically remove the user
      utils.users.list.setData(undefined, (old) => 
        old?.filter(user => user.id !== userId)
      );

      return { previousUsers };
    },
    onError: (err, userId, context) => {
      // Restore previous data on error
      utils.users.list.setData(undefined, context?.previousUsers);
    }
  });

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          {user.name}
          <button onClick={() => deleteMutation.mutate(user.id)}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
```

### Prefetching data

Prefetch data for better performance.

```tsx
function UserList() {
  const trpc = useTrpc();

  // Prefetch user details on hover
  const prefetchUser = async (userId: string) => {
    await trpc.users.getById.usePrefetchQuery(userId);
  };

  return (
    <ul>
      {users.map(user => (
        <li 
          key={user.id}
          onMouseEnter={() => prefetchUser(user.id)}
        >
          <Link to={`/users/${user.id}`}>
            {user.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

### Infinite queries

Handle pagination with infinite queries.

```tsx
function UserList() {
  const trpc = useTrpc();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = trpc.users.list.useInfiniteQuery(
    { limit: 10 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  return (
    <div>
      {data?.pages.map((page) => (
        page.users.map(user => (
          <UserCard key={user.id} user={user} />
        ))
      ))}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

## Type Safety

The integration provides complete end-to-end type safety. Your IDE will provide full autocompletion and type checking for all your API calls:

```tsx
function UserForm() {
  const trpc = useTrpc();
  
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