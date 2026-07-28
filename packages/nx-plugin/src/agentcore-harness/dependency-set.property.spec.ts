/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 3: Generated dependency versions are exact centralized values
 * Validates: Requirements 2.6, 2.7, 13.2, 13.3
 *
 * For all generated Harness Projects, every package imported by generated
 * source or required by generated targets has one dependency entry whose
 * version equals the corresponding centralized `TS_VERSIONS` value and
 * contains no range operator; the Harness SDK version equals the
 * repository AWS SDK baseline.
 *
 * The required package set is DERIVED from the final generated artifacts
 * on every run rather than restated from the implementation's dependency
 * list, so the property fails if the generated Invocation Client ever
 * imports a package (or a target ever executes a tool) that generation did
 * not wire into package.json:
 *
 * - Compiled sources come from the generated tsconfig.json `include` list
 *   (exactly the files the reserved `build` target type-checks). Their
 *   import declarations are parsed with the TypeScript compiler API, and
 *   non-relative, non-builtin specifiers map to npm package names (deep
 *   imports like `@aws-lambda-powertools/parameters/appconfig` map to the
 *   owning package).
 * - Target-executed tools come from the generated project.json commands:
 *   the `invoke` target's `tsx` binary is shipped by the `tsx` package and
 *   the `build` target's `tsc` binary is shipped by the `typescript`
 *   package (the only knowledge encoded here is that binary-to-package
 *   mapping; an unrecognized binary fails the property rather than being
 *   ignored).
 * - Ambient type packages come from the generated tsconfig.json
 *   `compilerOptions.types` array (`node` requires `@types/node`).
 * - `@aws-sdk/client-appconfigdata` is the single knowledge-based entry:
 *   the Powertools Parameters AppConfig provider constructs an
 *   `AppConfigDataClient` at runtime and declares the SDK client as a peer
 *   the consuming project must install, so no generated artifact names it
 *   directly. (It cannot be verified from this workspace's node_modules:
 *   `@aws-lambda-powertools/parameters` is not installed here because the
 *   plugin itself never executes it.)
 *
 * Runtime note: each case is one complete generator run including real
 * repository-standard formatting, mirroring the routing property's budget
 * (120 runs stay within the suite's 120s per-test budget).
 */
import { builtinModules } from 'node:module';
import { joinPathFragments, readJson, type Tree } from '@nx/devkit';
import fc from 'fast-check';
import yaml from 'js-yaml';
import ts from 'typescript';
import type { IacOption } from '../utils/iac';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { TS_VERSIONS } from '../utils/versions';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the dependency contract from the requirements, restated
// independently of the generator implementation.
//
// - 2.6: exact-pinned runtime and development dependencies required to
//   compile and execute the Invocation Client are added.
// - 2.7: every added dependency version comes from the centralized version
//   registry (`TS_VERSIONS`).
// - 13.2: `@aws-sdk/client-bedrock-agentcore` is pinned to the centralized
//   exact AWS SDK version used by repository AWS SDK clients.
// - 13.3: `@aws-sdk/client-appconfigdata`,
//   `@aws-lambda-powertools/parameters`, `tsx`, `typescript`, and Node.js
//   types are pinned through the centralized TypeScript version registry.
// ---------------------------------------------------------------------------

/**
 * An exact semver pin: MAJOR.MINOR.PATCH with an optional prerelease/build
 * suffix and no range syntax (`^`, `~`, `>`, `<`, `=`, `*`, `x`, spaces,
 * `||`, hyphen ranges all fail this pattern).
 */
const EXACT_SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A representative repository AWS SDK client: 13.2 requires the Harness SDK
 * pin to equal the centralized AWS SDK baseline shared by clients like
 * `@aws-sdk/client-s3` (the repository baseline, currently 3.1085.0).
 */
const AWS_SDK_BASELINE_PACKAGE = '@aws-sdk/client-s3';

const HARNESS_SDK_PACKAGE = '@aws-sdk/client-bedrock-agentcore';

/**
 * Binary-to-package mapping for tools executed by generated targets. `tsx`
 * is the bin of the `tsx` package; `tsc` is the compiler bin shipped by the
 * `typescript` package. Any other executed binary is unmodeled and fails
 * the property so a target change cannot silently drop a dependency.
 */
const EXECUTED_BINARY_PACKAGES: Record<string, string> = {
  tsx: 'tsx',
  tsc: 'typescript',
};

/**
 * The one knowledge-based runtime requirement (see the file header): the
 * Powertools Parameters AppConfig provider needs the AppConfigData SDK
 * client at runtime, and no generated artifact names it directly.
 */
const KNOWLEDGE_BASED_RUNTIME_PACKAGES = ['@aws-sdk/client-appconfigdata'];

/** `TS_VERSIONS` keyed by arbitrary derived package names. */
const CENTRALIZED_VERSIONS: Record<string, string | undefined> = TS_VERSIONS;

// ---------------------------------------------------------------------------
// Derivation helpers: required packages are read out of the generated
// artifacts, never out of the generator's own dependency wiring.
// ---------------------------------------------------------------------------

/**
 * Parse a generated TypeScript source with the pinned TypeScript compiler
 * and collect every import/re-export module specifier (including dynamic
 * `import()` of string literals). Parse diagnostics fail the property so a
 * syntactically broken artifact cannot yield an empty import list.
 */
const extractModuleSpecifiers = (
  fileName: string,
  content: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  expect(
    parseDiagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    ),
  ).toEqual([]);

  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

/** Relative imports resolve inside the project; builtins ship with Node. */
const isExternalPackageSpecifier = (specifier: string): boolean =>
  !specifier.startsWith('.') &&
  !specifier.startsWith('node:') &&
  !builtinModules.includes(specifier);

/**
 * Map a module specifier to its owning npm package: deep imports keep the
 * scope plus name (`@scope/name/deep` -> `@scope/name`) or the first
 * segment (`name/deep` -> `name`).
 */
const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
};

/**
 * Map a tsconfig `types` entry to the package that provides the ambient
 * declarations (`node` -> `@types/node`, `@scope/name` ->
 * `@types/scope__name` per the DefinitelyTyped mangling rule).
 */
const typesPackageOf = (typesEntry: string): string =>
  typesEntry.startsWith('@')
    ? `@types/${typesEntry.slice(1).replace('/', '__')}`
    : `@types/${typesEntry}`;

/** Read generated JSONC (the tsconfig template contains comments). */
const readGeneratedJsonc = (tree: Tree, path: string): Record<string, any> => {
  const text = tree.read(path, 'utf-8');
  expect(text).toBeDefined();
  const { config, error } = ts.parseConfigFileTextToJson(path, text!);
  expect(
    error && ts.flattenDiagnosticMessageText(error.messageText, ' '),
  ).toBeFalsy();
  return config;
};

/** First whitespace-delimited token of a generated target command. */
const executedBinaryOf = (command: unknown): string => {
  expect(typeof command).toBe('string');
  const binary = (command as string).trim().split(/\s+/)[0];
  expect(binary).toBeTruthy();
  return binary;
};

// ---------------------------------------------------------------------------
// Arbitraries: mirror the routing property's candidate space (valid names,
// custom creation options, and all three infrastructure routes) so the
// dependency contract is shown to be an invariant of every generated
// Harness Project rather than a property of the defaults or one provider.
// ---------------------------------------------------------------------------

/** The three routing outcomes; dependency wiring must not vary across them. */
type Route = 'cdk' | 'terraform' | 'none';

interface DependencyCandidate {
  route: Route;
  name: string;
  explicitInfra: boolean;
  noneIac: IacOption | undefined;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
}

/** Map a candidate onto the public generator option contract. */
const optionsForCandidate = (
  candidate: DependencyCandidate,
): AgentcoreHarnessGeneratorSchema => {
  const common: AgentcoreHarnessGeneratorSchema = {
    name: candidate.name,
    modelId: candidate.modelId,
    systemPrompt: candidate.systemPrompt,
    allowedTools: candidate.allowedTools,
    maxIterations: candidate.maxIterations,
    maxTokens: candidate.maxTokens,
    timeoutSeconds: candidate.timeoutSeconds,
  };
  switch (candidate.route) {
    case 'cdk':
    case 'terraform':
      return {
        ...common,
        infra: candidate.explicitInfra ? 'agentcore' : undefined,
        iac: candidate.route,
      };
    case 'none':
      return { ...common, infra: 'none', iac: candidate.noneIac };
  }
};

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/**
 * Valid human-readable names. Seeds cover the interesting normalization
 * shapes (spaces, camelCase humps, digit-leading words, accents, embedded
 * punctuation) and guarantee the name normalizes to a non-empty
 * identifier; decoration varies the rest.
 */
const arbValidName = fc
  .tuple(
    fc.constantFrom(
      'harness',
      'My Harness',
      'myHarness2',
      '3d',
      'café',
      'a_b.c',
      'Z',
      'x9/y',
    ),
    fc.string({ maxLength: 12 }),
  )
  .map(([seed, decoration]) => seed + decoration);

/**
 * Custom model IDs and system prompts: free text with at least one
 * non-whitespace character, including quote/backslash/newline/Unicode
 * shapes, so custom creation options are shown not to perturb dependency
 * wiring.
 */
const arbCustomFreeText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }).filter(containsNonWhitespace),
  fc.constantFrom(
    'custom.model-id',
    'anthropic.claude-sonnet-4-5-20250929-v1:0',
    'Custom prompt with "quotes", \\backslashes\\ and\nnewlines.',
    'unicode tëxt ✓',
  ),
);

const arbToolEntry = fc.oneof(
  fc.constant('@builtin'),
  fc.string({ minLength: 1, maxLength: 16 }).filter(containsNonWhitespace),
);

/** Valid custom allowed-tool arrays (1 through 8 entries). */
const arbCustomAllowedTools = fc.array(arbToolEntry, {
  minLength: 1,
  maxLength: 8,
});

const arbCustomLimit = fc.integer({ min: 1, max: 2_000_000 });

const arbDependencyCandidate: fc.Arbitrary<DependencyCandidate> = fc.record({
  route: fc.constantFrom<Route>('cdk', 'terraform', 'none'),
  name: arbValidName,
  explicitInfra: fc.boolean(),
  noneIac: fc.option(
    fc.constantFrom<IacOption>('inherit', 'cdk', 'terraform'),
    { nil: undefined },
  ),
  modelId: fc.option(arbCustomFreeText, { nil: undefined }),
  systemPrompt: fc.option(arbCustomFreeText, { nil: undefined }),
  allowedTools: fc.option(arbCustomAllowedTools, { nil: undefined }),
  maxIterations: fc.option(arbCustomLimit, { nil: undefined }),
  maxTokens: fc.option(arbCustomLimit, { nil: undefined }),
  timeoutSeconds: fc.option(arbCustomLimit, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness generated dependency set (Property 3)', () => {
  // Feature: agentcore-harness-generator, Property 3: Generated dependency versions are exact centralized values
  // **Validates: Requirements 2.6, 2.7, 13.2, 13.3**
  it('pins every artifact-derived required package to the exact centralized version', async () => {
    await fc.assert(
      fc.asyncProperty(arbDependencyCandidate, async (candidate) => {
        // A fresh empty workspace per case so each run observes exactly
        // the dependency entries one generation produced.
        const tree = createTreeUsingTsSolutionSetup();
        const options = optionsForCandidate(candidate);
        const resolved = resolveAgentcoreHarnessOptions(tree, options);
        const root = resolved.projectRoot;

        await agentcoreHarnessGenerator(tree, options);

        // -----------------------------------------------------------------
        // Derive the required package set from the final artifacts.
        // -----------------------------------------------------------------

        // The generated tsconfig names the compiled sources (`include`)
        // and ambient type requirements (`compilerOptions.types`).
        const tsconfig = readGeneratedJsonc(
          tree,
          joinPathFragments(root, 'tsconfig.json'),
        );
        const includedSources: string[] = tsconfig.include ?? [];
        expect(includedSources.length).toBeGreaterThan(0);
        const typesEntries: string[] = tsconfig.compilerOptions?.types ?? [];

        // Runtime requirement: every external package imported by a
        // compiled source (the Invocation Client executes these imports),
        // plus the single knowledge-based Powertools peer.
        const runtimeRequired = new Set<string>(
          KNOWLEDGE_BASED_RUNTIME_PACKAGES,
        );
        for (const sourceFile of includedSources) {
          const sourcePath = joinPathFragments(root, sourceFile);
          const content = tree.read(sourcePath, 'utf-8');
          expect(content).toBeDefined();
          for (const specifier of extractModuleSpecifiers(
            sourcePath,
            content!,
          )) {
            if (isExternalPackageSpecifier(specifier)) {
              runtimeRequired.add(packageNameOf(specifier));
            }
          }
        }

        // Anti-vacuity guard: import derivation must observe the real
        // artifact. The Invocation Client cannot function without the
        // Harness SDK, so its absence means extraction (not wiring) broke.
        expect([...runtimeRequired]).toContain(HARNESS_SDK_PACKAGE);

        // Development requirement: the binaries executed by the reserved
        // targets plus the ambient type packages from tsconfig `types`.
        const projectJson = readJson(
          tree,
          joinPathFragments(root, 'project.json'),
        );
        const devRequired = new Set<string>();
        for (const targetName of ['invoke', 'build']) {
          const binary = executedBinaryOf(
            projectJson.targets?.[targetName]?.options?.command,
          );
          const binaryPackage = EXECUTED_BINARY_PACKAGES[binary];
          // An unmodeled binary is a derivation gap, not an ignorable case.
          expect(
            binaryPackage,
            `target '${targetName}' executes unmodeled binary '${binary}'`,
          ).toBeDefined();
          devRequired.add(binaryPackage);
        }
        for (const typesEntry of typesEntries) {
          devRequired.add(typesPackageOf(typesEntry));
        }
        expect(devRequired.size).toBeGreaterThan(0);

        // -----------------------------------------------------------------
        // Assert every derived package is exact-pinned to the centralized
        // registry value in the correct package.json section.
        // -----------------------------------------------------------------

        const packageJson = readJson(tree, 'package.json');
        const dependencies: Record<string, string> =
          packageJson.dependencies ?? {};
        const devDependencies: Record<string, string> =
          packageJson.devDependencies ?? {};

        // When pnpm catalogs are enabled (the default in test trees, and in
        // any workspace on a catalog-capable package manager), generators
        // record the real version in the workspace catalog and leave a
        // `catalog:` reference in package.json instead. Resolve that
        // reference to the recorded range so the exact-pin assertions below
        // check the actual version regardless of catalog mode.
        const catalog: Record<string, string> = tree.exists(
          'pnpm-workspace.yaml',
        )
          ? ((
              yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as {
                catalog?: Record<string, string>;
              }
            ).catalog ?? {})
          : {};
        const resolveCatalogRef = (version: string, packageName: string) =>
          version === 'catalog:' ? catalog[packageName] : version;

        const assertExactCentralizedPin = (
          packageName: string,
          section: Record<string, string>,
          sectionName: string,
        ): void => {
          const version = resolveCatalogRef(section[packageName], packageName);
          expect(
            version,
            `required package '${packageName}' is missing from ${sectionName}`,
          ).toBeDefined();
          // (a) an exact pin with no range operator...
          expect(
            version,
            `'${packageName}' version '${version}' is not an exact pin`,
          ).toMatch(EXACT_SEMVER_PATTERN);
          // ...that (b) equals the centralized registry value (2.7 / 13.3
          // require the registry to define it; a missing entry fails).
          const centralized = CENTRALIZED_VERSIONS[packageName];
          expect(
            centralized,
            `'${packageName}' has no centralized TS_VERSIONS entry`,
          ).toBeDefined();
          expect(version).toBe(centralized);
        };

        // Runtime-vs-dev placement (SDK/Powertools packages execute at
        // invoke time; tsx/typescript/@types/node are tooling) with no
        // bleed into the opposite section.
        for (const packageName of runtimeRequired) {
          assertExactCentralizedPin(packageName, dependencies, 'dependencies');
          expect(
            devDependencies[packageName],
            `runtime package '${packageName}' must not also be a devDependency`,
          ).toBeUndefined();
        }
        for (const packageName of devRequired) {
          assertExactCentralizedPin(
            packageName,
            devDependencies,
            'devDependencies',
          );
          expect(
            dependencies[packageName],
            `development package '${packageName}' must not also be a runtime dependency`,
          ).toBeUndefined();
        }

        // The AWS SDK baseline (13.2): the Harness SDK pin equals the
        // centralized exact version shared by repository AWS SDK clients.
        expect(
          resolveCatalogRef(
            dependencies[HARNESS_SDK_PACKAGE],
            HARNESS_SDK_PACKAGE,
          ),
        ).toBe(TS_VERSIONS[AWS_SDK_BASELINE_PACKAGE]);
      }),
      // At least 100 runs required; 120 mirrors the routing property's
      // budget (each run is one full generator run) and gives roughly 40
      // runs per infrastructure route.
      { numRuns: 120 },
    );
  });
});
