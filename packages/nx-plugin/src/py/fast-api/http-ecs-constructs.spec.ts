/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Tree, updateJson } from '@nx/devkit';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { pyFastApiProjectGenerator } from './generator.js';
import type { PyFastApiProjectGeneratorSchema } from './schema';

const CONSTRUCTS_SRC = 'packages/common/constructs/src';

// Temp files sit next to this spec so `aws-cdk-lib` and `constructs` resolve
// from the workspace root `node_modules`; `_tmp_*` is git-ignored.
const TMP_DIR = join(import.meta.dirname, `_tmp_http-ecs-${process.pid}`);

/**
 * Stands in for the metadata the `openapi` target generates from the API's
 * spec at build time, which the construct derives its routes from.
 */
const METADATA_STUB = `export const OPERATION_DETAILS = {
  echo: { path: '/echo', method: 'GET' },
} as const;

export type Operations = keyof typeof OPERATION_DETAILS;
`;

const generatorOptions = (
  auth: PyFastApiProjectGeneratorSchema['auth'],
): PyFastApiProjectGeneratorSchema => ({
  name: 'test-api',
  directory: 'apps',
  infra: 'http-ecs',
  integrationPattern: 'shared',
  auth,
  iac: 'cdk',
});

const readOrThrow = (tree: Tree, path: string): string => {
  const content = tree.read(path, 'utf-8');
  if (content === null) {
    throw new Error(`Not rendered: ${path}`);
  }
  return content;
};

describe('vended FastAPI http-ecs constructs compile', () => {
  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  const compile = async (
    auth: PyFastApiProjectGeneratorSchema['auth'],
    format: 'esm' | 'cjs',
  ): Promise<string[]> => {
    const tree = createTreeUsingTsSolutionSetup();
    if (format === 'cjs') {
      updateJson(tree, 'package.json', (json) => ({
        ...json,
        type: 'commonjs',
      }));
    }
    await pyFastApiProjectGenerator(tree, generatorOptions(auth));

    const srcDir = join(TMP_DIR, `${auth}-${format}`, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(TMP_DIR, `${auth}-${format}`, 'package.json'),
      JSON.stringify({ type: format === 'esm' ? 'module' : 'commonjs' }),
    );

    const rootNames: string[] = [];
    const walk = (treePath: string): string[] =>
      tree.isFile(treePath)
        ? [treePath]
        : tree.children(treePath).flatMap((c) => walk(`${treePath}/${c}`));
    for (const treePath of walk(CONSTRUCTS_SRC)) {
      const target = join(srcDir, treePath.slice(CONSTRUCTS_SRC.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readOrThrow(tree, treePath));
      rootNames.push(target);
    }
    // Written by the `openapi` target during a build, so it is not in the tree.
    const metadataPath = join(srcDir, 'generated/test-api/metadata.gen.ts');
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, METADATA_STUB);
    rootNames.push(metadataPath);

    const program = ts.createProgram(rootNames, {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) =>
          `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      );
  };

  it.each<[PyFastApiProjectGeneratorSchema['auth'], 'esm' | 'cjs']>([
    ['iam', 'esm'],
    ['cognito', 'esm'],
    ['custom', 'esm'],
    ['iam', 'cjs'],
  ])(
    'should type check with %s auth as %s',
    async (auth, format) => {
      expect(await compile(auth, format)).toEqual([]);
    },
    180_000,
  );
});

/**
 * The FastAPI variant's routes come from the generated operation metadata
 * rather than from a tRPC router, and that metadata is the input the
 * authorizer assertion depends on, so it is synthesised here as well as in
 * `utils/api-constructs/http-ecs-constructs.spec.ts`.
 */
describe('FastAPI http-ecs API construct synth', () => {
  const MODULE_DIR = join(TMP_DIR, 'modules');
  const IMAGE_DIR = join(TMP_DIR, 'image');
  let cdkLib: typeof import('aws-cdk-lib');
  let ec2: typeof import('aws-cdk-lib/aws-ec2');
  let assertions: typeof import('aws-cdk-lib/assertions');
  let appCount = 0;

  /** The two operations the stub metadata declares, as plain ESM. */
  const METADATA_MODULE = `export const OPERATION_DETAILS = {
  echo: { path: '/echo', method: 'GET' },
  save: { path: '/save', method: 'POST' },
};
`;

  beforeAll(async () => {
    mkdirSync(IMAGE_DIR, { recursive: true });
    writeFileSync(join(IMAGE_DIR, 'Dockerfile'), 'FROM scratch\n');
    cdkLib = await import('aws-cdk-lib');
    ec2 = await import('aws-cdk-lib/aws-ec2');
    assertions = await import('aws-cdk-lib/assertions');
  }, 120_000);

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  /**
   * Transpiles the vended constructs into ES modules side by side, pointing
   * every relative import at its sibling there and the generated operation
   * metadata at a stub. The templates are not real `.ts` files, so they cannot
   * be imported directly.
   */
  const transpileConstructs = (
    tree: Tree,
    moduleDir: string,
    paths: string[],
  ): void => {
    mkdirSync(moduleDir, { recursive: true });
    const modulePath = (name: string) => join(moduleDir, `${name}.mjs`);
    writeFileSync(modulePath('metadata-stub'), METADATA_MODULE);

    for (const path of paths) {
      const name = path.split('/').pop()!.replace(/\.ts$/, '');
      const transpiled = ts.transpileModule(
        readOrThrow(tree, `${CONSTRUCTS_SRC}/${path}`),
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        },
      ).outputText;
      writeFileSync(
        modulePath(name),
        transpiled
          // The metadata's basename holds a dot, so it is rewritten before the
          // general rule below, which only matches a plain basename.
          .replace(
            /(["'])(?:\.{1,2}\/)+(?:[\w-]+\/)*metadata\.gen\.js\1/g,
            () =>
              JSON.stringify(pathToFileURL(modulePath('metadata-stub')).href),
          )
          .replace(
            /(["'])(?:\.{1,2}\/)+(?:[\w-]+\/)*([\w-]+)\.js\1/g,
            (_match, _quote, mod) =>
              JSON.stringify(pathToFileURL(modulePath(mod)).href),
          )
          // The modules are written side by side rather than at the paths the
          // generator vends, so an asset path resolved from `import.meta.url`
          // lands inside the temp root.
          .replace(/import\.meta\.url/g, () =>
            JSON.stringify(pathToFileURL(modulePath(name)).href),
          ),
      );
    }
  };

  const loadApi = async (
    auth: PyFastApiProjectGeneratorSchema['auth'],
  ): Promise<{
    readonly TestApi: {
      new (
        scope: import('constructs').Construct,
        id: string,
        props: Record<string, unknown>,
      ): unknown;
      defaultIntegrations: (
        scope: import('constructs').Construct,
        props: Record<string, unknown>,
      ) => { build: () => Record<string, unknown> };
    };
  }> => {
    const tree = createTreeUsingTsSolutionSetup();
    await pyFastApiProjectGenerator(tree, generatorOptions(auth));

    // The same depth below a workspace root as the real construct, so the
    // relative Lambda asset path it resolves lands inside the temp root.
    const fakeRoot = join(MODULE_DIR, auth);
    const moduleDir = join(fakeRoot, 'packages/common/constructs/src/app/apis');
    mkdirSync(join(fakeRoot, 'dist/apps/test_api/bundle-x86/authorizer'), {
      recursive: true,
    });
    writeFileSync(
      join(fakeRoot, 'dist/apps/test_api/bundle-x86/authorizer/index.py'),
      '',
    );
    transpileConstructs(tree, moduleDir, [
      'core/checkov.ts',
      'core/cloudfront.ts',
      'core/runtime-config.ts',
      'core/workspace.ts',
      'core/api/utils.ts',
      'core/api/http-api.ts',
      'core/api/ecs-http-endpoint.ts',
      'core/container/ecs-service.ts',
      'app/services/test-api-container.ts',
      'app/apis/test-api.ts',
    ]);
    return await import(pathToFileURL(join(moduleDir, 'test-api.mjs')).href);
  };

  const synthApi = async (auth: PyFastApiProjectGeneratorSchema['auth']) => {
    const api = await loadApi(auth);
    const app = new cdkLib.App({
      outdir: join(TMP_DIR, `cdk.out-${appCount++}`),
    });
    const stack = new cdkLib.Stack(app, 'Test');
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const integrations = api.TestApi.defaultIntegrations(stack, {
      vpc,
      service: { image: { directory: IMAGE_DIR } },
    }).build();
    const identity =
      auth === 'cognito'
        ? await (async () => {
            const cognito = await import('aws-cdk-lib/aws-cognito');
            const userPool = new cognito.UserPool(stack, 'UserPool');
            return { userPool, userPoolClient: userPool.addClient('Client') };
          })()
        : undefined;
    new api.TestApi(stack, 'TestApi', {
      integrations,
      ...(identity ? { identity } : {}),
    });

    const resources = assertions.Template.fromStack(stack).toJSON()
      .Resources as Record<
      string,
      { readonly Type: string; readonly Properties: Record<string, any> }
    >;
    return (type: string) =>
      Object.entries(resources).filter(([, r]) => r.Type === type);
  };

  it.each<[PyFastApiProjectGeneratorSchema['auth'], string]>([
    ['iam', 'AWS_IAM'],
    ['cognito', 'JWT'],
    ['custom', 'CUSTOM'],
  ])(
    'should authorize every route with the %s authorizer',
    async (auth, authorizationType) => {
      const ofType = await synthApi(auth);

      const routes = ofType('AWS::ApiGatewayV2::Route');
      // One route per operation in the stub metadata, and no catch-all.
      expect(routes).toHaveLength(2);
      for (const [, route] of routes) {
        expect(route.Properties.AuthorizationType).toBe(authorizationType);
        if (auth !== 'iam') {
          expect(route.Properties.AuthorizerId).toBeDefined();
        }
      }
      expect(ofType('AWS::ApiGatewayV2::Authorizer')).toHaveLength(
        auth === 'iam' ? 0 : 1,
      );

      // Every route resolves to the one load-balancer integration.
      const integrations = ofType('AWS::ApiGatewayV2::Integration');
      expect(integrations).toHaveLength(1);
      expect(integrations[0][1].Properties.ConnectionType).toBe('VPC_LINK');
      expect(
        new Set(routes.map(([, r]) => JSON.stringify(r.Properties.Target)))
          .size,
      ).toBe(1);
    },
    300_000,
  );
});
