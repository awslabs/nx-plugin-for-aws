/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addProjectConfiguration, generateFiles, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test';
import {
  BASE_IMAGES,
  CONTAINER_VERSIONS,
  PY_VERSIONS,
  TS_VERSIONS,
} from '../versions';
import { syncVendedVersions } from './sync-vended-versions';

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..', '..');
/**
 * Render a real template the way a generator does — through devkit's
 * `generateFiles` — and return the emitted text.
 */
const render = (
  scratch: Tree,
  rel: string,
  data: Record<string, unknown>,
): string => {
  // Isolate the one template, so rendering it needs no stubs for the vars its
  // siblings in the same directory happen to read.
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  const file = path.basename(rel);
  fs.copyFileSync(path.join(PLUGIN_SRC, rel), path.join(isolated, file));
  generateFiles(scratch, isolated, '__rendered__', data);
  const out = `__rendered__/${file.replace(/\.template$/, '')}`;
  const rendered = scratch.read(out, 'utf-8');
  if (rendered === null) {
    throw new Error(`template ${rel} rendered nothing at ${out}`);
  }
  return rendered;
};

// Stand-in for an OLD release: whatever the template renders, rolled back.
const rollback = (s: string) =>
  s
    .replace(`npm@${TS_VERSIONS.npm}`, 'npm@11.0.0')
    .replace(
      `jaeger=${TS_VERSIONS['@opentelemetry/propagator-jaeger']}`,
      'jaeger=2.8.0',
    )
    .replace(`minimatch=${TS_VERSIONS.minimatch}`, 'minimatch=9.0.5')
    .replace(
      `autoinstrumentation@${TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation']}`,
      'autoinstrumentation@0.11.0',
    )
    .replace(`prisma@${TS_VERSIONS.prisma}`, 'prisma@6.1.0')
    .replace(
      BASE_IMAGES.node,
      'public.ecr.aws/docker/library/node:lts-bookworm-slim',
    )
    .replace(
      BASE_IMAGES.python,
      'public.ecr.aws/docker/library/python:3.12-slim',
    )
    .replaceAll(PY_VERSIONS.boto3.replace('==', ''), '1.40.0')
    .replaceAll(PY_VERSIONS.httpx.replace('==', ''), '0.27.0')
    .replaceAll(PY_VERSIONS.mcp.replace('==', ''), '1.20.0');

describe('sync against the real vended templates', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'agent', {
      root: 'packages/agent',
      metadata: {
        generator: 'ts#agent',
        iac: 'terraform',
        components: [
          { generator: 'ts#mcp-server' },
          { generator: 'ts#rdb' },
          { generator: 'agentcore-gateway', iac: 'terraform' },
        ],
      } as never,
    });
  });

  it.each([
    ['ts/agent/files/deploy/Dockerfile.template', { protocol: 'http' }],
    ['ts/mcp-server/files/Dockerfile.template', {}],
  ])('restores %s to exactly what this release vends', async (rel, extra) => {
    const expected = render(tree, rel, {
      nodeBaseImage: BASE_IMAGES.node,
      npmVersion: TS_VERSIONS.npm,
      minimatchVersion: TS_VERSIONS.minimatch,
      jaegerVersion: TS_VERSIONS['@opentelemetry/propagator-jaeger'],
      adotVersion:
        TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
      ...extra,
    });
    tree.write('packages/agent/Dockerfile', rollback(expected));

    await syncVendedVersions(tree);

    expect(tree.read('packages/agent/Dockerfile', 'utf-8')).toEqual(expected);
  });

  it('restores the rdb Dockerfile to exactly what this release vends', async () => {
    const expected = render(tree, 'ts/rdb/files/Dockerfile.template', {
      npmVersion: TS_VERSIONS.npm,
      prismaVersion: TS_VERSIONS.prisma,
      minimatchVersion: TS_VERSIONS.minimatch,
    });
    tree.write('packages/rdb/Dockerfile', rollback(expected));

    await syncVendedVersions(tree);

    expect(tree.read('packages/rdb/Dockerfile', 'utf-8')).toEqual(expected);
  });

  it('restores the python agent Dockerfile base image', async () => {
    const expected = render(tree, 'py/agent/files/deploy/Dockerfile.template', {
      pythonBaseImage: BASE_IMAGES.python,
      protocol: 'http',
      moduleName: 'm',
      agentNameSnakeCase: 'a',
    });
    tree.write('packages/pyagent/Dockerfile', rollback(expected));

    await syncVendedVersions(tree);

    expect(tree.read('packages/pyagent/Dockerfile', 'utf-8')).toEqual(expected);
  });

  it('restores the agentcore gateway terraform python pins', async () => {
    const rel =
      'utils/agent-core-constructs/files/terraform/app/agentcore-gateway/__nameKebabCase__/__nameKebabCase__.tf.template';
    const raw = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
    // Only the `uv run --with` line matters here; render just that line so the
    // rest of the template's EJS vars need no stubbing.
    const line = raw.split('\n').find((l) => l.includes('uv run --with'))!;
    // The line's only EJS vars are the three pins, so substituting them gives
    // exactly what the generator emits for it.
    const expected = line
      .replace('<%= boto3Version %>', PY_VERSIONS.boto3)
      .replace('<%= httpxVersion %>', PY_VERSIONS.httpx)
      .replace('<%= mcpVersion %>', PY_VERSIONS.mcp);
    tree.write(
      'packages/infra/src/gw.tf',
      `resource "null_resource" "g" {\n  provisioner "local-exec" {\n    command = <<-EOT\n${rollback(expected)}\nprint(1)\n"\n    EOT\n  }\n}\n`,
    );

    await syncVendedVersions(tree);

    expect(tree.read('packages/infra/src/gw.tf', 'utf-8')).toContain(
      expected.trim(),
    );
  });

  it('restores the trivy image a real docker scan target pins', async () => {
    const vended = `public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy}`;
    tree.write(
      'packages/agent/project.json',
      JSON.stringify(
        {
          name: 'agent',
          targets: {
            'agent-trivy': {
              executor: 'nx:run-commands',
              options: {
                commands: [
                  `docker run --rm -v "./dist":/scan public.ecr.aws/aquasecurity/trivy:0.60.0 image --input /scan/image-0.tar`,
                ],
              },
            },
          },
        },
        null,
        2,
      ),
    );

    await syncVendedVersions(tree);

    expect(tree.read('packages/agent/project.json', 'utf-8')).toContain(vended);
  });
});

/**
 * The EJS vars the templates substitute a vended version through, which the
 * embedded sync is responsible for keeping current.
 */
const VENDED_TEMPLATE_VARS = new Set([
  'npmVersion',
  'minimatchVersion',
  'jaegerVersion',
  'adotVersion',
  'prismaVersion',
  'nodeBaseImage',
  'pythonBaseImage',
  'boto3Version',
  'httpxVersion',
  'mcpVersion',
]);

/** Every template file under the plugin's source tree. */
const templateFiles = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.template')) {
        found.push(path.relative(PLUGIN_SRC, full));
      }
    }
  };
  walk(PLUGIN_SRC);
  return found;
};

// The sync is driven off the owned dependency set rather than a list of the pins
// that happen to exist today, so that a pin added to a template in a later
// release is covered without touching the sync. This guards that: it finds the
// version pins the real templates actually emit and fails on one whose shape the
// sync has no pattern for — the failure mode that made these surfaces
// unreachable in the first place.
describe('template pin coverage', () => {
  /**
   * The pin shapes `sync-embedded-versions` can reach, matched against the text
   * immediately preceding the substitution.
   *
   * A Python var carries its own `==` operator (`PY_VERSIONS.boto3` is
   * `==1.43.51`), so the template writes no comparator of its own.
   */
  const REACHABLE_SHAPES: readonly RegExp[] = [
    // `npm install [-g] <pkg>@<version>`
    /npm install (?:-g )?\S+@$/,
    // `npm pkg set "overrides.<pkg>=<version>"`
    /overrides\.\S+=$/,
    // `uv run --with <pkg>==<version>`, the operator coming from the var.
    /--with \S+$/,
    // `FROM <repository>:<tag>` — the var renders the whole reference.
    /FROM $/,
  ];

  it('should reach every vended version pin the templates emit', () => {
    const unreachable: string[] = [];

    for (const rel of templateFiles()) {
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      for (const varName of VENDED_TEMPLATE_VARS) {
        // Match the substitution however it is written (`<%-` or `<%=`).
        const substitution = new RegExp(`<%[-=]\\s*${varName}\\s*%>`, 'g');
        for (const match of contents.matchAll(substitution)) {
          const before = contents.slice(0, match.index);
          // The pin is identified by what immediately precedes the version.
          const lineSoFar = before.slice(before.lastIndexOf('\n') + 1);
          if (!REACHABLE_SHAPES.some((shape) => shape.test(lineSoFar))) {
            unreachable.push(`${rel}: ${varName} in \`${lineSoFar.trim()}\``);
          }
        }
      }
    }

    expect(unreachable).toEqual([]);
  });

  /**
   * Terraform provider versions, which `syncTerraformProviders` already reaches
   * through the `required_providers` block rather than an embedded pin.
   */
  const PROVIDER_VAR = /^[a-z][A-Za-z]*ProviderVersion$/;

  // A vended version reaching a template through a var this test doesn't know
  // about would slip past the check above, so the map is pinned to the vars the
  // templates actually use. A new `*Version` var therefore fails here until it is
  // either mapped as an embedded pin or recognised as a provider version.
  it('should know every version var the templates substitute', () => {
    const versionVarLike = /<%[-=]\s*([A-Za-z]*(?:Version|BaseImage))\s*%>/g;
    const unknown = new Set<string>();

    for (const rel of templateFiles()) {
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      for (const [, varName] of contents.matchAll(versionVarLike)) {
        if (VENDED_TEMPLATE_VARS.has(varName) || PROVIDER_VAR.test(varName)) {
          continue;
        }
        unknown.add(`${rel}: ${varName}`);
      }
    }

    expect([...unknown]).toEqual([]);
  });
});
