/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { cjsToEsmGenerator } from './generator';
import { CjsToEsmGeneratorSchema } from './schema';
import { describe, it, expect, beforeEach } from 'vitest';
import tsLibGenerator from '../lib/generator';
describe('ts cjs-to-esm generator', () => {
  let tree: Tree;
  const options: CjsToEsmGeneratorSchema = { project: '@proj/test' };
  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await tsLibGenerator(tree, {
      name: 'test',
      skipInstall: true,
    });
  });
  it('should convert CommonJS requires to imports', async () => {
    tree.write(
      'test/src/example.ts',
      `
        const fs = require('fs');
      `
    );
    await cjsToEsmGenerator(tree, options);
    const content = tree.read('test/src/example.ts', 'utf8');
    expect(content).toContain("import fs from 'fs'");
    expect(content).not.toContain('require');
  });
  it('should convert destructured CommonJS requires to imports', async () => {
    tree.write(
      'test/src/example.ts',
      `
        const { foo, bar } = require('example');
      `
    );
    await cjsToEsmGenerator(tree, options);
    const content = tree.read('test/src/example.ts', 'utf8');
    expect(content).toContain("import { foo, bar } from 'example'");
    expect(content).not.toContain('require');
  });
  it('should convert module.exports to export default', async () => {
    tree.write(
      'test/src/example.ts',
      `
        module.exports = {
          foo: 42,
        };
      `
    );
    await cjsToEsmGenerator(tree, options);
    const content = tree.read('test/src/example.ts', 'utf8');
    expect(content).toContain('export default {');
    expect(content).not.toContain('module.exports');
  });
  it('should handle inline requires', async () => {
    tree.write(
      'test/src/example.ts',
      `
        module.exports = {
          foo: require('example')
        }
      `
    );
    await cjsToEsmGenerator(tree, options);
    const content = tree.read('test/src/example.ts', 'utf8');
    expect(content).toContain("import _import0 from 'example'");
    expect(content).toContain('foo: _import0');
    expect(content).not.toContain('require');
  });
  it('should handle multiple inline requires', async () => {
    tree.write(
      'test/src/example.ts',
      `
        module.exports = {
          foo: require('example'),
          bar: require('bar'),
        }
      `
    );
    await cjsToEsmGenerator(tree, options);
    const content = tree.read('test/src/example.ts', 'utf8');
    expect(content).toContain("import _import0 from 'example'");
    expect(content).toContain("import _import1 from 'bar'");
    expect(content).toContain('foo: _import0');
    expect(content).toContain('bar: _import1');
    expect(content).not.toContain('require');
  });
  it('should handle multiple requires in the same file', async () => {
    tree.write(
      'test/src/example.ts',
      `
        const fs = require('fs');
        const { join } = require('path');
        module.exports = {
          util: require('util')
        };
      `
    );
    await cjsToEsmGenerator(tree, options);
    const content = tree.read('test/src/example.ts', 'utf8');
    expect(content).toContain("import fs from 'fs'");
    expect(content).toContain("import { join } from 'path'");
    expect(content).toContain("import _import0 from 'util'");
    expect(content).toContain('util: _import0');
    expect(content).not.toContain('require');
    expect(content).not.toContain('module.exports');
  });
  it('should only convert files matching the include pattern', async () => {
    // Create multiple files with different extensions
    tree.write('test/src/example.ts', `const fs = require('fs');`);
    tree.write('test/src/example.js', `const path = require('path');`);
    tree.write('test/src/example.mjs', `const util = require('util');`);
    // Run generator with specific include pattern
    await cjsToEsmGenerator(tree, {
      ...options,
      include: '**/*.ts',
    });
    // Check that only .ts file was converted
    const tsContent = tree.read('test/src/example.ts', 'utf8');
    const jsContent = tree.read('test/src/example.js', 'utf8');
    const mjsContent = tree.read('test/src/example.mjs', 'utf8');
    expect(tsContent).toContain("import fs from 'fs'");
    expect(tsContent).not.toContain('require');
    expect(jsContent).toContain("require('path')");
    expect(mjsContent).toContain("require('util')");
  });
  it('should exclude files matching the exclude pattern', async () => {
    // Create multiple files
    tree.write('test/src/example.ts', `const fs = require('fs');`);
    tree.write('test/src/excluded.ts', `const path = require('path');`);
    // Run generator with exclude pattern
    await cjsToEsmGenerator(tree, {
      ...options,
      exclude: '**/excluded.ts',
    });
    // Check that only non-excluded file was converted
    const includedContent = tree.read('test/src/example.ts', 'utf8');
    const excludedContent = tree.read('test/src/excluded.ts', 'utf8');
    expect(includedContent).toContain("import fs from 'fs'");
    expect(includedContent).not.toContain('require');
    expect(excludedContent).toContain("require('path')");
  });
  it('should respect both include and exclude patterns', async () => {
    // Create multiple files
    tree.write('test/src/example.ts', `const fs = require('fs');`);
    tree.write('test/src/example.js', `const path = require('path');`);
    tree.write('test/src/excluded.ts', `const util = require('util');`);
    // Run generator with both include and exclude patterns
    await cjsToEsmGenerator(tree, {
      ...options,
      include: '**/*.ts',
      exclude: '**/excluded.ts',
    });
    // Check that only matching files were converted
    const includedTsContent = tree.read('test/src/example.ts', 'utf8');
    const jsContent = tree.read('test/src/example.js', 'utf8');
    const excludedContent = tree.read('test/src/excluded.ts', 'utf8');
    expect(includedTsContent).toContain("import fs from 'fs'");
    expect(includedTsContent).not.toContain('require');
    expect(jsContent).toContain("require('path')");
    expect(excludedContent).toContain("require('util')");
  });
});
