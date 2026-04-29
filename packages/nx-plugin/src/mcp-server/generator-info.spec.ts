/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NxGeneratorInfo } from '../utils/generators';
import {
  fetchGuidePagesForGenerator,
  postProcessGuide,
} from './generator-info';
import fs from 'fs';

describe('postProcessGuide', () => {
  const generators: NxGeneratorInfo[] = [
    {
      id: 'test-generator',
      description: 'A test generator',
      resolvedSchemaPath: '/path/to/schema.json',
      resolvedFactoryPath: '/path/to/factory',
      metric: 'g1',
    },
  ];

  beforeEach(() => {
    // Force the local-file probes in fetchGuidePages / fetchSnippet to miss
    // so the older mocks (fetch returning canned content) still take effect.
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    // Mock fs.readFileSync to return a mock schema
    vi.spyOn(fs, 'readFileSync').mockImplementation(() =>
      JSON.stringify({
        properties: {
          name: {
            type: 'string',
            description: 'The name of the project',
          },
          auth: {
            type: 'string',
            enum: ['IAM', 'Cognito', 'None'],
            description: 'The auth method to use',
          },
          directory: {
            type: 'string',
            description: 'The directory to create the project in',
          },
        },
        required: ['name'],
      }),
    );
    // Mock global fetch to return empty by default (no snippets found)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should transform NxCommands components to markdown code blocks', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={["generate @aws/nx-plugin:ts#project"]} />
`;

    const expected = `
# Test Guide
Here's how to run a command:
\`\`\`bash
nx generate @aws/nx-plugin:ts#project
\`\`\`
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform NxCommands components with single quotes', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={['generate @aws/nx-plugin:ts#project']} />
`;

    const expected = `
# Test Guide
Here's how to run a command:
\`\`\`bash
nx generate @aws/nx-plugin:ts#project
\`\`\`
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform NxCommands components with multiple commands', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={["generate @aws/nx-plugin:ts#project", "sync", 'foo']} />
`;

    const expected = `
# Test Guide
Here's how to run a command:
\`\`\`bash
nx generate @aws/nx-plugin:ts#project
nx sync
nx foo
\`\`\`
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform NxCommands components with package manager prefix', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={["generate @aws/nx-plugin:ts#project"]} />
`;

    const expected = `
# Test Guide
Here's how to run a command:
\`\`\`bash
pnpm nx generate @aws/nx-plugin:ts#project
\`\`\`
`;

    const result = await postProcessGuide(input, generators, 'pnpm');
    expect(result).toBe(expected);
  });

  it('should transform RunGenerator components to generator commands', async () => {
    const input = `
# Test Guide
Here's how to run a generator:
<RunGenerator generator="test-generator" />
`;

    const expected = `
# Test Guide
Here's how to run a generator:
\`\`\`bash
nx g @aws/nx-plugin:test-generator --no-interactive --name=<name>
\`\`\`
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform RunGenerator components with package manager prefix', async () => {
    const input = `
# Test Guide
Here's how to run a generator:
<RunGenerator generator="test-generator" />
`;

    const expected = `
# Test Guide
Here's how to run a generator:
\`\`\`bash
npx nx g @aws/nx-plugin:test-generator --no-interactive --name=<name>
\`\`\`
`;

    const result = await postProcessGuide(input, generators, 'npm');
    expect(result).toBe(expected);
  });

  it('should transform GeneratorParameters components to schema documentation', async () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters generator="test-generator" />
`;

    const expected = `
# Test Guide
Here are the parameters for the generator:
- name [type: string] (required) The name of the project
- auth [type: string] [options: IAM, Cognito, None] The auth method to use
- directory [type: string] The directory to create the project in
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should leave GeneratorParameters components unchanged if generator is not found', async () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters generator="non-existent-generator" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(input);
  });

  it('should leave GeneratorParameters components unchanged if generator parameter is missing', async () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters somethingElse="value" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(input);
  });

  it('should handle multiple transformations in a single guide', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={["generate @aws/nx-plugin:ts#project"]} />

And here's how to run a generator:
<RunGenerator generator="test-generator" />

Here are the parameters for the generator:
<GeneratorParameters generator="test-generator" />
`;

    const expected = `
# Test Guide
Here's how to run a command:
\`\`\`bash
bunx nx generate @aws/nx-plugin:ts#project
\`\`\`

And here's how to run a generator:
\`\`\`bash
bunx nx g @aws/nx-plugin:test-generator --no-interactive --name=<name>
\`\`\`

Here are the parameters for the generator:
- name [type: string] (required) The name of the project
- auth [type: string] [options: IAM, Cognito, None] The auth method to use
- directory [type: string] The directory to create the project in
`;

    const result = await postProcessGuide(input, generators, 'bun');
    expect(result).toBe(expected);
  });

  it('should handle errors when reading schema file', async () => {
    // Mock fs.readFileSync to throw an error
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('File not found');
    });

    const input = `
# Test Guide
Here's how to run a generator:
<RunGenerator generator="test-generator" />

Here are the parameters for the generator:
<GeneratorParameters generator="test-generator" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(input);
  });

  it('should replace Snippet tags with fetched snippet content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('This is shared content about constructs.', {
        status: 200,
      }),
    );

    const input = `
# Test Guide
Some intro text.

<Snippet name="shared-constructs" />

More text after.
`;

    const expected = `
# Test Guide
Some intro text.

<Snippet name="shared-constructs">
This is shared content about constructs.
</Snippet>

More text after.
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/snippets/shared-constructs.mdx'),
    );
  });

  it('should replace Snippet tags with nested path names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Consider your API choice carefully.', { status: 200 }),
    );

    const input = `
# Test Guide
<Snippet name="api/api-choice-note" />
`;

    const expected = `
# Test Guide
<Snippet name="api/api-choice-note">
Consider your API choice carefully.
</Snippet>
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/snippets/api/api-choice-note.mdx'),
    );
  });

  it('should leave Snippet tags unchanged when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404 }),
    );

    const input = `
# Test Guide
<Snippet name="non-existent-snippet" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(input);
  });

  it('should post-process NxCommands within fetched snippet content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        `The generator configures a bundle target:

<NxCommands commands={['run <project-name>:bundle']} />`,
        { status: 200 },
      ),
    );

    const input = `
# Test Guide
<Snippet name="ts-bundle" />
`;

    const expected = `
# Test Guide
<Snippet name="ts-bundle">
The generator configures a bundle target:

\`\`\`bash
pnpm nx run <project-name>:bundle
\`\`\`
</Snippet>
`;

    const result = await postProcessGuide(input, generators, 'pnpm');
    expect(result).toBe(expected);
  });

  it('should handle multiple Snippet tags in a single guide', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Shared constructs content.', { status: 200 });
      }
      return new Response('Bundle content.', { status: 200 });
    });

    const input = `
# Test Guide

<Snippet name="shared-constructs" />

Some middle text.

<Snippet name="ts-bundle" />
`;

    const expected = `
# Test Guide

<Snippet name="shared-constructs">
Shared constructs content.
</Snippet>

Some middle text.

<Snippet name="ts-bundle">
Bundle content.
</Snippet>
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should handle Snippet tags with parentHeading attribute', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Deploy instructions here.', { status: 200 }),
    );

    const input = `
# Test Guide
<Snippet name="lambda-function/deploying-your-function" parentHeading="Deploying your Function" />
`;

    const expected = `
# Test Guide
<Snippet name="lambda-function/deploying-your-function">
Deploy instructions here.
</Snippet>
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toBe(expected);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/snippets/lambda-function/deploying-your-function.mdx',
      ),
    );
  });

  describe('option filtering', () => {
    const pageWithBranches = `
# Guide
<OptionFilter when={{ computeType: 'ServerlessApiGatewayRestApi' }}>
REST-only content
</OptionFilter>
<OptionFilter when={{ computeType: 'ServerlessApiGatewayHttpApi' }}>
HTTP-only content
</OptionFilter>
common content
`;

    it('drops non-matching branches when options supplied', async () => {
      const result = await postProcessGuide(
        pageWithBranches,
        generators,
        undefined,
        undefined,
        { computeType: 'ServerlessApiGatewayHttpApi' },
      );
      expect(result).toContain('HTTP-only content');
      expect(result).not.toContain('REST-only content');
      expect(result).toContain('common content');
    });

    it('keeps all branches with NOTE markers when options omitted', async () => {
      const result = await postProcessGuide(pageWithBranches, generators);
      expect(result).toContain('REST-only content');
      expect(result).toContain('HTTP-only content');
      expect(result).toContain(
        '> [!NOTE] Only when computeType = ServerlessApiGatewayRestApi',
      );
    });

    it('filters Infrastructure to CDK slot when iacProvider is CDK', async () => {
      const page = `
# Deploy
<Infrastructure>
<Fragment slot="cdk">
cdk instructions
</Fragment>
<Fragment slot="terraform">
terraform instructions
</Fragment>
</Infrastructure>
`;
      const result = await postProcessGuide(
        page,
        generators,
        undefined,
        undefined,
        { iacProvider: 'CDK' },
      );
      expect(result).toContain('cdk instructions');
      expect(result).not.toContain('terraform instructions');
    });

    it('leaves Infrastructure blocks untouched when iacProvider omitted', async () => {
      const page = `
<Infrastructure>
<Fragment slot="cdk">cdk here</Fragment>
<Fragment slot="terraform">terraform here</Fragment>
</Infrastructure>
`;
      const result = await postProcessGuide(page, generators);
      expect(result).toContain('<Infrastructure>');
      expect(result).toContain('cdk here');
      expect(result).toContain('terraform here');
      expect(result).not.toContain('### CDK');
      expect(result).not.toContain('### Terraform');
    });
  });

  describe('guide-page-level filtering', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.restoreAllMocks();
      // fetchGuidePages prefers local files over the network. Force the
      // local probe to miss so these tests exercise the fetch fallback.
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      // Make every fetched guide page return its URL so we can assert on it.
      fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(new Response(`# content for ${url}`)),
        );
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as any);
    });

    const connectionInfo: NxGeneratorInfo = {
      id: 'connection',
      description: 'connect projects',
      resolvedSchemaPath: '/fake/schema.json',
      resolvedFactoryPath: '/fake/factory',
      metric: 'g11',
      guidePages: [
        'connection',
        {
          page: 'connection/react-trpc',
          when: { sourceType: 'react', targetType: 'ts#trpc-api' },
        },
        {
          page: 'connection/react-fastapi',
          when: { sourceType: 'react', targetType: 'py#fast-api' },
        },
      ],
    };

    it('fetches only matching guide pages when options narrow', async () => {
      await fetchGuidePagesForGenerator(
        connectionInfo,
        [connectionInfo],
        undefined,
        undefined,
        { sourceType: 'react', targetType: 'ts#trpc-api' },
      );
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.endsWith('/connection.mdx'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/connection/react-trpc.mdx'))).toBe(
        true,
      );
      expect(
        urls.some((u) => u.endsWith('/connection/react-fastapi.mdx')),
      ).toBe(false);
    });

    it('fetches every guide page when options are omitted', async () => {
      await fetchGuidePagesForGenerator(connectionInfo, [connectionInfo]);
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.endsWith('/connection/react-trpc.mdx'))).toBe(
        true,
      );
      expect(
        urls.some((u) => u.endsWith('/connection/react-fastapi.mdx')),
      ).toBe(true);
    });
  });

  describe('local-file fallback for guide pages', () => {
    const info: NxGeneratorInfo = {
      id: 'ts#trpc-api',
      description: 'trpc',
      resolvedSchemaPath: '/fake/schema.json',
      resolvedFactoryPath: '/fake/factory',
      metric: 'g9',
      guidePages: ['trpc'],
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reads from the local repo when the guide file is available on disk', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(new Response('REMOTE CONTENT — should not be used')),
        );
      // Accept any local probe path and return distinctive local content so
      // we can prove the network was not hit.
      const existsSpy = vi
        .spyOn(fs, 'existsSync')
        .mockImplementation(
          (p) => typeof p === 'string' && p.endsWith('/trpc.mdx'),
        );
      const readSpy = vi
        .spyOn(fs, 'readFileSync')
        .mockImplementation((p, enc) => {
          if (typeof p === 'string' && p.endsWith('/trpc.mdx')) {
            return 'LOCAL TRPC CONTENT';
          }
          // Fall through to the real implementation for any other read.
          return (fs as any).readFileSync.wrappedMethod.call(fs, p, enc);
        });

      const result = await fetchGuidePagesForGenerator(info, [info]);
      expect(result).toContain('LOCAL TRPC CONTENT');
      expect(result).not.toContain('REMOTE CONTENT');
      expect(fetchSpy).not.toHaveBeenCalled();

      existsSpy.mockRestore();
      readSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('falls back to the GitHub fetch when no local copy exists', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(new Response('REMOTE CONTENT')),
        );

      const result = await fetchGuidePagesForGenerator(info, [info]);
      expect(result).toContain('REMOTE CONTENT');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
