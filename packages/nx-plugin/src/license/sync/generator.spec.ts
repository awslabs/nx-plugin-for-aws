/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { licenseSyncGenerator } from './generator';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
import { LicenseConfig } from '../config-types';
import { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import { mkdtempSync, rmSync } from 'fs';
import { flushChanges, FsTree } from 'nx/src/generators/tree';
import { execSync } from 'child_process';

describe('licenseSyncGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const addLicenseConfig = async (
    licenseConfig?: Partial<LicenseConfig> & Pick<LicenseConfig, 'header'>,
    _tree: Tree = tree,
  ) => {
    await ensureAwsNxPluginConfig(_tree);
    await updateAwsNxPluginConfig(_tree, {
      license: licenseConfig
        ? {
            spdx: 'MIT',
            copyrightHolder: 'foo',
            copyrightYear: 2025,
            ...licenseConfig,
          }
        : {
            spdx: 'Apache-2.0',
            copyrightHolder: 'Test',
            header: {
              content: {
                lines: ['Test Header'],
              },
              format: {
                '**/*.ts': {
                  lineStart: '// ',
                },
                '**/*.sh': {
                  lineStart: '# ',
                },
              },
            },
          },
    });
  };

  const getOutOfSyncMessage = (
    res: SyncGeneratorResult,
  ): string | undefined => {
    if (typeof res === 'object') {
      return res.outOfSyncMessage;
    }
    return undefined;
  };

  it('should do nothing when there is no license config', async () => {
    const numChangesPrior = tree.listChanges().length;
    await licenseSyncGenerator(tree);
    expect(tree.listChanges()).toHaveLength(numChangesPrior);
  });

  it('should add headers', async () => {
    await addLicenseConfig();

    tree.write('foo.ts', `const foo = 'bar';`);

    const res = await licenseSyncGenerator(tree);

    expect(tree.read('foo.ts', 'utf-8')).toBe(
      `// Test Header\nconst foo = 'bar';`,
    );

    expect(getOutOfSyncMessage(res)).toContain(
      `License headers are out of sync in the following source files:\n- foo.ts`,
    );
  });

  it('should add multi-line headers', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: [
            'Copyright Test Inc.',
            'Licensed under MIT',
            'All rights reserved',
          ],
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
          },
        },
      },
    });

    tree.write('foo.ts', `const foo = 'bar';`);

    await licenseSyncGenerator(tree);

    expect(tree.read('foo.ts', 'utf-8')).toBe(
      `// Copyright Test Inc.\n// Licensed under MIT\n// All rights reserved\nconst foo = 'bar';`,
    );
  });

  it('should add multi-line block comment headers', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: [
            'Copyright Test Inc.',
            'Licensed under MIT',
            'All rights reserved',
          ],
        },
        format: {
          '**/*.ts': {
            blockStart: '/*',
            blockEnd: '*/',
          },
        },
      },
    });

    tree.write('foo.ts', `const foo = 'bar';`);

    await licenseSyncGenerator(tree);

    expect(tree.read('foo.ts', 'utf-8')).toBe(
      `/*\nCopyright Test Inc.\nLicensed under MIT\nAll rights reserved\n*/\nconst foo = 'bar';`,
    );
  });

  it("should allow custom comment syntax for files which aren't natively supported", async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.xyz': {
            lineStart: '## ',
          },
        },
        commentSyntax: {
          xyz: {
            line: '##',
          },
        },
      },
    });

    tree.write('test.xyz', `some content`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.xyz', 'utf-8')).toBe(`## Test Header\nsome content`);
  });

  it('should preserve bash hashbangs', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.sh': {
            lineStart: '# ',
          },
        },
      },
    });

    tree.write('script.sh', `#!/bin/bash\necho "hello"`);

    await licenseSyncGenerator(tree);

    expect(tree.read('script.sh', 'utf-8')).toBe(
      `#!/bin/bash\n# Test Header\necho "hello"`,
    );
  });

  it('should update an existing header', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['New Header'],
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
          },
        },
      },
    });

    tree.write('test.ts', `// Old Header\nconst x = 1;`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(`// New Header\nconst x = 1;`);
  });

  it('should only update the first block comment', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['New Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/***',
            lineStart: ' * ',
            blockEnd: ' ***/',
          },
        },
      },
    });

    tree.write(
      'test.ts',
      `/* Old Header */\n/* Another comment */\nconst x = 1;`,
    );

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(
      `/***\n * New Header\n ***/\n/* Another comment */\nconst x = 1;`,
    );
  });

  it('should only update the first series of line comments', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['New Header'],
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
          },
        },
      },
    });

    tree.write(
      'test.ts',
      `// Old Header\n// More old header\n/* some block comment */\nconst x = 1;\n// Another comment`,
    );

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(
      `// New Header\n/* some block comment */\nconst x = 1;\n// Another comment`,
    );
  });

  it('should read header content from a file', async () => {
    tree.write('header.txt', 'File Header Content');

    await addLicenseConfig({
      header: {
        content: {
          filePath: 'header.txt',
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(
      `// File Header Content\nconst x = 1;`,
    );
  });

  it('should error if the header content file does not exist', async () => {
    await addLicenseConfig({
      header: {
        content: {
          filePath: 'non-existent.txt',
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
          },
        },
      },
    });

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Could not find license header content file non-existent.txt',
    );
  });

  it('should error for a file with unknown line comment syntax', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.xyz': {
            lineStart: '// ',
          },
        },
      },
    });

    tree.write('test.xyz', `content`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Unknown file extension xyz',
    );
  });

  it('should error for a file with unknown block comment syntax', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.xyz': {
            blockStart: '/*',
            blockEnd: '*/',
          },
        },
      },
    });

    tree.write('test.xyz', `content`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Unknown file extension xyz',
    );
  });

  it('should error when a configured format would result in an invalid line comment', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            lineStart: '-- ',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided format for ts file would generate invalid comment syntax',
    );
  });

  it('should error when a configured format would result in an invalid block comment', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '-- ',
            blockEnd: ' --',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided format for ts file would generate invalid comment syntax',
    );
  });

  it('should error when a confgured license header would cause a syntax error by closing a block comment early', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test */ Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/*',
            blockEnd: '*/',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided license content would close a block comment early and cause a syntax error! Please remove "*/" from your license text.',
    );
  });

  it('should error when blockEnd does not close a block comment opened by blockStart', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/*',
            blockEnd: '// does not close',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided format for ts file opens a block comment with "/*" in blockStart but does not close it with "*/" in blockEnd',
    );
  });

  it('should allow a format which uses line comments in block start and end', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '// header',
            lineStart: '// ',
            blockEnd: '// footer',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(
      `// header\n// Test Header\n// footer\nconst x = 1;`,
    );
  });

  it('should allow a format which uses line comments in block start and omits block end', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '// header',
            lineStart: '// ',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(
      `// header\n// Test Header\nconst x = 1;`,
    );
  });

  it('should allow a format which uses line comments in block end and omits block start', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
            blockEnd: '// footer',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(
      `// Test Header\n// footer\nconst x = 1;`,
    );
  });

  it("should error when multiple block comments would be rendered and we couldn't therefore replace the header again", async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header Line 1', 'Test Header Line 2'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/* ',
            lineStart: '/* ',
            lineEnd: ' */',
            blockEnd: ' */',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'The license header content, or format for ts files would produce a header that cannot be safely replaced',
    );
  });

  it('should error when multiple block comments would be rendered from just block start and end', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header Line 1', 'Test Header Line 2'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/* something */',
            blockEnd: '/* something else */',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided format for ts file may cause syntax errors since it closes the block comment with "*/" in blockStart',
    );
  });

  it('should error when a block comment is terminated early by lineEnd', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header Line 1', 'Test Header Line 2'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/* something',
            lineStart: '//',
            lineEnd: ' */',
            blockEnd: ' */',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'The license header content, or format for ts files would produce a header that cannot be safely replaced',
    );
  });

  it('should error when a line comment spills over and tries to add non-comment code', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            lineStart: '//\nconsole.log("hack!"); //',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'The license header content, or format for ts files would produce a header that cannot be safely replaced',
    );
  });

  it("should error when content lines contain extra newlines that wouldn't render as comments", async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header\nconsole.log("hack!");'],
        },
        format: {
          '**/*.ts': {
            lineStart: '//',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'The license header content, or format for ts files would produce a header that cannot be safely replaced',
    );
  });

  it('should error when a blockEnd format double-ends a comment', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/*',
            blockEnd: '*/ console.log("hack!"); /* */',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided format for ts file may cause syntax errors due to closing a block comment multiple times with "*/" in blockEnd',
    );
  });

  it('should error when a blockStart format ends a block comment', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header Line 1', 'Test Header Line 2'],
        },
        format: {
          '**/*.ts': {
            blockStart: '/* something */console.log("hack!");/*',
            blockEnd: ' */',
          },
        },
      },
    });

    tree.write('test.ts', `const x = 1;`);

    await expect(licenseSyncGenerator(tree)).rejects.toThrow(
      'Provided format for ts file may cause syntax errors since it closes the block comment with "*/" in blockStart',
    );
  });

  it('should allow files to be excluded from license header updates', async () => {
    await addLicenseConfig({
      header: {
        content: {
          lines: ['Test Header'],
        },
        format: {
          '**/*.ts': {
            lineStart: '// ',
          },
        },
        exclude: ['**/excluded.ts'],
      },
    });

    tree.write('test.ts', `const x = 1;`);
    tree.write('excluded.ts', `const y = 2;`);

    await licenseSyncGenerator(tree);

    expect(tree.read('test.ts', 'utf-8')).toBe(`// Test Header\nconst x = 1;`);
    expect(tree.read('excluded.ts', 'utf-8')).toBe(`const y = 2;`);
  });

  it('should synchronise LICENSE files', async () => {
    await addLicenseConfig({
      spdx: 'MIT',
    });

    addProjectConfiguration(tree, 'without-license', {
      root: 'packages/without-license',
    });

    addProjectConfiguration(tree, 'with-bad-license', {
      root: 'packages/with-bad-license',
    });
    tree.write('packages/with-bad-license/LICENSE', 'bad license');

    const res = await licenseSyncGenerator(tree);

    expect(tree.exists('LICENSE')).toBeTruthy();
    expect(tree.read('LICENSE', 'utf-8')).toContain('MIT');
    expect(tree.exists('packages/without-license/LICENSE')).toBeTruthy();
    expect(tree.read('packages/without-license/LICENSE', 'utf-8')).toContain(
      'MIT',
    );

    expect(tree.exists('packages/with-bad-license/LICENSE')).toBeTruthy();
    expect(tree.read('packages/with-bad-license/LICENSE', 'utf-8')).toContain(
      'MIT',
    );

    expect(getOutOfSyncMessage(res)).toContain(
      'Project LICENSE files are out of sync:\n- LICENSE\n- packages/without-license/LICENSE\n- packages/with-bad-license/LICENSE',
    );
  });

  it('should allow subprojects to be excluded from LICENSE file sync', async () => {
    await addLicenseConfig({
      spdx: 'MIT',
      files: {
        exclude: ['packages/excluded-project'],
      },
    });

    addProjectConfiguration(tree, 'excluded-project', {
      root: 'packages/excluded-project',
    });

    await licenseSyncGenerator(tree);

    expect(tree.exists('packages/excluded-project/LICENSE')).toBeFalsy();
  });

  it('should synchronise package.json files', async () => {
    await addLicenseConfig({
      spdx: 'MIT',
    });

    addProjectConfiguration(tree, 'with-package', {
      root: 'packages/with-package',
    });
    tree.write(
      'packages/with-package/package.json',
      JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        license: 'Apache-2.0',
      }),
    );

    tree.write(
      'package.json',
      JSON.stringify({
        name: 'root-package',
        version: '1.0.0',
        license: 'Apache-2.0',
      }),
    );

    const res = await licenseSyncGenerator(tree);

    expect(
      JSON.parse(tree.read('packages/with-package/package.json', 'utf-8')),
    ).toEqual({
      name: 'test-package',
      version: '1.0.0',
      license: 'MIT',
    });

    expect(JSON.parse(tree.read('package.json', 'utf-8'))).toEqual({
      name: 'root-package',
      version: '1.0.0',
      license: 'MIT',
    });

    expect(getOutOfSyncMessage(res)).toContain(
      'Project package.json files are out of sync:\n- package.json\n- packages/with-package/package.json',
    );
  });

  it('should synchronise pyproject.toml files', async () => {
    await addLicenseConfig({
      spdx: 'MIT',
    });

    addProjectConfiguration(tree, 'python-project', {
      root: 'packages/python-project',
    });
    tree.write(
      'packages/python-project/pyproject.toml',
      '[project]\nname = "test-project"\nversion = "1.0.0"\nlicense = "Apache-2.0"',
    );

    const res = await licenseSyncGenerator(tree);

    // Should update license field
    expect(
      tree.read('packages/python-project/pyproject.toml', 'utf-8'),
    ).toContain('license = "MIT"');

    // Create LICENSE file and verify license-files is added
    tree.write('packages/python-project/LICENSE', 'MIT License');
    await licenseSyncGenerator(tree);
    expect(
      tree.read('packages/python-project/pyproject.toml', 'utf-8'),
    ).toContain('license-files = [ "LICENSE" ]');

    expect(getOutOfSyncMessage(res)).toContain(
      'Project pyproject.toml files are out of sync:\n- packages/python-project/pyproject.toml',
    );
  });

  it('should allow skipping pyproject.toml files while still synchronising package.json files', async () => {
    await addLicenseConfig({
      spdx: 'MIT',
      files: {
        exclude: ['**/pyproject.toml'],
      },
    });

    addProjectConfiguration(tree, 'mixed-project', {
      root: 'packages/mixed-project',
    });

    // Set up both package.json and pyproject.toml with Apache-2.0 license
    tree.write(
      'packages/mixed-project/package.json',
      JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        license: 'Apache-2.0',
      }),
    );
    tree.write(
      'packages/mixed-project/pyproject.toml',
      '[project]\nname = "test-project"\nversion = "1.0.0"\nlicense = "Apache-2.0"',
    );

    await licenseSyncGenerator(tree);

    // package.json should be updated to MIT
    expect(
      JSON.parse(tree.read('packages/mixed-project/package.json', 'utf-8')),
    ).toEqual({
      name: 'test-package',
      version: '1.0.0',
      license: 'MIT',
    });

    // pyproject.toml should remain unchanged with Apache-2.0
    expect(
      tree.read('packages/mixed-project/pyproject.toml', 'utf-8'),
    ).toContain('license = "Apache-2.0"');
  });

  it('should not update ignored files in git projects', async () => {
    const tmpDir = mkdtempSync('tmp-dir');

    try {
      const fsTree = new FsTree(tmpDir, false);
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email test@example.com', { cwd: tmpDir });
      execSync('git config user.name test', { cwd: tmpDir });

      // Add default config
      await addLicenseConfig(undefined, fsTree);

      fsTree.write('.gitignore', '*.js');
      fsTree.write('test.ts', "const x = 'foo';");
      fsTree.write('ignored.js', "const y = 'bar';");

      // Flush to ensure git is aware of the files
      flushChanges(fsTree.root, fsTree.listChanges());

      await licenseSyncGenerator(fsTree);

      expect(fsTree.read('test.ts', 'utf-8')).toBe(
        `// Test Header\nconst x = 'foo';`,
      );
      expect(fsTree.read('ignored.js', 'utf-8')).toBe(`const y = 'bar';`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      ext: 'ts',
      content: 'const x = 1;',
      format: {
        blockStart: '/*',
        blockEnd: '*/',
      },
      expected: '/*\nTest Header\n*/\nconst x = 1;',
      description: 'block comments (C-style)',
    },
    {
      ext: 'py',
      content: 'x = 1',
      format: {
        lineStart: '# ',
      },
      expected: '# Test Header\nx = 1',
      description: 'line comments (Python-style)',
    },
    {
      ext: 'html',
      content: '<div>test</div>',
      format: {
        blockStart: '<!--',
        blockEnd: '-->',
      },
      expected: '<!--\nTest Header\n-->\n<div>test</div>',
      description: 'block-only comments (HTML)',
    },
    {
      ext: 'sh',
      content: 'echo "hello"',
      format: {
        lineStart: '# ',
      },
      expected: '# Test Header\necho "hello"',
      description: 'line-only comments (shell)',
    },
    {
      ext: 'rb',
      content: 'puts "hello"',
      format: {
        blockStart: '=begin',
        blockEnd: '=end',
      },
      expected: '=begin\nTest Header\n=end\nputs "hello"',
      description: 'alternative block syntax (Ruby)',
    },
  ])(
    'should support popular languages: $description',
    async ({ ext, content, format, expected }) => {
      await addLicenseConfig({
        header: {
          content: {
            lines: ['Test Header'],
          },
          format: {
            [`**/*.${ext}`]: format,
          },
        },
      });

      tree.write(`test.${ext}`, content);
      await licenseSyncGenerator(tree);
      expect(tree.read(`test.${ext}`, 'utf-8')).toBe(expected);
    },
  );
});
