/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT_ROOT = 'packages/py-project/proj_py_project';
const AGENT_DIR = 'my_agent';
const MCP_DIR = 'my_mcp';
const AGENT_DOCKERFILE = `${PROJECT_ROOT}/${AGENT_DIR}/Dockerfile`;
const MCP_DOCKERFILE = `${PROJECT_ROOT}/${MCP_DIR}/Dockerfile`;

const VENDED_AGENT_DOCKERFILE = `FROM public.ecr.aws/docker/library/python:3.14-slim

WORKDIR /app

# Copy bundled package
COPY . /app

EXPOSE 8080

ENV PYTHONPATH=/app
ENV PATH="/app/bin:\${PATH}"

CMD ["python", "bin/opentelemetry-instrument", "python", "-m", "proj_py_project.my_agent.main"]
`;

const VENDED_MCP_DOCKERFILE = `FROM public.ecr.aws/docker/library/python:3.14-slim

WORKDIR /app

# Copy bundled package
COPY . /app

EXPOSE 8000

ENV PYTHONPATH=/app

CMD ["python", "bin/opentelemetry-instrument", "python", "-m", "uvicorn", "proj_py_project.my_mcp.http:app", "--host", "0.0.0.0", "--port", "8000"]
`;

/**
 * Register a py-project whose components point at the given Dockerfile dirs, so
 * the migration locates them the way it does in a real workspace.
 */
const seedProject = (
  tree: Tree,
  components: { generator: string; path: string; name: string }[],
) => {
  addProjectConfiguration(tree, 'proj.py-project', {
    name: 'proj.py-project',
    root: PROJECT_ROOT,
    sourceRoot: PROJECT_ROOT,
    projectType: 'application',
    targets: {},
    metadata: { components } as any,
  });
};

describe('strip-pip-from-python-images migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('does nothing when there are no runtime image components', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('strips pip from a py#agent Dockerfile', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: AGENT_DIR, name: 'my-agent' },
    ]);
    tree.write(AGENT_DOCKERFILE, VENDED_AGENT_DOCKERFILE);

    const result = await migration(tree);
    const content = tree.read(AGENT_DOCKERFILE, 'utf-8')!;

    expect(content).toContain('RUN python -m pip uninstall -y pip');
    expect(content).toContain(
      'rm -rf /usr/local/lib/python*/site-packages/pip',
    );
    // Inserted after FROM, before the COPY.
    expect(content.indexOf('pip uninstall')).toBeLessThan(
      content.indexOf('COPY . /app'),
    );
    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('strips pip from a py#mcp-server Dockerfile', async () => {
    seedProject(tree, [
      { generator: 'py#mcp-server', path: MCP_DIR, name: 'my-mcp' },
    ]);
    tree.write(MCP_DOCKERFILE, VENDED_MCP_DOCKERFILE);

    const result = await migration(tree);
    const content = tree.read(MCP_DOCKERFILE, 'utf-8')!;

    expect(content).toContain('RUN python -m pip uninstall -y pip');
    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('ignores Dockerfiles not belonging to a runtime image component', async () => {
    // A py#agent component exists, but a stray Dockerfile in the project (not
    // the component's) must not be touched.
    seedProject(tree, [
      { generator: 'py#agent', path: AGENT_DIR, name: 'my-agent' },
    ]);
    tree.write(AGENT_DOCKERFILE, VENDED_AGENT_DOCKERFILE);
    const strayDockerfile = `${PROJECT_ROOT}/other/Dockerfile`;
    tree.write(strayDockerfile, VENDED_AGENT_DOCKERFILE);

    await migration(tree);

    expect(tree.read(AGENT_DOCKERFILE, 'utf-8')).toContain('pip uninstall');
    expect(tree.read(strayDockerfile, 'utf-8')).toEqual(
      VENDED_AGENT_DOCKERFILE,
    );
  });

  it('skips and reports a Dockerfile that installs pip', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: AGENT_DIR, name: 'my-agent' },
    ]);
    const customised = VENDED_AGENT_DOCKERFILE.replace(
      'WORKDIR /app',
      'RUN pip install --no-cache-dir some-tool\n\nWORKDIR /app',
    );
    tree.write(AGENT_DOCKERFILE, customised);

    const result = await migration(tree);

    expect(tree.read(AGENT_DOCKERFILE, 'utf-8')).toEqual(customised);
    expect(result.nextSteps).toEqual([
      expect.stringContaining('this image uses pip'),
    ]);
  });

  it('skips and reports a Dockerfile with another pip command', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: AGENT_DIR, name: 'my-agent' },
    ]);
    const customised = VENDED_AGENT_DOCKERFILE.replace(
      'WORKDIR /app',
      'RUN pip config set global.index-url https://example.com\n\nWORKDIR /app',
    );
    tree.write(AGENT_DOCKERFILE, customised);

    const result = await migration(tree);

    expect(tree.read(AGENT_DOCKERFILE, 'utf-8')).toEqual(customised);
    expect(result.nextSteps).toEqual([
      expect.stringContaining('this image uses pip'),
    ]);
  });

  it('is idempotent', async () => {
    seedProject(tree, [
      { generator: 'py#agent', path: AGENT_DIR, name: 'my-agent' },
      { generator: 'py#mcp-server', path: MCP_DIR, name: 'my-mcp' },
    ]);
    tree.write(AGENT_DOCKERFILE, VENDED_AGENT_DOCKERFILE);
    tree.write(MCP_DOCKERFILE, VENDED_MCP_DOCKERFILE);

    await migration(tree);
    const agentAfterFirst = tree.read(AGENT_DOCKERFILE, 'utf-8');
    const mcpAfterFirst = tree.read(MCP_DOCKERFILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(AGENT_DOCKERFILE, 'utf-8')).toEqual(agentAfterFirst);
    expect(tree.read(MCP_DOCKERFILE, 'utf-8')).toEqual(mcpAfterFirst);
    expect(secondRun.nextSteps).toEqual([]);
  });
});
