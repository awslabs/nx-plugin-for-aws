/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree, writeJson } from '@nx/devkit';
import agentcoreGatewayGenerator from '../../agentcore-gateway/generator';
import tsSmithyApiGenerator from '../../smithy/ts/api/generator';
import tsAgentGenerator from '../../ts/agent/generator';
import tsProjectGenerator from '../../ts/lib/generator';
import tsMcpServerGenerator from '../../ts/mcp-server/generator';
import tsRdbGenerator from '../../ts/rdb/generator';
import { createTreeUsingTsSolutionSetup } from '../test';
import { BASE_IMAGES, PY_VERSIONS, TS_VERSIONS } from '../versions';
import { syncVendedVersions } from './sync-vended-versions';

// `@nx/js`'s `libraryGenerator` crashes in this environment inside the
// `@nx/vitest` configuration step, which resolves the project from a graph the
// in-memory tree has not produced. It only scaffolds the host TypeScript project
// — tsconfigs, a manifest and a sample source file — none of which carries a
// version pin, so it is replaced with an equivalent writing those directly.
// Every generator that actually vends a pin runs for real.
vi.mock('@nx/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx/js')>();
  return {
    ...actual,
    libraryGenerator: async (
      tree: Tree,
      options: { name: string; directory: string },
    ) => {
      const root = options.directory;
      writeJson(tree, `${root}/package.json`, {
        name: options.name,
        version: '0.0.1',
        type: 'module',
        main: './src/index.ts',
      });
      for (const config of [
        'tsconfig.json',
        'tsconfig.lib.json',
        'tsconfig.spec.json',
      ]) {
        writeJson(tree, `${root}/${config}`, {
          extends: '../../tsconfig.base.json',
          compilerOptions: { outDir: 'dist' },
          include: ['src/**/*.ts'],
          files: [],
          references: [],
        });
      }
      tree.write(`${root}/src/index.ts`, 'export const hello = () => "hi";\n');
      addProjectConfiguration(tree, options.name, {
        root,
        sourceRoot: `${root}/src`,
        projectType: 'library',
        targets: { build: { dependsOn: ['compile'] }, compile: {} },
      });
      return () => {};
    },
  };
});

/**
 * The versions an older release vended, applied to a freshly generated workspace
 * to stand in for one scaffolded back then.
 */
const DOWNGRADE: readonly [RegExp, string][] = [
  [new RegExp(`npm@${TS_VERSIONS.npm}`, 'g'), 'npm@11.0.0'],
  [new RegExp(`minimatch=${TS_VERSIONS.minimatch}`, 'g'), 'minimatch=9.0.5'],
  [
    new RegExp(
      `propagator-jaeger=${TS_VERSIONS['@opentelemetry/propagator-jaeger']}`,
      'g',
    ),
    'propagator-jaeger=2.8.0',
  ],
  [
    new RegExp(
      `autoinstrumentation@${TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation']}`,
      'g',
    ),
    'autoinstrumentation@0.11.0',
  ],
  [new RegExp(`prisma@${TS_VERSIONS.prisma}`, 'g'), 'prisma@6.1.0'],
  // `rolldown-plugin-dts` first, since `rolldown@` is a prefix of it.
  [
    new RegExp(
      `rolldown-plugin-dts@${TS_VERSIONS['rolldown-plugin-dts']}`,
      'g',
    ),
    'rolldown-plugin-dts@0.16.5',
  ],
  [
    new RegExp(`rolldown@${TS_VERSIONS.rolldown}`, 'g'),
    'rolldown@1.0.0-beta.38',
  ],
  [
    new RegExp(
      `@rollup/plugin-esm-shim@${TS_VERSIONS['@rollup/plugin-esm-shim']}`,
      'g',
    ),
    '@rollup/plugin-esm-shim@0.1.0',
  ],
  [
    new RegExp(BASE_IMAGES.node, 'g'),
    'public.ecr.aws/docker/library/node:lts-bookworm-slim',
  ],
  [
    new RegExp(BASE_IMAGES.python, 'g'),
    'public.ecr.aws/docker/library/python:3.12-slim',
  ],
  [
    new RegExp(`boto3==${PY_VERSIONS.boto3.replace('==', '')}`, 'g'),
    'boto3==1.40.0',
  ],
  [
    new RegExp(`httpx==${PY_VERSIONS.httpx.replace('==', '')}`, 'g'),
    'httpx==0.27.0',
  ],
  [new RegExp(`mcp==${PY_VERSIONS.mcp.replace('==', '')}`, 'g'), 'mcp==1.20.0'],
  [/aquasecurity\/trivy:[0-9][^"\s]*/g, 'aquasecurity/trivy:0.60.0'],
];

/** Every file a vended pin can be embedded in. */
const isPinFile = (filePath: string): boolean =>
  /(^|\/)(Dockerfile|[^/]+\.Dockerfile)$/.test(filePath) ||
  filePath.endsWith('.tf') ||
  filePath.endsWith('project.json');

const pinFiles = (tree: Tree): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const child of tree.children(dir)) {
      const full = dir === '.' ? child : `${dir}/${child}`;
      if (child === 'node_modules') {
        continue;
      }
      if (tree.isFile(full)) {
        if (isPinFile(full)) {
          found.push(full);
        }
      } else {
        walk(full);
      }
    }
  };
  walk('.');
  return found;
};

/** A workspace covering every generator that embeds a pin. */
const generateWorkspace = async (tree: Tree, iac: 'cdk' | 'terraform') => {
  await tsProjectGenerator(tree, { name: 'agent-app' } as never);
  await tsAgentGenerator(tree, {
    project: 'agent-app',
    iac,
    infra: 'agentcore',
    protocol: 'http',
  } as never);
  await tsProjectGenerator(tree, { name: 'mcp-app' } as never);
  await tsMcpServerGenerator(tree, {
    project: 'mcp-app',
    iac,
    infra: 'agentcore',
  } as never);
  await tsRdbGenerator(tree, { name: 'db', engine: 'postgres', iac } as never);
  await tsSmithyApiGenerator(tree, {
    name: 'my-api',
    infra: 'rest-lambda',
    auth: 'iam',
    iac,
  } as never);
  await agentcoreGatewayGenerator(tree, {
    name: 'gw',
    project: 'agent-app',
    iac,
    auth: 'iam',
  } as never);
};

// The whole point of the sync, end to end: a workspace an older release
// generated, migrated to this one, must hold exactly the pins a workspace
// generated today does. A fixture can only assert what it was written to mirror,
// so this runs the real generators and compares against their own output.
describe.each(['cdk', 'terraform'] as const)(
  'a real %s workspace, downgraded and migrated',
  (iac) => {
    it('should end up with exactly the pins a fresh workspace has', async () => {
      const tree = createTreeUsingTsSolutionSetup();
      await generateWorkspace(tree, iac);

      const files = pinFiles(tree);
      // A workspace this size must produce Dockerfiles, Terraform and targets;
      // an empty sweep would make the comparison below vacuous.
      expect(files.length).toBeGreaterThan(3);

      // The baseline is a freshly generated workspace *after* a sync, not raw
      // generator output: a template is free to pin a version behind what this
      // release vends, and the migration is expected to move that too.
      await syncVendedVersions(tree);
      const fresh = new Map(
        files.map((file) => [file, tree.read(file, 'utf-8')!]),
      );

      let downgraded = 0;
      for (const [file, contents] of fresh) {
        let older = contents;
        for (const [pattern, version] of DOWNGRADE) {
          older = older.replace(pattern, version);
        }
        if (older !== contents) {
          tree.write(file, older);
          downgraded += 1;
        }
      }
      // The downgrade has to bite, or the migration has nothing to restore.
      expect(downgraded).toBeGreaterThan(0);

      await syncVendedVersions(tree);

      const drifted = [...fresh].filter(
        ([file, original]) => tree.read(file, 'utf-8') !== original,
      );
      for (const [file, original] of drifted) {
        const got = tree.read(file, 'utf-8')!;
        const wantLines = original.split('\n');
        got.split('\n').forEach((line, i) => {
          if (line !== wantLines[i]) {
            console.log(
              `DRIFT ${file}\n  want: ${wantLines[i]}\n  got : ${line}`,
            );
          }
        });
      }
      expect(drifted.map(([file]) => file)).toEqual([]);
    }, 300000);
  },
);
