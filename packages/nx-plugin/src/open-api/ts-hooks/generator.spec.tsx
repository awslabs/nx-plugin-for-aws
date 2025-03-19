/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { openApiTsHooksGenerator } from './generator';
import { expectTypeScriptToCompile } from '../ts-client/generator.utils.spec';
import { importTypeScriptModule } from '../../utils/js';
import { waitFor, render, fireEvent } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useInfiniteQuery,
  UseQueryResult,
  UseInfiniteQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import React from 'react';
import { Mock } from 'vitest';

describe('openApiTsHooksGenerator', () => {
  let tree: Tree;
  const title = 'TestApi';
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths, ['@tanstack/react-query']);
  };

  // Helper function to create a wrapper component with QueryClientProvider
  const createWrapper = () => {
    // Create a new QueryClient for testing
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    });

    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  // Helper function to configure the options proxy
  const configureOptionsProxy = async (
    clientModule: string,
    optionsProxyModule: string,
    mockFetch: Mock<any, any>,
  ) => {
    // Dynamically import the generated modules
    const { TestApi } = await importTypeScriptModule<any>(clientModule);
    const { TestApiOptionsProxy } =
      await importTypeScriptModule<any>(optionsProxyModule);

    // Create client instance with mock fetch
    const apiClient = new TestApi({ url: baseUrl, fetch: mockFetch });

    // Create options proxy with the client
    const optionsProxyInstance = new TestApiOptionsProxy({ client: apiClient });

    return optionsProxyInstance;
  };

  // Helper function to test a query hook
  const renderQueryHook = async (
    hookOptions: any,
  ): Promise<{
    getLatestHookState: () => UseQueryResult<any>;
    getHookStates: () => UseQueryResult<any>[];
  }> => {
    const Wrapper = createWrapper();

    // Track the state of the hook on every render
    const states: UseQueryResult<any>[] = [];

    // Component that uses the query hook
    const Component = () => {
      const query = useQuery(hookOptions);
      states.push(query);
      return <div>Query Component</div>;
    };

    render(
      <Wrapper>
        <Component />
      </Wrapper>,
    );

    // Wait for the query to reach a terminal state (success or error)
    await waitFor(() =>
      expect(states[states.length - 1].isLoading).toBe(false),
    );

    return {
      // Return the latest state
      getLatestHookState: () => states[states.length - 1],
      getHookStates: () => states,
    };
  };

  // Helper function to test a mutation hook
  const renderMutationHook = async (
    hookOptions: any,
    inputData: any,
  ): Promise<{
    getLatestHookState: () => UseMutationResult<any>;
  }> => {
    const Wrapper = createWrapper();

    // Track the state of the hook on every render
    const states: UseMutationResult<any>[] = [];

    // Component that uses the mutation hook
    const Component = () => {
      const mutation = useMutation(hookOptions);
      states.push(mutation);

      return (
        <div>
          <button onClick={() => mutation.mutate(inputData)}>Mutate</button>
        </div>
      );
    };

    const rendered = render(
      <Wrapper>
        <Component />
      </Wrapper>,
    );

    // Execute the mutation
    fireEvent.click(rendered.getByText('Mutate'));

    // Wait for the mutation to reach a terminal state (success or error)
    await waitFor(() =>
      expect(states[states.length - 1].isPending).toBe(false),
    );

    return {
      // Return the latest state
      getLatestHookState: () => states[states.length - 1],
    };
  };

  // Helper function to test an infinite query hook
  const renderInfiniteQueryHook = async (
    hookOptions: any,
  ): Promise<{
    getLatestHookState: () => UseInfiniteQueryResult<any>;
    fetchNextPage: () => void;
  }> => {
    const Wrapper = createWrapper();

    // Track the state of the hook on every render
    const states: UseInfiniteQueryResult<any>[] = [];

    const Component = () => {
      const query = useInfiniteQuery(hookOptions);
      states.push(query);

      return (
        <div>
          <button onClick={() => query.fetchNextPage()}>Next Page</button>
        </div>
      );
    };

    const rendered = render(
      <Wrapper>
        <Component />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(states[states.length - 1].isLoading).toBe(false),
    );

    return {
      // Return the latest state
      getLatestHookState: () => states[states.length - 1],
      fetchNextPage: () => {
        fireEvent.click(rendered.getByText('Next Page'));
      },
    };
  };

  it('should generate an options proxy for a query operation', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            description: 'Sends a test request!',
            responses: {
              '200': {
                description: 'getTest',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        string: { type: 'string' },
                        number: { type: 'number' },
                        integer: { type: 'integer' },
                        boolean: { type: 'boolean' },
                        'nullable-string': { type: 'string', nullable: true },
                        optionalNumber: { type: 'number' },
                      },
                      required: ['string', 'number', 'integer', 'boolean'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        string: 'str',
        number: 42.3,
        integer: 33,
        boolean: true,
        'nullable-string': null,
      }),
    });

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the root queryKey method
    const rootQueryKey = optionsProxyInstance.queryKey();
    expect(rootQueryKey).toEqual(['TestApi']);

    // Test the operation-specific queryKey method
    const operationQueryKey = optionsProxyInstance.getTest.queryKey();
    expect(operationQueryKey).toEqual(['TestApi', 'getTest']);

    // Test the queryFilter method
    const queryFilter = optionsProxyInstance.getTest.queryFilter();
    expect(queryFilter.queryKey).toEqual(['TestApi', 'getTest']);

    // Test queryFilter with additional options
    const extendedFilter = optionsProxyInstance.getTest.queryFilter({
      exact: true,
    });
    expect(extendedFilter).toEqual({
      queryKey: ['TestApi', 'getTest'],
      exact: true,
    });

    // Test the query hook
    const { getLatestHookState } = await renderQueryHook(
      optionsProxyInstance.getTest.queryOptions(),
    );

    // Verify the data is correct
    expect(getLatestHookState().data).toEqual({
      string: 'str',
      number: 42.3,
      integer: 33,
      boolean: true,
      nullableString: null,
    });

    // Verify the fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should generate an options proxy for a mutation operation', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            description: 'Creates a new user',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      email: { type: 'string' },
                      age: { type: 'integer' },
                    },
                    required: ['name', 'email'],
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'User created successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        age: { type: 'integer' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                      required: ['id', 'name', 'email', 'createdAt'],
                    },
                  },
                },
              },
              '400': {
                description: 'Bad request',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                      },
                      required: ['error'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 201,
      json: vi.fn().mockResolvedValue({
        id: '123',
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        createdAt: '2023-01-01T12:00:00Z',
      }),
    });

    // Prepare test data
    const userData = {
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    };

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the mutation hook
    const { getLatestHookState } = await renderMutationHook(
      optionsProxyInstance.createUser.mutationOptions(),
      userData,
    );

    // Verify the data is correct
    expect(getLatestHookState().data).toEqual({
      id: '123',
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
      createdAt: new Date('2023-01-01T12:00:00Z'),
    });

    // Verify the fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/users`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(userData),
      }),
    );
  });

  it('should handle query errors correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/error': {
          get: {
            operationId: 'getError',
            description: 'Returns an error',
            responses: {
              '200': {
                description: 'Success response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        message: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '400': {
                description: 'Error response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                      },
                      required: ['error'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function that returns an error
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Bad request',
      }),
    });

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the query hook
    const { getLatestHookState } = await renderQueryHook(
      optionsProxyInstance.getError.queryOptions(),
    );

    // Verify the error state
    expect(getLatestHookState().isError).toBe(true);
    expect(getLatestHookState().error).toBeDefined();
    expect(getLatestHookState().error).toMatchObject({
      status: 400,
      error: { error: 'Bad request' },
    });

    // Verify the fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/error`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle mutation errors correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            description: 'Creates a new user',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                    required: ['name', 'email'],
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'User created successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '400': {
                description: 'Bad request',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                      },
                      required: ['error'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function that returns an error
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Invalid email format',
      }),
    });

    // Prepare test data
    const userData = {
      name: 'John Doe',
      email: 'invalid-email',
    };

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the mutation hook
    const { getLatestHookState } = await renderMutationHook(
      optionsProxyInstance.createUser.mutationOptions(),
      userData,
    );

    // Verify the error state
    expect(getLatestHookState().isError).toBe(true);
    expect(getLatestHookState().error).toBeDefined();
    expect(getLatestHookState().error).toMatchObject({
      status: 400,
      error: { error: 'Invalid email format' },
    });

    // Verify the fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/users`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(userData),
      }),
    );
  });

  it('should generate an options proxy for a successful infinite query operation', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'getItems',
            description: 'Gets a paginated list of items',
            parameters: [
              {
                name: 'cursor',
                in: 'query',
                description: 'Pagination cursor',
                required: false,
                schema: {
                  type: 'string',
                },
              },
              {
                name: 'limit',
                in: 'query',
                description: 'Number of items to return',
                required: false,
                schema: {
                  type: 'integer',
                  default: 10,
                },
              },
            ],
            responses: {
              '200': {
                description: 'List of items',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                              description: { type: 'string' },
                            },
                            required: ['id', 'name'],
                          },
                        },
                        nextCursor: {
                          type: 'string',
                        },
                      },
                      required: ['items'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function for first page
    const mockFetch = vi.fn();

    // First call returns first page
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue({
        items: [
          { id: '1', name: 'Item 1', description: 'First item' },
          { id: '2', name: 'Item 2', description: 'Second item' },
        ],
        nextCursor: 'next-page-cursor',
      }),
    });

    // Second call returns second page
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        items: [
          { id: '3', name: 'Item 3', description: 'Third item' },
          { id: '4', name: 'Item 4', description: 'Fourth item' },
        ],
      }),
    });

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the root queryKey method
    const rootQueryKey = optionsProxyInstance.queryKey();
    expect(rootQueryKey).toEqual(['TestApi']);

    // Test the operation-specific queryKey method
    const operationQueryKey = optionsProxyInstance.getItems.queryKey({});
    expect(operationQueryKey).toEqual(['TestApi', 'getItems', {}]);

    // Test the queryFilter method
    const queryFilter = optionsProxyInstance.getItems.queryFilter({});
    expect(queryFilter.queryKey).toEqual(['TestApi', 'getItems', {}]);

    const extendedFilter = optionsProxyInstance.getItems.queryFilter(
      {},
      { exact: true },
    );
    expect(extendedFilter).toEqual({
      queryKey: ['TestApi', 'getItems', {}],
      exact: true,
    });

    // Test with parameters
    const withParams = optionsProxyInstance.getItems.queryKey({
      cursor: 'test-cursor',
      limit: 20,
    });
    expect(withParams).toEqual([
      'TestApi',
      'getItems',
      { cursor: 'test-cursor', limit: 20 },
    ]);

    const { getLatestHookState: infiniteQuery, fetchNextPage } =
      await renderInfiniteQueryHook(
        optionsProxyInstance.getItems.infiniteQueryOptions(
          {},
          {
            getNextPageParam: (lastPage) => lastPage.nextCursor,
          },
        ),
      );

    // Verify the first page data is correct
    expect(infiniteQuery().data.pages).toHaveLength(1);
    expect(infiniteQuery().data.pages[0]).toEqual({
      items: [
        { id: '1', name: 'Item 1', description: 'First item' },
        { id: '2', name: 'Item 2', description: 'Second item' },
      ],
      nextCursor: 'next-page-cursor',
    });

    // Verify the fetch was called correctly for the first page
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/items`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    fetchNextPage();

    // Verify both pages are now available
    await waitFor(() => expect(infiniteQuery().data.pages).toHaveLength(2));
    expect(infiniteQuery().data.pages[1]).toEqual({
      items: [
        { id: '3', name: 'Item 3', description: 'Third item' },
        { id: '4', name: 'Item 4', description: 'Fourth item' },
      ],
    });
    // Verify there are no more pages as nextCursor is undefined
    expect(infiniteQuery().hasNextPage).toBe(false);

    // Verify the fetch was called correctly for the second page with the cursor
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/items?cursor=next-page-cursor`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle GET operation with x-mutation: true correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/actions/trigger': {
          get: {
            ...{
              'x-mutation': true,
            },
            operationId: 'triggerAction',
            description: 'Triggers an action via GET',
            parameters: [
              {
                name: 'actionId',
                in: 'query',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Action triggered successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        actionId: { type: 'string' },
                      },
                      required: ['success', 'actionId'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      vi.fn(),
    );

    // Verify that the operation has mutationKey and mutationOptions methods (not queryKey/queryOptions)
    expect(optionsProxyInstance.triggerAction.mutationKey).toBeDefined();
    expect(optionsProxyInstance.triggerAction.mutationOptions).toBeDefined();
    expect(optionsProxyInstance.triggerAction.queryKey).toBeUndefined();
    expect(optionsProxyInstance.triggerAction.queryOptions).toBeUndefined();

    // Test the mutation key
    const mutationKey = optionsProxyInstance.triggerAction.mutationKey();
    expect(mutationKey).toEqual(['TestApi', 'triggerAction']);
  });

  it('should handle POST operation with x-query: true correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/data/search': {
          post: {
            ...{
              'x-query': true,
            },
            operationId: 'searchData',
            description: 'Search data via POST',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string' },
                    },
                    required: ['query'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Search results',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        results: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              title: { type: 'string' },
                            },
                            required: ['id', 'title'],
                          },
                        },
                        total: { type: 'integer' },
                      },
                      required: ['results', 'total'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      vi.fn(),
    );

    // Verify that the operation has queryKey and queryOptions methods (not mutationKey/mutationOptions)
    expect(optionsProxyInstance.searchData.queryKey).toBeDefined();
    expect(optionsProxyInstance.searchData.queryOptions).toBeDefined();
    expect(optionsProxyInstance.searchData.queryFilter).toBeDefined();
    expect(optionsProxyInstance.searchData.mutationKey).toBeUndefined();
    expect(optionsProxyInstance.searchData.mutationOptions).toBeUndefined();
  });

  it('should handle infinite query with custom cursor parameter', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/records': {
          get: {
            ...{
              'x-cursor': 'nextToken',
            },
            operationId: 'listRecords',
            description: 'Lists records with nextToken pagination',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                description: 'Number of records to return',
                required: false,
                schema: {
                  type: 'integer',
                  default: 10,
                },
              },
              {
                name: 'nextToken',
                in: 'query',
                description: 'Pagination token',
                required: false,
                schema: {
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                description: 'List of records',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        records: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                              value: { type: 'number' },
                            },
                            required: ['id', 'name'],
                          },
                        },
                        nextToken: {
                          type: 'string',
                        },
                      },
                      required: ['records'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function for first page
    const mockFetch = vi.fn();

    // First call returns first page
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue({
        records: [
          { id: '1', name: 'Record 1', value: 100 },
          { id: '2', name: 'Record 2', value: 200 },
        ],
        nextToken: 'next-page-token',
      }),
    });

    // Second call returns second page
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        records: [
          { id: '3', name: 'Record 3', value: 300 },
          { id: '4', name: 'Record 4', value: 400 },
        ],
        // No nextToken in the response means end of pagination
      }),
    });

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the infinite query hook
    const { getLatestHookState: infiniteQuery, fetchNextPage } =
      await renderInfiniteQueryHook(
        optionsProxyInstance.listRecords.infiniteQueryOptions(
          {},
          {
            getNextPageParam: (lastPage) => lastPage.nextToken,
          },
        ),
      );

    // Verify the first page data is correct
    expect(infiniteQuery().data.pages).toHaveLength(1);
    expect(infiniteQuery().data.pages[0]).toEqual({
      records: [
        { id: '1', name: 'Record 1', value: 100 },
        { id: '2', name: 'Record 2', value: 200 },
      ],
      nextToken: 'next-page-token',
    });

    // Verify the fetch was called correctly for the first page
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/records`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    fetchNextPage();

    // Verify both pages are now available
    await waitFor(() => expect(infiniteQuery().data.pages).toHaveLength(2));
    expect(infiniteQuery().data.pages[1]).toEqual({
      records: [
        { id: '3', name: 'Record 3', value: 300 },
        { id: '4', name: 'Record 4', value: 400 },
      ],
    });

    // Verify there are no more pages as nextToken is undefined
    expect(infiniteQuery().hasNextPage).toBe(false);

    // Verify the fetch was called correctly for the second page with the nextToken
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/records?nextToken=next-page-token`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle streaming query operation correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/events/stream': {
          get: {
            ...{
              'x-streaming': true,
            },
            operationId: 'streamEvents',
            description: 'Streams events as they occur',
            parameters: [
              {
                name: 'type',
                in: 'query',
                description: 'Event type filter',
                required: false,
                schema: {
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                description: 'Stream of events',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        type: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                        data: {
                          type: 'object',
                          properties: {
                            value: {
                              type: 'integer',
                            },
                          },
                        },
                      },
                      required: ['id', 'type', 'timestamp'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create a mock async iterable for streaming events
    const mockEvents = [
      {
        id: '1',
        type: 'update',
        timestamp: '2023-01-01T12:00:00Z',
        data: { value: 10 },
      },
      {
        id: '2',
        type: 'update',
        timestamp: '2023-01-01T12:01:00Z',
        data: { value: 20 },
      },
      {
        id: '3',
        type: 'update',
        timestamp: '2023-01-01T12:02:00Z',
        data: { value: 30 },
      },
    ];

    // Create mock fetch function that returns an async iterable
    const mockFetch = vi.fn();
    const mockClient = {
      streamEvents: vi.fn().mockImplementation(async function* () {
        for (const event of mockEvents) {
          // Add a delay to ensure there's time for a rerender after each event
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield event;
        }
      }),
    };

    // Configure the options proxy with our mock client
    const { TestApiOptionsProxy } =
      await importTypeScriptModule<any>(optionsProxy);
    const optionsProxyInstance = new TestApiOptionsProxy({
      client: mockClient,
    });

    // Create a mock QueryClient for testing
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    // Test the query hook
    const { getLatestHookState, getHookStates: getStates } =
      await renderQueryHook(
        optionsProxyInstance.streamEvents.queryOptions(
          { type: 'update' },
          { client: queryClient },
        ),
      );

    // Verify the data contains all streamed events
    await waitFor(() => expect(getLatestHookState().data).toEqual(mockEvents));

    // Check that we had individual state updates for each streamed element
    const states = getStates();

    // We should have at least initial loading state + one state per event
    expect(states.length).toBeGreaterThan(mockEvents.length);

    // Find the first success state (after loading)
    const successStates = states.filter((state) => state.isSuccess);
    expect(successStates.length).toBeGreaterThanOrEqual(mockEvents.length);

    // Verify that we got incremental updates
    for (
      let i = 0;
      i < Math.min(mockEvents.length, successStates.length);
      i++
    ) {
      // Each state should have the events up to that point
      expect(successStates[i].data).toEqual(mockEvents.slice(0, i + 1));
    }

    // Verify the client method was called correctly
    expect(mockClient.streamEvents).toHaveBeenCalledWith({ type: 'update' });
  });

  it('should handle streaming mutation operation correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/uploads/stream': {
          post: {
            ...{
              'x-streaming': true,
            },
            operationId: 'uploadStream',
            description: 'Upload a file with streaming progress',
            requestBody: {
              required: true,
              content: {
                'application/octet-stream': {
                  schema: {
                    type: 'string',
                    format: 'binary',
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Upload progress and result',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        progress: { type: 'number' },
                        bytesUploaded: { type: 'integer' },
                        status: { type: 'string' },
                      },
                      required: ['progress', 'bytesUploaded', 'status'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create a mock async iterable for streaming upload progress
    const mockProgress = [
      { progress: 0.25, bytesUploaded: 256000, status: 'uploading' },
      { progress: 0.5, bytesUploaded: 512000, status: 'uploading' },
      { progress: 0.75, bytesUploaded: 768000, status: 'uploading' },
      { progress: 1.0, bytesUploaded: 1024000, status: 'completed' },
    ];

    // Create mock client with streaming upload method
    const mockClient = {
      uploadStream: vi.fn().mockImplementation(async function* () {
        for (const progress of mockProgress) {
          yield progress;
        }
      }),
    };

    // Configure the options proxy with our mock client
    const { TestApiOptionsProxy } =
      await importTypeScriptModule<any>(optionsProxy);
    const optionsProxyInstance = new TestApiOptionsProxy({
      client: mockClient,
    });

    // Test the mutation hook
    const fileData = new Blob([new Uint8Array(1024000)]);
    const { getLatestHookState } = await renderMutationHook(
      optionsProxyInstance.uploadStream.mutationOptions(),
      fileData,
    );

    // Verify the mutation was called with the file data
    expect(mockClient.uploadStream).toHaveBeenCalledWith(fileData);

    // Verify the mutation returns an AsyncIterableIterator
    expect(getLatestHookState().data).toBeDefined();
    expect(typeof getLatestHookState().data[Symbol.asyncIterator]).toBe(
      'function',
    );
  });

  it('should handle streaming infinite query operation correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/logs': {
          get: {
            ...{
              'x-streaming': true,
            },
            operationId: 'streamLogs',
            description: 'Stream logs with pagination',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                description: 'Number of logs to return per page',
                required: false,
                schema: {
                  type: 'integer',
                  default: 10,
                },
              },
              {
                name: 'cursor',
                in: 'query',
                description: 'Pagination token',
                required: false,
                schema: {
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                description: 'Stream of logs',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        message: { type: 'string' },
                        level: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                      required: ['id', 'message', 'level', 'timestamp'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock streaming data for first page
    const mockFirstPageLogs = [
      {
        id: '1',
        message: 'Starting application',
        level: 'info',
        timestamp: '2023-01-01T12:00:00Z',
      },
      {
        id: '2',
        message: 'Connected to database',
        level: 'info',
        timestamp: '2023-01-01T12:00:01Z',
      },
    ];

    // Create mock streaming data for second page
    const mockSecondPageLogs = [
      {
        id: '3',
        message: 'User login',
        level: 'info',
        timestamp: '2023-01-01T12:00:02Z',
      },
      {
        id: '4',
        message: 'API request received',
        level: 'debug',
        timestamp: '2023-01-01T12:00:03Z',
      },
    ];

    // Create mock client with streaming methods
    const mockClient = {
      streamLogs: vi
        .fn()
        // First call returns first page with nextToken
        .mockImplementationOnce(async function* () {
          for (const log of mockFirstPageLogs) {
            yield log;
          }
        })
        // Second call returns second page without nextToken
        .mockImplementationOnce(async function* () {
          for (const log of mockSecondPageLogs) {
            yield log;
          }
        }),
    };

    // Configure the options proxy with our mock client
    const { TestApiOptionsProxy } =
      await importTypeScriptModule<any>(optionsProxy);
    const optionsProxyInstance = new TestApiOptionsProxy({
      client: mockClient,
    });

    // Test the infinite query hook
    const { getLatestHookState: infiniteQuery, fetchNextPage } =
      await renderInfiniteQueryHook(
        optionsProxyInstance.streamLogs.infiniteQueryOptions(
          {},
          {
            getNextPageParam: (lastPage) => lastPage[lastPage.length - 1].id,
          },
        ),
      );

    // Verify the first page data is correct
    expect(infiniteQuery().data.pages).toHaveLength(1);
    expect(infiniteQuery().data.pages[0]).toEqual(mockFirstPageLogs);

    // Verify the client method was called correctly for the first page
    expect(mockClient.streamLogs).toHaveBeenCalledWith({});

    // Fetch the next page
    fetchNextPage();

    // Verify both pages are now available
    await waitFor(() => expect(infiniteQuery().data.pages).toHaveLength(2));
    expect(infiniteQuery().data.pages[1]).toEqual(mockSecondPageLogs);

    // Verify the client method was called correctly for the second page
    expect(mockClient.streamLogs).toHaveBeenCalledWith({ cursor: '2' });
  });

  it('should handle infinite query errors correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'getItems',
            description: 'Gets a paginated list of items',
            parameters: [
              {
                name: 'cursor',
                in: 'query',
                description: 'Pagination cursor',
                required: false,
                schema: {
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                description: 'List of items',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                            },
                            required: ['id', 'name'],
                          },
                        },
                        nextCursor: { type: 'string', nullable: true },
                      },
                      required: ['items'],
                    },
                  },
                },
              },
              '400': {
                description: 'Bad request',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                      },
                      required: ['error'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const optionsProxy = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );
    expect(optionsProxy).toMatchSnapshot();

    // Create mock fetch function that returns an error
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Invalid cursor format',
      }),
    });

    // Configure the options proxy
    const optionsProxyInstance = await configureOptionsProxy(
      client,
      optionsProxy,
      mockFetch,
    );

    // Test the infinite query hook with an invalid cursor
    const { getLatestHookState: infiniteQuery } = await renderInfiniteQueryHook(
      optionsProxyInstance.getItems.infiniteQueryOptions(
        {},
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
        },
      ),
    );

    // Verify the error state
    expect(infiniteQuery().isError).toBe(true);
    expect(infiniteQuery().error).toBeDefined();
    expect(infiniteQuery().error).toMatchObject({
      status: 400,
      error: { error: 'Invalid cursor format' },
    });

    // Verify the fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/items`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});
