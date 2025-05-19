/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NxGeneratorInfo } from '../utils/nx';
import { postProcessGuide } from './generator-info';
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
    // Mock fs.readFileSync to return a mock schema
    vi.spyOn(fs, 'readFileSync').mockImplementation(() =>
      JSON.stringify({
        properties: {
          name: {
            type: 'string',
            description: 'The name of the project',
          },
          directory: {
            type: 'string',
            description: 'The directory to create the project in',
          },
        },
        required: ['name'],
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should transform NxCommands components to markdown code blocks', () => {
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

    const result = postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform NxCommands components with single quotes', () => {
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

    const result = postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform NxCommands components with multiple commands', () => {
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

    const result = postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform NxCommands components with package manager prefix', () => {
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

    const result = postProcessGuide(input, generators, 'pnpm');
    expect(result).toBe(expected);
  });

  it('should transform RunGenerator components to generator commands', () => {
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

    const result = postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should transform RunGenerator components with package manager prefix', () => {
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

    const result = postProcessGuide(input, generators, 'npm');
    expect(result).toBe(expected);
  });

  it('should transform GeneratorParameters components to schema documentation', () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters generator="test-generator" />
`;

    const expected = `
# Test Guide
Here are the parameters for the generator:
- name [type: string] (required) The name of the project
- directory [type: string] The directory to create the project in
`;

    const result = postProcessGuide(input, generators);
    expect(result).toBe(expected);
  });

  it('should leave GeneratorParameters components unchanged if generator is not found', () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters generator="non-existent-generator" />
`;

    const result = postProcessGuide(input, generators);
    expect(result).toBe(input);
  });

  it('should leave GeneratorParameters components unchanged if generator parameter is missing', () => {
    const input = `
# Test Guide
Here are the parameters for the generator:
<GeneratorParameters somethingElse="value" />
`;

    const result = postProcessGuide(input, generators);
    expect(result).toBe(input);
  });

  it('should handle multiple transformations in a single guide', () => {
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
- directory [type: string] The directory to create the project in
`;

    const result = postProcessGuide(input, generators, 'bun');
    expect(result).toBe(expected);
  });

  it('should handle errors when reading schema file', () => {
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

    const result = postProcessGuide(input, generators);
    expect(result).toBe(input);
  });
});
