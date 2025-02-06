# License Generator

## Overview

This generator configures `LICENSE` files and source file headers for your project. After you run this generator, a [sync generator](https://nx.dev/concepts/sync-generators) is registered to execute as part of your `lint` targets which will ensure that your source files conform to the desired license content and format, as well as ensuring that your project's LICENSE files are correct, and licensing information is included in relevant project files.

## Usage

You can run the generator in two ways:

### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then generate your API:

1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "license"
4. Fill in the required parameters in the form
5. Click "Run"

### 2. Using CLI

Generate the API:

```bash
nx g @aws/nx-plugin:license my-api --copyrightHolder="My Company, Inc." --license=MIT
```

You can also perform a dry-run to see what files would be generated or updated without actually creating them:

```bash
nx g @aws/nx-plugin:license my-api --copyrightHolder="My Company, Inc." --license=MIT --dry-run
```

Both methods will configure the license sync generator to ensure that your project contains the correct LICENSE files, and source files specify the correct license header.

## Input Parameters

| Parameter       | Type   | Default                              | Description                                                                            |
| --------------- | ------ | ------------------------------------ | -------------------------------------------------------------------------------------- |
| license         | string | "Apache-2.0"                         | The SPDX license identifier for your chosen license.                                   |
| copyrightHolder | string | "Amazon.com, Inc. or its affiliates" | The copyright holder, included in the LICENSE file and source file headers by default. |

## Expected Output

The generator will create or update the following files:

```
└── nx.json                    # The "lint" target is configured to sync LICENSE files and source file headers
└── aws-nx-plugin.config.mts   # Configuration for the license sync, such as customising the license header content and format for different languages
```

Some default configuration for license header content and format is added to `aws-nx-plugin.config.mts` to write appropriate headers for a handful of file types. You may wish to customise this further; please see the [configuration section](#configuration) below.

## License Sync Behaviour

The license sync generator performs three main tasks:

### 1. Synchronise Source File License Headers

When the sync generator is run, it will ensure that all source code files in your workspace (based on your configuration) contain the appropriate license header. The header is written as the first block comment or consecutive series of line comments in the file (besides the shebang/hashbang if present in a file).

You can update the configuration at any time to change which files should be included or excluded, as well as the content or format of license headers for different file types. For more details, please see the [configuration section](#configuration) below.

### 2. Synchronise LICENSE Files

When the sync generator is run, it will ensure that the root `LICENSE` file corresponds to your configured license, as well as ensuring that all subprojects in your workspace also contain the correct `LICENSE` file.

You can exclude projects in the configuration if required. For more details, please see the [configuration section](#configuration) below.

### 3. Synchronise licensing information in project files

When the sync generator is run, it will ensure the `license` fields in `package.json` and `pyproject.toml` files are set to your configured license.

You can exclude projects in the configuration if required. For more details, please see the [configuration section](#configuration) below.

## Configuration

Configuration is defined in the `aws-nx-plugin.config.mts` file in the root of your workspace.

### SPDX and Copyright Holder

Your chosen license can be updated at any time via the `spdx` configuration property:

```typescript
{
  license: {
    spdx: 'MIT',
  }
}
```

When the sync generator runs, all `LICENSE` files, `package.json` and `pyproject.toml` files will be updated to reflect the configured license.

You can additionally configure the copyright holder and copyright year, which are included in some `LICENSE` files:

```typescript
{
  license: {
    spdx: 'MIT',
    copyrightHolder: 'Amazon.com, Inc. or its affiliates',
    copyrightYear: 2025,
  }
}
```

### License Headers

#### Content

The license header content can be configured in two ways:

1. Using inline content:

```typescript
{
  license: {
    header: {
      content: {
        lines: ['Copyright My Company, Inc.', 'Licensed under MIT License', 'All rights reserved'];
      }
      // ... format configuration
    }
  }
}
```

2. Loading from a file:

```typescript
{
  license: {
    header: {
      content: {
        filePath: 'license-header.txt'; // relative to workspace root
      }
      // ... format configuration
    }
  }
}
```

#### Including files and specifying header format

You can specify how license headers should be formatted for different file types using glob patterns. The format configuration supports line comments, block comments, or a combination of both:

```typescript
{
  license: {
    header: {
      content: {
        lines: ['Copyright notice here']
      },
      format: {
        // Line comments
        '**/*.ts': {
          lineStart: '// '
        },

        // Block comments
        '**/*.css': {
          blockStart: '/*',
          blockEnd: '*/'
        },

        // Block comments with line prefixes
        '**/*.java': {
          blockStart: '/*',
          lineStart: ' * ',
          blockEnd: ' */'
        },

        // Line comments with header/footer
        '**/*.py': {
          blockStart: '# ------------',
          lineStart: '# ',
          blockEnd: '# ------------'
        }
      }
    }
  }
}
```

The format configuration supports:

- `blockStart`: Text written before the license content (e.g., to start a block comment)
- `lineStart`: Text prepended to each line of the license content
- `lineEnd`: Text appended to each line of the license content
- `blockEnd`: Text written after the license content (e.g., to end a block comment)

#### Custom comment syntax

For file types that aren't natively supported, you can specify custom comment syntax:

```typescript
{
  license: {
    header: {
      content: {
        lines: ['My license header']
      },
      format: {
        '**/*.xyz': {
          lineStart: '## '
        }
      },
      commentSyntax: {
        xyz: {
          line: '##'  // Define line comment syntax
        },
        abc: {
          block: {    // Define block comment syntax
            start: '<!--',
            end: '-->'
          }
        }
      }
    }
  }
}
```

This tells the sync generator how to identify existing license headers in these file types. The `commentSyntax` configuration supports:

- `line`: Characters that start a line comment
- `block`: Characters that start and end a block comment

#### Excluding files

By default, in a git repository, all `.gitignore` files are honored to ensure that only files managed by version control are synchronized. In non-git repositories, all files are considered unless explicitly excluded in configuration.

You can exclude additional files from license header synchronization using glob patterns:

```typescript
{
  license: {
    header: {
      content: {
        lines: ['My license header']
      },
      format: {
        '**/*.ts': {
          lineStart: '// '
        }
      },
      exclude: [
        '**/generated/**',
        '**/dist/**',
        'some-specific-file.ts'
      ]
    }
  }
}
```

### Excluding project files from sync

All `LICENSE` files, `package.json` files and `pyproject.toml` files are synchronised with the configured license by default.

You can exclude specific projects or files from synchronization using glob patterns:

```typescript
{
  license: {
    files: {
      exclude: [
        'packages/excluded-project', // do not sync LICENSE file, package.json or pyproject.toml
        'apps/internal/LICENSE', // do not sync LICENSE file, but sync package.json and/or pyproject.toml
      ];
    }
  }
}
```

## Disabling license sync

To disable the license sync generator:

1. Remove the `license` section from your configuration in `aws-nx-plugin.config.mts` (or remove the `aws-nx-plugin.config.mts` file)
2. Remove the `@aws/nx-plugin:license#sync` generator from `targetDefaults.lint.syncGenerators`

To re-enable license sync, simply run the `license` generator again.
