/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateFiles, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { declareDependencies } from '../declared-dependencies.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import { cdkLambdaRuntime, cdkLambdaRuntimeVars } from '../versions.js';
import {
  addGreengrassComponentAppConstruct,
  addGreengrassCoreConstructs,
  GREENGRASS_CONSTRUCTS_DEPENDENCIES,
} from './greengrass-constructs.js';

// Real npm packages (`aws-cdk-lib`, `constructs`, `js-yaml`) are resolved
// against this package's own installed dependencies by writing the
// transpiled module to a real temporary file next to this spec, the same
// pattern `greengrass-scripts.spec.ts` uses for the vended tsx scripts -
// `aws-cdk-lib`/`constructs` are pinned at the workspace root, which Node's
// directory walk-up module resolution reaches from anywhere under it.
const CORE_DIR = join(
  import.meta.dirname,
  'files',
  'cdk',
  'core',
  'greengrass',
);

const MODULE_NAMES = [
  'recipe',
  'artifact-bucket',
  'next-version',
  'component-version',
  'deployment',
] as const;
type ModuleName = (typeof MODULE_NAMES)[number];

// `artifact-bucket` imports the shared `suppressRules` helper from the core
// constructs dir one level up, which `sharedConstructsGenerator` vends into
// the same workspace. Transpiled alongside the greengrass modules so the
// suppression runs for real here rather than being stubbed out.
const COMMON_CORE_DIR = join(
  import.meta.dirname,
  '..',
  'files',
  'common',
  'constructs',
  'src',
  'core',
);

const checkovTmpModulePath = (): string =>
  join(
    import.meta.dirname,
    `.tmp-greengrass-constructs-checkov-${process.pid}.mjs`,
  );

const tmpModulePath = (name: ModuleName): string =>
  join(
    import.meta.dirname,
    `.tmp-greengrass-constructs-${name}-${process.pid}.mjs`,
  );

let renderedTemplates: Tree;

const readRenderedTemplate = (path: string): string => {
  const content = renderedTemplates.read(path, 'utf-8');
  if (content === null) {
    throw new Error(`Template was not rendered: ${path}`);
  }
  return content;
};

const loadTemplate = (name: ModuleName): string =>
  readRenderedTemplate(`greengrass/${name}.ts`).replace(
    /url\.fileURLToPath\(\s*new URL\('\.\/next-version', import\.meta\.url\),\s*\)/g,
    'import.meta.dirname',
  );

const transpileTemplate = (name: ModuleName): string => {
  const jsCode = ts.transpileModule(loadTemplate(name), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  // Point sibling imports (`./recipe.js`) at the real temp files this helper
  // writes them as.
  const withSiblings = MODULE_NAMES.reduce(
    (code, sibling) =>
      code
        .split(`./${sibling}.js`)
        .join(pathToFileURL(tmpModulePath(sibling)).href),
    jsCode,
  );
  return withSiblings
    .split('../checkov.js')
    .join(pathToFileURL(checkovTmpModulePath()).href);
};

const transpileCheckovTemplate = (): string =>
  ts.transpileModule(readRenderedTemplate('common/checkov.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

// The vended modules are transpiled from `.ts.template` sources that don't
// exist as real `.ts` files on disk, so their real types aren't statically
// resolvable here - these narrow interfaces describe only what this spec
// calls, mirroring `greengrass-scripts.spec.ts`'s `RecipeUtilsModule` /
// `ZipWriterModule` pattern for the same reason.
interface RecipeModuleShape {
  readonly readRecipeSummary: (
    yamlSource: string,
    recipePath: string,
  ) => { componentName: string; componentVersion: string; raw: any };
  readonly substituteArtifactUris: (raw: any, substitution: any) => string[];
}

interface ArtifactBucketModuleShape {
  readonly GreengrassArtifactBucket: new (
    scope: import('constructs').Construct,
    id: string,
    props?: any,
  ) => {
    readonly bucket: import('aws-cdk-lib/aws-s3').IBucket;
    grantReadTo: (grantee: any, keyPrefix?: string) => unknown;
  };
}

interface ComponentVersionModuleShape {
  readonly GreengrassComponentVersion: new (
    scope: import('constructs').Construct,
    id: string,
    props: any,
  ) => {
    readonly componentName: string;
    readonly componentVersion: string;
    readonly cfnComponentVersion: import('aws-cdk-lib').CfnResource;
  };
}

interface GreengrassDeploymentInstance {
  readonly thingGroup?: unknown;
  readonly targetArn: unknown;
  readonly deployment: import('aws-cdk-lib').CfnResource;
  addComponent: (...args: any[]) => GreengrassDeploymentInstance;
}

interface DeploymentModuleShape {
  readonly GreengrassDeployment: new (
    scope: import('constructs').Construct,
    id: string,
    props: any,
  ) => GreengrassDeploymentInstance;
}

interface SynthesizedResource {
  readonly Type: string;
  readonly Properties: Record<string, unknown>;
}

let cdkLib: typeof import('aws-cdk-lib');
let assertionsLib: typeof import('aws-cdk-lib/assertions');
let RecipeModule: RecipeModuleShape;
let ArtifactBucketModule: ArtifactBucketModuleShape;
let ComponentVersionModule: ComponentVersionModuleShape;
let DeploymentModule: DeploymentModuleShape;

// Holds the fake `greengrass-build` output `writeBuildOutput` writes, shared by
// every spec that needs a real component version.
let tmpDir: string;

beforeAll(async () => {
  renderedTemplates = createTreeUsingTsSolutionSetup();
  generateFiles(renderedTemplates, CORE_DIR, 'greengrass', {
    esm: true,
    ...cdkLambdaRuntimeVars(),
    componentKeyPrefix: 'com.proj.*',
  });
  generateFiles(renderedTemplates, COMMON_CORE_DIR, 'common', {
    esm: true,
    tags: [],
  });
  tmpDir = mkdtempSync(join(tmpdir(), 'greengrass-component-version-'));
  writeFileSync(checkovTmpModulePath(), transpileCheckovTemplate());
  for (const name of MODULE_NAMES) {
    writeFileSync(tmpModulePath(name), transpileTemplate(name));
  }
  cdkLib = await import('aws-cdk-lib');
  assertionsLib = await import('aws-cdk-lib/assertions');
  RecipeModule = await import(pathToFileURL(tmpModulePath('recipe')).href);
  ArtifactBucketModule = await import(
    pathToFileURL(tmpModulePath('artifact-bucket')).href
  );
  ComponentVersionModule = await import(
    pathToFileURL(tmpModulePath('component-version')).href
  );
  DeploymentModule = await import(
    pathToFileURL(tmpModulePath('deployment')).href
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const path of [
    ...MODULE_NAMES.map(tmpModulePath),
    // The checkov helper is written next to the modules above, so it needs
    // removing here too - left behind it accumulates one file per test-run
    // pid in the source tree and fails `nx run @aws/nx-plugin:format`.
    checkovTmpModulePath(),
  ]) {
    try {
      unlinkSync(path);
    } catch {
      // already cleaned up
    }
  }
});

/**
 * Writes a `greengrass-build`-shaped recipe and artifact pair under {@link tmpDir},
 * which `GreengrassComponentVersion` reads at synth time.
 */
const writeBuildOutput = (
  componentName: string,
  componentVersion: string,
  artifactContent: string,
  // Defaults to matching the recipe. Override to exercise the guard against
  // a recipe naming an artifact the build never produced.
  artifactFileName = 'my-component.zip',
): { recipesDir: string; artifactsDir: string } => {
  const recipesDir = join(tmpDir, componentName, componentVersion, 'recipes');
  const artifactsDir = join(
    tmpDir,
    componentName,
    componentVersion,
    'artifacts',
  );
  mkdirSync(recipesDir, { recursive: true });
  mkdirSync(join(artifactsDir, componentName, componentVersion), {
    recursive: true,
  });
  writeFileSync(
    join(recipesDir, `${componentName}-${componentVersion}.yaml`),
    [
      'RecipeFormatVersion: 2020-01-25',
      `ComponentName: ${componentName}`,
      `ComponentVersion: ${componentVersion}`,
      'Manifests:',
      '  - Artifacts:',
      `      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip`,
    ].join('\n'),
  );
  writeFileSync(
    join(artifactsDir, componentName, componentVersion, artifactFileName),
    artifactContent,
  );
  return { recipesDir, artifactsDir };
};

/**
 * Writes a `greengrass-build`-shaped recipe declaring one manifest per
 * artifact basename in {@link contentsByBasename} (or `manifestsPerArtifact`
 * manifests per basename, for the TypeScript "one artifact, several
 * manifests" shape), plus one built file per basename.
 */
const writeMultiArtifactBuildOutput = (
  componentName: string,
  componentVersion: string,
  contentsByBasename: Readonly<Record<string, string>>,
  { manifestsPerArtifact = 1 }: { manifestsPerArtifact?: number } = {},
): { recipesDir: string; artifactsDir: string } => {
  const recipesDir = join(tmpDir, componentName, componentVersion, 'recipes');
  const artifactsDir = join(
    tmpDir,
    componentName,
    componentVersion,
    'artifacts',
  );
  mkdirSync(recipesDir, { recursive: true });
  mkdirSync(join(artifactsDir, componentName, componentVersion), {
    recursive: true,
  });

  const manifestLines: string[] = [];
  for (const [basename, content] of Object.entries(contentsByBasename)) {
    writeFileSync(
      join(artifactsDir, componentName, componentVersion, basename),
      content,
    );
    for (let i = 0; i < manifestsPerArtifact; i++) {
      manifestLines.push(
        '  - Artifacts:',
        `      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/${basename}`,
      );
    }
  }

  writeFileSync(
    join(recipesDir, `${componentName}-${componentVersion}.yaml`),
    [
      'RecipeFormatVersion: 2020-01-25',
      `ComponentName: ${componentName}`,
      `ComponentVersion: ${componentVersion}`,
      'Manifests:',
      ...manifestLines,
    ].join('\n'),
  );
  return { recipesDir, artifactsDir };
};

/**
 * A recipe whose `ComponentConfiguration.DefaultConfiguration` carries a plain
 * scalar of `paddingChars` repeats of `paddingChar`, for the recipe-size
 * guard's boundary tests. js-yaml emits such a scalar verbatim and never folds
 * it at `lineWidth: -1`, so the padding is a linear dial on the serialized
 * recipe's size - one byte per character for `a`, three for a character like
 * `あ`.
 */
const paddedRecipeSource = (
  componentName: string,
  componentVersion: string,
  paddingChars: number,
  paddingChar = 'a',
): string =>
  [
    'RecipeFormatVersion: 2020-01-25',
    `ComponentName: ${componentName}`,
    `ComponentVersion: ${componentVersion}`,
    'ComponentConfiguration:',
    '  DefaultConfiguration:',
    `    pad: ${paddingChar.repeat(paddingChars)}`,
    'Manifests:',
    '  - Artifacts:',
    '      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
  ].join('\n');

/**
 * Writes a `greengrass-build`-shaped recipe and artifact pair around
 * {@link paddedRecipeSource}. Returns the recipe source too, so a test can
 * recompute the expected dump.
 */
const writePaddedBuildOutput = (
  componentName: string,
  componentVersion: string,
  artifactContent: string,
  configurationPaddingChars: number,
  paddingChar = 'a',
): { recipesDir: string; artifactsDir: string; recipeSource: string } => {
  const recipesDir = join(tmpDir, componentName, componentVersion, 'recipes');
  const artifactsDir = join(
    tmpDir,
    componentName,
    componentVersion,
    'artifacts',
  );
  mkdirSync(recipesDir, { recursive: true });
  mkdirSync(join(artifactsDir, componentName, componentVersion), {
    recursive: true,
  });
  const recipeSource = paddedRecipeSource(
    componentName,
    componentVersion,
    configurationPaddingChars,
    paddingChar,
  );
  writeFileSync(
    join(recipesDir, `${componentName}-${componentVersion}.yaml`),
    recipeSource,
  );
  writeFileSync(
    join(artifactsDir, componentName, componentVersion, 'my-component.zip'),
    artifactContent,
  );
  return { recipesDir, artifactsDir, recipeSource };
};

describe('recipe.ts (readRecipeSummary / substituteArtifactUris)', () => {
  it('extracts ComponentName and ComponentVersion', () => {
    const { componentName, componentVersion } = RecipeModule.readRecipeSummary(
      [
        'RecipeFormatVersion: 2020-01-25',
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests: []',
      ].join('\n'),
      'recipe.yaml',
    );
    expect(componentName).toBe('com.example.MyComponent');
    expect(componentVersion).toBe('1.0.0');
  });

  it('throws an actionable error when ComponentName or ComponentVersion is missing', () => {
    expect(() =>
      RecipeModule.readRecipeSummary('Manifests: []', 'recipe.yaml'),
    ).toThrow(/ComponentName/);
  });

  it('substitutes only Uris carrying the GDK placeholder prefix, leaving others untouched', () => {
    const raw = {
      Manifests: [
        {
          Artifacts: [
            {
              Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
            },
            { Uri: 's3://already-published-bucket/some/other/key.zip' },
          ],
        },
      ],
    };

    const substituted = RecipeModule.substituteArtifactUris(raw, {
      bucketName: 'real-bucket',
      keyPrefix: 'com.example.MyComponent/1.0.0/deadbeef/',
    });

    // Only the placeholder URI's basename is reported back.
    expect(substituted).toEqual(['my-component.zip']);

    expect(raw.Manifests[0].Artifacts[0].Uri).toBe(
      's3://real-bucket/com.example.MyComponent/1.0.0/deadbeef/my-component.zip',
    );
    // Not a placeholder - left exactly as authored.
    expect(raw.Manifests[0].Artifacts[1].Uri).toBe(
      's3://already-published-bucket/some/other/key.zip',
    );
  });
});

describe('GreengrassArtifactBucket', () => {
  it('is retained, versioned, SSE-S3 encrypted, blocks public access and enforces TLS', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    new ArtifactBucketModule.GreengrassArtifactBucket(stack, 'ArtifactBucket');

    const template = assertionsLib.Template.fromStack(stack);

    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: assertionsLib.Match.objectLike({
        VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: assertionsLib.Match.objectLike({
          ServerSideEncryptionConfiguration: [
            assertionsLib.Match.objectLike({
              ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
            }),
          ],
        }),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
    });

    // enforceSSL: true - a deny statement for non-TLS requests.
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: assertionsLib.Match.objectLike({
        Statement: assertionsLib.Match.arrayWith([
          assertionsLib.Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      }),
    });
  });

  it('imports an existing bucket by name instead of creating one', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    new ArtifactBucketModule.GreengrassArtifactBucket(stack, 'ArtifactBucket', {
      existingBucketName: 'my-existing-bucket',
    });

    const template = assertionsLib.Template.fromStack(stack);
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });

  it('defaults device reads to the workspace namespace', async () => {
    const { Role, ServicePrincipal } = await import('aws-cdk-lib/aws-iam');
    const stack = new cdkLib.Stack(new cdkLib.App(), 'ReadScopeStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'Bucket',
    );
    const role = new Role(stack, 'DeviceRole', {
      assumedBy: new ServicePrincipal('credentials.iot.amazonaws.com'),
    });
    bucket.grantReadTo(role);
    const statements = Object.values(
      assertionsLib.Template.fromStack(stack).toJSON().Resources,
    )
      .filter((resource: any) => resource.Type === 'AWS::IAM::Policy')
      .flatMap((resource: any) => resource.Properties.PolicyDocument.Statement);
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toBe('s3:GetObject');
    expect(JSON.stringify(statements[0].Resource)).toContain('/com.proj.*');
  });

  it('grantReadTo grants exactly s3:GetObject, scoped to the given prefix', async () => {
    const iam = await import('aws-cdk-lib/aws-iam');
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const artifactBucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );
    const grantee = new iam.Role(stack, 'Grantee', {
      assumedBy: new iam.ServicePrincipal('greengrass.amazonaws.com'),
    });

    artifactBucket.grantReadTo(grantee, 'com.example.MyComponent/*');

    const template = assertionsLib.Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: assertionsLib.Match.objectLike({
        Statement: assertionsLib.Match.arrayWith([
          assertionsLib.Match.objectLike({
            Action: 's3:GetObject',
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });
});

describe('GreengrassComponentVersion', () => {
  const artifactSetSha256Of = (
    content: string,
    name = 'my-component.zip',
  ): string =>
    createHash('sha256')
      .update(`${name}:${sha256Of(content)}`)
      .digest('hex');

  const sha256Of = (content: string): string =>
    createHash('sha256').update(content).digest('hex');

  it('matches the Terraform fixture key and preserves its full artifact digest', () => {
    const fixtureDir = join(
      import.meta.dirname,
      '../../../../../e2e/src/files/terraform-plan/greengrass-tests/fixtures/component-version',
    );
    const stack = new cdkLib.Stack(new cdkLib.App(), 'SharedFixtureStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'Bucket',
      { existingBucketName: 'test-bucket' },
    );
    new ComponentVersionModule.GreengrassComponentVersion(stack, 'Version', {
      recipesDir: join(fixtureDir, 'recipes'),
      artifactsDir: join(fixtureDir, 'artifacts'),
      bucket,
    });
    const resources = Object.values(
      assertionsLib.Template.fromStack(stack).toJSON().Resources,
    ) as SynthesizedResource[];
    const upload = resources.find(
      (resource) => resource.Type === 'Custom::CDKBucketDeployment',
    );
    const version = resources.find(
      (resource) => resource.Type === 'AWS::GreengrassV2::ComponentVersion',
    );
    if (!upload || !version) {
      throw new Error(
        'Fixture must synthesize both upload and version resources',
      );
    }
    const expectedKey = readFileSync(
      join(fixtureDir, 'expected-key.txt'),
      'utf-8',
    ).trim();
    expect(upload.Properties.DestinationBucketKeyPrefix).toBe(
      expectedKey.slice(0, expectedKey.lastIndexOf('/') + 1),
    );
    const recipe = yaml.load(version.Properties.InlineRecipe as string) as {
      Manifests: { Artifacts: { Uri: string; Digest: string }[] }[];
    };
    expect(recipe.Manifests[0].Artifacts[0]).toMatchObject({
      Uri: `s3://test-bucket/${expectedKey}`,
      Digest: createHash('sha256')
        .update(
          readFileSync(
            join(
              fixtureDir,
              'artifacts/com.test.FixtureComponent/1.0.0/fixture-artifact.txt',
            ),
          ),
        )
        .digest('base64'),
    });
  });

  it('shares one resolver provider and scopes each action to the correct component resource', async () => {
    const { GreengrassNextVersion } = await import(
      pathToFileURL(tmpModulePath('next-version')).href
    );
    const stack = new cdkLib.Stack(new cdkLib.App(), 'ResolverScopeStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    for (const [index, componentName] of [
      'com.acme.*',
      'com.acme.?',
    ].entries()) {
      expect(
        () =>
          new GreengrassNextVersion(stack, `Invalid${index}`, {
            componentName,
            strategy: 'patch',
            contentSha256: 'a'.repeat(64),
            bucketName: 'test-bucket',
          }),
      ).toThrow('componentName must contain only');
    }
    for (const [index, componentName] of [
      'com.acme.First',
      'com.acme.Second',
      'com.acme.First',
    ].entries()) {
      new GreengrassNextVersion(stack, `Resolver${index}`, {
        componentName,
        strategy: 'patch',
        contentSha256: 'a'.repeat(64),
        bucketName: 'test-bucket',
      });
    }
    const resources = Object.values(
      assertionsLib.Template.fromStack(stack).toJSON().Resources,
    ) as any[];
    expect(
      resources.filter(
        (resource) =>
          resource.Type === 'AWS::Lambda::Function' &&
          resource.Properties.Handler === 'index.handler',
      ),
    ).toHaveLength(1);
    const statements = resources
      .filter((resource) => resource.Type === 'AWS::IAM::Policy')
      .flatMap((resource) => resource.Properties.PolicyDocument.Statement)
      .filter((statement) =>
        JSON.stringify(statement.Action).includes('greengrass:'),
      );
    for (const [action, suffix] of [
      ['greengrass:ListComponentVersions', ''],
      ['greengrass:DescribeComponent', ':versions:*'],
    ]) {
      const permitted = statements
        .filter((statement) => statement.Action === action)
        .flatMap((statement) =>
          Array.isArray(statement.Resource)
            ? statement.Resource
            : [statement.Resource],
        );
      expect(permitted).toEqual(
        ['com.acme.First', 'com.acme.Second'].map((name) =>
          stack.resolve(
            `arn:${stack.partition}:greengrass:us-east-1:123456789012:components:${name}${suffix}`,
          ),
        ),
      );
    }
    expect(statements).toHaveLength(4);
  });

  it('uses the same artifact key across explicit and automatic version modes', () => {
    const componentName = 'com.example.SharedKey';
    const stack = new cdkLib.Stack(new cdkLib.App(), 'SharedKeyStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'Bucket',
    );
    for (const [index, version] of ['1.0.0', '2.0.0', 'NEXT_PATCH'].entries()) {
      const paths = writeBuildOutput(
        componentName,
        version,
        'same artifact bytes',
      );
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        `Version${index}`,
        { ...paths, bucket },
      );
    }
    const uploads = Object.values(
      assertionsLib.Template.fromStack(stack).toJSON().Resources,
    ).filter(
      (resource: any) => resource.Type === 'Custom::CDKBucketDeployment',
    ) as any[];
    expect(uploads).toHaveLength(3);
    expect(
      new Set(
        uploads.map(
          (resource) => resource.Properties.DestinationBucketKeyPrefix,
        ),
      ),
    ).toEqual(
      new Set([
        `${componentName}/${artifactSetSha256Of('same artifact bytes').slice(0, 32)}/`,
      ]),
    );
  });

  it('uploads the artifact, substitutes the recipe placeholders, and depends on the upload', () => {
    const { recipesDir, artifactsDir } = writeBuildOutput(
      'com.example.DependsOnTest',
      '1.0.0',
      'artifact bytes v1',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );
    const componentVersion =
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        'ComponentVersion',
        { recipesDir, artifactsDir, bucket },
      );

    const template = assertionsLib.Template.fromStack(stack);
    const json = template.toJSON();
    const resources = json.Resources as Record<string, any>;

    const cfnLogicalId = stack.getLogicalId(
      componentVersion.cfnComponentVersion,
    );
    const componentVersionResource = resources[cfnLogicalId];
    expect(componentVersionResource.Type).toBe(
      'AWS::GreengrassV2::ComponentVersion',
    );
    expect(componentVersionResource.DeletionPolicy).toBe('Retain');
    expect(componentVersionResource.UpdateReplacePolicy).toBe('Retain');

    // DependsOn must reach a Custom::CDKBucketDeployment resource - referencing
    // the bucket's name in InlineRecipe does not make CloudFormation wait for
    // the upload custom resource on its own.
    const dependsOn: string[] = Array.isArray(
      componentVersionResource.DependsOn,
    )
      ? componentVersionResource.DependsOn
      : [componentVersionResource.DependsOn];
    expect(dependsOn.length).toBeGreaterThan(0);
    const dependedOnTypes = dependsOn.map((id) => resources[id]?.Type);
    expect(dependedOnTypes).toContain('Custom::CDKBucketDeployment');

    const sha256 = artifactSetSha256Of('artifact bytes v1');
    const bucketDeploymentResource = Object.values(resources).find(
      (r: any) => r.Type === 'Custom::CDKBucketDeployment',
    ) as any;
    expect(bucketDeploymentResource.Properties.DestinationBucketKeyPrefix).toBe(
      `com.example.DependsOnTest/${sha256.slice(0, 32)}/`,
    );
    // `extract` must stay at its default. The handler syncs the *unpacked*
    // asset, so each file keeps its own name under the prefix; `extract:
    // false` would publish the archive under the CDK asset's hashed file name
    // instead, which the recipe's artifact URI could never reference.
    expect([undefined, true, 'true']).toContain(
      bucketDeploymentResource.Properties.Extract,
    );

    // InlineRecipe carries the substituted Uri with the sha256 path segment,
    // and the zip's basename survives untouched.
    const inlineRecipe = componentVersionResource.Properties.InlineRecipe;
    expect(inlineRecipe).toEqual(
      expect.objectContaining({ 'Fn::Join': expect.anything() }),
    );
    const renderedRecipe = (inlineRecipe['Fn::Join'][1] as unknown[])
      .filter((part): part is string => typeof part === 'string')
      .join('');
    expect(renderedRecipe).toContain(
      `/com.example.DependsOnTest/${sha256.slice(0, 32)}/my-component.zip`,
    );

    expect(componentVersion.componentName).toBe('com.example.DependsOnTest');
    expect(componentVersion.componentVersion).toBe('1.0.0');
    void bucket;
  });

  it('resolves sentinel versions at deploy time and tags the returned content key', () => {
    const componentName = 'com.example.NextVersion';
    const { recipesDir, artifactsDir } = writeBuildOutput(
      componentName,
      'NEXT_PATCH',
      'next-version artifact bytes',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );
    const componentVersion =
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        'ComponentVersion',
        { recipesDir, artifactsDir, bucket },
      );

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, SynthesizedResource>;
    const nextVersion = Object.entries(resources).find(
      ([, resource]) => resource.Type === 'Custom::GreengrassNextVersion',
    );

    expect(nextVersion).toBeDefined();
    if (!nextVersion) {
      throw new Error('Expected a Greengrass next-version custom resource.');
    }

    const [nextVersionLogicalId, nextVersionResource] = nextVersion;
    expect(nextVersionResource.Properties.ComponentName).toBe(componentName);
    expect(nextVersionResource.Properties.Strategy).toBe('patch');

    const recipe = yaml.load(
      readFileSync(
        join(recipesDir, `${componentName}-NEXT_PATCH.yaml`),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    delete recipe.ComponentVersion;
    const expectedContentSha256 = createHash('sha256')
      .update(
        `${yaml.dump(recipe, { lineWidth: -1 })}\n${artifactSetSha256Of(
          'next-version artifact bytes',
        )}`,
      )
      .digest('hex');
    expect(nextVersionResource.Properties.ContentSha256).toBe(
      expectedContentSha256,
    );

    const componentVersionResource =
      resources[stack.getLogicalId(componentVersion.cfnComponentVersion)];
    const tags = componentVersionResource.Properties.Tags as Record<
      string,
      unknown
    >;

    expect(tags['nx:greengrass:versioning']).toBe('NEXT_PATCH');
    expect(tags['nx:greengrass:content-sha256']).toEqual({
      'Fn::GetAtt': [nextVersionLogicalId, 'ContentKey'],
    });

    const bucketDeploymentResource = Object.values(resources).find(
      (resource) => resource.Type === 'Custom::CDKBucketDeployment',
    );

    expect(bucketDeploymentResource).toBeDefined();
    if (!bucketDeploymentResource) {
      throw new Error('Expected a bucket deployment custom resource.');
    }

    expect(bucketDeploymentResource.Properties.DestinationBucketKeyPrefix).toBe(
      `${componentName}/${artifactSetSha256Of('next-version artifact bytes').slice(0, 32)}/`,
    );
    expect(cdkLib.Token.isUnresolved(componentVersion.componentVersion)).toBe(
      true,
    );
    // The public version is the L1's own attribute, so a deployment that
    // references it depends on the published version, not on the resolver.
    expect(stack.resolve(componentVersion.componentVersion)).toEqual({
      'Fn::GetAtt': [
        stack.getLogicalId(componentVersion.cfnComponentVersion),
        'ComponentVersion',
      ],
    });
  });

  it('throws when the recipe references an artifact the build did not produce', () => {
    const { recipesDir, artifactsDir } = writeBuildOutput(
      'com.example.BasenameMismatch',
      '1.0.0',
      'content',
      'renamed-by-hand.zip',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersion',
          { recipesDir, artifactsDir, bucket },
        ),
    ).toThrow(/renamed-by-hand\.zip/);
  });

  it('keys a single-artifact version by its name-and-hash digest', () => {
    const { recipesDir, artifactsDir } = writeBuildOutput(
      'com.example.SingleHashTest',
      '1.0.0',
      'artifact bytes v1',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );
    new ComponentVersionModule.GreengrassComponentVersion(
      stack,
      'ComponentVersion',
      { recipesDir, artifactsDir, bucket },
    );

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const bucketDeploymentResource = Object.values(resources).find(
      (r: any) => r.Type === 'Custom::CDKBucketDeployment',
    ) as any;

    const expectedSha256 = artifactSetSha256Of('artifact bytes v1');
    expect(bucketDeploymentResource.Properties.DestinationBucketKeyPrefix).toBe(
      `com.example.SingleHashTest/${expectedSha256.slice(0, 32)}/`,
    );
  });

  it('keys a two-artifact version by the sorted name-and-hash digest and uploads both under one prefix', () => {
    const { recipesDir, artifactsDir } = writeMultiArtifactBuildOutput(
      'com.example.TwoArtifactTest',
      '1.0.0',
      {
        'my-component-amd64.zip': 'amd64 bytes',
        'my-component-aarch64.zip': 'aarch64 bytes',
      },
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );
    new ComponentVersionModule.GreengrassComponentVersion(
      stack,
      'ComponentVersion',
      { recipesDir, artifactsDir, bucket },
    );

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const bucketDeployments = Object.values(resources).filter(
      (r: any) => r.Type === 'Custom::CDKBucketDeployment',
    );
    // Two artifacts uploaded from one source directory - one BucketDeployment,
    // not two.
    expect(bucketDeployments).toHaveLength(1);

    // Recomputed independently of the construct's own implementation: sorted
    // "<name>:<sha256>" lines joined by "\n", hashed.
    const hashes: Record<string, string> = {
      'my-component-aarch64.zip': sha256Of('aarch64 bytes'),
      'my-component-amd64.zip': sha256Of('amd64 bytes'),
    };
    const sortedNames = Object.keys(hashes).sort();
    const expectedAggregate = createHash('sha256')
      .update(sortedNames.map((n) => `${n}:${hashes[n]}`).join('\n'))
      .digest('hex');

    expect(
      (bucketDeployments[0] as any).Properties.DestinationBucketKeyPrefix,
    ).toBe(`com.example.TwoArtifactTest/${expectedAggregate.slice(0, 32)}/`);

    const componentVersionResource = Object.values(resources).find(
      (r: any) => r.Type === 'AWS::GreengrassV2::ComponentVersion',
    ) as any;
    const renderedRecipe = (
      componentVersionResource.Properties.InlineRecipe[
        'Fn::Join'
      ][1] as unknown[]
    )
      .filter((part): part is string => typeof part === 'string')
      .join('');
    const prefix = `/com.example.TwoArtifactTest/${expectedAggregate.slice(0, 32)}/`;
    expect(renderedRecipe).toContain(`${prefix}my-component-amd64.zip`);
    expect(renderedRecipe).toContain(`${prefix}my-component-aarch64.zip`);
  });

  it.each([
    ['renamed.zip', 'original bytes'],
    ['original.zip', 'changed bytes'],
  ])('changes the artifact-set digest for %s with %s', (name, content) => {
    const componentName = `com.example.Digest${name.startsWith('renamed') ? 'Rename' : 'Content'}`;
    const stack = new cdkLib.Stack(new cdkLib.App(), 'DigestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'Bucket',
    );
    for (const [index, artifacts] of [
      { 'original.zip': 'original bytes' },
      { [name]: content },
    ].entries()) {
      const paths = writeMultiArtifactBuildOutput(
        componentName,
        `1.0.${index}`,
        artifacts,
      );
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        `Version${index}`,
        { ...paths, bucket },
      );
    }
    const uploads = Object.values(
      assertionsLib.Template.fromStack(stack).toJSON().Resources,
    ).filter(
      (resource: any) => resource.Type === 'Custom::CDKBucketDeployment',
    ) as any[];
    expect(uploads).toHaveLength(2);
    expect(uploads[0].Properties.DestinationBucketKeyPrefix).not.toEqual(
      uploads[1].Properties.DestinationBucketKeyPrefix,
    );
  });

  it('throws when the build produced an artifact no manifest references', () => {
    const { recipesDir, artifactsDir } = writeMultiArtifactBuildOutput(
      'com.example.Unreferenced',
      '1.0.0',
      { 'my-component-amd64.zip': 'amd64 bytes' },
    );
    // A stray file the recipe never references - eg an architecture whose
    // manifest was never added.
    writeFileSync(
      join(
        artifactsDir,
        'com.example.Unreferenced',
        '1.0.0',
        'my-component-aarch64.zip',
      ),
      'aarch64 bytes',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersion',
          { recipesDir, artifactsDir, bucket },
        ),
    ).toThrow(/my-component-aarch64\.zip.*no manifest.*references/s);
  });

  it('accepts one artifact referenced by two manifests', () => {
    // The TypeScript multi-arch shape: a single bundle serves both
    // architectures, so two manifests reference the same basename.
    const { recipesDir, artifactsDir } = writeMultiArtifactBuildOutput(
      'com.example.SharedArtifact',
      '1.0.0',
      { 'my-component.zip': 'bundle bytes' },
      { manifestsPerArtifact: 2 },
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersion',
          { recipesDir, artifactsDir, bucket },
        ),
    ).not.toThrow();
  });

  it('fails synth when the same version is claimed twice with a different content hash', () => {
    const { recipesDir: recipesDirA, artifactsDir: artifactsDirA } =
      writeBuildOutput('com.example.DriftTest', '1.0.0', 'content A');

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );
    new ComponentVersionModule.GreengrassComponentVersion(
      stack,
      'ComponentVersionA',
      { recipesDir: recipesDirA, artifactsDir: artifactsDirA, bucket },
    );

    // A second build directory for the SAME componentName@componentVersion,
    // with genuinely different artifact bytes - eg the user forgot to bump
    // ComponentVersion after editing the component.
    const recipesDirB = join(
      tmpDir,
      'com.example.DriftTest',
      '1.0.0',
      'recipes-b',
    );
    const artifactsDirB = join(
      tmpDir,
      'com.example.DriftTest',
      '1.0.0',
      'artifacts-b',
    );
    mkdirSync(recipesDirB, { recursive: true });
    mkdirSync(join(artifactsDirB, 'com.example.DriftTest', '1.0.0'), {
      recursive: true,
    });
    writeFileSync(
      join(recipesDirB, 'com.example.DriftTest-1.0.0.yaml'),
      [
        'RecipeFormatVersion: 2020-01-25',
        'ComponentName: com.example.DriftTest',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
      ].join('\n'),
    );
    writeFileSync(
      join(artifactsDirB, 'com.example.DriftTest', '1.0.0', 'my-component.zip'),
      'content B - genuinely different',
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersionB',
          { recipesDir: recipesDirB, artifactsDir: artifactsDirB, bucket },
        ),
    ).toThrow(/immutable/i);
  });

  it('throws an actionable error when the recipes directory holds more than one recipe', () => {
    const { recipesDir, artifactsDir } = writeBuildOutput(
      'com.example.MultiRecipe',
      '1.0.0',
      'content',
    );
    writeFileSync(join(recipesDir, 'extra.yaml'), 'ComponentName: x');

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersion',
          {
            recipesDir,
            artifactsDir,
            bucket,
          },
        ),
    ).toThrow(/Expected exactly one/);
  });

  // The artifact-set hash and two separators consume 34 prefix characters.
  const componentNameOfLength = (length: number): string =>
    `com.example.${'X'.repeat(length - 'com.example.'.length)}`;

  it('accepts a ComponentName that puts the artifact key prefix exactly at the length limit', () => {
    const componentName = componentNameOfLength(68);
    const { recipesDir, artifactsDir } = writeBuildOutput(
      componentName,
      '1.0.0',
      'artifact bytes at limit',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersion',
          { recipesDir, artifactsDir, bucket },
        ),
    ).not.toThrow();

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const bucketDeploymentResource = Object.values(resources).find(
      (r: any) => r.Type === 'Custom::CDKBucketDeployment',
    ) as any;
    const destinationKeyPrefix =
      bucketDeploymentResource.Properties.DestinationBucketKeyPrefix;
    expect(destinationKeyPrefix).toHaveLength(102);
    expect(destinationKeyPrefix).toBe(
      `${componentName}/${artifactSetSha256Of('artifact bytes at limit').slice(0, 32)}/`,
    );
  });

  it('throws an actionable error naming the limit and the offending length when ComponentName pushes the artifact key prefix past it', () => {
    const componentName = componentNameOfLength(69);
    const { recipesDir, artifactsDir } = writeBuildOutput(
      componentName,
      '1.0.0',
      'artifact bytes over limit',
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
    );

    let thrown: Error | undefined;
    try {
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        'ComponentVersion',
        { recipesDir, artifactsDir, bucket },
      );
    } catch (error) {
      thrown = error as Error;
    }

    // Names the ComponentName and ComponentVersion driving the overflow, the
    // resulting prefix length (103), and the limit it exceeds (102) - not a
    // bare `BucketDeployment` tag-key error.
    expect(thrown).toBeDefined();
    const message = thrown?.message ?? '';
    expect(message).toContain(`ComponentName "${componentName}"`);
    expect(message).not.toContain('Shorten ComponentVersion');
    expect(message).toContain('103');
    expect(message).toContain('exceeding the 102 character limit');
  });

  // `CreateComponentVersion` caps `InlineRecipe` at 16384 bytes (see
  // `MAX_INLINE_RECIPE_BYTES` in `component-version.ts.template`). The exact
  // boundary is derived, never hardcoded: synth once with a one-character
  // padding, measure the resulting dump, then pad the difference. So a change
  // in js-yaml's output shape moves the fixture instead of silently making the
  // test measure the wrong side of the limit.
  //
  // `existingBucketName` keeps `bucketName` a literal, so `InlineRecipe` is a
  // plain string rather than the `Fn::Join` a created bucket's unresolved
  // token produces - the measured size is then independent of CDK's token
  // counter, and so of test order.
  const RECIPE_SIZE_ARTIFACT_CONTENT = 'recipe size artifact bytes';

  const synthInlineRecipe = (
    componentName: string,
    configurationPaddingChars: number,
  ): { inlineRecipe: string; recipeSource: string } => {
    const { recipesDir, artifactsDir, recipeSource } = writePaddedBuildOutput(
      componentName,
      '1.0.0',
      RECIPE_SIZE_ARTIFACT_CONTENT,
      configurationPaddingChars,
    );
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
      { existingBucketName: 'test-bucket' },
    );
    const componentVersion =
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        'ComponentVersion',
        { recipesDir, artifactsDir, bucket },
      );
    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const inlineRecipe = resources[
      stack.getLogicalId(componentVersion.cfnComponentVersion)
    ].Properties.InlineRecipe as string;
    return { inlineRecipe, recipeSource };
  };

  const paddingForDumpedBytes = (
    componentName: string,
    targetBytes: number,
  ): number => {
    const probeBytes = Buffer.byteLength(
      synthInlineRecipe(componentName, 1).inlineRecipe,
      'utf-8',
    );
    return 1 + (targetBytes - probeBytes);
  };

  it('accepts a recipe whose serialized size sits exactly at the InlineRecipe limit, and publishes it byte for byte', () => {
    const componentName = 'com.example.RecipeSizeAtLimit';
    const padding = paddingForDumpedBytes(componentName, 16 * 1024);

    const { inlineRecipe, recipeSource } = synthInlineRecipe(
      componentName,
      padding,
    );

    expect(Buffer.byteLength(inlineRecipe, 'utf-8')).toBe(16384);
    // The guard measures, it never rewrites: what reaches `InlineRecipe` is
    // still exactly `yaml.dump(<recipe with substituted Uris>, { lineWidth: -1 })`.
    const { raw } = RecipeModule.readRecipeSummary(recipeSource, 'recipe.yaml');
    RecipeModule.substituteArtifactUris(raw, {
      bucketName: 'test-bucket',
      keyPrefix: `${componentName}/${artifactSetSha256Of(RECIPE_SIZE_ARTIFACT_CONTENT).slice(0, 32)}/`,
    });
    expect(inlineRecipe).toBe(yaml.dump(raw, { lineWidth: -1 }));
  });

  it('throws an actionable error naming the size, the limit and the likely causes when the recipe is one byte over', () => {
    const componentName = 'com.example.RecipeSizeOver';
    const padding = paddingForDumpedBytes(componentName, 16 * 1024) + 1;
    const { recipesDir, artifactsDir } = writePaddedBuildOutput(
      componentName,
      '1.0.0',
      RECIPE_SIZE_ARTIFACT_CONTENT,
      padding,
    );

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
      { existingBucketName: 'test-bucket' },
    );

    let thrown: Error | undefined;
    try {
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        'ComponentVersion',
        { recipesDir, artifactsDir, bucket },
      );
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    const message = thrown?.message ?? '';
    expect(message).toContain(`${componentName}@1.0.0`);
    expect(message).toContain('16385 bytes');
    expect(message).toContain('exceeding the 16384 byte limit');
    expect(message).toContain('by 1 byte(s)');
    // Names both realistic budget consumers, so the reader knows where to look.
    expect(message).toContain('ComponentConfiguration.DefaultConfiguration');
    expect(message).toContain('platform: linux-amd64-arm64');
  });

  it('measures the recipe in bytes, not characters', () => {
    // The service counts the serialized document's bytes. 6000 three-byte
    // characters make this recipe about 18 KB on the wire while its character
    // count stays around 6 KB, so a check written as `.length` would let it
    // through.
    const componentName = 'com.example.RecipeSizeBytes';
    const { recipesDir, artifactsDir, recipeSource } = writePaddedBuildOutput(
      componentName,
      '1.0.0',
      RECIPE_SIZE_ARTIFACT_CONTENT,
      6000,
      'あ',
    );
    expect(recipeSource.length).toBeLessThan(16384);
    expect(Buffer.byteLength(recipeSource, 'utf-8')).toBeGreaterThan(16384);

    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
      { existingBucketName: 'test-bucket' },
    );

    expect(
      () =>
        new ComponentVersionModule.GreengrassComponentVersion(
          stack,
          'ComponentVersion',
          { recipesDir, artifactsDir, bucket },
        ),
    ).toThrow(/exceeding the 16384 byte limit/);
  });

  // An imported bucket name can be a CloudFormation parameter, whose token
  // text is longer than the shortest name it can resolve to - so the measured
  // recipe can be larger than the submitted one. These two tests pin the
  // guard's answer on both sides of that band. The padding is solved against a
  // dump computed with the SAME token instance the construct will embed, since
  // the token's own text length depends on a process-wide counter.
  const dumpFor = (recipeSource: string, bucketName: string): string => {
    const { componentName, raw } = RecipeModule.readRecipeSummary(
      recipeSource,
      'recipe.yaml',
    );
    RecipeModule.substituteArtifactUris(raw, {
      bucketName,
      keyPrefix: `${componentName}/${artifactSetSha256Of(RECIPE_SIZE_ARTIFACT_CONTENT).slice(0, 32)}/`,
    });
    return yaml.dump(raw, { lineWidth: -1 });
  };

  const paddingForTokenizedBytes = (
    componentName: string,
    bucketName: string,
    targetBytes: number,
  ): number => {
    const probeBytes = Buffer.byteLength(
      dumpFor(paddedRecipeSource(componentName, '1.0.0', 1), bucketName),
      'utf-8',
    );
    return 1 + (targetBytes - probeBytes);
  };

  const synthWithTokenizedBucket = (
    componentName: string,
    overLimitBy: number,
  ): { thrown: Error | undefined; dumpedBytes: number } => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const bucketName = new cdkLib.CfnParameter(stack, 'BucketName', {
      type: 'String',
    }).valueAsString;
    expect(cdkLib.Token.isUnresolved(bucketName)).toBe(true);

    const padding = paddingForTokenizedBytes(
      componentName,
      bucketName,
      16 * 1024 + overLimitBy,
    );
    const { recipesDir, artifactsDir, recipeSource } = writePaddedBuildOutput(
      componentName,
      '1.0.0',
      RECIPE_SIZE_ARTIFACT_CONTENT,
      padding,
    );
    const dumpedBytes = Buffer.byteLength(
      dumpFor(recipeSource, bucketName),
      'utf-8',
    );
    expect(dumpedBytes).toBe(16 * 1024 + overLimitBy);

    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      'ArtifactBucket',
      { existingBucketName: bucketName },
    );
    let thrown: Error | undefined;
    try {
      new ComponentVersionModule.GreengrassComponentVersion(
        stack,
        'ComponentVersion',
        { recipesDir, artifactsDir, bucket },
      );
    } catch (error) {
      thrown = error as Error;
    }
    return { thrown, dumpedBytes };
  };

  it('does not reject a tokenized-bucket recipe whose size the token could still bring under the limit', () => {
    // A `${Token[TOKEN.n]}` placeholder stands in for a name of 3 to 63
    // characters. Four bytes over the cap as measured is under it once the
    // token resolves to a short name, and the service would accept it.
    const { thrown } = synthWithTokenizedBucket(
      'com.example.RecipeSizeTokNear',
      4,
    );

    expect(thrown).toBeUndefined();
  });

  it('rejects a tokenized-bucket recipe too large for even the shortest bucket name', () => {
    const { thrown } = synthWithTokenizedBucket(
      'com.example.RecipeSizeTokOver',
      4096,
    );

    expect(thrown).toBeDefined();
    const message = thrown?.message ?? '';
    expect(message).toContain('com.example.RecipeSizeTokOver@1.0.0');
    expect(message).toContain(`${16 * 1024 + 4096} bytes`);
    // Says which number the verdict rests on, since it is not the measured one.
    expect(message).toContain(
      "do not depend on the artifact bucket's name (still an unresolved token",
    );
    expect(message).toContain('exceeding the 16384 byte limit');
  });
});

describe('GreengrassDeployment', () => {
  it('creates a thing group and targets its ARN', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingGroupName: 'my-things' },
    );

    const template = assertionsLib.Template.fromStack(stack);
    template.hasResourceProperties('AWS::IoT::ThingGroup', {
      ThingGroupName: 'my-things',
    });

    const json = template.toJSON();
    const resources = json.Resources as Record<string, any>;
    const deploymentLogicalId = stack.getLogicalId(deployment.deployment);
    expect(resources[deploymentLogicalId].DeletionPolicy).toBe('Retain');
    expect(resources[deploymentLogicalId].UpdateReplacePolicy).toBe('Retain');
    expect(deployment.thingGroup).toBeDefined();
  });

  const addComponent = (
    stack: import('aws-cdk-lib').Stack,
    id: string,
    componentName: string,
    componentVersion: string,
  ) => {
    const { recipesDir, artifactsDir } = writeBuildOutput(
      componentName,
      componentVersion,
      `${id} artifact`,
    );
    const bucket = new ArtifactBucketModule.GreengrassArtifactBucket(
      stack,
      `${id}Bucket`,
    );
    return new ComponentVersionModule.GreengrassComponentVersion(stack, id, {
      recipesDir,
      artifactsDir,
      bucket,
    });
  };

  it('adds a fixed component with an explicit deployment dependency', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingGroupName: 'my-things' },
    );
    const component = addComponent(
      stack,
      'Component',
      'com.example.Fixed',
      '1.0.0',
    );
    deployment.addComponent(component);

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const deploymentResource =
      resources[stack.getLogicalId(deployment.deployment)];
    const componentLogicalId = stack.getLogicalId(
      component.cfnComponentVersion,
    );
    expect(deploymentResource.DependsOn).toContain(componentLogicalId);
    expect(
      deploymentResource.Properties.Components['com.example.Fixed']
        .ComponentVersion,
    ).toBe('1.0.0');
  });

  it('uses the published version resource token for NEXT_* components', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const component = addComponent(
      stack,
      'Component',
      'com.example.Next',
      'NEXT_PATCH',
    );
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingGroupName: 'my-things' },
    ).addComponent(component);
    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const componentLogicalId = stack.getLogicalId(
      component.cfnComponentVersion,
    );
    const deploymentResource =
      resources[stack.getLogicalId(deployment.deployment)];
    // The published version's own attribute, not the resolver's token.
    expect(
      deploymentResource.Properties.Components['com.example.Next']
        .ComponentVersion,
    ).toEqual({
      'Fn::GetAtt': [componentLogicalId, 'ComponentVersion'],
    });
    // The GetAtt already orders the deployment; the explicit edge is kept so
    // fixed and sentinel versions behave alike.
    expect(deploymentResource.DependsOn).toContain(componentLogicalId);
  });

  it('accumulates components and makes repeated registration idempotent', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingGroupName: 'my-things' },
    );
    const first = addComponent(stack, 'First', 'com.example.First', '1.0.0');
    const second = addComponent(stack, 'Second', 'com.example.Second', '1.0.0');
    deployment.addComponent(first).addComponent(second).addComponent(first);

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const deploymentResource =
      resources[stack.getLogicalId(deployment.deployment)];
    expect(
      Object.keys(deploymentResource.Properties.Components).sort(),
    ).toEqual(['com.example.First', 'com.example.Second']);
    // Two components in one fleet: the deployment resource waits for both
    // published versions, and re-adding one does not duplicate the edge.
    const firstId = stack.getLogicalId(first.cfnComponentVersion);
    const secondId = stack.getLogicalId(second.cfnComponentVersion);
    expect(deploymentResource.DependsOn).toContain(firstId);
    expect(deploymentResource.DependsOn).toContain(secondId);
    expect(
      deploymentResource.DependsOn.filter((id: string) => id === firstId),
    ).toHaveLength(1);
    // The edge sits on the deployment L1 only: the thing group created next
    // to it must not wait for the component versions.
    expect(
      resources[stack.getLogicalId(deployment.thingGroup as any)].DependsOn,
    ).toBeUndefined();
  });

  it('preserves raw configuration and runWith, replaces top-level overrides, and keeps caller input unchanged', () => {
    const input = {
      'com.example.Raw': {
        componentVersion: '1.0.0',
        configurationUpdate: { merge: { retained: true } },
        runWith: { posixUser: 'ggc_user' },
      },
    };
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const component = addComponent(
      stack,
      'Component',
      'com.example.Raw',
      '1.0.1',
    );
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingGroupName: 'my-things', components: input },
    );
    deployment.addComponent(component);
    expect(
      (deployment.deployment as any).components?.['com.example.Raw'],
    ).toMatchObject({
      componentVersion: '1.0.1',
      configurationUpdate: { merge: JSON.stringify({ retained: true }) },
      runWith: { posixUser: 'ggc_user' },
    });
    deployment.addComponent(component, {
      configurationUpdate: { reset: ['/replace'] },
      runWith: { windowsUser: 'Administrator' },
      componentVersion: 'hostile' as never,
    } as any);

    const rendered =
      assertionsLib.Template.fromStack(stack).toJSON().Resources[
        stack.getLogicalId(deployment.deployment)
      ].Properties.Components['com.example.Raw'];
    expect(rendered.ComponentVersion).toBe('1.0.1');
    expect(rendered.ConfigurationUpdate).toEqual({ Reset: ['/replace'] });
    expect(rendered.RunWith).toEqual({ WindowsUser: 'Administrator' });
    expect(input['com.example.Raw']).toEqual({
      componentVersion: '1.0.0',
      configurationUpdate: { merge: { retained: true } },
      runWith: { posixUser: 'ggc_user' },
    });
  });

  it('rejects a different construct with the same component name', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingGroupName: 'my-things' },
    );
    deployment.addComponent(
      addComponent(stack, 'First', 'com.example.Duplicate', '1.0.0'),
    );
    expect(() =>
      deployment.addComponent(
        addComponent(stack, 'Second', 'com.example.Duplicate', '1.0.1'),
      ),
    ).toThrow(/different GreengrassComponentVersion/);
  });

  it('keeps raw entries and empty deployments valid, and reports raw sentinels', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    new DeploymentModule.GreengrassDeployment(stack, 'Empty', {
      thingGroupName: 'empty',
    });
    new DeploymentModule.GreengrassDeployment(stack, 'ConfigOnly', {
      thingGroupName: 'config',
      components: {
        'com.example.Config': {
          configurationUpdate: { reset: ['/enabled'] },
        },
      },
    });
    new DeploymentModule.GreengrassDeployment(stack, 'Sentinel', {
      thingGroupName: 'sentinel',
      components: {
        'com.example.Next': { componentVersion: 'NEXT_PATCH' },
      },
    });
    expect(() => app.synth()).toThrow(
      /com\.example\.Next.*addComponent\(myComponent\)/s,
    );
  });

  it('allows one component construct to be registered with two deployments and retains raw L1 dependency wiring', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const component = addComponent(
      stack,
      'Component',
      'com.example.Shared',
      '1.0.0',
    );
    const first = new DeploymentModule.GreengrassDeployment(stack, 'First', {
      thingGroupName: 'first',
    }).addComponent(component);
    const second = new DeploymentModule.GreengrassDeployment(stack, 'Second', {
      thingGroupName: 'second',
    }).addComponent(component);
    const raw = new cdkLib.CfnResource(stack, 'RawVersion', {
      type: 'AWS::GreengrassV2::ComponentVersion',
    });
    first.deployment.node.addDependency(raw);

    const resources = assertionsLib.Template.fromStack(stack).toJSON()
      .Resources as Record<string, any>;
    const rawId = stack.getLogicalId(raw);
    expect(resources[stack.getLogicalId(first.deployment)].DependsOn).toContain(
      rawId,
    );
    expect(
      resources[stack.getLogicalId(second.deployment)].DependsOn,
    ).toContain(stack.getLogicalId(component.cfnComponentVersion));
  });

  it('imports an existing thing by name without creating a thing group', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      { thingName: 'my-thing' },
    );

    const template = assertionsLib.Template.fromStack(stack);
    template.resourceCountIs('AWS::IoT::ThingGroup', 0);
    // `formatArn` returns an unresolved token at construct-authoring time;
    // it only becomes an `Fn::Join` once the template is synthesized.
    expect(cdkLib.Token.isUnresolved(deployment.targetArn)).toBe(true);

    const json = template.toJSON();
    const deploymentLogicalId = stack.getLogicalId(deployment.deployment);
    expect(json.Resources[deploymentLogicalId].Properties.TargetArn).toEqual(
      expect.objectContaining({ 'Fn::Join': expect.anything() }),
    );
  });

  it('throws when more than one target option is provided', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    expect(
      () =>
        new DeploymentModule.GreengrassDeployment(stack, 'Deployment', {
          thingGroupName: 'my-things',
          thingName: 'my-thing',
        }),
    ).toThrow(/exactly one/);
  });

  it('throws when a literal targetArn belongs to a different account/region than the stack', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    expect(
      () =>
        new DeploymentModule.GreengrassDeployment(stack, 'Deployment', {
          targetArn:
            'arn:aws:iot:eu-west-1:222222222222:thinggroup/other-account-group',
        }),
    ).toThrow(/does not match stack/);
  });

  it('accepts a literal targetArn on an environment-agnostic stack', () => {
    // No `env`, so the stack's own account and region are unresolved tokens.
    // Comparing a real account number against a token would reject every ARN.
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack');
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      {
        targetArn: 'arn:aws:iot:eu-west-1:222222222222:thinggroup/my-group',
      },
    );
    expect(deployment.targetArn).toBe(
      'arn:aws:iot:eu-west-1:222222222222:thinggroup/my-group',
    );
  });

  it('accepts a matching literal targetArn', () => {
    const app = new cdkLib.App();
    const stack = new cdkLib.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const deployment = new DeploymentModule.GreengrassDeployment(
      stack,
      'Deployment',
      {
        targetArn: 'arn:aws:iot:us-east-1:111111111111:thinggroup/my-group',
      },
    );
    expect(deployment.targetArn).toBe(
      'arn:aws:iot:us-east-1:111111111111:thinggroup/my-group',
    );
  });
});

describe('cdk app constructs', () => {
  let tree: Tree;
  const declaration = declareDependencies()({
    ts: [...GREENGRASS_CONSTRUCTS_DEPENDENCIES],
  });
  const options = {
    iac: 'cdk' as const,
    componentNameClassName: 'MyComponent',
    componentDisplayName: 'com.example.MyComponent',
    componentDirName: 'my-component',
    project: 'my-project',
    hostProjectName: 'my-project',
    recipesDirFromRoot:
      'dist/apps/my-project/greengrass/my-component/greengrass-build/recipes',
    artifactsDirFromRoot:
      'dist/apps/my-project/greengrass/my-component/greengrass-build/artifacts',
  };
  const appConstructPath =
    'packages/common/constructs/src/app/greengrass/my-component.ts';

  const occurrences = (path: string, needle: string): number =>
    (tree.read(path, 'utf-8') ?? '').split(needle).length - 1;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
  });

  it('vends the app construct at app/greengrass/<component>.ts as a GreengrassComponentVersion subclass', async () => {
    await addGreengrassComponentAppConstruct(tree, options, declaration);

    const content = tree.read(appConstructPath, 'utf-8')!;
    expect(content).toContain(
      'export class MyComponent extends GreengrassComponentVersion',
    );
    expect(content).toContain("from '../../core/greengrass/index.js'");
    expect(content).toContain(
      'dist/apps/my-project/greengrass/my-component/greengrass-build/recipes',
    );
    expect(content).toContain(
      'dist/apps/my-project/greengrass/my-component/greengrass-build/artifacts',
    );
    expect(
      tree.read(
        'packages/common/constructs/src/app/greengrass/index.ts',
        'utf-8',
      ),
    ).toContain("export * from './my-component.js';");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './greengrass/index.js';");
    expect(
      tree.read('packages/common/constructs/src/core/index.ts', 'utf-8'),
    ).toContain("export * from './greengrass/index.js';");
  });

  it('preserves an edited app construct and adds exports and the artifact edge once across re-runs', async () => {
    await addGreengrassComponentAppConstruct(tree, options, declaration);
    tree.write(appConstructPath, '// user customization');
    await addGreengrassComponentAppConstruct(tree, options, declaration);

    expect(tree.read(appConstructPath, 'utf-8')).toBe('// user customization');
    expect(
      occurrences(
        'packages/common/constructs/src/app/greengrass/index.ts',
        "export * from './my-component.js';",
      ),
    ).toBe(1);
    expect(
      occurrences(
        'packages/common/constructs/src/app/index.ts',
        "export * from './greengrass/index.js';",
      ),
    ).toBe(1);
    expect(
      occurrences(
        'packages/common/constructs/src/core/index.ts',
        "export * from './greengrass/index.js';",
      ),
    ).toBe(1);
    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    expect(
      sharedConstructsConfig.targets.build.dependsOn.filter(
        (d: string) => d === 'my-project:build',
      ),
    ).toHaveLength(1);
  });
});
