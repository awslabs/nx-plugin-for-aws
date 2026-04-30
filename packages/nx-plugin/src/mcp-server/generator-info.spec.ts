/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NxGeneratorInfo } from '../utils/generators';
import {
  fetchGuidePagesForGenerator,
  postProcessGuide,
  renderFilterableOptionsAsync,
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
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => typeof p === 'string' && p.endsWith('schema.json'),
    );
    // Mock fs.readFileSync to return a mock schema only for schema.json paths;
    // delegate other reads (e.g. Node CJS loader peeking at lazy-loaded
    // remark deps) to the real implementation.
    const realReadFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(
      (p: any, ...rest: any[]) => {
        if (typeof p === 'string' && p.endsWith('schema.json')) {
          return JSON.stringify({
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
          });
        }
        return (realReadFileSync as any)(p, ...rest);
      },
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

    const result = await postProcessGuide(input, generators);
    expect(result).toContain('# Test Guide');
    expect(result).toContain("Here's how to run a command:");
    expect(result).toContain(
      '```bash\nnx generate @aws/nx-plugin:ts#project\n```',
    );
    expect(result).not.toContain('<NxCommands');
  });

  it('should transform NxCommands components with single quotes', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={['generate @aws/nx-plugin:ts#project']} />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toContain(
      '```bash\nnx generate @aws/nx-plugin:ts#project\n```',
    );
    expect(result).not.toContain('<NxCommands');
  });

  it('should transform NxCommands components with multiple commands', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={["generate @aws/nx-plugin:ts#project", "sync", 'foo']} />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toContain(
      '```bash\nnx generate @aws/nx-plugin:ts#project\nnx sync\nnx foo\n```',
    );
  });

  it('should transform NxCommands components with package manager prefix', async () => {
    const input = `
# Test Guide
Here's how to run a command:
<NxCommands commands={["generate @aws/nx-plugin:ts#project"]} />
`;

    const result = await postProcessGuide(input, generators, 'pnpm');
    expect(result).toContain(
      '```bash\npnpm nx generate @aws/nx-plugin:ts#project\n```',
    );
  });

  it('should transform RunGenerator components to generator commands', async () => {
    const input = `
# Test Guide
Here's how to run a generator:
<RunGenerator generator="test-generator" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toContain(
      '```bash\nnx g @aws/nx-plugin:test-generator --no-interactive --name=<name>\n```',
    );
    expect(result).not.toContain('<RunGenerator');
  });

  it('should transform RunGenerator components with package manager prefix', async () => {
    const input = `
# Test Guide
Here's how to run a generator:
<RunGenerator generator="test-generator" />
`;

    const result = await postProcessGuide(input, generators, 'npm');
    expect(result).toContain(
      '```bash\nnpx nx g @aws/nx-plugin:test-generator --no-interactive --name=<name>\n```',
    );
  });

  it('should transform GeneratorParameters components to schema documentation', async () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters generator="test-generator" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toMatch(
      /- name \\?\[type: string] \(required\) The name of the project/,
    );
    expect(result).toMatch(
      /- auth \\?\[type: string] \\?\[options: IAM, Cognito, None] The auth method to use/,
    );
    expect(result).toMatch(
      /- directory \\?\[type: string] The directory to create the project in/,
    );
    expect(result).not.toContain('<GeneratorParameters');
  });

  it('should leave GeneratorParameters components unchanged if generator is not found', async () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters generator="non-existent-generator" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toContain(
      '<GeneratorParameters generator="non-existent-generator"',
    );
  });

  it('should leave GeneratorParameters components unchanged if generator parameter is missing', async () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters somethingElse="value" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toContain('<GeneratorParameters somethingElse="value"');
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

    const result = await postProcessGuide(input, generators, 'bun');
    expect(result).toContain(
      '```bash\nbunx nx generate @aws/nx-plugin:ts#project\n```',
    );
    expect(result).toContain(
      '```bash\nbunx nx g @aws/nx-plugin:test-generator --no-interactive --name=<name>\n```',
    );
    expect(result).toMatch(
      /- name \\?\[type: string] \(required\) The name of the project/,
    );
    expect(result).not.toContain('<NxCommands');
    expect(result).not.toContain('<RunGenerator');
    expect(result).not.toContain('<GeneratorParameters');
  });

  it('should handle errors when reading schema file', async () => {
    // Mock fs.readFileSync to throw an error for schema.json reads
    vi.spyOn(fs, 'readFileSync').mockImplementation((p: any) => {
      if (typeof p === 'string' && p.endsWith('schema.json')) {
        throw new Error('File not found');
      }
      return (fs as any).readFileSync.wrappedMethod.call(fs, p);
    });

    const input = `
# Test Guide
Here's how to run a generator:
<RunGenerator generator="test-generator" />

Here are the parameters for the generator:
<GeneratorParameters generator="test-generator" />
`;

    const result = await postProcessGuide(input, generators);
    // When the schema can't be read, both components are left as-is.
    expect(result).toContain('<RunGenerator generator="test-generator"');
    expect(result).toContain('<GeneratorParameters generator="test-generator"');
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

    const result = await postProcessGuide(input, generators);
    expect(result).toContain('<Snippet name="shared-constructs">');
    expect(result).toContain('This is shared content about constructs.');
    expect(result).toContain('</Snippet>');
    expect(result).toContain('More text after.');
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

    const result = await postProcessGuide(input, generators);
    expect(result).toContain('<Snippet name="api/api-choice-note">');
    expect(result).toContain('Consider your API choice carefully.');
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
    expect(result).toContain('<Snippet name="non-existent-snippet"');
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

    const result = await postProcessGuide(input, generators, 'pnpm');
    expect(result).toContain('<Snippet name="ts-bundle">');
    expect(result).toContain('The generator configures a bundle target:');
    // remark-stringify indents nested fenced-code blocks inside JSX children.
    expect(result).toMatch(
      /```bash\n\s*pnpm nx run <project-name>:bundle\n\s*```/,
    );
    expect(result).not.toContain('<NxCommands');
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

    const result = await postProcessGuide(input, generators);
    expect(result).toContain('<Snippet name="shared-constructs">');
    expect(result).toContain('Shared constructs content.');
    expect(result).toContain('<Snippet name="ts-bundle">');
    expect(result).toContain('Bundle content.');
    expect(result).toContain('Some middle text.');
  });

  it('should handle Snippet tags with parentHeading attribute', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Deploy instructions here.', { status: 200 }),
    );

    const input = `
# Test Guide
<Snippet name="lambda-function/deploying-your-function" parentHeading="Deploying your Function" />
`;

    const result = await postProcessGuide(input, generators);
    expect(result).toContain(
      '<Snippet name="lambda-function/deploying-your-function">',
    );
    expect(result).toContain('Deploy instructions here.');
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
      expect(result).toMatch(
        /\[!NOTE]\s+Only when computeType = ServerlessApiGatewayRestApi/,
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

  describe('frontmatter-driven guide filtering', () => {
    const variants: Record<string, string> = {
      'connection.mdx': `---
title: Overview
---
OVERVIEW_BODY`,
      'connection/react-trpc.mdx': `---
title: React to tRPC
when:
  sourceType: react
  targetType: ts#trpc-api
---
REACT_TRPC_BODY`,
      'connection/react-fastapi.mdx': `---
title: React to FastAPI
when:
  sourceType: react
  targetType: py#fast-api
---
REACT_FASTAPI_BODY`,
      'connection/react-agui.mdx': `---
title: React to AG-UI Agent
when:
  sourceType: react
  targetType: py#strands-agent
  protocol: AG-UI
---
REACT_AGUI_BODY`,
      'connection/react-py-strands-agent.mdx': `---
title: React to Python Strands Agent
when:
  sourceType: react
  targetType: py#strands-agent
  protocol:
    - HTTP
    - A2A
---
REACT_PY_STRANDS_BODY`,
    };

    const connectionInfo: NxGeneratorInfo = {
      id: 'connection',
      description: 'connect projects',
      resolvedSchemaPath: '/fake/schema.json',
      resolvedFactoryPath: '/fake/factory',
      metric: 'g11',
      guidePages: [
        'connection',
        'connection/react-trpc',
        'connection/react-fastapi',
        'connection/react-agui',
        'connection/react-py-strands-agent',
      ],
    };

    beforeEach(() => {
      vi.restoreAllMocks();
      // Force fetchLocalGuide to miss so we exercise the fetch() fallback,
      // then return per-URL content from the `variants` table.
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
        const match = /\/guides\/(.+)\.mdx/.exec(String(url));
        if (!match) return Promise.resolve(new Response('', { status: 404 }));
        const key = `${match[1]}.mdx`;
        const body = variants[key];
        if (body === undefined) {
          return Promise.resolve(new Response('', { status: 404 }));
        }
        return Promise.resolve(new Response(body));
      });
    });

    // remark-stringify escapes `_` in plain text, so these tests match
    // against the tokens with optional backslash escapes.
    const bodyMatcher = (label: string) =>
      new RegExp(label.replaceAll('_', String.raw`\\?_`));

    it('returns only the variants whose frontmatter `when` matches the options', async () => {
      const result = await fetchGuidePagesForGenerator(
        connectionInfo,
        [connectionInfo],
        undefined,
        undefined,
        { sourceType: 'react', targetType: 'ts#trpc-api' },
      );
      expect(result.kind).toBe('ok');
      expect(result.content).toMatch(bodyMatcher('OVERVIEW_BODY'));
      expect(result.content).toMatch(bodyMatcher('REACT_TRPC_BODY'));
      expect(result.content).not.toMatch(bodyMatcher('REACT_FASTAPI_BODY'));
      expect(result.content).not.toMatch(bodyMatcher('REACT_AGUI_BODY'));
      expect(result.content).not.toMatch(bodyMatcher('REACT_PY_STRANDS_BODY'));
    });

    it('distinguishes variants that differ only by a third option key', async () => {
      const agui = await fetchGuidePagesForGenerator(
        connectionInfo,
        [connectionInfo],
        undefined,
        undefined,
        {
          sourceType: 'react',
          targetType: 'py#strands-agent',
          protocol: 'AG-UI',
        },
      );
      expect(agui.content).toMatch(bodyMatcher('REACT_AGUI_BODY'));
      expect(agui.content).not.toMatch(bodyMatcher('REACT_PY_STRANDS_BODY'));

      const http = await fetchGuidePagesForGenerator(
        connectionInfo,
        [connectionInfo],
        undefined,
        undefined,
        {
          sourceType: 'react',
          targetType: 'py#strands-agent',
          protocol: 'HTTP',
        },
      );
      expect(http.content).toMatch(bodyMatcher('REACT_PY_STRANDS_BODY'));
      expect(http.content).not.toMatch(bodyMatcher('REACT_AGUI_BODY'));
    });

    it('returns every variant when no options are supplied', async () => {
      const result = await fetchGuidePagesForGenerator(connectionInfo, [
        connectionInfo,
      ]);
      expect(result.content).toMatch(bodyMatcher('OVERVIEW_BODY'));
      expect(result.content).toMatch(bodyMatcher('REACT_TRPC_BODY'));
      expect(result.content).toMatch(bodyMatcher('REACT_FASTAPI_BODY'));
      expect(result.content).toMatch(bodyMatcher('REACT_AGUI_BODY'));
      expect(result.content).toMatch(bodyMatcher('REACT_PY_STRANDS_BODY'));
    });

    it('returns an Unsupported combination warning when no variant matches', async () => {
      const result = await fetchGuidePagesForGenerator(
        connectionInfo,
        [connectionInfo],
        undefined,
        undefined,
        { sourceType: 'ts#trpc-api', targetType: 'smithy', protocol: 'HTTP' },
      );
      expect(result.kind).toBe('unsupported');
      expect(result.content).toContain('Unsupported combination');
      expect(result.content).toContain('sourceType = ts#trpc-api');
      expect(result.content).toContain('Supported combinations:');
      // The warning should enumerate the known-good predicates.
      expect(result.content).toMatch(/react.*ts#trpc-api/);
    });

    it('still shows partial matches when not every predicate key is supplied', async () => {
      // No protocol supplied — both protocol-tagged pages are kept.
      const result = await fetchGuidePagesForGenerator(
        connectionInfo,
        [connectionInfo],
        undefined,
        undefined,
        { sourceType: 'react', targetType: 'py#strands-agent' },
      );
      // With a partial selection we don't emit an Unsupported warning.
      expect(result.kind).toBe('ok');
      expect(result.content).toMatch(bodyMatcher('REACT_AGUI_BODY'));
      expect(result.content).toMatch(bodyMatcher('REACT_PY_STRANDS_BODY'));
    });

    it('surfaces frontmatter keys in the filterable-options list', async () => {
      const rendered = await renderFilterableOptionsAsync(connectionInfo);
      expect(rendered).toContain('sourceType:');
      expect(rendered).toContain('targetType:');
      expect(rendered).toContain('protocol:');
      // The enums come from the union of frontmatter values, sorted into
      // some stable order — just make sure the expected values appear.
      expect(rendered).toMatch(/sourceType: react\b/);
      expect(rendered).toMatch(/protocol: .*AG-UI/);
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
      expect(result.content).toContain('LOCAL TRPC CONTENT');
      expect(result.content).not.toContain('REMOTE CONTENT');
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
      expect(result.content).toContain('REMOTE CONTENT');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
