/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  readAwsNxPluginConfig,
  updateAwsNxPluginConfig,
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
} from './utils';
import { LicenseLinesContent } from '../../license/config-types';

describe('config utils', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await ensureAwsNxPluginConfig(tree);
  });

  it('should ensure config exists', async () => {
    expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBe(true);
  });

  it('should update user config', async () => {
    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Test Copyright Header'] },
          format: {
            '**/*.ts': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();

    expect(
      (
        (await readAwsNxPluginConfig(tree)).license.header
          .content as LicenseLinesContent
      ).lines[0],
    ).toBe('Test Copyright Header');

    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Test Copyright Header 2'] },
          format: {
            '**/*.ts': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    expect(
      (
        (await readAwsNxPluginConfig(tree)).license.header
          .content as LicenseLinesContent
      ).lines[0],
    ).toBe('Test Copyright Header 2');
  });

  it('should not delete other user config', async () => {
    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Test Copyright Header'] },
          format: {
            '**/*.ts': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    await updateAwsNxPluginConfig(tree, {});

    expect(
      (
        (await readAwsNxPluginConfig(tree)).license.header
          .content as LicenseLinesContent
      ).lines[0],
    ).toBe('Test Copyright Header');
  });

  it('should snapshot simple iac config', async () => {
    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'CDK' },
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should snapshot config with tags', async () => {
    await updateAwsNxPluginConfig(tree, {
      tags: ['tag1', 'tag2', 'tag3'],
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should snapshot merged config with multiple keys', async () => {
    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'CDK' },
    });
    await updateAwsNxPluginConfig(tree, {
      tags: ['tag1'],
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();

    const config = await readAwsNxPluginConfig(tree);
    expect(config.iac.provider).toBe('CDK');
    expect(config.tags).toEqual(['tag1']);
  });

  it('should handle config with special characters in values', async () => {
    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Copyright "Foo" Inc.'] },
          format: {
            '**/*.{js,ts,jsx,tsx}': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
          },
        },
      },
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();

    const config = await readAwsNxPluginConfig(tree);
    expect(
      (config.license.header.content as LicenseLinesContent).lines[0],
    ).toBe('Copyright "Foo" Inc.');
  });

  it('should handle config without satisfies clause', async () => {
    tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, `export default {}`);

    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'CDK' },
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();

    const config = await readAwsNxPluginConfig(tree);
    expect(config.iac.provider).toBe('CDK');
  });

  it('should preserve JS expressions when updating a different key', async () => {
    tree.write(
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `import { AwsNxPluginConfig } from "@aws/nx-plugin";

export default {
  license: {
    header: {
      content: { lines: [\`Copyright \${new Date().getFullYear()} Foo Inc.\`] },
    },
  },
} satisfies AwsNxPluginConfig;
`,
    );

    // Update a DIFFERENT key — license should be left untouched
    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'CDK' },
    });

    const content = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
    // The template literal must still be present in source
    expect(content).toContain('${new Date().getFullYear()}');
    // The new key must be added (prettier may reformat quotes)
    expect(content).toContain('CDK');
    expect(content).toContain('iac');

    expect(content).toMatchSnapshot();
  });

  it('should preserve JS expressions when updating an unrelated key alongside', async () => {
    tree.write(
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `import { AwsNxPluginConfig } from "@aws/nx-plugin";

export default {
  license: {
    copyrightHolder: "Acme",
    header: {
      content: { lines: [\`Copyright \${new Date().getFullYear()} Acme\`] },
    },
  },
  iac: { provider: "CDK" },
} satisfies AwsNxPluginConfig;
`,
    );

    // Replace iac — license (with JS expression) should be unchanged
    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'Terraform' },
    });

    const content = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
    expect(content).toContain('${new Date().getFullYear()}');
    expect(content).toContain('Terraform');
    expect(content).not.toContain('CDK');

    expect(content).toMatchSnapshot();
  });

  it('should replace a key that contains JS expressions when explicitly updated', async () => {
    tree.write(
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `import { AwsNxPluginConfig } from "@aws/nx-plugin";

export default {
  license: {
    header: {
      content: { lines: [\`Copyright \${new Date().getFullYear()} Old\`] },
    },
  },
} satisfies AwsNxPluginConfig;
`,
    );

    // Explicitly replacing the license key — should overwrite the JS expression
    await updateAwsNxPluginConfig(tree, {
      license: {
        header: {
          content: { lines: ['Static Copyright 2026'] },
        },
      },
    });

    const content = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
    expect(content).not.toContain('${new Date().getFullYear()}');
    expect(content).toContain('Static Copyright 2026');
  });

  it('should add multiple new keys to an empty config', async () => {
    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'CDK' },
      tags: ['a', 'b'],
    });

    expect(
      tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8'),
    ).toMatchSnapshot();

    const config = await readAwsNxPluginConfig(tree);
    expect(config.iac.provider).toBe('CDK');
    expect(config.tags).toEqual(['a', 'b']);
  });

  it('should handle config without satisfies clause and JS expressions', async () => {
    tree.write(
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `export default {
  license: {
    header: {
      content: { lines: [\`Copyright \${new Date().getFullYear()}\`] },
    },
  },
}`,
    );

    await updateAwsNxPluginConfig(tree, {
      iac: { provider: 'CDK' },
    });

    const content = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
    expect(content).toContain('${new Date().getFullYear()}');
    expect(content).toContain('CDK');
  });
});
