/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import {
  BASE_IMAGES,
  CONTAINER_VERSIONS,
  PY_VERSIONS,
  TS_VERSIONS,
} from '../versions.js';
import { isDockerfile } from './sync-embedded-versions.js';
import { syncVendedVersions } from './sync-vended-versions.js';

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..', '..');

/**
 * The versions an older release vended, hardcoded so a workspace generated back
 * then is reproduced exactly rather than derived from today's manifest.
 */
const OLD = {
  npm: '11.0.0',
  minimatch: '9.0.5',
  jaeger: '2.8.0',
  adot: '0.11.0',
  prisma: '6.1.0',
  nodeImage: 'public.ecr.aws/docker/library/node:lts-bookworm-slim',
  pythonImage: 'public.ecr.aws/docker/library/python:3.12-slim',
  boto3: '1.40.0',
  httpx: '0.27.0',
  mcp: '1.20.0',
  trivy: '0.60.0',
} as const;

/** What this release vends, which the sync must move each pin to. */
const VENDED = {
  npm: TS_VERSIONS.npm,
  minimatch: TS_VERSIONS.minimatch,
  jaeger: TS_VERSIONS['@opentelemetry/propagator-jaeger'],
  adot: TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
  prisma: TS_VERSIONS.prisma,
  nodeImage: BASE_IMAGES.node,
  pythonImage: BASE_IMAGES.python,
  boto3: PY_VERSIONS.boto3.replace('==', ''),
  httpx: PY_VERSIONS.httpx.replace('==', ''),
  mcp: PY_VERSIONS.mcp.replace('==', ''),
  trivy: CONTAINER_VERSIONS.trivy,
} as const;

type Versions = typeof OLD | typeof VENDED;

/**
 * The Dockerfile `ts#agent` and `ts#mcp-server` vend, written out at whichever
 * versions are given. Kept byte-for-byte in step with
 * `ts/agent/files/deploy/Dockerfile.template`, which
 * `describe('template fidelity')` below enforces.
 */
const agentDockerfile = (v: Versions) => `FROM ${v.nodeImage}

# Upgrade npm to a version free of known HIGH/CRITICAL vulnerabilities
RUN npm install -g npm@${v.npm}

WORKDIR /app

# Add AWS Distro for OpenTelemetry for observability
# https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
# The overrides pin transitive dependencies with known HIGH/CRITICAL
# vulnerabilities to fixed versions. npm is removed once the install is done —
# the runtime only needs node, and npm's own bundled dependencies would
# otherwise carry vulnerabilities into the image.
RUN npm init -y \\
  && npm pkg set "overrides.@opentelemetry/propagator-jaeger=${v.jaeger}" \\
  && npm pkg set "overrides.minimatch=${v.minimatch}" \\
  && npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@${v.adot} \\
  && npm uninstall -g npm

# Copy bundled agent
COPY index.js /app

EXPOSE 8080

# Auto-instrument with AWS Distro for OpenTelemetry
# https://aws-otel.github.io/docs/getting-started/js-sdk/trace-metric-auto-instr
CMD [ "node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js" ]
`;

/** The Dockerfile `ts#rdb` vends, pinning prisma and npm. */
const rdbDockerfile = (v: Versions) => `FROM public.ecr.aws/lambda/nodejs:24

# Upgrade npm to a version free of known HIGH/CRITICAL vulnerabilities
RUN npm install -g npm@${v.npm}

WORKDIR \${LAMBDA_TASK_ROOT}

RUN printf 'allow-scripts[]=prisma\\nallow-scripts[]=@prisma/engines\\n' > .npmrc \\
    && npm install prisma@${v.prisma} \\
    && rm .npmrc \\
    && npm uninstall -g npm

COPY index.js ./index.js

CMD ["index.handler"]
`;

/** The Dockerfile the Python agent vends, whose only pin is its base image. */
const pythonAgentDockerfile = (v: Versions) => `FROM ${v.pythonImage}

WORKDIR /app

COPY . /app

EXPOSE 8080

ENV PYTHONPATH=/app
`;

/**
 * The gateway's Terraform, pinning its inline script's Python dependencies in a
 * heredoc — the form most `.tf` templates use.
 */
const gatewayTerraform = (v: Versions) => `resource "null_resource" "gateway" {
  provisioner "local-exec" {
    command = <<-EOT
      uv run --with boto3==${v.boto3} --with httpx==${v.httpx} --with mcp==${v.mcp} python -c "
import boto3
import json
print(json.dumps({}))
"
    EOT
  }
}
`;

/** The account module's Terraform, pinning boto3 in a single-line command. */
const accountTerraform = (v: Versions) => `resource "null_resource" "account" {
  provisioner "local-exec" {
    command = "uv run --with boto3==${v.boto3} python -c \\"$SCRIPT\\""
  }
}
`;

/** The `project.json` the docker helper writes, pinning the trivy scan image. */
const projectJsonWithTrivyTarget = (v: Versions) => `{
  "name": "agent",
  "targets": {
    "agent-trivy": {
      "executor": "nx:run-commands",
      "options": {
        "commands": [
          "rm -rf dist/packages/agent/trivy/agent",
          "docker run --rm -v \\"./dist/packages/agent/trivy/agent\\":/scan public.ecr.aws/aquasecurity/trivy:${v.trivy} image --input /scan/image-0.tar --scanners vuln --severity HIGH,CRITICAL --exit-code 1"
        ],
        "parallel": false
      }
    }
  }
}
`;

// A workspace generated by an older release, migrated to this one, must end up
// with exactly the pins this release vends — every byte of it, since these files
// are the user's to read and diff.
describe('sync against a workspace an older release generated', () => {
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
    [
      'the agent/mcp-server Dockerfile',
      'packages/agent/Dockerfile',
      agentDockerfile,
    ],
    ['the rdb Dockerfile', 'packages/rdb/Dockerfile', rdbDockerfile],
    [
      'the python agent Dockerfile',
      'packages/pyagent/Dockerfile',
      pythonAgentDockerfile,
    ],
    ['the gateway terraform', 'packages/infra/src/gw.tf', gatewayTerraform],
    [
      'the account terraform',
      'packages/infra/src/account.tf',
      accountTerraform,
    ],
    [
      'the trivy scan target',
      'packages/agent/project.json',
      projectJsonWithTrivyTarget,
    ],
  ] as const)(
    'should bring %s up to date exactly',
    async (_, filePath, file) => {
      tree.write(filePath, file(OLD));

      await syncVendedVersions(tree);

      expect(tree.read(filePath, 'utf-8')).toEqual(file(VENDED));
    },
  );

  it('should leave a workspace already on this release untouched', async () => {
    const paths = [
      ['packages/agent/Dockerfile', agentDockerfile],
      ['packages/rdb/Dockerfile', rdbDockerfile],
      ['packages/infra/src/gw.tf', gatewayTerraform],
      ['packages/agent/project.json', projectJsonWithTrivyTarget],
    ] as const;
    for (const [filePath, file] of paths) {
      tree.write(filePath, file(VENDED));
    }

    const { nextSteps } = await syncVendedVersions(tree);

    for (const [filePath, file] of paths) {
      expect(tree.read(filePath, 'utf-8')).toEqual(file(VENDED));
    }
    expect(nextSteps).toEqual([]);
  });
});

/**
 * The fixtures above are hardcoded so they assert an exact expected file rather
 * than one derived from the code under test. That only holds while they match
 * what the generators actually vend, so each is checked against its template:
 * the template rendered at the vended versions must equal the fixture.
 */
describe('template fidelity', () => {
  /** A template's text with its vended-version substitutions filled in. */
  const renderPins = (rel: string, v: Versions): string =>
    fs
      .readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8')
      .replaceAll('<%- nodeBaseImage %>', v.nodeImage)
      .replaceAll('<%- pythonBaseImage %>', v.pythonImage)
      .replaceAll('<%- npmVersion %>', v.npm)
      .replaceAll('<%= npmVersion %>', v.npm)
      .replaceAll('<%- minimatchVersion %>', v.minimatch)
      .replaceAll('<%= minimatchVersion %>', v.minimatch)
      .replaceAll('<%- jaegerVersion %>', v.jaeger)
      .replaceAll('<%- adotVersion %>', v.adot)
      .replaceAll('<%= prismaVersion %>', v.prisma)
      .replaceAll('<%= boto3Version %>', `==${v.boto3}`)
      .replaceAll('<%= httpxVersion %>', `==${v.httpx}`)
      .replaceAll('<%= mcpVersion %>', `==${v.mcp}`);

  /**
   * Compare only the lines carrying a pin: a template also holds EJS branches
   * and per-project substitutions the fixtures deliberately don't reproduce.
   */
  const pinLines = (contents: string): string[] =>
    contents
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          /^FROM /.test(line) ||
          line.includes('npm install') ||
          line.includes('overrides.') ||
          line.includes('uv run --with'),
      );

  it.each([
    ['ts/agent/files/deploy/Dockerfile.template', agentDockerfile],
    ['ts/mcp-server/files/deploy/Dockerfile.template', agentDockerfile],
    ['ts/rdb/files/Dockerfile.template', rdbDockerfile],
    ['py/agent/files/deploy/Dockerfile.template', pythonAgentDockerfile],
    [
      'utils/agent-core-constructs/files/terraform/app/agentcore-gateway/__nameKebabCase__/__nameKebabCase__.tf.template',
      gatewayTerraform,
    ],
    [
      'utils/api-constructs/files/terraform/core/api/rest/api-gateway-account/api-gateway-account.tf.template',
      accountTerraform,
    ],
  ] as const)(
    'should keep the %s fixture in step with the template',
    (rel, file) => {
      expect(pinLines(renderPins(rel, VENDED))).toEqual(
        expect.arrayContaining(pinLines(file(VENDED))),
      );
    },
  );

  it('should keep the trivy fixture in step with the scan target', () => {
    // Built in `docker.ts` rather than a template, so the reference is compared
    // against the constant the helper interpolates.
    expect(projectJsonWithTrivyTarget(VENDED)).toContain(
      `public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy}`,
    );
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
  'deepmergeTsVersion',
  'mysql2Version',
  'rolldownVersion',
  'rolldownDtsVersion',
  'esmShimVersion',
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
    // `npm install|i|add [flags] [other pkgs] <pkg>@<version>`
    /npm (?:install|i|add)\b.*\s\S+@$/,
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

  // Matching a pin's shape is only half of reachability: the sync also has to
  // visit the file it lands in. A template emitting a perfectly matchable pin
  // under a name the collector skips — `build.Dockerfile` against a
  // `Dockerfile`-prefix match — would pass the check above and still never sync.
  it('should visit the file every pin-bearing template emits', () => {
    const unvisited: string[] = [];

    for (const rel of templateFiles()) {
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      const hasPin = [...VENDED_TEMPLATE_VARS].some((varName) =>
        new RegExp(`<%[-=]\\s*${varName}\\s*%>`).test(contents),
      );
      if (!hasPin) {
        continue;
      }
      // The emitted name is the template's, less the `.template` suffix.
      const emitted = path.basename(rel).replace(/\.template$/, '');
      if (!isDockerfile(emitted) && !emitted.endsWith('.tf')) {
        unvisited.push(`${rel}: emits ${emitted}`);
      }
    }

    expect(unvisited).toEqual([]);
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
