/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PY_PROJECT_ROOT = 'packages/py-project/proj_py_project';
const TS_PROJECT_ROOT = 'packages/ts-project';
const PY_AGENT_DIR = 'my_agent';
const PY_MCP_DIR = 'my_mcp';
const TS_AGENT_DIR = 'src/my-agent';
const PY_AGENT_DOCKERFILE = `${PY_PROJECT_ROOT}/${PY_AGENT_DIR}/Dockerfile`;
const PY_MCP_DOCKERFILE = `${PY_PROJECT_ROOT}/${PY_MCP_DIR}/Dockerfile`;
const TS_AGENT_DOCKERFILE = `${TS_PROJECT_ROOT}/${TS_AGENT_DIR}/Dockerfile`;

const VENDED_PY_AGENT_DOCKERFILE = `FROM public.ecr.aws/docker/library/python:3.14-slim

# Remove the base image's pip: the agent runs from the bundled environment and
# never needs it at runtime, and pip's vendored packages carry known
# HIGH/CRITICAL vulnerabilities flagged by the image scan.
RUN python -m pip uninstall -y pip && \\
    rm -rf /usr/local/lib/python*/site-packages/pip \\
           /usr/local/lib/python*/site-packages/pip-*.dist-info

WORKDIR /app

# Copy bundled package
COPY . /app

EXPOSE 8080

ENV PYTHONPATH=/app
ENV PATH="/app/bin:\${PATH}"

CMD ["python", "bin/opentelemetry-instrument", "python", "-m", "proj_py_project.my_agent.main"]
`;

const VENDED_PY_MCP_DOCKERFILE = `FROM public.ecr.aws/docker/library/python:3.14-slim

# Remove the base image's pip: the server runs from the bundled environment and
# never needs it at runtime, and pip's vendored packages carry known
# HIGH/CRITICAL vulnerabilities flagged by the image scan.
RUN python -m pip uninstall -y pip && \\
    rm -rf /usr/local/lib/python*/site-packages/pip \\
           /usr/local/lib/python*/site-packages/pip-*.dist-info

WORKDIR /app

# Copy bundled package
COPY . /app

EXPOSE 8000

ENV PYTHONPATH=/app

CMD ["python", "bin/opentelemetry-instrument", "python", "-m", "uvicorn", "proj_py_project.my_mcp.http:app", "--host", "0.0.0.0", "--port", "8000"]
`;

const VENDED_TS_AGENT_DOCKERFILE = `FROM public.ecr.aws/docker/library/node:lts-slim

# Upgrade npm to a version free of known HIGH/CRITICAL vulnerabilities
RUN npm install -g npm@11.0.0

WORKDIR /app

RUN npm init -y \\
  && npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.12.0 \\
  && npm uninstall -g npm

# Copy bundled agent
COPY index.js /app

EXPOSE 8080

CMD [ "node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js" ]
`;

/**
 * Register a project whose components point at the given Dockerfile dirs, so the
 * migration locates them the way it does in a real workspace.
 */
const seedProject = (
  tree: Tree,
  components: { generator: string; path: string; name: string }[],
  { name = 'proj.py-project', root = PY_PROJECT_ROOT } = {},
) => {
  addProjectConfiguration(tree, name, {
    name,
    root,
    sourceRoot: root,
    projectType: 'application',
    targets: {},
    metadata: { components } as any,
  });
};

describe('apt-security-updates-in-container-images migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('does nothing when there are no runtime image components', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toBeUndefined();
  });

  it('adds the security updates to a py#agent Dockerfile', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: PY_AGENT_DIR, name: 'my-agent' },
    ]);
    tree.write(PY_AGENT_DOCKERFILE, VENDED_PY_AGENT_DOCKERFILE);

    const result = await migration(tree);
    const content = tree.read(PY_AGENT_DOCKERFILE, 'utf-8')!;

    expect(content).toContain('RUN apt-get update');
    expect(content).toContain('apt-get upgrade -y --no-install-recommends');
    expect(content).toContain('rm -rf /var/lib/apt/lists/*');
    // Inserted after FROM, ahead of every other instruction.
    expect(content.indexOf('apt-get update')).toBeLessThan(
      content.indexOf('pip uninstall'),
    );
    expect(result.nextSteps).toBeUndefined();
    expect(content).toMatchSnapshot();
  });

  it('adds the security updates to a py#mcp-server Dockerfile', async () => {
    seedProject(tree, [
      { generator: 'py#mcp-server', path: PY_MCP_DIR, name: 'my-mcp' },
    ]);
    tree.write(PY_MCP_DOCKERFILE, VENDED_PY_MCP_DOCKERFILE);

    const result = await migration(tree);
    const content = tree.read(PY_MCP_DOCKERFILE, 'utf-8')!;

    expect(content).toContain('RUN apt-get update');
    expect(result.nextSteps).toBeUndefined();
    expect(content).toMatchSnapshot();
  });

  it('adds the security updates to a ts#agent Dockerfile', async () => {
    seedProject(
      tree,
      [{ generator: 'ts#agent', path: TS_AGENT_DIR, name: 'my-agent' }],
      { name: 'ts-project', root: TS_PROJECT_ROOT },
    );
    tree.write(TS_AGENT_DOCKERFILE, VENDED_TS_AGENT_DOCKERFILE);

    const result = await migration(tree);
    const content = tree.read(TS_AGENT_DOCKERFILE, 'utf-8')!;

    expect(content).toContain('RUN apt-get update');
    // Ahead of the npm install so it resolves against upgraded packages.
    expect(content.indexOf('apt-get update')).toBeLessThan(
      content.indexOf('npm install -g npm'),
    );
    expect(result.nextSteps).toBeUndefined();
    expect(content).toMatchSnapshot();
  });

  it('ignores Dockerfiles not belonging to a runtime image component', async () => {
    // A py#agent component exists, but a stray Dockerfile in the project (not
    // the component's) must not be touched.
    seedProject(tree, [
      { generator: 'py#agent', path: PY_AGENT_DIR, name: 'my-agent' },
    ]);
    tree.write(PY_AGENT_DOCKERFILE, VENDED_PY_AGENT_DOCKERFILE);
    const strayDockerfile = `${PY_PROJECT_ROOT}/other/Dockerfile`;
    tree.write(strayDockerfile, VENDED_PY_AGENT_DOCKERFILE);

    await migration(tree);

    expect(tree.read(PY_AGENT_DOCKERFILE, 'utf-8')).toContain('apt-get update');
    expect(tree.read(strayDockerfile, 'utf-8')).toEqual(
      VENDED_PY_AGENT_DOCKERFILE,
    );
  });

  it('leaves a Dockerfile that already upgrades untouched', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: PY_AGENT_DIR, name: 'my-agent' },
    ]);
    const alreadyUpgrading = VENDED_PY_AGENT_DOCKERFILE.replace(
      "# Remove the base image's pip",
      "RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*\n\n# Remove the base image's pip",
    );
    tree.write(PY_AGENT_DOCKERFILE, alreadyUpgrading);

    const result = await migration(tree);

    expect(tree.read(PY_AGENT_DOCKERFILE, 'utf-8')).toEqual(alreadyUpgrading);
    expect(result.nextSteps).toBeUndefined();
  });

  it('leaves a Dockerfile re-based onto a non-Debian image untouched', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: PY_AGENT_DIR, name: 'my-agent' },
    ]);
    const alpine = VENDED_PY_AGENT_DOCKERFILE.replace(
      'FROM public.ecr.aws/docker/library/python:3.14-slim',
      'FROM public.ecr.aws/docker/library/alpine:3.22',
    );
    tree.write(PY_AGENT_DOCKERFILE, alpine);

    const result = await migration(tree);

    expect(tree.read(PY_AGENT_DOCKERFILE, 'utf-8')).toEqual(alpine);
    expect(result.nextSteps).toBeUndefined();
  });

  it('is idempotent', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: PY_AGENT_DIR, name: 'my-agent' },
      { generator: 'py#mcp-server', path: PY_MCP_DIR, name: 'my-mcp' },
    ]);
    tree.write(PY_AGENT_DOCKERFILE, VENDED_PY_AGENT_DOCKERFILE);
    tree.write(PY_MCP_DOCKERFILE, VENDED_PY_MCP_DOCKERFILE);

    await migration(tree);
    const agentAfterFirst = tree.read(PY_AGENT_DOCKERFILE, 'utf-8');
    const mcpAfterFirst = tree.read(PY_MCP_DOCKERFILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(PY_AGENT_DOCKERFILE, 'utf-8')).toEqual(agentAfterFirst);
    expect(tree.read(PY_MCP_DOCKERFILE, 'utf-8')).toEqual(mcpAfterFirst);
    expect(secondRun.nextSteps).toBeUndefined();
  });
});
