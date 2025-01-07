# TypeScript Library Generator

## Overview

This generator creates a new TypeScript library with modern configuration and best practices. It sets up a complete TypeScript project with ESM modules, proper build configuration, and optional linting and testing support. The generator is designed to create reusable TypeScript packages that can be shared across your organization's projects.

## How to generate a TypeScript library

You can generate a new TypeScript library in two ways.

### Using VSCode IDE

Install the NX Console extension for VSCode:

1. Open VSCode.
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X).
3. Search for "Nx Console".
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console).

To generate your library:

1. Open the NX Console in VSCode.
2. Choose **Generate**.
3. Search for "ts#lib"
4. Fill in the required parameters in the form, and choose **Run**.

### Using the CLI

To generate the library:

```bash
nx g @aws/nx-plugin:ts#lib my-lib --directory=packages
```

To perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:ts#lib my-lib --directory=packages --dry-run
```

Both methods create a new TypeScript library in the specified directory with all the necessary configuration.

## Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| name* | string | - | Library name (required). Used to generate package name and file paths. |
| directory | string | "packages" | Parent directory where the library is placed. |
| linter | string | "eslint" | The tool to use for running lint checks. Options: eslint, none |
| unitTestRunner | string | "none" | Test runner to use for unit tests. Options: jest, vitest, none |
| scope | string | - | Scope for your package (e.g., @my-company). If omitted, this will be inferred from your project configuration. Must be in format @scope or @scope/subscope. |
| subDirectory | string | library name | The sub directory the lib is placed in. By default, this is the library name. |

*Required parameters

## Expected output

The generator creates a TypeScript library with the following structure.

```
<directory>/<sub-directory>/
├── src/
│   └── index.ts          # Main entry point for your library
├── tsconfig.json        # TypeScript configuration
├── tsconfig.lib.json    # TypeScript build configuration
├── project.json        # Project configuration and build targets
└── .eslintrc.json     # ESLint configuration (if enabled)
```

Additionally, the generator:

1. Configures the project for ESM (ECMAScript Modules).
2. Sets up proper TypeScript configuration for library development.
3. Configures build settings for production deployment.
4. Sets up linting with ESLint (if enabled).
5. Configures test runner (if enabled).
6. Installs any required dependencies.

## Best practices

### Export patterns

Use explicit exports in your index.ts.

```typescript
// Good
export { MyClass } from './my-class';
export type { MyType } from './types';

// Avoid
export * from './everything';
```

### TypeScript configuration

While the generator sets up optimal TypeScript configuration, you can customize it.

### Testing setup

If you enable testing, follow these practices.

```typescript
// my-feature.test.ts
describe('MyFeature', () => {
  it('should handle basic case', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = processInput(input);
    
    // Assert
    expect(result).toBe('TEST');
  });
});
```

### Documentation

Add JSDoc comments to your public APIs:

```typescript
/**
 * Processes the input string according to business rules.
 * 
 * @param input - The string to process
 * @returns The processed string
 * @throws {ValidationError} If input is invalid
 * 
 * @example
 * ```ts
 * const result = processInput('test');
 * console.log(result); // 'TEST'
 * ```
 */
export function processInput(input: string): string {
  // Implementation
}
```

### Build process

The generator configures a build process that:

- Compiles TypeScript to JavaScript
- Generates type definitions
- Creates source maps
- Handles ESM modules properly

You can build your library using:

```bash
nx build my-lib
```

This will create a `dist` directory in the root of your monorepo with your compiled library ready for distribution.