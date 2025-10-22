/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { baseUrl, callGeneratedClient } from './generator.utils.spec';
import { Tree } from '@nx/devkit';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';

describe('openApiTsClientGenerator - FastAPI', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should generate valid TypeScript for FastAPI echo endpoint with validation errors', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '0.1.0' },
      components: {
        schemas: {
          EchoOutput: {
            properties: {
              message: {
                title: 'Message',
                type: 'string',
              },
            },
            required: ['message'],
            title: 'EchoOutput',
            type: 'object',
          },
          HTTPValidationError: {
            properties: {
              detail: {
                items: {
                  $ref: '#/components/schemas/ValidationError',
                },
                title: 'Detail',
                type: 'array',
              },
            },
            title: 'HTTPValidationError',
            type: 'object',
          },
          InternalServerErrorDetails: {
            properties: {
              detail: {
                title: 'Detail',
                type: 'string',
              },
            },
            required: ['detail'],
            title: 'InternalServerErrorDetails',
            type: 'object',
          },
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [
                    {
                      type: 'string',
                    },
                    {
                      type: 'integer',
                    },
                  ],
                },
                title: 'Location',
                type: 'array',
              },
              msg: {
                title: 'Message',
                type: 'string',
              },
              type: {
                title: 'Error Type',
                type: 'string',
              },
            },
            required: ['loc', 'msg', 'type'],
            title: 'ValidationError',
            type: 'object',
          },
        },
      },
      paths: {
        '/echo': {
          get: {
            operationId: 'echo',
            parameters: [
              {
                in: 'query',
                name: 'message',
                required: true,
                schema: {
                  title: 'Message',
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/EchoOutput',
                    },
                  },
                },
                description: 'Successful Response',
              },
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/HTTPValidationError',
                    },
                  },
                },
                description: 'Validation Error',
              },
              '500': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/InternalServerErrorDetails',
                    },
                  },
                },
                description: 'Internal Server Error',
              },
            },
            summary: 'Echo',
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    // Test successful response
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        message: 'Hello, World',
      }),
    });

    const response = await callGeneratedClient(client, mockFetch, 'echo', {
      message: 'Hello, World',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/echo?message=Hello%2C%20World`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual({ message: 'Hello, World' });

    // Test validation error response (422)
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 422,
      json: vi.fn().mockResolvedValue({
        detail: [
          {
            loc: ['query', 'message'],
            msg: 'field required',
            type: 'value_error.missing',
          },
        ],
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'echo', {}),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/echo`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    // Test internal server error response (500)
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 500,
      json: vi.fn().mockResolvedValue({
        detail: 'Internal server error occurred',
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'echo', { message: 'test' }),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/echo?message=test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle FastAPI validation error schemas with anyOf types', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '0.1.0' },
      components: {
        schemas: {
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [{ type: 'string' }, { type: 'integer' }],
                },
                title: 'Location',
                type: 'array',
              },
              msg: {
                title: 'Message',
                type: 'string',
              },
              type: {
                title: 'Error Type',
                type: 'string',
              },
            },
            required: ['loc', 'msg', 'type'],
            title: 'ValidationError',
            type: 'object',
          },
        },
      },
      paths: {
        '/test': {
          post: {
            operationId: 'testValidation',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      value: { type: 'integer' },
                    },
                    required: ['value'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        detail: {
                          items: {
                            $ref: '#/components/schemas/ValidationError',
                          },
                          type: 'array',
                        },
                      },
                      type: 'object',
                    },
                  },
                },
                description: 'Validation Error',
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    // Test successful request
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'testValidation',
      { value: 42 },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ value: 42 }),
      }),
    );
    expect(response).toBe('success');

    // Test validation error with mixed location types
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 422,
      json: vi.fn().mockResolvedValue({
        detail: [
          {
            loc: ['body', 'value'],
            msg: 'ensure this value is greater than 0',
            type: 'value_error.number.not_gt',
          },
          {
            loc: [0, 'nested_field'],
            msg: 'field required',
            type: 'value_error.missing',
          },
        ],
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'testValidation', { value: -1 }),
    ).rejects.toThrow();
  });

  it('should handle schemas with hyphens as generated by fastapi >=0.119.0', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: {
        title: 'TestApi',
        version: '0.1.0',
      },
      components: {
        schemas: {
          'ContentBlock-Input': {
            properties: {
              image: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ImageContent',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              text: {
                anyOf: [
                  {
                    type: 'string',
                  },
                  {
                    type: 'null',
                  },
                ],
                title: 'Text',
              },
              toolResult: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ToolResult-Input',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              toolUse: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ToolUse',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
            title: 'ContentBlock',
            type: 'object',
          },
          'ContentBlock-Output': {
            properties: {
              image: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ImageContent',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              text: {
                anyOf: [
                  {
                    type: 'string',
                  },
                  {
                    type: 'null',
                  },
                ],
                title: 'Text',
              },
              toolResult: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ToolResult-Output',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              toolUse: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ToolUse',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
            title: 'ContentBlock',
            type: 'object',
          },
          HTTPValidationError: {
            properties: {
              detail: {
                items: {
                  $ref: '#/components/schemas/ValidationError',
                },
                title: 'Detail',
                type: 'array',
              },
            },
            title: 'HTTPValidationError',
            type: 'object',
          },
          ImageContent: {
            properties: {
              format: {
                $ref: '#/components/schemas/ImageFormat',
              },
              source: {
                $ref: '#/components/schemas/ImageSource',
              },
            },
            required: ['format', 'source'],
            title: 'ImageContent',
            type: 'object',
          },
          ImageFormat: {
            description: 'Supported image formats.',
            enum: ['png', 'jpeg', 'gif', 'webp'],
            title: 'ImageFormat',
            type: 'string',
          },
          ImageSource: {
            properties: {
              bytes: {
                format: 'binary',
                title: 'Bytes',
                type: 'string',
              },
            },
            required: ['bytes'],
            title: 'ImageSource',
            type: 'object',
          },
          InternalServerErrorDetails: {
            properties: {
              detail: {
                title: 'Detail',
                type: 'string',
              },
            },
            required: ['detail'],
            title: 'InternalServerErrorDetails',
            type: 'object',
          },
          InvokeInput: {
            properties: {
              message: {
                title: 'Message',
                type: 'string',
              },
              session_id: {
                title: 'Session Id',
                type: 'string',
              },
            },
            required: ['message', 'session_id'],
            title: 'InvokeInput',
            type: 'object',
          },
          ListMessagesOutput: {
            properties: {
              messages: {
                items: {
                  $ref: '#/components/schemas/Message-Output',
                },
                title: 'Messages',
                type: 'array',
              },
            },
            required: ['messages'],
            title: 'ListMessagesOutput',
            type: 'object',
          },
          'Message-Input': {
            properties: {
              content: {
                items: {
                  $ref: '#/components/schemas/ContentBlock-Input',
                },
                title: 'Content',
                type: 'array',
              },
              role: {
                $ref: '#/components/schemas/Role',
              },
            },
            required: ['content', 'role'],
            title: 'Message',
            type: 'object',
          },
          'Message-Output': {
            properties: {
              content: {
                items: {
                  $ref: '#/components/schemas/ContentBlock-Output',
                },
                title: 'Content',
                type: 'array',
              },
              role: {
                $ref: '#/components/schemas/Role',
              },
            },
            required: ['content', 'role'],
            title: 'Message',
            type: 'object',
          },
          Role: {
            description:
              'Role of a message sender.\n\n- USER: Messages from the user to the assistant\n- ASSISTANT: Messages from the assistant to the user',
            enum: ['user', 'assistant'],
            title: 'Role',
            type: 'string',
          },
          'ToolResult-Input': {
            properties: {
              content: {
                items: {
                  $ref: '#/components/schemas/ToolResultContent-Input',
                },
                title: 'Content',
                type: 'array',
              },
              status: {
                $ref: '#/components/schemas/ToolResultStatus',
              },
              toolUseId: {
                title: 'Tooluseid',
                type: 'string',
              },
            },
            required: ['content', 'status', 'toolUseId'],
            title: 'ToolResult',
            type: 'object',
          },
          'ToolResult-Output': {
            properties: {
              content: {
                items: {
                  $ref: '#/components/schemas/ToolResultContent-Output',
                },
                title: 'Content',
                type: 'array',
              },
              status: {
                $ref: '#/components/schemas/ToolResultStatus',
              },
              toolUseId: {
                title: 'Tooluseid',
                type: 'string',
              },
            },
            required: ['content', 'status', 'toolUseId'],
            title: 'ToolResult',
            type: 'object',
          },
          'ToolResultContent-Input': {
            properties: {
              image: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ImageContent',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              json: {
                anyOf: [
                  {},
                  {
                    type: 'null',
                  },
                ],
                title: 'Json',
              },
              text: {
                anyOf: [
                  {
                    type: 'string',
                  },
                  {
                    type: 'null',
                  },
                ],
                title: 'Text',
              },
            },
            title: 'ToolResultContent',
            type: 'object',
          },
          'ToolResultContent-Output': {
            description:
              'Content returned by a tool execution.\n\nAttributes:\n    image: Image content returned by the tool.\n    json: JSON-serializable data returned by the tool.\n    text: Text content returned by the tool.',
            properties: {
              image: {
                anyOf: [
                  {
                    $ref: '#/components/schemas/ImageContent',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              json: {
                anyOf: [
                  {},
                  {
                    type: 'null',
                  },
                ],
                title: 'Json',
              },
              text: {
                anyOf: [
                  {
                    type: 'string',
                  },
                  {
                    type: 'null',
                  },
                ],
                title: 'Text',
              },
            },
            title: 'ToolResultContent',
            type: 'object',
          },
          ToolResultStatus: {
            description: 'Status of a tool execution result.',
            enum: ['success', 'error'],
            title: 'ToolResultStatus',
            type: 'string',
          },
          ToolUse: {
            properties: {
              input: {
                title: 'Input',
              },
              name: {
                title: 'Name',
                type: 'string',
              },
              toolUseId: {
                title: 'Tooluseid',
                type: 'string',
              },
            },
            required: ['input', 'name', 'toolUseId'],
            title: 'ToolUse',
            type: 'object',
          },
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [
                    {
                      type: 'string',
                    },
                    {
                      type: 'integer',
                    },
                  ],
                },
                title: 'Location',
                type: 'array',
              },
              msg: {
                title: 'Message',
                type: 'string',
              },
              type: {
                title: 'Error Type',
                type: 'string',
              },
            },
            required: ['loc', 'msg', 'type'],
            title: 'ValidationError',
            type: 'object',
          },
        },
      },
      paths: {
        '/invocations': {
          post: {
            description: 'Handler for agent invocation',
            operationId: 'invoke',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/InvokeInput',
                  },
                },
              },
              required: true,
            },
            responses: {
              '200': {
                content: {
                  'text/plain': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
                description: 'Successful Response',
              },
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/HTTPValidationError',
                    },
                  },
                },
                description: 'Validation Error',
              },
              '500': {
                content: {
                  'text/plain': {
                    schema: {
                      $ref: '#/components/schemas/InternalServerErrorDetails',
                    },
                  },
                },
                description: 'Internal Server Error',
              },
            },
            summary: 'Invoke',
            'x-streaming': true as any,
          } as any,
        },
        '/messages': {
          get: {
            operationId: 'list_messages',
            parameters: [
              {
                in: 'query',
                name: 'session_id',
                required: true,
                schema: {
                  title: 'Session Id',
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/ListMessagesOutput',
                    },
                  },
                },
                description: 'Successful Response',
              },
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/HTTPValidationError',
                    },
                  },
                },
                description: 'Validation Error',
              },
              '500': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/InternalServerErrorDetails',
                    },
                  },
                },
                description: 'Internal Server Error',
              },
            },
            summary: 'List Messages',
          },
        },
        '/ping': {
          get: {
            operationId: 'ping',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      title: 'Response Ping Ping Get',
                      type: 'string',
                    },
                  },
                },
                description: 'Successful Response',
              },
              '500': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/InternalServerErrorDetails',
                    },
                  },
                },
                description: 'Internal Server Error',
              },
            },
            summary: 'Ping',
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    // Test list_messages endpoint
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
          {
            role: 'assistant',
            content: [{ text: 'Hi there!' }],
          },
        ],
      }),
    });

    const messagesResponse = await callGeneratedClient(
      client,
      mockFetch,
      'listMessages',
      { sessionId: 'test-session' },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/messages?session_id=test-session`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(messagesResponse).toEqual({
      messages: [
        {
          role: 'user',
          content: [{ text: 'Hello' }],
        },
        {
          role: 'assistant',
          content: [{ text: 'Hi there!' }],
        },
      ],
    });
  });
});
