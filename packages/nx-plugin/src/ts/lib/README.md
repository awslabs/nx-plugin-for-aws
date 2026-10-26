# TypeScript Library Generator

## Overview
This generator creates a new TypeScript library with modern configuration and best practices. It sets up a complete TypeScript project with ESM modules, proper build configuration, and optional linting and testing support. The generator is designed to create reusable TypeScript packages that can be shared across your organization's projects.

## Usage

You can generate a new TypeScript library in two ways:

### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:
1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then generate your library:
1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "ts#lib"
4. Fill in the required parameters in the form
5. Click "Run"

### 2. Using CLI

Generate the library:
```bash
nx g @aws/nx-plugin:ts#lib my-lib --directory=packages
```

You can also perform a dry-run to see what files would be generated without actually creating them:
```bash
nx g @aws/nx-plugin:ts#lib my-lib --directory=packages --dry-run
```

Both methods will create a new TypeScript library in the specified directory with all the necessary configuration.

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| name* | string | - | Library name (required). Used to generate package name and file paths. |
| directory | string | "packages" | Parent directory where the library is placed. |
| linter | string | "eslint" | The tool to use for running lint checks. Options: eslint, none |
| unitTestRunner | string | "none" | Test runner to use for unit tests. Options: jest, vitest, none |
| scope | string | - | Scope for your package (e.g., @my-company). If omitted, this will be inferred from your project configuration. Must be in format @scope or @scope/subscope. |
| subDirectory | string | library name | The sub directory the lib is placed in. By default, this is the library name. |

*Required parameter

## Expected Output

The generator creates a TypeScript library with the following structure:

```
<directory>/<sub-directory>/
├── src/
│   └── index.ts          # Main entry point for your library
├── tsconfig.json        # TypeScript configuration
├── tsconfig.lib.json    # TypeScript build configuration
├── project.json        # Project configuration and build targets
└── .eslintrc.json     # ESLint configuration (if enabled)
```

Additionally, it:
1. Configures the project for ESM (ECMAScript Modules)
2. Sets up proper TypeScript configuration for library development
3. Configures build settings for production deployment
4. Sets up linting with ESLint (if enabled)
5. Configures test runner (if enabled)
6. Installs required dependencies

## Best Practices

### 1. Export Patterns

Use explicit exports in your index.ts:

```typescript
// Good
export { MyClass } from './my-class';
export type { MyType } from './types';

// Avoid
export * from './everything';
```

### 2. TypeScript Configuration

The generator sets up optimal TypeScript configuration, but you can customize it.

### 3. Testing Setup

If you enable testing, follow these practices:

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

### 4. Documentation

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

### 5. Build Process

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
