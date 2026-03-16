# GritQL Migration Plan: Replace tsquery/TypeScript Factory AST Manipulation

## Overview

This plan documents all AST manipulation occurrences across the codebase that currently use `tsquery` and TypeScript `factory` methods, and outlines how to replace each with GritQL patterns. The key paradigm shift is that **imports should be handled via `ensure_import_from`** as part of the GritQL transform that needs them, rather than as separate explicit calls.

## Current AST Utility Functions in [`ast.ts`](packages/nx-plugin/src/utils/ast.ts)

| Function                         | Purpose                                      | GritQL Replacement Strategy                                                   |
| -------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `addDestructuredImport`          | Add named imports to a file                  | Replace with `ensure_import_from` in the GritQL pattern that needs the import |
| `addSingleImport`                | Add default import to a file                 | Replace with `ensure_import_from` in the GritQL pattern that needs the import |
| `addStarExport`                  | Add `export * from '...'` statement          | GritQL pattern to add export if not present                                   |
| `replace`                        | Replace nodes matching a tsquery selector    | GritQL rewrite pattern                                                        |
| `replaceIfExists`                | Replace nodes if they match, no-op otherwise | GritQL rewrite pattern (naturally idempotent)                                 |
| `query`                          | Query nodes matching a tsquery selector      | `hasGritQLMatch` for boolean checks                                           |
| `prependStatements`              | Prepend statements to file                   | GritQL file-level pattern                                                     |
| `appendStatements`               | Append statements to file                    | GritQL file-level pattern                                                     |
| `createJsxElementFromIdentifier` | Create JSX wrapper element                   | GritQL rewrite with JSX snippets                                              |
| `createJsxElement`               | Create JSX element from parts                | GritQL rewrite with JSX snippets                                              |
| `jsonToAst`                      | Convert JSON to TypeScript AST               | Keep as utility - used for dynamic object construction                        |
| `hasExportDeclaration`           | Check if identifier is exported              | `hasGritQLMatch`                                                              |
| `applyGritQLTransform`           | Already uses GritQL                          | Keep as-is                                                                    |
| `hasGritQLMatch`                 | Already uses GritQL                          | Keep as-is                                                                    |

---

## Occurrence Inventory

### Category 1: Import Management (use `ensure_import_from`)

These are standalone import additions that should be folded into the GritQL transform that needs them.

#### 1.1 [`ts/react-website/app/generator.ts`](packages/nx-plugin/src/ts/react-website/app/generator.ts)

- **Line 343**: `addDestructuredImport(tree, viteConfigPath, ['tanstackRouter'], '@tanstack/router-plugin/vite')`
- **Line 350**: `addDestructuredImport(tree, viteConfigPath, ['resolve'], 'path')`
- **Line 353**: `addSingleImport(tree, viteConfigPath, 'tsconfigPaths', 'vite-tsconfig-paths')`
- **Line 362**: `addSingleImport(tree, viteConfigPath, 'tailwindcss', '@tailwindcss/vite')`
- **Strategy**: Fold these into the `replaceIfExists` GritQL pattern on the vite config ObjectLiteralExpression (line 365), using `ensure_import_from` within the same pattern.

#### 1.2 [`ts/lib/eslint.ts`](packages/nx-plugin/src/ts/lib/eslint.ts)

- **Line 58**: `addSingleImport(tree, eslintConfigPath, 'eslintPluginPrettierRecommended', 'eslint-plugin-prettier/recommended')`
- **Strategy**: Fold into the GritQL pattern that adds `eslintPluginPrettierRecommended` to the exports array, using `ensure_import_from`.

#### 1.3 [`trpc/react/generator.ts`](packages/nx-plugin/src/trpc/react/generator.ts)

- **Line 110**: `addSingleImport(tree, mainTsxPath, 'QueryClientProvider', './components/QueryClientProvider')`
- **Line 118**: `addSingleImport(tree, mainTsxPath, clientProviderName, './components/${clientProviderName}')`
- **Strategy**: Fold into the GritQL patterns that wrap `<App />` with these providers, using `ensure_import_from`.

#### 1.4 [`utils/connection/open-api/react.ts`](packages/nx-plugin/src/utils/connection/open-api/react.ts)

- **Line 208**: `addSingleImport(tree, mainTsxPath, 'QueryClientProvider', './components/QueryClientProvider')`
- **Line 232**: `addSingleImport(tree, mainTsxPath, providerName, './components/${providerName}')`
- **Strategy**: Same as 1.3 - fold into JSX wrapping patterns.

#### 1.5 [`ts/react-website/cognito-auth/generator.ts`](packages/nx-plugin/src/ts/react-website/cognito-auth/generator.ts)

- **Line 106**: `addSingleImport(tree, mainTsxPath, 'CognitoAuth', './components/CognitoAuth')`
- **Line 141**: `addDestructuredImport(tree, appLayoutTsxPath, ['useAuth'], 'react-oidc-context')`
- **Strategy**: Fold into the JSX wrapping and variable declaration patterns.

#### 1.6 [`ts/react-website/cognito-auth/utils.ts`](packages/nx-plugin/src/ts/react-website/cognito-auth/utils.ts)

- **Line 390**: `addDestructuredImport(tree, appLayoutTsxPath, ['useEffect', 'useRef', 'useState'], 'react')`
- **Strategy**: Fold into the GritQL pattern that adds state/ref/effect to AppLayout.

#### 1.7 [`utils/ast/website.ts`](packages/nx-plugin/src/utils/ast/website.ts)

- **Line 63**: `addDestructuredImport(tree, mainTsxPath, [hook], module)`
- **Strategy**: Fold into the GritQL patterns that modify the RouterProviderContext.

#### 1.8 [`ts/react-website/runtime-config/generator.ts`](packages/nx-plugin/src/ts/react-website/runtime-config/generator.ts)

- **Line 75-85**: `prependStatements` with a manually created import declaration for `RuntimeConfigProvider`
- **Strategy**: Use `ensure_import_from` in the GritQL pattern that wraps `<App />` with `<RuntimeConfigProvider>`.

---

### Category 2: JSX Wrapping Transforms

These wrap an existing JSX element with a new parent element. This is a common pattern that GritQL handles well.

#### 2.1 Wrap `<App />` with provider

- **Files**: [`trpc/react/generator.ts:134-140`](packages/nx-plugin/src/trpc/react/generator.ts:134), [`utils/connection/open-api/react.ts:214-220`](packages/nx-plugin/src/utils/connection/open-api/react.ts:214)
- **Current**: `replace(tree, mainTsxPath, 'JsxSelfClosingElement[tagName.name="App"]', (node) => createJsxElementFromIdentifier('QueryClientProvider', [node]))`
- **GritQL Pattern**:
  ```
  `<App />` => `<QueryClientProvider><App /></QueryClientProvider>` where {
    $source = `"./components/QueryClientProvider"`,
    `QueryClientProvider` <: ensure_import_from($source)
  }
  ```

#### 2.2 Wrap children of `<RuntimeConfigProvider>` with `<CognitoAuth>`

- **File**: [`ts/react-website/cognito-auth/generator.ts:122-132`](packages/nx-plugin/src/ts/react-website/cognito-auth/generator.ts:122)
- **Current**: Replace `JsxElement[openingElement.tagName.name="RuntimeConfigProvider"]` to wrap children with `CognitoAuth`
- **GritQL Pattern**:
  ```
  `<RuntimeConfigProvider>$children</RuntimeConfigProvider>` => `<RuntimeConfigProvider><CognitoAuth>$children</CognitoAuth></RuntimeConfigProvider>` where {
    $source = `"./components/CognitoAuth"`,
    `CognitoAuth` <: ensure_import_from($source)
  }
  ```

#### 2.3 Wrap `<App />` with `<RuntimeConfigProvider>`

- **File**: [`ts/react-website/runtime-config/generator.ts:88-110`](packages/nx-plugin/src/ts/react-website/runtime-config/generator.ts:88)
- **GritQL Pattern**:
  ```
  `<App />` => `<RuntimeConfigProvider><App /></RuntimeConfigProvider>` where {
    $source = `"./components/RuntimeConfig"`,
    `RuntimeConfigProvider` <: ensure_import_from($source)
  }
  ```

---

### Category 3: Object/Array Manipulation Transforms

These modify object literals or arrays in config files.

#### 3.1 Add element to eslint config array

- **File**: [`ts/lib/eslint.ts:74-88`](packages/nx-plugin/src/ts/lib/eslint.ts:74)
- **Current**: Prepend `eslintPluginPrettierRecommended` to `ExportAssignment > ArrayLiteralExpression`
- **GritQL Pattern**: Use accumulate (`+=`) to add to array

#### 3.2 Add ignores object to eslint config

- **File**: [`ts/lib/eslint.ts:130-151`](packages/nx-plugin/src/ts/lib/eslint.ts:130)
- **Current**: Append `{ ignores: [] }` to exports array if not present
- **GritQL Pattern**: Conditional accumulate

#### 3.3 Add ignore patterns to ignores array

- **File**: [`ts/lib/eslint.ts:158-177`](packages/nx-plugin/src/ts/lib/eslint.ts:158)
- **Current**: Add string patterns to ignores array
- **GritQL Pattern**: Accumulate with dedup

#### 3.4 Add `passWithNoTests` to vitest config

- **File**: [`ts/lib/vitest.ts:22-45`](packages/nx-plugin/src/ts/lib/vitest.ts:22)
- **Current**: Add `passWithNoTests: true` to test config object
- **GritQL Pattern**: Conditional property addition

#### 3.5 Add rolldown config entry

- **File**: [`utils/bundle/bundle.ts:224-316`](packages/nx-plugin/src/utils/bundle/bundle.ts:224)
- **Current**: Append complex object to defineConfig array
- **Complexity**: HIGH - dynamic values from options, conditional properties
- **Strategy**: May need to keep as hybrid (construct the object string, then use GritQL to insert it)

#### 3.6 Update vite config (build outDir, plugins)

- **File**: [`ts/react-website/app/generator.ts:365-493`](packages/nx-plugin/src/ts/react-website/app/generator.ts:365)
- **Current**: Complex nested object manipulation
- **Complexity**: HIGH - conditional plugin additions, nested property updates
- **Strategy**: May need multiple GritQL patterns or hybrid approach

#### 3.7 Change eslint rule severity

- **File**: [`ts/lib/generator.ts:208-217`](packages/nx-plugin/src/ts/lib/generator.ts:208)
- **Current**: Replace `"error"` with `"warn"` in dependency-checks rule
- **GritQL Pattern**: Simple string replacement in context

#### 3.8 Add sidebar entry to docs config

- **File**: [`ts/nx-generator/generator.ts:107-129`](packages/nx-plugin/src/ts/nx-generator/generator.ts:107)
- **Current**: Append object to sidebar items array
- **GritQL Pattern**: Accumulate to array

#### 3.9 Update aws-nx-plugin config

- **File**: [`utils/config/utils.ts:51-87`](packages/nx-plugin/src/utils/config/utils.ts:51)
- **Current**: Merge/replace properties in exported object
- **Complexity**: MEDIUM - dynamic keys from config update
- **Strategy**: May need hybrid approach for dynamic property names

#### 3.10 Add eslint rule config to shadcn

- **File**: [`utils/shared-shadcn.ts:91-100`](packages/nx-plugin/src/utils/shared-shadcn.ts:91)
- **Current**: Append rule config object to exports array
- **GritQL Pattern**: Accumulate to array

#### 3.11 Add runtime config API override

- **File**: [`connection/serve-local.ts:70-90`](packages/nx-plugin/src/connection/serve-local.ts:70)
- **Current**: Append assignment statement to if block
- **GritQL Pattern**: Accumulate statement to block

#### 3.12 Add router context property

- **File**: [`utils/ast/website.ts:99-141`](packages/nx-plugin/src/utils/ast/website.ts:99)
- **Current**: Add property to createRouter object and context sub-object
- **Complexity**: MEDIUM

---

### Category 4: Complex JSX/Component Transforms

These involve significant JSX construction - creating entire UI components programmatically.

#### 4.1 Add auth menu to None UX provider

- **File**: [`ts/react-website/cognito-auth/utils.ts:41-202`](packages/nx-plugin/src/ts/react-website/cognito-auth/utils.ts:41) (`addNoneAuthMenu`)
- **Current**: ~160 lines of factory calls to create user greeting + sign-out button
- **Strategy**: Write the target JSX as a GritQL snippet template. This is a prime candidate for GritQL since the output is static JSX.

#### 4.2 Add auth menu to Cloudscape UX provider

- **File**: [`ts/react-website/cognito-auth/utils.ts:207-382`](packages/nx-plugin/src/ts/react-website/cognito-auth/utils.ts:207) (`addCloudscapeAuthMenu`)
- **Current**: ~175 lines of factory calls to add utilities attribute to TopNavigation
- **Strategy**: GritQL JSX rewrite pattern

#### 4.3 Add auth menu to Shadcn UX provider

- **File**: [`ts/react-website/cognito-auth/utils.ts:385-960`](packages/nx-plugin/src/ts/react-website/cognito-auth/utils.ts:385) (`addShadcnAuthMenu`)
- **Current**: ~575 lines of factory calls for state, refs, effects, and complex JSX
- **Strategy**: GritQL pattern with large JSX template. This is the biggest win - replacing 575 lines with a readable template.

#### 4.4 Add useAuth destructuring to AppLayout

- **File**: [`ts/react-website/cognito-auth/generator.ts:147-223`](packages/nx-plugin/src/ts/react-website/cognito-auth/generator.ts:147)
- **Current**: Add `const { user, removeUser, signoutRedirect, clearStaleState } = useAuth()` to AppLayout
- **GritQL Pattern**:
  ```
  `const AppLayout = ($params) => { $body }` =>
  `const AppLayout = ($params) => { const { user, removeUser, signoutRedirect, clearStaleState } = useAuth(); $body }` where {
    $source = `"react-oidc-context"`,
    `useAuth` <: ensure_import_from($source)
  }
  ```

#### 4.5 Add hook call to App component

- **File**: [`utils/ast/website.ts:145-213`](packages/nx-plugin/src/utils/ast/website.ts:145)
- **Current**: Prepend `const <contextProp> = <hook>()` to App arrow function
- **GritQL Pattern**: Similar to 4.4 - prepend statement to function body

#### 4.6 Add context prop to RouterProvider

- **File**: [`utils/ast/website.ts:216-280`](packages/nx-plugin/src/utils/ast/website.ts:216)
- **Current**: Add/update context attribute on `<RouterProvider>`
- **GritQL Pattern**: JSX attribute manipulation

#### 4.7 Add type property to RouterProviderContext

- **File**: [`utils/ast/website.ts:65-96`](packages/nx-plugin/src/utils/ast/website.ts:65)
- **Current**: Add optional property to type literal
- **GritQL Pattern**: Type literal manipulation

---

### Category 5: Export Management

#### 5.1 `addStarExport` usage

- **Files**: [`utils/api-constructs/api-constructs.ts`](packages/nx-plugin/src/utils/api-constructs/api-constructs.ts), [`utils/website-constructs/website-constructs.ts`](packages/nx-plugin/src/utils/website-constructs/website-constructs.ts), [`utils/function-constructs/function-constructs.ts`](packages/nx-plugin/src/utils/function-constructs/function-constructs.ts), [`utils/agent-core-constructs/agent-core-constructs.ts`](packages/nx-plugin/src/utils/agent-core-constructs/agent-core-constructs.ts), [`utils/identity-constructs/identity-constructs.ts`](packages/nx-plugin/src/utils/identity-constructs/identity-constructs.ts), [`ts/nx-generator/generator.ts`](packages/nx-plugin/src/ts/nx-generator/generator.ts)
- **Current**: Add `export * from './module'` if not present
- **GritQL Pattern**: File-level pattern to add export statement

---

### Category 6: Query-only Usage (boolean checks)

#### 6.1 Check if element exists

- **Files**: Multiple files use `query(tree, path, selector).length > 0`
- **Strategy**: Replace with `hasGritQLMatch(tree, path, pattern)`

---

### Category 7: Already Using GritQL

#### 7.1 [`utils/metrics.ts`](packages/nx-plugin/src/utils/metrics.ts)

- Already uses `applyGritQLTransform` - no changes needed

---

## Migration Priority & Phases

### Phase 1: Low-hanging fruit - Import + JSX wrapping (Categories 1 & 2)

These are the simplest transforms and demonstrate the `ensure_import_from` pattern.

**Files to change:**

1. [`trpc/react/generator.ts`](packages/nx-plugin/src/trpc/react/generator.ts) - Replace `addSingleImport` + `replace` with single GritQL pattern using `ensure_import_from`
2. [`utils/connection/open-api/react.ts`](packages/nx-plugin/src/utils/connection/open-api/react.ts) - Same pattern
3. [`ts/react-website/cognito-auth/generator.ts`](packages/nx-plugin/src/ts/react-website/cognito-auth/generator.ts) - Same pattern
4. [`ts/react-website/runtime-config/generator.ts`](packages/nx-plugin/src/ts/react-website/runtime-config/generator.ts) - Replace `prependStatements` + `replaceIfExists` with GritQL

### Phase 2: Simple config transforms (Category 3, simple items)

- 3.1, 3.2, 3.3: ESLint config manipulation
- 3.4: Vitest config
- 3.7: ESLint rule severity
- 3.8: Docs sidebar entry
- 3.10: Shadcn eslint rules
- 3.11: Runtime config override

### Phase 3: Complex JSX transforms (Category 4)

The biggest wins in terms of code reduction:

- 4.1-4.3: Auth menu generation (~900 lines of factory code → readable JSX templates)
- 4.4-4.7: Component/type modifications

### Phase 4: Complex config transforms (Category 3, complex items)

- 3.5: Rolldown config (dynamic values)
- 3.6: Vite config (conditional plugins)
- 3.9: AWS NX plugin config (dynamic keys)

### Phase 5: Query replacements & export management (Categories 5 & 6)

- Replace `query().length > 0` with `hasGritQLMatch`
- Replace `addStarExport` with GritQL pattern

### Phase 6: Cleanup

- Remove unused imports from `ast.ts` (tsquery, factory methods)
- Remove deprecated utility functions
- Update tests

## Key GritQL Patterns to Validate

Before implementation, each pattern type needs CLI validation:

1. **`ensure_import_from` with named imports** ✅ Validated
2. **`ensure_import_from` with aliased imports** ✅ Validated
3. **`ensure_import_from` via `file($body)`** ✅ Validated (for imports without existing usage)
4. **JSX wrapping**: `<App />` => `<Provider><App /></Provider>`
5. **Array accumulate**: Adding elements to arrays
6. **Object property addition**: Adding properties to object literals
7. **Statement prepending**: Adding statements to function bodies
8. **Type literal modification**: Adding properties to type definitions
9. **Export statement addition**: Adding `export * from '...'`
10. **Conditional transforms**: Only apply if pattern not already present

## Notes

- `jsonToAst` should be kept as a utility since it converts runtime JS objects to AST nodes - this is inherently dynamic and not suitable for GritQL
- `hasExportDeclaration` in [`connection/generator.ts`](packages/nx-plugin/src/connection/generator.ts) operates on source strings, not tree files - may need special handling
- The `applyGritQLTransform` function already handles the grit CLI interaction and should be reused
- All GritQL patterns should be tested with the CLI before implementation using `echo '...' | grit apply '...' --stdin test.ts --dry-run`
