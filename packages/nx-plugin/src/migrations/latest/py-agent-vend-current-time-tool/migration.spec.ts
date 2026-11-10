/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import {
  PY_AGENT_GENERATOR_INFO,
  pyAgentGenerator,
} from '../../../py/agent/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tryReadToml } from '../../../utils/toml.js';
import migration from './migration.js';

const PROJECT_ROOT = 'apps/test-project';
const AGENT_DIR = `${PROJECT_ROOT}/proj_test_project/agent`;
const AGENT_PY = `${AGENT_DIR}/agent.py`;
const MAIN_PY = `${AGENT_DIR}/main.py`;
const HELPER_PY = `${PROJECT_ROOT}/proj_test_project/helpers/clock.py`;

type Protocol = 'http' | 'a2a' | 'ag-ui';

/** The local tool the generator vends. */
const CURRENT_TIME_TOOL = `@tool
def current_time() -> str:
    """Get the current date and time in UTC (ISO 8601)."""
    return datetime.now(UTC).isoformat()`;

/** Register a py#agent component as the generator records it. */
const setUpProject = (tree: Tree) => {
  addProjectConfiguration(tree, 'test-project', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/proj_test_project`,
    targets: {},
    metadata: {
      components: [
        {
          generator: PY_AGENT_GENERATOR_INFO.id,
          path: 'proj_test_project/agent',
          protocol: 'http',
          framework: 'strands',
          name: 'agent',
        },
      ],
    } as any,
  });
};

/** An HTTP agent.py as the generator wrote it before this change. */
const OLD_AGENT_PY = `from contextlib import contextmanager

from proj_agent_connection import log_model_errors, log_tool_errors
from strands import Agent, tool
from strands.hooks import HookCallback, HookProvider
from strands_tools import current_time

from .session import get_session_manager


@tool
def subtract(a: int, b: int) -> int:
    return a - b


AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]


@contextmanager
def get_agent():
    yield Agent(
        name="Agent",
        description="Agent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract, current_time],
        hooks=AGENT_HOOKS,
        session_manager=get_session_manager(),
    )
`;

/** {@link OLD_AGENT_PY} after the migration. */
const NEW_AGENT_PY = `from contextlib import contextmanager
from datetime import UTC, datetime

from proj_agent_connection import log_model_errors, log_tool_errors
from strands import Agent, tool
from strands.hooks import HookCallback, HookProvider

from .session import get_session_manager


${CURRENT_TIME_TOOL}


@tool
def subtract(a: int, b: int) -> int:
    return a - b


AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]


@contextmanager
def get_agent():
    yield Agent(
        name="Agent",
        description="Agent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract, current_time],
        hooks=AGENT_HOOKS,
        session_manager=get_session_manager(),
    )
`;

/**
 * Roll a freshly generated agent.py back to the shape the generator wrote
 * before this change.
 */
const rollBackAgentPy = (vended: string): string =>
  vended
    .replace('from datetime import UTC, datetime\n', '')
    .replace(`${CURRENT_TIME_TOOL}\n\n\n`, '')
    .replace(
      'from strands.hooks import HookCallback, HookProvider\n',
      'from strands.hooks import HookCallback, HookProvider\nfrom strands_tools import current_time\n',
    );

/** Generate a py#agent into a Python project, as a user workspace would hold. */
const generateAgent = async (tree: Tree, protocol: Protocol) => {
  addProjectConfiguration(tree, 'test-project', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/proj_test_project`,
    targets: {},
  });
  tree.write(
    `${PROJECT_ROOT}/pyproject.toml`,
    `[project]
name = "proj.test_project"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
  );
  await pyAgentGenerator(tree, {
    project: 'test-project',
    name: 'agent',
    protocol,
    iac: 'cdk',
  } as any);
};

/** Run the migration on one helper file and return its next steps. */
const migrateHelper = async (tree: Tree, content: string) => {
  setUpProject(tree);
  tree.write(HELPER_PY, content);
  return (await migration(tree)).nextSteps;
};

describe('py-agent-vend-current-time-tool migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should replace the strands_tools current_time import with a local tool', async () => {
    setUpProject(tree);
    tree.write(AGENT_PY, OLD_AGENT_PY);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
  });

  it('should be idempotent on re-run', async () => {
    setUpProject(tree);
    tree.write(AGENT_PY, OLD_AGENT_PY);

    await migration(tree);
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
  });

  it.each<Protocol>(['http', 'a2a', 'ag-ui'])(
    'should converge a %s agent on exactly what the generator vends today',
    async (protocol) => {
      await generateAgent(tree, protocol);
      const vendedAgent = tree.read(AGENT_PY, 'utf-8')!;
      const vendedMain = tree.read(MAIN_PY, 'utf-8')!;

      const oldAgent = rollBackAgentPy(vendedAgent);
      expect(oldAgent).toContain('from strands_tools import current_time\n');
      expect(oldAgent).toContain('tools=[subtract, current_time]');
      expect(oldAgent).not.toContain('def current_time');
      tree.write(AGENT_PY, oldAgent);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(vendedAgent);
      expect(tree.read(MAIN_PY, 'utf-8')).toBe(vendedMain);
    },
  );

  it.each<Protocol>(['http', 'a2a', 'ag-ui'])(
    'should be a no-op on a freshly generated %s agent',
    async (protocol) => {
      await generateAgent(tree, protocol);
      const agent = tree.read(AGENT_PY, 'utf-8');
      const main = tree.read(MAIN_PY, 'utf-8');

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(agent);
      expect(tree.read(MAIN_PY, 'utf-8')).toBe(main);
    },
  );

  it('should rewrite an agent.py an MCP connection generator has transformed', async () => {
    setUpProject(tree);
    tree.write(
      AGENT_PY,
      OLD_AGENT_PY.replace(
        'from proj_agent_connection import log_model_errors, log_tool_errors',
        'from proj_agent_connection import InventoryMcpClientStrands, log_model_errors, log_tool_errors',
      ).replace(
        'tools=[subtract, current_time],',
        'tools=[subtract, current_time, *inventory_mcp.list_tools_sync()],',
      ),
    );

    const { nextSteps } = await migration(tree);
    const agent = tree.read(AGENT_PY, 'utf-8')!;

    expect(nextSteps).toEqual([]);
    expect(agent).toContain(CURRENT_TIME_TOOL);
    expect(agent).toContain(
      'tools=[subtract, current_time, *inventory_mcp.list_tools_sync()],',
    );
    expect(agent).not.toContain('strands_tools');
  });

  it('should keep the other strands_tools names and list the file', async () => {
    setUpProject(tree);
    tree.write(
      AGENT_PY,
      OLD_AGENT_PY.replace(
        'from strands_tools import current_time',
        'from strands_tools import current_time, http_request',
      ).replace(
        'tools=[subtract, current_time]',
        'tools=[subtract, current_time, http_request]',
      ),
    );

    const { nextSteps } = await migration(tree);
    const agent = tree.read(AGENT_PY, 'utf-8')!;

    expect(agent).toBe(
      NEW_AGENT_PY.replace(
        'from strands.hooks import HookCallback, HookProvider\n',
        'from strands.hooks import HookCallback, HookProvider\nfrom strands_tools import http_request\n',
      ).replace(
        'tools=[subtract, current_time]',
        'tools=[subtract, current_time, http_request]',
      ),
    );
    expect(nextSteps).toEqual([
      `${AGENT_PY}: it still imports from strands_tools. strands-agents-tools 0.9.0 is a tombstone release (importing any of its tools raises ImportError); keep strands-agents-tools pinned below 0.9 or replace these tools: https://strandsagents.com/docs/user-guide/migrate/strands-agents-tools/`,
    ]);
  });

  it('should rewrite a parenthesised import and keep aliased names', async () => {
    const nextSteps = await migrateHelper(
      tree,
      `from strands import tool
from strands_tools import (
    current_time,
    file_read as read_file,
)

TOOLS = [current_time, read_file]
`,
    );

    expect(
      tree.read(HELPER_PY, 'utf-8'),
    ).toBe(`from datetime import UTC, datetime

from strands import tool
from strands_tools import file_read as read_file


${CURRENT_TIME_TOOL}


TOOLS = [current_time, read_file]
`);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(`${HELPER_PY}: it still imports from`);
  });

  it('should add the imports a file without them needs', async () => {
    const nextSteps = await migrateHelper(
      tree,
      '"""Clock helpers."""\n\nfrom strands_tools import current_time\n\nNOW = current_time\n',
    );

    expect(nextSteps).toEqual([]);
    expect(tree.read(HELPER_PY, 'utf-8')).toBe(`"""Clock helpers."""

from datetime import UTC, datetime

from strands import tool


${CURRENT_TIME_TOOL}


NOW = current_time
`);
  });

  it('should add names to existing datetime and strands imports without duplicates', async () => {
    const nextSteps = await migrateHelper(
      tree,
      `from datetime import date

from strands import Agent
from strands_tools import current_time

TODAY = date.today()
AGENT = Agent(tools=[current_time])
`,
    );

    expect(nextSteps).toEqual([]);
    expect(
      tree.read(HELPER_PY, 'utf-8'),
    ).toBe(`from datetime import UTC, date, datetime

from strands import Agent, tool


${CURRENT_TIME_TOOL}


TODAY = date.today()
AGENT = Agent(tools=[current_time])
`);
  });

  it('should put the tool after a plain import that follows the strands_tools import', async () => {
    const nextSteps = await migrateHelper(
      tree,
      `from strands_tools import current_time

import proj_test_project

TOOLS = [current_time, proj_test_project]
`,
    );

    expect(nextSteps).toEqual([]);
    const helper = tree.read(HELPER_PY, 'utf-8')!;
    expect(helper.indexOf('import proj_test_project')).toBeLessThan(
      helper.indexOf('def current_time'),
    );
    expect(helper).not.toContain('strands_tools');
  });

  it.each([
    [
      'an aliased current_time',
      'from strands_tools import current_time as now\n\nTOOLS = [now]\n',
    ],
    [
      'a current_time it already defines',
      'from strands_tools import current_time\n\n\ndef current_time() -> str:\n    return ""\n',
    ],
    [
      'current_time imported twice',
      'from strands_tools import current_time\n\nTOOLS = [current_time]\n\n\ndef tools():\n    from strands_tools import current_time\n\n    return [current_time]\n',
    ],
    [
      'current_time from a strands_tools submodule',
      'from strands_tools.current_time import current_time\n\nTOOLS = [current_time]\n',
    ],
    [
      'a strands_tools import with a comment',
      'from strands_tools import current_time  # noqa: F401\n',
    ],
    [
      'a strands_tools import below top level',
      'def tools():\n    from strands_tools import current_time\n\n    return [current_time]\n',
    ],
    [
      'the datetime module imported',
      'import datetime\n\nfrom strands_tools import current_time\n\nTOOLS = [current_time]\nTODAY = datetime.date.today()\n',
    ],
    [
      'an aliased datetime import',
      'from datetime import datetime as dt\n\nfrom strands_tools import current_time\n\nTOOLS = [current_time, dt]\n',
    ],
    [
      'datetime imported below top level',
      'from strands_tools import current_time\n\nTOOLS = [current_time]\n\n\ndef today():\n    from datetime import date\n\n    return date.today()\n',
    ],
    [
      'a tool name from another module',
      'from my_tools import tool\nfrom strands_tools import current_time\n\nTOOLS = [tool, current_time]\n',
    ],
    [
      'an unparsed datetime import',
      'from datetime import (  # stdlib\n    date,\n)\n\nfrom strands_tools import current_time\n\nTOOLS = [current_time, date]\n',
    ],
    [
      'an unparsed import that mentions tool',
      'from my_tools import (  # the tool helpers\n    helper,\n)\nfrom strands_tools import current_time\n\nTOOLS = [current_time, helper]\n',
    ],
  ])(
    'should leave a file with %s unchanged and list it',
    async (_case, content) => {
      const nextSteps = await migrateHelper(tree, content);

      expect(nextSteps).toEqual([
        `${HELPER_PY}: it imports current_time from strands-agents-tools in a shape this migration does not rewrite (for example an aliased import, or a current_time, datetime, UTC or tool name the file already defines), so it was left unchanged. strands-agents-tools 0.9.0 removed current_time (importing it raises ImportError). Define a local current_time tool instead, as the py#agent generator does in agent.py: https://strandsagents.com/docs/user-guide/migrate/strands-agents-tools/`,
      ]);
      expect(tree.read(HELPER_PY, 'utf-8')).toBe(content);
    },
  );

  it('should list a file that imports other strands_tools without changing it', async () => {
    const content =
      'import strands_tools\n\nTOOLS = [strands_tools.http_request]\n';

    const nextSteps = await migrateHelper(tree, content);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(`${HELPER_PY}: it still imports from`);
    expect(tree.read(HELPER_PY, 'utf-8')).toBe(content);
  });

  it('should leave empty and unrelated Python files alone', async () => {
    setUpProject(tree);
    tree.write(`${AGENT_DIR}/__init__.py`, '');
    tree.write(HELPER_PY, 'NOW = "current_time"\n');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(`${AGENT_DIR}/__init__.py`, 'utf-8')).toBe('');
    expect(tree.read(HELPER_PY, 'utf-8')).toBe('NOW = "current_time"\n');
  });

  it.each([
    'strands-agents-tools==0.8.11',
    'Strands_Agents_Tools>=0.8,<0.9',
    'strands-agents-tools @ https://github.com/strands-agents/tools/archive/v0.8.11.zip',
  ])(
    'should keep %s in pyproject.toml and add a next step about it',
    async (requirement) => {
      setUpProject(tree);
      tree.write(AGENT_PY, OLD_AGENT_PY);
      const pyproject = `${PROJECT_ROOT}/pyproject.toml`;
      const pyprojectContent = `[project]
name = "proj.test_project"
version = "0.1.0"
dependencies = ["strands-agents==1.20.0", "${requirement}"]
`;
      tree.write(pyproject, pyprojectContent);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([
        `${pyproject}: it lists strands-agents-tools, which the py#agent generator no longer adds. strands-agents-tools 0.9.0 is a tombstone release (importing any of its tools raises ImportError); keep it pinned below 0.9 or remove it if unused.`,
      ]);
      expect(tree.read(pyproject, 'utf-8')).toBe(pyprojectContent);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
    },
  );

  it.each([
    // An invalid requirement string that names the package.
    '["strands-agents==1.20.0", "strands-agents-tools ==="]',
    // Entries that are not requirement strings at all.
    '[{ name = "strands-agents-tools" }]',
  ])(
    'should skip dependencies it cannot read as requirements: %s',
    async (dependencies) => {
      setUpProject(tree);
      tree.write(AGENT_PY, OLD_AGENT_PY);
      const pyproject = `${PROJECT_ROOT}/pyproject.toml`;
      tree.write(
        pyproject,
        `[project]
name = "proj.test_project"
version = "0.1.0"
dependencies = ${dependencies}
`,
      );
      // The file itself parses, so the entries are what the migration skips.
      expect(tryReadToml(tree, pyproject)).toBeDefined();

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
    },
  );

  it('should not change projects without a py#agent', async () => {
    addProjectConfiguration(tree, 'other', { root: 'apps/other' });
    tree.write('apps/other/other/agent.py', OLD_AGENT_PY);
    tree.write(
      'apps/other/pyproject.toml',
      `[project]
name = "other"
version = "0.1.0"
dependencies = ["strands-agents-tools==0.8.11"]
`,
    );

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read('apps/other/other/agent.py', 'utf-8')).toBe(OLD_AGENT_PY);
  });
});
