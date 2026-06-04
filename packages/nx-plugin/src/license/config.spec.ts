/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  defaultLicenseConfig,
  ensureDependencyCheckBlock,
  ensureLicenseExceptions,
  ensurePythonLicenseCollector,
  readLicenseConfig,
  writeLicenseConfig,
} from './config';
import { SPDXLicenseIdentifier } from './schema';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from '../utils/config/utils';
import { LicenseConfig } from './config-types';
import { DependencyCheckException } from './dependency-check/types';
import { beforeEach, afterEach, vi } from 'vitest';

const LICENSES: SPDXLicenseIdentifier[] = ['Apache-2.0', 'MIT', 'ASL'];

describe('license config', () => {
  let tree: Tree;

  const sampleConfig: LicenseConfig = {
    spdx: 'ASL',
    copyrightHolder: 'Test Inc.',
    header: {
      content: {
        lines: ['this is a test license header'],
      },
      format: {
        '**/*.js': {
          lineStart: '// ',
        },
      },
    },
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Mock Date to return a consistent year for snapshot tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaultLicenseConfig', () => {
    it.each(LICENSES)(
      'should generate default license config for %s',
      (spdx) => {
        expect(
          defaultLicenseConfig(spdx, 'Test Inc. or its affiliates'),
        ).toMatchSnapshot();
      },
    );
  });

  describe('readLicenseConfig', () => {
    it('should read license configuration', async () => {
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `
        export default {
          license: ${JSON.stringify(sampleConfig)}
        };
      `,
      );

      expect(await readLicenseConfig(tree)).toEqual(sampleConfig);
    });
  });

  describe('writeLicenseConfig', () => {
    it('should write license configuration', async () => {
      tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, `export default {}`);

      await writeLicenseConfig(tree, sampleConfig);

      expect(tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')).toContain(
        'this is a test license header',
      );
    });
  });

  describe('dependency check config writes', () => {
    const writeConfig = (body: string) =>
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `import { AwsNxPluginConfig } from '@aws/nx-plugin';\n\nexport default ${body} satisfies AwsNxPluginConfig;\n`,
      );

    const read = () => tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;

    const exception = (
      pkg: string,
      reason = 'because',
      spdx = 'MIT',
    ): DependencyCheckException => ({ package: pkg, reason, spdx });

    describe('ensureDependencyCheckBlock', () => {
      it('should add a dependencyCheck block to a license config', async () => {
        writeConfig(`{
  license: {
    spdx: 'Apache-2.0',
    copyrightHolder: 'Test',
  },
}`);

        await ensureDependencyCheckBlock(tree);

        const config = read();
        expect(config).toContain('dependencyCheck');
        expect(config).toContain('DEFAULT_LICENSE_ALLOWLIST');
        expect(config).toContain('npmCollector()');
        expect(config).not.toContain('pythonCollector');
        expect(config).toContain("from '@aws/nx-plugin/sdk/license'");
        expect(config).toMatchSnapshot();
      });

      it('should add pythonCollector when requested', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'Test' } }`,
        );

        await ensureDependencyCheckBlock(tree, {
          includeCollectors: 'npm+python',
        });

        const config = read();
        expect(config).toContain('npmCollector()');
        expect(config).toContain('pythonCollector()');
      });

      it('should preserve other license properties', async () => {
        writeConfig(`{
  license: {
    spdx: 'Apache-2.0',
    copyrightHolder: 'Test',
    header: {
      content: { lines: ['Copyright Test'] },
    },
  },
}`);

        await ensureDependencyCheckBlock(tree);

        const config = read();
        expect(config).toContain('header');
        expect(config).toContain('Copyright Test');
        expect(config).toContain('dependencyCheck');
      });

      it('should be idempotent and not overwrite an existing block', async () => {
        writeConfig(`{
  license: {
    spdx: 'Apache-2.0',
    copyrightHolder: 'Test',
    dependencyCheck: {
      allow: MY_CUSTOM_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [{ package: 'my-pkg', reason: 'mine', spdx: 'MIT' }],
    },
  },
}`);

        await ensureDependencyCheckBlock(tree);

        const config = read();
        expect(config).toContain('MY_CUSTOM_ALLOWLIST');
        expect(config).toContain('my-pkg');
        // Should not have added the default allowlist import or a second block
        expect(config).not.toContain('DEFAULT_LICENSE_ALLOWLIST');
        expect(config.match(/dependencyCheck/g)).toHaveLength(1);
      });

      it('should be a no-op when no config file exists', async () => {
        await expect(ensureDependencyCheckBlock(tree)).resolves.toBeUndefined();
        expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBe(false);
      });
    });

    describe('ensureLicenseExceptions', () => {
      it('should append to an empty exceptions array', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [],
      exceptions: [],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [exception('pkg-a')]);

        const config = await readAwsNxPluginConfig(tree);
        expect((config!.license as any).dependencyCheck.exceptions).toEqual([
          { package: 'pkg-a', reason: 'because', spdx: 'MIT' },
        ]);
      });

      it('should append to a non-empty exceptions array', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [],
      exceptions: [{ package: 'existing', reason: 'r', spdx: 'MIT' }],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [exception('pkg-b')]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions).toHaveLength(2);
        expect(exceptions.map((e: any) => e.package)).toEqual([
          'existing',
          'pkg-b',
        ]);
      });

      it('should add multiple exceptions', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: { allow: [], collectors: [], exceptions: [] },
  },
}`);

        await ensureLicenseExceptions(tree, [
          exception('pkg-a'),
          exception('pkg-b'),
          exception('pkg-c'),
        ]);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions.map(
            (e: any) => e.package,
          ),
        ).toEqual(['pkg-a', 'pkg-b', 'pkg-c']);
      });

      it('should be idempotent for an already-listed package', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [],
      exceptions: [{ package: 'pkg-a', reason: 'original reason', spdx: 'MIT' }],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [
          exception('pkg-a', 'a different reason'),
        ]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions).toHaveLength(1);
        // Original reason preserved — not overwritten
        expect(exceptions[0].reason).toBe('original reason');
      });

      it('should only add the missing exceptions from a mixed list', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [],
      exceptions: [{ package: 'pkg-a', reason: 'r', spdx: 'MIT' }],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [
          exception('pkg-a'),
          exception('pkg-b'),
        ]);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions.map(
            (e: any) => e.package,
          ),
        ).toEqual(['pkg-a', 'pkg-b']);
      });

      it('should preserve the allowlist and collectors when adding exceptions', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: MY_CUSTOM_ALLOWLIST,
      collectors: [npmCollector(), pythonCollector()],
      exceptions: [],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [exception('pkg-a')]);

        const config = read();
        expect(config).toContain('MY_CUSTOM_ALLOWLIST');
        expect(config).toContain('npmCollector()');
        expect(config).toContain('pythonCollector()');
        expect(config).toContain('pkg-a');
      });

      it('should escape special characters in the reason', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: { allow: [], collectors: [], exceptions: [] },
  },
}`);

        await ensureLicenseExceptions(tree, [
          exception('pkg-a', "it's a 'quoted' reason"),
        ]);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions[0].reason,
        ).toBe("it's a 'quoted' reason");
      });

      it('should be a no-op when dependencyCheck is not configured', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'Test' } }`,
        );

        await ensureLicenseExceptions(tree, [exception('pkg-a')]);

        expect(read()).not.toContain('pkg-a');
      });
    });

    describe('ensurePythonLicenseCollector', () => {
      it('should add pythonCollector to an existing collectors array', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [],
    },
  },
}`);

        await ensurePythonLicenseCollector(tree);

        const config = read();
        expect(config).toContain('npmCollector()');
        expect(config).toContain('pythonCollector()');
        expect(config).toContain("from '@aws/nx-plugin/sdk/license'");
      });

      it('should add pythonCollector to an empty collectors array', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: { allow: [], collectors: [], exceptions: [] },
  },
}`);

        await ensurePythonLicenseCollector(tree);

        expect(read()).toContain('pythonCollector()');
      });

      it('should be idempotent', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [npmCollector(), pythonCollector()],
      exceptions: [],
    },
  },
}`);

        await ensurePythonLicenseCollector(tree);

        const config = read();
        expect(config.match(/pythonCollector/g)).toHaveLength(1);
      });

      it('should be a no-op when dependencyCheck is not configured', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'Test' } }`,
        );

        await ensurePythonLicenseCollector(tree);

        expect(read()).not.toContain('pythonCollector');
      });
    });

    describe('combined orderings', () => {
      it('should support block -> python -> exceptions', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'Test' } }`,
        );

        await ensureDependencyCheckBlock(tree);
        await ensurePythonLicenseCollector(tree);
        await ensureLicenseExceptions(tree, [exception('pkg-a')]);

        const config = await readAwsNxPluginConfig(tree);
        const dc = (config!.license as any).dependencyCheck;
        expect(dc.exceptions.map((e: any) => e.package)).toEqual(['pkg-a']);
        expect(read()).toContain('pythonCollector()');
      });

      it('should support exceptions added across multiple calls', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'Test' } }`,
        );

        await ensureDependencyCheckBlock(tree, {
          includeCollectors: 'npm+python',
        });
        await ensureLicenseExceptions(tree, [exception('pkg-a')]);
        await ensureLicenseExceptions(tree, [exception('pkg-b')]);
        // Re-run the block ensure to confirm it doesn't clobber exceptions
        await ensureDependencyCheckBlock(tree);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions.map(
            (e: any) => e.package,
          ),
        ).toEqual(['pkg-a', 'pkg-b']);
      });
    });

    describe('array integrity (no holes)', () => {
      const noHole = (arr: any[]) => arr.every((e) => e != null);

      it('should not create a hole when appending to a multi-line exceptions array', async () => {
        // A prettier-formatted multi-element array has a trailing comma; a naive
        // append would capture it and produce a `[ ...a, , ...b ]` elision.
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [],
      exceptions: [
        { package: 'a', reason: 'r', spdx: 'MIT' },
        { package: 'b', reason: 'r', spdx: 'MIT' },
      ],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [exception('c')]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions).toHaveLength(3);
        expect(noHole(exceptions)).toBe(true);
        expect(exceptions.map((e: any) => e.package)).toEqual(['a', 'b', 'c']);
        // The raw source must not contain a bare double comma.
        expect(read().replace(/\{[^{}]*\}/g, 'X')).not.toMatch(/,\s*,/);
      });

      it('should not create a hole appending across separate calls (forward generator order)', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'T' } }`,
        );

        await ensureDependencyCheckBlock(tree);
        // First call adds 4 exceptions (array becomes multi-line w/ trailing comma)
        await ensureLicenseExceptions(tree, [
          exception('p1'),
          exception('p2'),
          exception('p3'),
          exception('p4'),
        ]);
        // Second, separate call (after a format pass) appends one more
        await ensureLicenseExceptions(tree, [exception('p5')]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions).toHaveLength(5);
        expect(noHole(exceptions)).toBe(true);
      });

      it('should repair (not propagate) a pre-existing hole when appending', async () => {
        // A config that already contains an elision should not keep growing holes.
        writeConfig(`{
  license: {
    dependencyCheck: {
      allow: [],
      collectors: [],
      exceptions: [
        { package: 'a', reason: 'r', spdx: 'MIT' },
        { package: 'b', reason: 'r', spdx: 'MIT' },
      ],
    },
  },
}`);

        await ensureLicenseExceptions(tree, [exception('c')]);
        await ensureLicenseExceptions(tree, [exception('d')]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(noHole(exceptions)).toBe(true);
        expect(exceptions.map((e: any) => e.package)).toEqual([
          'a',
          'b',
          'c',
          'd',
        ]);
      });

      it('should not create a hole appending to a multi-line collectors array', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [
        npmCollector(),
        npmCollector(),
      ],
      exceptions: [],
    },
  },
};`,
        );

        await ensurePythonLicenseCollector(tree);

        const config = await readAwsNxPluginConfig(tree);
        const collectors = (config!.license as any).dependencyCheck.collectors;
        expect(noHole(collectors)).toBe(true);
        expect(collectors).toHaveLength(3);
        expect(read()).toContain('pythonCollector()');
        // No bare double comma in the source.
        expect(read()).not.toMatch(/\(\),\s*,/);
      });
    });

    describe('writeLicenseConfig preserves dependencyCheck', () => {
      it('should keep a customized dependencyCheck block when re-writing the license', async () => {
        writeConfig(`{
  license: {
    spdx: 'Apache-2.0',
    copyrightHolder: 'Old',
    dependencyCheck: {
      allow: MY_CUSTOM_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [{ package: 'my-pkg', reason: 'vetted', spdx: 'GPL-3.0' }],
    },
  },
}`);

        await writeLicenseConfig(tree, {
          spdx: 'MIT',
          copyrightHolder: 'New Corp',
          header: { content: { lines: ['hello'] }, format: {} },
        });

        const config = read();
        // License header re-written
        expect(config).toContain('New Corp');
        // dependencyCheck customizations preserved verbatim
        expect(config).toContain('MY_CUSTOM_ALLOWLIST');
        expect(config).toContain('my-pkg');
        expect(config).toContain('npmCollector()');
        // Exactly one dependencyCheck block
        expect(config.match(/dependencyCheck/g)).toHaveLength(1);
      });

      it('should not add a dependencyCheck block if none existed', async () => {
        writeConfig(
          `{ license: { spdx: 'Apache-2.0', copyrightHolder: 'Old' } }`,
        );

        await writeLicenseConfig(tree, {
          spdx: 'MIT',
          copyrightHolder: 'New',
          header: { content: { lines: ['hi'] }, format: {} },
        });

        expect(read()).not.toContain('dependencyCheck');
      });

      it('should preserve a dependencyCheck whose reason contains backticks and ${}', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    spdx: 'Apache-2.0',
    copyrightHolder: 'Old',
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [{ package: 'tick', reason: 'has a \`backtick\` and \${dollar}', spdx: 'MIT' }],
    },
  },
};`,
        );

        await writeLicenseConfig(tree, {
          spdx: 'MIT',
          copyrightHolder: 'New',
          header: { content: { lines: ['hi'] }, format: {} },
        });

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions).toHaveLength(1);
        expect(exceptions[0].package).toBe('tick');
        expect(exceptions[0].reason).toBe('has a `backtick` and ${dollar}');
        expect((config!.license as any).copyrightHolder).toBe('New');
      });
    });

    describe('robustness against unusual config shapes', () => {
      it('should target the license dependencyCheck, not a same-shaped object elsewhere', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
const other = { dependencyCheck: { exceptions: [{ package: 'DECOY', reason: 'r', spdx: 'MIT' }] } };
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [{ package: 'a', reason: 'r', spdx: 'MIT' }],
    },
  },
};`,
        );

        await ensureLicenseExceptions(tree, [exception('real')]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions.map((e: any) => e.package)).toEqual(['a', 'real']);
        // The decoy object is untouched, and no placeholder leaked into source.
        expect(read()).toContain("package: 'DECOY'");
        expect(read()).not.toContain('PLACEHOLDER');
      });

      it('should round-trip a reason containing newlines, backslashes and backticks', async () => {
        writeConfig(`{
  license: {
    dependencyCheck: { allow: [], collectors: [], exceptions: [] },
  },
}`);

        await ensureLicenseExceptions(tree, [
          {
            package: 'weird',
            reason: 'line1\nline2 \\ back `tick` ${x}',
            spdx: 'MIT',
          },
        ]);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions[0].reason,
        ).toBe('line1\nline2 \\ back `tick` ${x}');
      });

      it('should preserve collector call arguments when adding pythonCollector', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector({ excludePackages: ['foo'] })],
      exceptions: [],
    },
  },
};`,
        );

        await ensurePythonLicenseCollector(tree);

        const source = read();
        expect(source).toContain("excludePackages: ['foo']");
        expect(source).toContain('pythonCollector()');
      });

      it('should leave the config untouched when collectors is not an array literal', async () => {
        const original = `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
const MY_COLLECTORS = [npmCollector()];
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: MY_COLLECTORS,
      exceptions: [],
    },
  },
};`;
        tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, original);

        await ensurePythonLicenseCollector(tree);

        // No safe array literal to edit — config is left valid and unchanged
        // rather than corrupted.
        await expect(readAwsNxPluginConfig(tree)).resolves.toBeDefined();
        expect(read()).not.toContain('pythonCollector()');
      });

      it('should remain valid across many sequential single appends', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default { license: { dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, collectors: [npmCollector()], exceptions: [] } } };`,
        );

        for (let i = 0; i < 12; i++) {
          await ensureLicenseExceptions(tree, [exception(`pkg-${i}`)]);
        }

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions).toHaveLength(12);
        expect(exceptions.every((e: any) => e != null)).toBe(true);
      });
    });

    describe('comments in the config', () => {
      it('should append without corrupting a trailing line comment', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [
        { package: 'a', reason: 'r', spdx: 'MIT' }, // keep me
      ],
    },
  },
};`,
        );

        await ensureLicenseExceptions(tree, [exception('b')]);

        const config = await readAwsNxPluginConfig(tree);
        const exceptions = (config!.license as any).dependencyCheck.exceptions;
        expect(exceptions.map((e: any) => e.package)).toEqual(['a', 'b']);
        // The new element is live (not swallowed by the comment) and the
        // comment is preserved.
        expect(read()).toContain('keep me');
      });

      it('should append when a comment sits before the closing bracket', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [
        { package: 'a', reason: 'r', spdx: 'MIT' },
        // add more below
      ],
    },
  },
};`,
        );

        await ensureLicenseExceptions(tree, [exception('b')]);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions.map(
            (e: any) => e.package,
          ),
        ).toEqual(['a', 'b']);
      });

      it('should add the first exception into a commented-but-empty array', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [
        // none yet
      ],
    },
  },
};`,
        );

        await ensureLicenseExceptions(tree, [exception('first')]);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.exceptions.map(
            (e: any) => e.package,
          ),
        ).toEqual(['first']);
      });

      it('should add pythonCollector around a comment in the collectors array', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    dependencyCheck: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [
        npmCollector(), // npm only for now
      ],
      exceptions: [],
    },
  },
};`,
        );

        await ensurePythonLicenseCollector(tree);

        const config = await readAwsNxPluginConfig(tree);
        expect(
          (config!.license as any).dependencyCheck.collectors,
        ).toHaveLength(2);
        expect(read()).toContain('pythonCollector()');
      });
    });

    describe('missing or unfindable arrays are skipped, not crashed', () => {
      it('should not crash when the exceptions key is missing', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default { license: { dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, collectors: [npmCollector()] } } };`,
        );

        await expect(
          ensureLicenseExceptions(tree, [exception('x')]),
        ).resolves.toBeUndefined();
        await expect(readAwsNxPluginConfig(tree)).resolves.toBeDefined();
      });

      it('should not crash when the collectors key is missing', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST } from '@aws/nx-plugin/sdk/license';
export default { license: { dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, exceptions: [] } } };`,
        );

        await expect(
          ensurePythonLicenseCollector(tree),
        ).resolves.toBeUndefined();
        await expect(readAwsNxPluginConfig(tree)).resolves.toBeDefined();
      });

      it('should not crash on an empty dependencyCheck object', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `export default { license: { dependencyCheck: {} } };`,
        );

        await ensureLicenseExceptions(tree, [exception('x')]);
        await ensurePythonLicenseCollector(tree);

        await expect(readAwsNxPluginConfig(tree)).resolves.toBeDefined();
      });

      it('should not crash when there is no license object at all', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `export default { iac: { provider: 'cdk' } };`,
        );

        await ensureLicenseExceptions(tree, [exception('x')]);
        await ensurePythonLicenseCollector(tree);
        await ensureDependencyCheckBlock(tree);

        await expect(readAwsNxPluginConfig(tree)).resolves.toBeDefined();
        expect(read()).not.toContain('dependencyCheck');
      });

      it('should not crash when exceptions is not an array literal', async () => {
        tree.write(
          AWS_NX_PLUGIN_CONFIG_FILE_NAME,
          `import { DEFAULT_LICENSE_ALLOWLIST, npmCollector } from '@aws/nx-plugin/sdk/license';
export default { license: { dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, collectors: [npmCollector()], exceptions: {} } } };`,
        );

        await expect(
          ensureLicenseExceptions(tree, [exception('x')]),
        ).resolves.toBeUndefined();
        await expect(readAwsNxPluginConfig(tree)).resolves.toBeDefined();
      });
    });
  });
});
