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
import {
  addProjectConfiguration,
  generateFiles,
  logger,
  type Tree,
} from '@nx/devkit';
import yaml from 'js-yaml';
import ts from 'typescript';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import terraformProjectGenerator from '../../terraform/project/generator.js';
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

    // The error identifies ComponentName, the 103-character prefix, and the
    // 102-character limit.
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

// Terraform has no `aws-cdk-lib`/`assertions` equivalent to synth against, so
// these assert directly on the rendered `.tf` text `generateFiles` produces -
// the same real EJS rendering path the generators use, just invoked here on a
// bare `createTreeUsingTsSolutionSetup()` tree rather than through a full
// component/deployment generator run.
describe('terraform core modules (via hashicorp/awscc)', () => {
  let tree: Tree;
  const declaration = declareDependencies()({
    ts: [...GREENGRASS_CONSTRUCTS_DEPENDENCIES],
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const readCore = (name: string): string =>
    tree.read(
      `packages/common/terraform/src/core/greengrass/${name}/main.tf`,
      'utf-8',
    )!;

  const addRoot = (name: string, providers: string): string => {
    const root = `packages/${name}`;
    addProjectConfiguration(tree, name, {
      root,
      sourceRoot: `${root}/src`,
      projectType: 'application',
    });
    const path = `${root}/src/providers.tf`;
    tree.write(path, providers);
    return path;
  };

  it('preserves multiline HCL blocks when adding awscc to a generated application', async () => {
    await terraformProjectGenerator(tree, {
      name: 'infra',
      type: 'application',
      directory: 'packages',
    });
    const path = 'packages/infra/src/providers.tf';
    const original = tree.read(path, 'utf-8')!;
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    const content = tree.read(path, 'utf-8')!;
    // Multiline HCL blocks cannot put the first argument on the opening line.
    expect(content).toMatch(/terraform \{\r?\n/);
    expect(content).toMatch(/required_providers \{\r?\n/);
    expect(content).toContain('required_version = ">= 1.0"');
    expect(content).toContain(
      original.slice(original.indexOf('provider "aws"')),
    );
    expect(content).toMatch(/source\s*=\s*"hashicorp\/awscc"/);
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.read(path, 'utf-8')).toBe(content);
  });

  it('adds awscc to every existing application root once, preserving other provider settings', async () => {
    const first = addRoot(
      'first',
      `terraform {
      required_providers {
        aws = { source = "hashicorp/aws", version = "6.0.0" }
      }
    }
    provider "aws" { region = "eu-west-1" }
    # provider "awscc" {} is documentation, not configuration
    `,
    );
    const second = addRoot(
      'second',
      'provider "aws" { region = var.aws_region }',
    );
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    const contents = [first, 'packages/second/src/greengrass-providers.tf'].map(
      (path) => tree.read(path, 'utf-8')!,
    );
    for (const content of contents) {
      expect(content).toMatch(/source\s*=\s*"hashicorp\/awscc"/);
      expect(content.match(/^provider "awscc"/gm)).toHaveLength(1);
      expect(content).toContain('region = var.aws_region');
    }
    expect(tree.read(first, 'utf-8')).toContain(
      'provider "aws" { region = "eu-west-1" }',
    );
    expect(tree.read(second, 'utf-8')).toBe(
      'provider "aws" { region = var.aws_region }',
    );
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(
      [first, 'packages/second/src/greengrass-providers.tf'].map((path) =>
        tree.read(path, 'utf-8'),
      ),
    ).toEqual(contents);
  });

  it('adds awscc to an empty required_providers block', async () => {
    const path = addRoot('empty', 'terraform {\n  required_providers {}\n}\n');
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    const content = tree.read(path, 'utf-8')!;
    expect(content).toMatch(/source\s*=\s*"hashicorp\/awscc"/);
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.read(path, 'utf-8')).toBe(content);
  });

  it('preserves custom awscc requirements and default configurations in separate root files', async () => {
    const path = addRoot(
      'custom',
      `terraform {
      required_providers {
        awscc = { source = "hashicorp/awscc", version = "~> 1.0" }
      }
    }`,
    );
    const defaultConfig =
      'provider "awscc" { region = "eu-west-1"\n profile = "deployment" }';
    const aliasConfig =
      'provider "awscc" { alias = "backup"\n region = "eu-west-2" }';
    tree.write(
      'packages/custom/src/custom-providers.tf',
      `${defaultConfig}\n${aliasConfig}`,
    );
    const original = tree.read(path, 'utf-8');
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.read(path, 'utf-8')).toBe(original);
    expect(tree.read('packages/custom/src/custom-providers.tf', 'utf-8')).toBe(
      `${defaultConfig}\n${aliasConfig}`,
    );
  });

  it('keeps aliases and creates a default awscc configuration when only an alias exists', async () => {
    const path = addRoot(
      'alias',
      `terraform { required_providers { awscc = { source = "hashicorp/awscc" } } }
provider "awscc" { alias = "backup"\n region = "eu-west-2" }`,
    );
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    const content = tree.read(path, 'utf-8')!;
    expect(content).toContain('alias = "backup"');
    expect(content.match(/provider "awscc"/g)).toHaveLength(2);
    expect(content).toContain('region = var.aws_region');
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.read(path, 'utf-8')).toBe(content);
  });

  it('logs how to configure a future root when no Terraform application exists', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await addGreengrassCoreConstructs(
        tree,
        { iac: 'terraform' },
        declaration,
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Create a terraform#project application and re-run greengrass#component',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('vends the same sanitized workspace read prefix for both IaC paths', async () => {
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8')!);
    tree.write(
      'package.json',
      JSON.stringify({ ...packageJson, name: '@My.Org~Team/workspace' }),
    );
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    tree.write(
      'packages/common/constructs/package.json',
      '{"name":"@proj/common-constructs"}',
    );
    await addGreengrassCoreConstructs(tree, { iac: 'cdk' }, declaration);
    expect(readCore('artifact-bucket')).toContain(
      'default     = "com.my.org-team.*"',
    );
    expect(
      tree.read(
        'packages/common/constructs/src/core/greengrass/artifact-bucket.ts',
        'utf-8',
      ),
    ).toContain("keyPrefix: string = 'com.my.org-team.*'");
  });

  it('vends all three modules with pinned required_providers blocks', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    // Every provider a module uses must be declared in that module's own
    // `required_providers` - one it uses but never declares is inherited from
    // the root module UNPINNED, bypassing the versions vended here. Derived
    // from the `resource`/`data` block types the way the
    // `terraform-declare-used-providers` migration derives it, rather than
    // hand-listed, so a module gaining a resource from a new provider fails
    // here instead of shipping unpinned.
    for (const name of ['artifact-bucket', 'component-version', 'deployment']) {
      const content = readCore(name);
      const used = new Set(
        [
          ...content.matchAll(
            /^(?:resource|data) "([a-z0-9]+)(?:_[a-z0-9_]+)?"/gm,
          ),
        ]
          .map((match) => match[1])
          // `terraform_data` is built in to Terraform: no entry, no version.
          .filter((provider) => provider !== 'terraform'),
      );
      expect(used.size).toBeGreaterThan(0);
      for (const provider of used) {
        expect(content).toContain(`source  = "hashicorp/${provider}"`);
      }
    }

    expect(readCore('component-version')).toContain(
      'resource "awscc_greengrassv2_component_version" "this"',
    );
    // The one the previous version of this test missed: `aws_s3_object` makes
    // the component-version module an `aws` consumer as well as an `awscc` one.
    expect(readCore('component-version')).toContain(
      'resource "aws_s3_object" "artifact"',
    );
    expect(readCore('deployment')).toContain(
      'resource "awscc_greengrassv2_deployment" "this"',
    );
    expect(readCore('deployment')).toContain(
      'resource "aws_iot_thing_group" "this"',
    );
  });

  it('preserves customized core and resolver files on later component runs', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    const terraformResolver =
      'packages/common/terraform/src/core/greengrass/component-version/next-version.cjs';
    expect(tree.exists(terraformResolver)).toBe(false);
    const customizedCore =
      'packages/common/terraform/src/core/greengrass/component-version/main.tf';
    tree.write(customizedCore, '# custom component version module');
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.exists(terraformResolver)).toBe(false);
    expect(tree.read(customizedCore, 'utf-8')).toBe(
      '# custom component version module',
    );

    tree.write(
      'packages/common/constructs/package.json',
      '{"name":"@proj/common-constructs","dependencies":{},"devDependencies":{}}',
    );
    await addGreengrassCoreConstructs(tree, { iac: 'cdk' }, declaration);
    const cdkResolver =
      'packages/common/constructs/src/core/greengrass/next-version/index.js';
    expect(tree.exists(cdkResolver)).toBe(true);
    expect(tree.read(cdkResolver, 'utf-8')).toContain(
      'exports.resolveNextVersion',
    );
    tree.write(cdkResolver, 'stale cdk resolver');
    await addGreengrassCoreConstructs(tree, { iac: 'cdk' }, declaration);
    expect(tree.read(cdkResolver, 'utf-8')).toBe('stale cdk resolver');

    const cdkNextVersion = tree.read(
      'packages/common/constructs/src/core/greengrass/next-version.ts',
      'utf-8',
    )!;
    expect(cdkNextVersion).toContain(`runtime: ${cdkLambdaRuntime('node')}`);
    expect(cdkNextVersion).toContain('Custom::GreengrassNextVersion');
    expect(cdkNextVersion).toContain('greengrass:ListComponentVersions');
    expect(cdkNextVersion).toContain('greengrass:DescribeComponent');

    const cdkComponentVersion = tree.read(
      'packages/common/constructs/src/core/greengrass/component-version.ts',
      'utf-8',
    )!;
    expect(cdkComponentVersion).toContain('NEXT_VERSION_STRATEGIES');
    expect(cdkComponentVersion).toContain('NEXT_VERSION_TAG_KEY');
    expect(cdkComponentVersion).toContain('new GreengrassNextVersion');

    const cdkDeployment = tree.read(
      'packages/common/constructs/src/core/greengrass/deployment.ts',
      'utf-8',
    )!;
    expect(cdkDeployment).toContain('addComponent(');
    expect(cdkDeployment).not.toContain('componentVersions');
    expect(cdkDeployment).toContain('addValidation');
    expect(cdkDeployment).toContain(
      'this.deployment.components = this.renderComponents();',
    );
    expect(
      tree.read(
        'packages/common/constructs/src/core/greengrass/index.ts',
        'utf-8',
      ),
    ).toContain("export * from './next-version.js';");
  });

  it('retains the artifact bucket, and orders replacements create-before-destroy', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    // The bucket is the only resource `RemovalPolicy.RETAIN` maps onto
    // cleanly: nothing about it forces a replacement, so `prevent_destroy`
    // only ever refuses a genuine teardown.
    const bucket = readCore('artifact-bucket');
    expect(
      bucket.slice(bucket.indexOf('resource "aws_s3_bucket" "bucket"')),
    ).toContain('prevent_destroy = true');

    // On the component version and the deployment it would instead reject the
    // replacement an ordinary version bump or deployment revision needs, so it
    // must NOT be there. `create_before_destroy` is what keeps the safety
    // property: the new version is published (and rejected by
    // `CreateComponentVersion` if it reuses a version with different content)
    // before the outgoing one is deleted.
    for (const [name, resourceBlock] of [
      [
        'component-version',
        'resource "awscc_greengrassv2_component_version" "this"',
      ],
      ['component-version', 'resource "aws_s3_object" "artifact"'],
      ['deployment', 'resource "awscc_greengrassv2_deployment" "this"'],
    ] as const) {
      const content = readCore(name);
      const afterResource = content.slice(content.indexOf(resourceBlock));
      const lifecycle = afterResource.slice(
        afterResource.indexOf('lifecycle {'),
      );
      expect(lifecycle).toContain('create_before_destroy = true');
      expect(lifecycle.slice(0, lifecycle.indexOf('}'))).not.toContain(
        'prevent_destroy',
      );
    }
  });

  it('component-version depends on the uploaded artifact object, not just the recipe reference', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('component-version');
    expect(content).toContain('depends_on = [aws_s3_object.artifact]');
  });

  it('requires an explicit strict version and has no plan-time AWS resolver', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    const content = readCore('component-version');
    expect(content).toContain(
      'Terraform requires an explicit ComponentVersion such as 1.0.0',
    );
    expect(content).toContain(
      'NEXT_PATCH, NEXT_MINOR and NEXT_MAJOR are supported only by CDK',
    );
    expect(content).toContain('condition     = can(regex(');
    expect(content).not.toContain('hashicorp/external');
    expect(content).not.toContain('data "external"');
    expect(content).not.toContain('next-version.cjs');
    expect(content).toContain('value      = local.component_version');
    expect(content).toContain(
      'depends_on = [awscc_greengrassv2_component_version.this]',
    );
  });

  it('uploads the artifact under a sha256-hashed key prefix, and substitutes only the GDK placeholder Uri', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('component-version');
    // The hash lives in the prefix, not the basename - see the doc comment on
    // `destination_key_prefix`/`replacement_prefix`.
    expect(content).toContain(
      'destination_key_prefix = "${local.component_name}/${substr(local.sha256, 0, 32)}/"',
    );
    // for_each over the hash map - key names come from a `fileset`, always
    // known at plan time.
    expect(content).toContain('for_each = local.artifact_hashes');
    expect(content).toContain(
      'key         = "${local.destination_key_prefix}${each.key}"',
    );
    expect(content).toContain(
      'placeholder_prefix = "s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/"',
    );
    // Only the placeholder-prefixed Uri is rewritten; every other Uri (and
    // every other field) passes through the `merge(...)` untouched.
    expect(content).toContain(
      'startswith(artifact.Uri, local.placeholder_prefix)',
    );
    expect(content).toContain(': artifact.Uri');
  });

  it('guards against a missing recipe or artifact, and basename mismatches in both directions', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('component-version');
    expect(content).toContain('resource "terraform_data" "guard"');
    expect(content).toContain('length(local.recipe_files) == 1');
    expect(content).toContain('length(local.artifact_files) >= 1');
    expect(content).toContain('length(local.missing_basenames) == 0');
    expect(content).toContain('length(local.unreferenced_artifacts) == 0');
  });

  it('keys every artifact set by the sorted name-and-hash digest', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('component-version');
    expect(content).not.toContain('length(local.artifact_basenames) == 1');
    expect(content).toContain(
      'sha256(join("\\n", [for f in local.artifact_basenames : "${f}:${local.artifact_hashes[f]}"]))',
    );
    expect(content).toContain(
      'destination_key_prefix = "${local.component_name}/${substr(local.sha256, 0, 32)}/"',
    );
    expect(content).toContain(
      'replacement_prefix     = "s3://${var.bucket_name}/${local.destination_key_prefix}"',
    );
    // Each object carries its own file's hash, so a change to one artifact
    // replaces only that object - under a prefix the aggregate moved.
    expect(content).toContain('source_hash = each.value');
  });

  it('deployment requires exactly one of thing_group_name, thing_name or target_arn', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('deployment');
    expect(content).toContain('length(local.target_inputs_provided) == 1');
    expect(content).toContain(
      'requires exactly one of thing_group_name, thing_name or target_arn',
    );
    expect(content).toContain('next_version_sentinel_components');
    expect(content).toContain(
      'Terraform requires explicit versions such as 1.0.0; automatic versioning is supported only by CDK',
    );
  });

  it('cross-checks a literal target_arn against the caller identity, region and partition', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    // The CDK construct's `assertArnMatchesStack`. Verified against the real
    // terraform CLI: the mocked identity reaches this precondition through a
    // nested module from a root-level `mock_data "aws_caller_identity"`, which
    // is exactly what the generated plan test writes.
    const content = readCore('deployment');
    expect(content).toContain('length(local.target_arn_mismatches) == 0');
    expect(content).toContain('data.aws_caller_identity.current.account_id');
    expect(content).toContain('data.aws_region.current.region');
    expect(content).toContain('data.aws_partition.current.partition');
    expect(content).toContain(
      'looks like it belongs to a different environment',
    );
  });

  it('leaves a recipe without Manifests, and a manifest without Artifacts, without those keys', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    // HCL forbids a conditional whose arms have different types, so "add the
    // key only when the authored recipe had it" is expressed as a zero- or
    // one-element list expanded into `merge`. An unconditional
    // `merge(x, { Manifests = ... })` would add an empty list to every recipe
    // that has no manifests.
    const content = readCore('component-version');
    expect(content).toContain('range(can(local.recipe.Manifests) ? 1 : 0)');
    expect(content).toContain('range(can(manifest.Artifacts) ? 1 : 0)');
    // The unconditional forms these replaced, which would add the key to every
    // recipe. (`try(manifest.Artifacts, [])` is still correct in
    // `substituted_basenames`, which only enumerates names.)
    expect(content).not.toContain('merge(local.recipe, { Manifests');
    expect(content).not.toContain('merge(manifest, {');
  });

  it('encodes the inline recipe as JSON, never as YAML', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('component-version');
    // CreateComponentVersion picks its parser from the document's first byte.
    // `yamlencode` always quotes mapping keys, so its first byte is `"`, the
    // service parses the YAML body as JSON, and every apply fails with
    // `Invalid recipe format; line: 1, column: 1` - verified against the real
    // API. This assertion is the only thing standing between that regression
    // and every Terraform user's first deploy.
    expect(content).toContain(
      'inline_recipe = jsonencode(local.substituted_recipe)',
    );
    // The call form, not the bare word: the comment above that line names
    // `yamlencode` precisely so nobody reintroduces it.
    expect(content).not.toContain('yamlencode(');
  });

  it('grants s3:GetObject, scoped to the given prefix, when a token exchange role is configured', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    const content = readCore('artifact-bucket');
    expect(content).toContain(
      'resource "aws_iam_role_policy" "token_exchange_read"',
    );
    expect(content).toContain('Action   = "s3:GetObject"');
    expect(content).toContain(
      'Resource = "${local.bucket_arn}/${var.token_exchange_key_prefix}"',
    );
  });

  it('orders the artifact-bucket module outputs after the bucket is hardened, not just created', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    // F3: `aws_s3_object.artifact` (in the component-version module) only
    // ever receives this module's `bucket_name` output, a plain string with
    // no dependency of its own - so the output itself must `depends_on` the
    // four resources that harden the bucket, or an artifact can land before
    // versioning, encryption, the public-access block or the policy exist.
    const content = readCore('artifact-bucket');
    const nameOutput = content.slice(content.indexOf('output "bucket_name"'));
    for (const resource of [
      'aws_s3_bucket_versioning.bucket',
      'aws_s3_bucket_server_side_encryption_configuration.bucket',
      'aws_s3_bucket_public_access_block.bucket',
      'aws_s3_bucket_policy.bucket',
    ]) {
      expect(nameOutput.slice(0, nameOutput.indexOf('}'))).toContain(resource);
    }
  });

  it('generates a bucket name derived from bucket_name_prefix, not an opaque AWS-generated one', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);

    // F7: leaving `bucket_name` unset must not fall through to an AWS-chosen
    // "terraform-<random>" default - the generated name carries the
    // caller's own prefix (typically the deployment's name) plus enough to
    // stay globally unique.
    const content = readCore('artifact-bucket');
    expect(content).toContain('variable "bucket_name_prefix"');
    expect(content).toContain(
      'bucket = coalesce(var.bucket_name, local.generated_bucket_name)',
    );
    expect(content).toContain('resource "random_string" "bucket_suffix"');
    expect(content).toContain('data.aws_caller_identity.current[0].account_id');
    expect(content).toContain('data.aws_region.current[0].region');
  });

  it('preserves customized core modules while adding missing files', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    tree.write(
      'packages/common/terraform/src/core/greengrass/deployment/main.tf',
      '# user customization',
    );
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(readCore('deployment')).toBe('# user customization');
    expect(
      tree.exists(
        'packages/common/terraform/src/core/greengrass/artifact-bucket/main.tf',
      ),
    ).toBe(true);
  });

  it('keeps the resolver SDK in CDK constructs and adds none for Terraform', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.exists('packages/common/terraform/package.json')).toBe(false);
    const rootPackageJson = JSON.parse(
      tree.read('package.json', 'utf-8') ?? '{}',
    );
    expect(
      rootPackageJson.devDependencies?.['@aws-sdk/client-greengrassv2'],
    ).toBeUndefined();
    expect(
      rootPackageJson.devDependencies?.['@aws-sdk/client-sts'],
    ).toBeUndefined();
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8') ?? '',
    ) as { catalog?: Record<string, string> };
    expect(
      workspaceYaml.catalog?.['@aws-sdk/client-greengrassv2'],
    ).toBeUndefined();
    expect(workspaceYaml.catalog?.['@aws-sdk/client-sts']).toBeUndefined();
    expect(rootPackageJson.dependencies?.['js-yaml']).toBeUndefined();
    expect(rootPackageJson.devDependencies?.['js-yaml']).toBeUndefined();

    const cdkTree = createTreeUsingTsSolutionSetup();
    cdkTree.write(
      'packages/common/constructs/package.json',
      '{"name":"@proj/common-constructs","dependencies":{},"devDependencies":{}}',
    );
    await addGreengrassCoreConstructs(cdkTree, { iac: 'cdk' }, declaration);
    const cdkRootPackageJson = JSON.parse(
      cdkTree.read('package.json', 'utf-8') ?? '{}',
    );
    expect(
      cdkRootPackageJson.devDependencies['@aws-sdk/client-greengrassv2'],
    ).toBeUndefined();
    expect(
      cdkRootPackageJson.devDependencies?.['@aws-sdk/client-sts'],
    ).toBeUndefined();
    // The vended Lambda handler requires the Greengrass client, and the workspace's
    // biome `noUndeclaredDependencies` rule checks them against this manifest.
    const cdkConstructsPackageJson = JSON.parse(
      cdkTree.read('packages/common/constructs/package.json', 'utf-8') ?? '{}',
    );
    expect(
      cdkConstructsPackageJson.dependencies['@aws-sdk/client-greengrassv2'],
    ).toBe('catalog:');
    expect(
      cdkConstructsPackageJson.dependencies['@aws-sdk/client-sts'],
    ).toBeUndefined();
  });

  it('does not vend internal Terraform tests or fixtures', async () => {
    await addGreengrassCoreConstructs(tree, { iac: 'terraform' }, declaration);
    expect(tree.children('packages/common/terraform/src/tests')).toEqual([]);
    expect(
      tree.listChanges().some((file) => file.path.includes('FixtureComponent')),
    ).toBe(false);
  });
});

describe('terraform app modules', () => {
  let tree: Tree;
  const declaration = declareDependencies()({
    ts: [...GREENGRASS_CONSTRUCTS_DEPENDENCIES],
  });

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    // `addArtifactProjectToSharedTargets` updates this project's targets, so
    // it must already exist - `sharedConstructsGenerator` is what creates it
    // in the real generator flow.
    await terraformProjectGenerator(tree, {
      name: 'terraform',
      directory: 'packages/common',
      type: 'library',
    });
  });

  it('vends a per-component module taking the bucket name as a plain variable', async () => {
    await addGreengrassComponentAppConstruct(
      tree,
      {
        iac: 'terraform',
        componentNameClassName: 'MyComponent',
        componentDisplayName: 'com.example.MyComponent',
        componentDirName: 'my-component',
        project: 'my-project',
        hostProjectName: 'my-project',
        recipesDirFromRoot:
          'dist/apps/my-project/greengrass/my-component/greengrass-build/recipes',
        artifactsDirFromRoot:
          'dist/apps/my-project/greengrass/my-component/greengrass-build/artifacts',
      },
      declaration,
    );

    const modulePath =
      'packages/common/terraform/src/app/greengrass-component/my-component/my-component.tf';
    expect(tree.exists(modulePath)).toBe(true);
    const content = tree.read(modulePath, 'utf-8')!;
    expect(content).toContain('variable "bucket_name"');
    expect(content).toContain(
      'source = "../../../core/greengrass/component-version"',
    );
    expect(content).toContain(
      'dist/apps/my-project/greengrass/my-component/greengrass-build/recipes',
    );
  });

  it('is idempotent: re-running twice registers the artifact dependency exactly once', async () => {
    const options = {
      iac: 'terraform' as const,
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
    await addGreengrassComponentAppConstruct(tree, options, declaration);
    await addGreengrassComponentAppConstruct(tree, options, declaration);

    const sharedTerraformConfig = JSON.parse(
      tree.read('packages/common/terraform/project.json', 'utf-8') ?? '{}',
    );
    expect(
      sharedTerraformConfig.targets.build.dependsOn.filter(
        (d: string) => d === 'my-project:build',
      ),
    ).toHaveLength(1);
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
