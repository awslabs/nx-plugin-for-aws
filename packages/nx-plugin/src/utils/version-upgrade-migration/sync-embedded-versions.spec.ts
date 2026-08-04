/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree, writeJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test';
import {
  BASE_IMAGES,
  CONTAINER_REPOSITORIES,
  CONTAINER_VERSIONS,
  PY_VERSIONS,
  TS_VERSIONS,
} from '../versions';
import { syncVendedVersions } from './sync-vended-versions';

// Versions the plugin vends, read from the manifest so the tests track it.
const VENDED_NPM = TS_VERSIONS.npm;
const VENDED_PRISMA = TS_VERSIONS.prisma;
const VENDED_JAEGER = TS_VERSIONS['@opentelemetry/propagator-jaeger'];
const VENDED_MINIMATCH = TS_VERSIONS.minimatch;
const VENDED_ADOT =
  TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'];
const VENDED_BOTO3 = PY_VERSIONS.boto3.replace('==', '');
const VENDED_HTTPX = PY_VERSIONS.httpx.replace('==', '');
const VENDED_MCP = PY_VERSIONS.mcp.replace('==', '');
const VENDED_TRIVY = CONTAINER_VERSIONS.trivy;
const VENDED_CHECKOV = PY_VERSIONS.checkov.replace('==', '');

/** The tag part of a pinned base image reference. */
const imageTag = (image: string): string =>
  image.slice(image.lastIndexOf(':') + 1);

/** The repository part of a pinned base image reference. */
const imageRepository = (image: string): string =>
  image.slice(0, image.lastIndexOf(':'));

const AGENT_DOCKERFILE_PATH = 'packages/agent/src/deploy/Dockerfile';
const RDB_DOCKERFILE_PATH = 'packages/rdb/Dockerfile';

/**
 * The Dockerfile the agent and MCP server generators vend, with the versions it
 * was generated at. Mirrors `src/ts/agent/files/deploy/Dockerfile.template`.
 */
const agentDockerfile = (versions: {
  base?: string;
  npm?: string;
  jaeger?: string;
  minimatch?: string;
  adot?: string;
}) => `FROM ${versions.base ?? `${imageRepository(BASE_IMAGES.node)}:lts-bookworm-slim`}

# Upgrade npm to a version free of known HIGH/CRITICAL vulnerabilities
RUN npm install -g npm@${versions.npm ?? '11.0.0'}

WORKDIR /app

# Add AWS Distro for OpenTelemetry for observability
# The overrides pin transitive dependencies with known HIGH/CRITICAL
# vulnerabilities to fixed versions.
RUN npm init -y \\
  && npm pkg set "overrides.@opentelemetry/propagator-jaeger=${versions.jaeger ?? '2.8.0'}" \\
  && npm pkg set "overrides.minimatch=${versions.minimatch ?? '9.0.5'}" \\
  && npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@${versions.adot ?? '0.11.0'} \\
  && npm uninstall -g npm

# Copy bundled agent
COPY index.js /app

EXPOSE 8080

CMD [ "node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js" ]
`;

/** The Dockerfile the rdb generator vends, pinning prisma and npm. */
const rdbDockerfile = (versions: { npm?: string; prisma?: string }) =>
  `FROM public.ecr.aws/lambda/nodejs:24

# Upgrade npm to a version free of known HIGH/CRITICAL vulnerabilities
RUN npm install -g npm@${versions.npm ?? '11.0.0'}

WORKDIR \${LAMBDA_TASK_ROOT}

RUN printf 'allow-scripts[]=prisma\\nallow-scripts[]=@prisma/engines\\n' > .npmrc \\
    && npm install prisma@${versions.prisma ?? '6.1.0'} \\
    && rm .npmrc \\
    && npm uninstall -g npm

COPY index.js ./index.js

CMD ["index.handler"]
`;

/**
 * A Terraform inline script pinning its Python dependencies, as the agent-core
 * and gateway templates emit. The heredoc form is what most templates use.
 */
const terraformWithHeredocScript = (versions: {
  boto3?: string;
  httpx?: string;
  mcp?: string;
}) => `resource "null_resource" "configure_gateway" {
  provisioner "local-exec" {
    command = <<-EOT
      uv run --with boto3==${versions.boto3 ?? '1.40.0'} --with httpx==${versions.httpx ?? '0.27.0'} --with mcp==${versions.mcp ?? '1.20.0'} python -c "
import boto3
import json
print(json.dumps({}))
"
    EOT
  }
}
`;

/** The single-line quoted form, as the api-gateway-account template emits. */
const terraformWithQuotedScript = (boto3 = '1.40.0') =>
  `resource "null_resource" "account" {
  provisioner "local-exec" {
    command = "uv run --with boto3==${boto3} python -c \\"$SCRIPT\\""
  }
}
`;

/** A `project.json` carrying the trivy scan target the docker helper adds. */
const projectJsonWithTrivyTarget = (trivy = '0.60.0') => ({
  name: 'agent',
  targets: {
    'agent-trivy': {
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rm -rf dist/packages/agent/trivy/agent',
          `docker run --rm -v "./dist/packages/agent/trivy/agent":/scan public.ecr.aws/aquasecurity/trivy:${trivy} image --input /scan/image-0.tar --scanners vuln --severity HIGH,CRITICAL --exit-code 1`,
        ],
        parallel: false,
      },
    },
  },
});

describe('sync-embedded-versions migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Only dependencies a generator declares are synced, so these tests need
    // projects recording the generators that own the packages under test.
    addProjectConfiguration(tree, 'agent', {
      root: 'packages/agent',
      metadata: {
        generator: 'ts#agent',
        components: [{ generator: 'ts#mcp-server' }],
      } as never,
    });
    addProjectConfiguration(tree, 'rdb', {
      root: 'packages/rdb',
      metadata: { generator: 'ts#rdb' } as never,
    });
    // The Python pins live in the generated Terraform, so their ownership is
    // gated on a project having recorded `iac: 'terraform'`.
    addProjectConfiguration(tree, 'infra', {
      root: 'packages/infra',
      metadata: {
        generator: 'agentcore-gateway',
        iac: 'terraform',
      } as never,
    });
  });

  // The Dockerfile overrides pin transitive dependencies with known
  // HIGH/CRITICAL vulnerabilities. Before this sync they were the only vended
  // versions guaranteed never to be upgraded.
  describe('Dockerfile pins', () => {
    it('should upgrade the CVE override pins to the vended versions', async () => {
      tree.write(AGENT_DOCKERFILE_PATH, agentDockerfile({}));

      await syncVendedVersions(tree);

      const dockerfile = tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')!;
      expect(dockerfile).toContain(
        `"overrides.@opentelemetry/propagator-jaeger=${VENDED_JAEGER}"`,
      );
      expect(dockerfile).toContain(`"overrides.minimatch=${VENDED_MINIMATCH}"`);
    });

    it('should upgrade the packages the image installs', async () => {
      tree.write(AGENT_DOCKERFILE_PATH, agentDockerfile({}));
      tree.write(RDB_DOCKERFILE_PATH, rdbDockerfile({}));

      await syncVendedVersions(tree);

      expect(tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')).toContain(
        `npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@${VENDED_ADOT}`,
      );
      expect(tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')).toContain(
        `npm install -g npm@${VENDED_NPM}`,
      );
      const rdb = tree.read(RDB_DOCKERFILE_PATH, 'utf-8')!;
      expect(rdb).toContain(`npm install prisma@${VENDED_PRISMA}`);
      expect(rdb).toContain(`npm install -g npm@${VENDED_NPM}`);
    });

    it('should upgrade the base image to the vended tag', async () => {
      tree.write(AGENT_DOCKERFILE_PATH, agentDockerfile({}));

      await syncVendedVersions(tree);

      expect(tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')).toContain(
        `FROM ${BASE_IMAGES.node}`,
      );
    });

    it('should upgrade a python base image the same way', async () => {
      tree.write(
        'packages/pyagent/Dockerfile',
        `FROM ${imageRepository(BASE_IMAGES.python)}:3.12-slim\n\nWORKDIR /app\n`,
      );

      await syncVendedVersions(tree);

      expect(tree.read('packages/pyagent/Dockerfile', 'utf-8')).toContain(
        `FROM ${BASE_IMAGES.python}`,
      );
    });

    // The overrides sit inside a shell command, so a workspace whose Dockerfile
    // was reformatted must sync the same way a freshly generated one does — the
    // reason these are matched by pin rather than by surrounding text.
    it('should upgrade a pin in a reformatted Dockerfile', async () => {
      tree.write(
        AGENT_DOCKERFILE_PATH,
        `FROM ${BASE_IMAGES.node}
RUN npm install -g npm@11.0.0
RUN npm init -y && npm pkg set "overrides.minimatch=9.0.5" && npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.11.0
`,
      );

      await syncVendedVersions(tree);

      const dockerfile = tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')!;
      expect(dockerfile).toContain(`"overrides.minimatch=${VENDED_MINIMATCH}"`);
      expect(dockerfile).toContain(
        `@aws/aws-distro-opentelemetry-node-autoinstrumentation@${VENDED_ADOT}`,
      );
      expect(dockerfile).toContain(`npm install -g npm@${VENDED_NPM}`);
    });

    it('should leave a version the user raised above the vended one alone', async () => {
      tree.write(
        AGENT_DOCKERFILE_PATH,
        agentDockerfile({ minimatch: '99.0.0', npm: '99.0.0' }),
      );

      await syncVendedVersions(tree);

      const dockerfile = tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')!;
      expect(dockerfile).toContain('"overrides.minimatch=99.0.0"');
      expect(dockerfile).toContain('npm install -g npm@99.0.0');
    });

    // A package whose name merely ends with an owned one's must not be caught by
    // it — the name has to run all the way to the `@`.
    it('should leave a package whose name ends with an owned one alone', async () => {
      tree.write(
        'packages/other/Dockerfile',
        `FROM ${BASE_IMAGES.node}
RUN npm install some-npm@1.0.0
RUN npm install @scope/npm@1.0.0
`,
      );

      await syncVendedVersions(tree);

      const dockerfile = tree.read('packages/other/Dockerfile', 'utf-8')!;
      expect(dockerfile).toContain('npm install some-npm@1.0.0');
      expect(dockerfile).toContain('npm install @scope/npm@1.0.0');
    });

    // `build.Dockerfile` is the form the smithy templates vend, so matching only
    // names starting with `Dockerfile` would skip it.
    it.each(['packages/agent/Dockerfile', 'packages/agent/build.Dockerfile'])(
      'should sync the pins in %s',
      async (filePath) => {
        tree.write(
          filePath,
          `FROM ${imageRepository(BASE_IMAGES.node)}:20\nRUN npm install -g npm@11.0.0\n`,
        );

        await syncVendedVersions(tree);

        const dockerfile = tree.read(filePath, 'utf-8')!;
        expect(dockerfile).toContain(`npm install -g npm@${VENDED_NPM}`);
        expect(dockerfile).toContain(`FROM ${BASE_IMAGES.node}`);
      },
    );

    // A build stage names itself and picks a tag for what that stage has to run.
    // The smithy builder needs curl and unzip, which the slim tag vended for a
    // runtime image does not carry, and the two share a repository — so
    // rewriting it swaps in an image the build cannot run on.
    it('should not rewrite the base image tag of a named build stage', async () => {
      const builder = `FROM ${imageRepository(BASE_IMAGES.node)}:24 AS builder
RUN curl -L https://example.com/cli.zip -o cli.zip && unzip -qo cli.zip

FROM scratch AS export
COPY --from=builder /out /
`;
      tree.write('packages/agent/build.Dockerfile', builder);

      await syncVendedVersions(tree);

      expect(tree.read('packages/agent/build.Dockerfile', 'utf-8')).toEqual(
        builder,
      );
    });

    // Matched exactly, so a file merely named like one — a backup kept beside a
    // real Dockerfile, or notes about it — is not rewritten.
    it.each([
      'packages/agent/Dockerfile.bak',
      'packages/agent/Dockerfile.md',
      'packages/agent/dockerfile',
    ])('should leave %s alone', async (filePath) => {
      const original = `FROM ${imageRepository(BASE_IMAGES.node)}:20\nRUN npm install -g npm@11.0.0\n`;
      tree.write(filePath, original);

      await syncVendedVersions(tree);

      expect(tree.read(filePath, 'utf-8')).toEqual(original);
    });

    // The smithy build image installs several packages in one abbreviated
    // command, so a pattern requiring `npm install <pkg>` immediately would miss
    // every pin in it.
    it('should sync a pin in an abbreviated multi-package install', async () => {
      tree.write(
        'packages/agent/build.Dockerfile',
        `FROM ${BASE_IMAGES.node}\nRUN npm i -g pnpm@11.1.1 rolldown@1.0.0-beta.38\n`,
      );

      await syncVendedVersions(tree);

      const dockerfile = tree.read('packages/agent/build.Dockerfile', 'utf-8')!;
      expect(dockerfile).toContain(`rolldown@${TS_VERSIONS.rolldown}`);
      // pnpm is not vended, so it keeps the version the template pinned.
      expect(dockerfile).toContain('pnpm@11.1.1');
    });

    // Ownership scopes to the project a file sits in, not just the workspace: a
    // sibling project owning a package does not license rewriting that package's
    // pin here. `prisma` is owned by `ts#rdb` alone, so the agent's Dockerfile
    // keeps whatever it pins even though the workspace as a whole owns it.
    it('should not sync a pin a sibling project owns', async () => {
      tree.write(
        'packages/agent/Dockerfile',
        `FROM ${BASE_IMAGES.node}\nRUN npm install prisma@6.1.0\n`,
      );
      tree.write(
        RDB_DOCKERFILE_PATH,
        `FROM ${BASE_IMAGES.node}\nRUN npm install prisma@6.1.0\n`,
      );

      await syncVendedVersions(tree);

      // The rdb project owns prisma, so its own pin moves.
      expect(tree.read(RDB_DOCKERFILE_PATH, 'utf-8')).toContain(
        `prisma@${VENDED_PRISMA}`,
      );
      // The agent project does not, so its pin is the user's.
      expect(tree.read('packages/agent/Dockerfile', 'utf-8')).toContain(
        'prisma@6.1.0',
      );
    });

    // Ownership is what scopes the sync: without a generator declaring these,
    // the pins are the user's own and keep the versions they chose.
    it('should leave pins alone in a workspace no generator owns them in', async () => {
      const bare = createTreeUsingTsSolutionSetup();
      bare.write(AGENT_DOCKERFILE_PATH, agentDockerfile({}));

      await syncVendedVersions(bare);

      const dockerfile = bare.read(AGENT_DOCKERFILE_PATH, 'utf-8')!;
      expect(dockerfile).toContain('"overrides.minimatch=9.0.5"');
      expect(dockerfile).toContain('npm install -g npm@11.0.0');
    });

    // `nextSteps` are work left for the user. A rebuilt image picks these up on
    // its own, so an entry here would ask for nothing and bury the ones that do.
    it('should report no next step for a Dockerfile it updated', async () => {
      tree.write(AGENT_DOCKERFILE_PATH, agentDockerfile({}));

      const { nextSteps } = await syncVendedVersions(tree);

      expect(nextSteps).toEqual([]);
    });
  });

  // The provider sync visits `.tf` files but only reads `required_providers`, so
  // the Python pins an inline script runs were never reached.
  describe('terraform inline script pins', () => {
    it('should upgrade the python pins in a heredoc script', async () => {
      tree.write(
        'packages/infra/src/gateway.tf',
        terraformWithHeredocScript({}),
      );

      await syncVendedVersions(tree);

      const terraform = tree.read('packages/infra/src/gateway.tf', 'utf-8')!;
      expect(terraform).toContain(`--with boto3==${VENDED_BOTO3}`);
      expect(terraform).toContain(`--with httpx==${VENDED_HTTPX}`);
      expect(terraform).toContain(`--with mcp==${VENDED_MCP}`);
    });

    it('should upgrade the python pin in a single-line quoted script', async () => {
      tree.write('packages/infra/src/account.tf', terraformWithQuotedScript());

      await syncVendedVersions(tree);

      expect(tree.read('packages/infra/src/account.tf', 'utf-8')).toContain(
        `--with boto3==${VENDED_BOTO3}`,
      );
    });

    it('should leave the script body around the pin untouched', async () => {
      tree.write(
        'packages/infra/src/gateway.tf',
        terraformWithHeredocScript({}),
      );

      await syncVendedVersions(tree);

      const terraform = tree.read('packages/infra/src/gateway.tf', 'utf-8')!;
      expect(terraform).toContain('import boto3');
      expect(terraform).toContain('print(json.dumps({}))');
      expect(terraform).toContain(
        'resource "null_resource" "configure_gateway"',
      );
    });

    it('should leave a pin the user raised above the vended version alone', async () => {
      tree.write(
        'packages/infra/src/gateway.tf',
        terraformWithHeredocScript({ boto3: '99.0.0' }),
      );

      await syncVendedVersions(tree);

      expect(tree.read('packages/infra/src/gateway.tf', 'utf-8')).toContain(
        '--with boto3==99.0.0',
      );
    });

    it('should leave a python package the plugin does not vend alone', async () => {
      tree.write(
        'packages/infra/src/other.tf',
        `resource "null_resource" "x" {
  provisioner "local-exec" {
    command = "uv run --with some-other-package==1.0.0 python -c \\"pass\\""
  }
}
`,
      );

      await syncVendedVersions(tree);

      expect(tree.read('packages/infra/src/other.tf', 'utf-8')).toContain(
        '--with some-other-package==1.0.0',
      );
    });

    // These pins only exist in the Terraform a generator writes, so ownership is
    // gated on it. Without the gate a workspace that pinned `boto3` in a `.tf`
    // file of its own would have it rewritten.
    it('should leave the pins alone in a workspace with no terraform generated', async () => {
      const cdkTree = createTreeUsingTsSolutionSetup();
      addProjectConfiguration(cdkTree, 'infra', {
        root: 'packages/infra',
        metadata: { generator: 'agentcore-gateway', iac: 'cdk' } as never,
      });
      cdkTree.write(
        'packages/infra/src/gateway.tf',
        terraformWithHeredocScript({}),
      );

      await syncVendedVersions(cdkTree);

      const terraform = cdkTree.read('packages/infra/src/gateway.tf', 'utf-8')!;
      expect(terraform).toContain('--with boto3==1.40.0');
      expect(terraform).toContain('--with httpx==0.27.0');
      expect(terraform).toContain('--with mcp==1.20.0');
    });

    // An inline script's pin has no lock file, so unlike a provider version it
    // leaves the user nothing to reconcile.
    it('should report no next step for an inline script pin', async () => {
      tree.write(
        'packages/infra/src/gateway.tf',
        terraformWithHeredocScript({}),
      );

      const { nextSteps } = await syncVendedVersions(tree);

      expect(nextSteps).toEqual([]);
    });
  });

  // The trivy image is built into a target command rather than declared as a
  // dependency, so nothing else reaches it.
  describe('pinned tool images in project.json', () => {
    // The pins come from `CONTAINER_REPOSITORIES`, so every tool image the plugin
    // pins is covered by the sync rather than only the one it happens to have.
    it('should cover every pinned tool image, not just trivy', () => {
      expect(Object.keys(CONTAINER_REPOSITORIES)).toEqual(
        Object.keys(CONTAINER_VERSIONS),
      );
    });

    it('should upgrade the trivy image a scan target runs', async () => {
      writeJson(
        tree,
        'packages/agent/project.json',
        projectJsonWithTrivyTarget(),
      );

      await syncVendedVersions(tree);

      expect(tree.read('packages/agent/project.json', 'utf-8')).toContain(
        `public.ecr.aws/aquasecurity/trivy:${VENDED_TRIVY}`,
      );
    });

    it('should leave the rest of the target command untouched', async () => {
      writeJson(
        tree,
        'packages/agent/project.json',
        projectJsonWithTrivyTarget(),
      );

      await syncVendedVersions(tree);

      const projectJson = tree.read('packages/agent/project.json', 'utf-8')!;
      expect(projectJson).toContain('--severity HIGH,CRITICAL');
      expect(projectJson).toContain('rm -rf dist/packages/agent/trivy/agent');
    });

    it('should leave a trivy version the user raised alone', async () => {
      writeJson(
        tree,
        'packages/agent/project.json',
        projectJsonWithTrivyTarget('99.0.0'),
      );

      await syncVendedVersions(tree);

      expect(tree.read('packages/agent/project.json', 'utf-8')).toContain(
        'trivy:99.0.0',
      );
    });

    // `checkov` is pinned the same way, for the security scan every infra project
    // runs — the CDK one through `infra#app` and the Terraform one through
    // `terraform#project`.
    it.each([
      [
        'a cdk infra project',
        'checkov.yml --directory dist/{projectRoot}/cdk.out',
      ],
      ['a terraform project', '--directory . -o cli -o json'],
    ])(
      'should upgrade the checkov a scan target on %s runs',
      async (_, args) => {
        writeJson(tree, 'packages/infra/project.json', {
          name: 'infra',
          targets: {
            checkov: {
              executor: 'nx:run-commands',
              options: { command: `uvx --from checkov==3.2.0 checkov ${args}` },
            },
          },
        });

        await syncVendedVersions(tree);

        const projectJson = tree.read('packages/infra/project.json', 'utf-8')!;
        expect(projectJson).toContain(`uvx --from checkov==${VENDED_CHECKOV}`);
        // The rest of the command is untouched.
        expect(projectJson).toContain(args.split(' ')[0]);
      },
    );

    // `uvxCommand` can add packages to the tool's environment as well as pinning
    // the tool itself, so both shapes of a `uvx` invocation are synced.
    it('should upgrade the packages a uvx command adds with --with', async () => {
      writeJson(tree, 'packages/infra/project.json', {
        name: 'infra',
        targets: {
          checkov: {
            executor: 'nx:run-commands',
            options: {
              command:
                'uvx --from checkov==3.2.0 --with boto3==1.40.0 --with httpx==0.27.0 checkov -d .',
            },
          },
        },
      });

      await syncVendedVersions(tree);

      const projectJson = tree.read('packages/infra/project.json', 'utf-8')!;
      expect(projectJson).toContain(`uvx --from checkov==${VENDED_CHECKOV}`);
      expect(projectJson).toContain(`--with boto3==${VENDED_BOTO3}`);
      expect(projectJson).toContain(`--with httpx==${VENDED_HTTPX}`);
    });

    it('should leave a checkov version the user raised alone', async () => {
      writeJson(tree, 'packages/infra/project.json', {
        name: 'infra',
        targets: {
          checkov: {
            executor: 'nx:run-commands',
            options: { command: 'uvx --from checkov==99.0.0 checkov -d .' },
          },
        },
      });

      await syncVendedVersions(tree);

      expect(tree.read('packages/infra/project.json', 'utf-8')).toContain(
        'checkov==99.0.0',
      );
    });
  });

  it('should report no next steps when every embedded pin is current', async () => {
    tree.write(
      AGENT_DOCKERFILE_PATH,
      agentDockerfile({
        base: BASE_IMAGES.node,
        npm: VENDED_NPM,
        jaeger: VENDED_JAEGER,
        minimatch: VENDED_MINIMATCH,
        adot: VENDED_ADOT,
      }),
    );
    tree.write(
      'packages/infra/src/gateway.tf',
      terraformWithHeredocScript({
        boto3: VENDED_BOTO3,
        httpx: VENDED_HTTPX,
        mcp: VENDED_MCP,
      }),
    );

    const { nextSteps } = await syncVendedVersions(tree);

    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(AGENT_DOCKERFILE_PATH, agentDockerfile({}));
    tree.write(RDB_DOCKERFILE_PATH, rdbDockerfile({}));
    tree.write('packages/infra/src/gateway.tf', terraformWithHeredocScript({}));
    writeJson(
      tree,
      'packages/agent/project.json',
      projectJsonWithTrivyTarget(),
    );

    await syncVendedVersions(tree);

    const paths = [
      AGENT_DOCKERFILE_PATH,
      RDB_DOCKERFILE_PATH,
      'packages/infra/src/gateway.tf',
      'packages/agent/project.json',
    ];
    const afterFirstRun = paths.map((path) => tree.read(path, 'utf-8'));

    const { nextSteps } = await syncVendedVersions(tree);

    expect(paths.map((path) => tree.read(path, 'utf-8'))).toEqual(
      afterFirstRun,
    );
    expect(nextSteps).toEqual([]);
  });

  // The tag is compared for equality, not ordering, so a base image the plugin
  // moved backwards — to a previous LTS line, say — must still be corrected.
  it('should move a base image tag backwards when that is what is vended', async () => {
    tree.write(
      AGENT_DOCKERFILE_PATH,
      `FROM ${imageRepository(BASE_IMAGES.node)}:99-slim\n\nWORKDIR /app\n`,
    );

    await syncVendedVersions(tree);

    expect(tree.read(AGENT_DOCKERFILE_PATH, 'utf-8')).toContain(
      `FROM ${imageRepository(BASE_IMAGES.node)}:${imageTag(BASE_IMAGES.node)}`,
    );
  });
});
