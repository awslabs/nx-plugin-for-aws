/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

// Registers a project with the ComponentMetadata the ts#agent generator
// itself writes, since the migration now reads protocol/name from it rather
// than guessing from file contents.
const registerAgentProject = (
  tree: Tree,
  name: string,
  root: string,
  protocol: string,
  rc: string,
  agentDir = 'src/agent',
) =>
  addProjectConfiguration(tree, name, {
    root,
    metadata: {
      components: [
        {
          generator: TS_AGENT_GENERATOR_INFO.id,
          path: agentDir,
          rc,
          protocol,
        },
      ],
    } as any,
  });

const CDK_AGENT_FILE =
  'packages/common/constructs/src/app/agents/my-agent/my-agent.ts';
const CDK_MCP_SERVER_FILE =
  'packages/common/constructs/src/app/mcp-servers/my-mcp/my-mcp.ts';
const TF_AGENT_FILE =
  'packages/common/terraform/src/app/agents/my-agent/my-agent.tf';
const TS_RUNTIME_CONFIG_FILE =
  'packages/common/agent-connection/src/core/runtime-config.ts';
const TS_A2A_CLIENT_FILE =
  'packages/common/agent-connection/src/app/my-target-agent-client-strands.ts';
const PY_A2A_CLIENT_FILE =
  'packages/common/agent_connection/app/my_target_agent_client_strands.py';
const AGENTCORE_CHAT_SCRIPT_FILE =
  'apps/test-project/scripts/agent/agentcore.ts';
const REACT_PROVIDER_FILE =
  'packages/website/src/components/MyAgentAgentClientProvider.tsx';

const OLD_CDK_AGENT_FILE = `import { Construct } from 'constructs';
import { RuntimeConfig } from '../../../core/runtime-config.js';

export class MyAgent extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const rc = RuntimeConfig.ensure(this);

    rc.grantReadAppConfig(this.agentCoreRuntime);

    rc.set('agentcore', 'agentRuntimes', {
      ...rc.get('agentcore').agentRuntimes,
      MyAgent: this.agentCoreRuntime.agentRuntimeArn,
    });

    rc.set('connection', 'agentRuntimes', {
      ...rc.get('connection').agentRuntimes,
      MyAgent: this.agentCoreRuntime.agentRuntimeArn,
    });
  }
}
`;

const OLD_CDK_MCP_SERVER_FILE = `import { Construct } from 'constructs';
import { RuntimeConfig } from '../../../core/runtime-config.js';

export class MyMcp extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const rc = RuntimeConfig.ensure(this);

    rc.grantReadAppConfig(this.agentCoreRuntime);

    rc.set('agentcore', 'agentRuntimes', {
      ...rc.get('agentcore').agentRuntimes,
      MyMcp: this.agentCoreRuntime.agentRuntimeArn,
    });
  }
}
`;

const OLD_TF_AGENT_FILE = `module "agent_core_runtime" {
  source = "../../../core/agent-core"
  agent_runtime_name = "MyAgent"
}

# Add agent runtime ARN to runtime config
module "add_agent_runtime_to_runtime_config" {
  source = "../../../core/runtime-config/entry"

  namespace = "agentcore"
  key       = "agentRuntimes"
  value     = { "MyAgent" = module.agent_core_runtime.agent_core_runtime_arn }

  depends_on = [module.agent_core_runtime]
}

# Also expose the agent runtime ARN to the frontend via the 'connection' namespace
module "add_agent_runtime_to_connection_runtime_config" {
  source = "../../../core/runtime-config/entry"

  namespace = "connection"
  key       = "agentRuntimes"
  value     = { "MyAgent" = module.agent_core_runtime.agent_core_runtime_arn }

  depends_on = [module.agent_core_runtime]
}
`;

const OLD_TS_RUNTIME_CONFIG_FILE = `import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';

/**
 * Shape of this project's runtime configuration in AppConfig. Keys are the
 * class names of connected target constructs (e.g. \`MyAgent\`, \`MyGateway\`).
 */
export interface AgentCoreRuntimeConfig {
  agentRuntimes?: Record<string, string>;
  gateways?: Record<string, string>;
}

export const getAgentCoreRuntimeConfig =
  async (): Promise<AgentCoreRuntimeConfig> => {
    const application = process.env.RUNTIME_CONFIG_APP_ID;
    return (await getAppConfig('agentcore', {
      application,
      environment: 'default',
      transform: 'json',
    })) as AgentCoreRuntimeConfig;
  };
`;

const OLD_TS_A2A_CLIENT_FILE = `import { A2AAgent } from '@strands-agents/sdk/a2a';
import { getAgentCoreRuntimeConfig } from '../core/runtime-config.js';

export class MyTargetAgentClientStrands {
  static async create(): Promise<A2AAgent> {
    const config = await getAgentCoreRuntimeConfig();
    const agentRuntimeArn =
      config.agentRuntimes?.['MyTargetAgent'];
    if (!agentRuntimeArn) {
      throw new Error('No connected agent runtime found.');
    }
    return AgentCoreA2aClientStrands.withIamAuth({ agentRuntimeArn });
  }
}
`;

const OLD_PY_A2A_CLIENT_FILE = `import os

from strands.agent.a2a_agent import A2AAgent

from packages.common.agent_connection.core.runtime_config import (
    get_agentcore_runtime_config,
)


class MyTargetAgentClientStrands:
    @staticmethod
    def create() -> A2AAgent:
        config = get_agentcore_runtime_config()
        agent_runtime_arn = config.get("agentRuntimes", {}).get(
            "MyTargetAgent"
        )
        if not agent_runtime_arn:
            raise RuntimeError("No connected agent runtime found.")
        return AgentCoreA2aClientStrands.with_iam_auth(agent_runtime_arn)
`;

// Unlike the a2a/mcp client templates, agentcore.ts (the agent-chat CLI's
// runtime-config resolver) calls getAppConfig directly and casts the result
// inline rather than importing the shared AgentCoreRuntimeConfig type, so it
// needs its own reshape.
const OLD_AGENTCORE_CHAT_SCRIPT_FILE = `import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';

export const resolveRemoteAgent = async () => {
  const application = process.env.RUNTIME_CONFIG_APP_ID;
  if (!application) {
    return undefined;
  }
  const config = (await getAppConfig('agentcore', {
    application,
    environment: 'default',
    transform: 'json',
  })) as { agentRuntimes?: Record<string, string> };
  const arn = config.agentRuntimes?.['MyAgent'];
  if (!arn) {
    throw new Error("No deployed agent named 'MyAgent' found.");
  }
  return { arn, region: arn.split(':')[3] };
};
`;

const OLD_REACT_PROVIDER_FILE = `import { useRuntimeConfig } from '../hooks/useRuntimeConfig';

function buildAgentCoreWsUrl(agentRuntimeArn: string): string {
  const region = agentRuntimeArn.split(':')[3];
  return \`wss://bedrock-agentcore.\${region}.amazonaws.com/runtimes/\${encodeURIComponent(agentRuntimeArn)}/ws\`;
}

export const MyAgentAgentClientProvider = () => {
  const runtimeConfig = useRuntimeConfig();
  const agentRuntimeValue = runtimeConfig.agentRuntimes.MyAgent;

  const wsUrl = agentRuntimeValue.startsWith('arn:')
    ? buildAgentCoreWsUrl(agentRuntimeValue)
    : agentRuntimeValue;

  return wsUrl;
};
`;

const AGUI_AGENT_TS_FILE = 'apps/test-project/src/agent/agent.ts';
const AGUI_INDEX_TS_FILE = 'apps/test-project/src/agent/index.ts';
const HTTP_AGENT_TS_FILE = 'apps/http-project/src/agent/agent.ts';
const HTTP_INDEX_TS_FILE = 'apps/http-project/src/agent/index.ts';

const OLD_AGENT_TS_FILE = `import { Agent, tool } from '@strands-agents/sdk';
import { logModelErrors, logToolErrors } from '@proj/agent-connection';
import { z } from 'zod';

export const getAgent = async () => {
  const agent = new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [],
  });
  logModelErrors(agent);
  logToolErrors(agent);
  return agent;
};
`;

// Regression fixture: the Agent is constructed from a variable rather than an
// inline object literal, so the constructor rewrites can't apply.
const NON_LITERAL_CONSTRUCTOR_OLD_AGENT_TS_FILE = `import { Agent, tool } from '@strands-agents/sdk';
import { logModelErrors, logToolErrors } from '@proj/agent-connection';
import { z } from 'zod';

const agentProps = {
  systemPrompt: 'You are a mathematical wizard.',
  tools: [],
};

export const getAgent = async () => {
  const agent = new Agent(agentProps);
  logModelErrors(agent);
  logToolErrors(agent);
  return agent;
};
`;

// Regression fixture: a long npm scope name pushes the import past prettier's
// print width, so it wraps onto multiple lines. The migration must detect
// this via GritQL (AST-based) rather than a literal `logModelErrors, logToolErrors`
// substring check, which this exact shape used to defeat silently.
const MULTI_LINE_IMPORT_OLD_AGENT_TS_FILE = `import { Agent, tool } from '@strands-agents/sdk';
import {
  logModelErrors,
  logToolErrors,
} from '@my-really-long-npm-scope-name/agent-connection';
import { z } from 'zod';

export const getAgent = async () => {
  const agent = new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [],
  });
  logModelErrors(agent);
  logToolErrors(agent);
  return agent;
};
`;

// Regression fixture: a connection generator (mcp-connection/a2a-connection)
// merges its own client import into this same import statement via
// addDestructuredImport (which only ever appends), so logModelErrors/
// logToolErrors aren't always the only two specifiers.
const MERGED_IMPORT_OLD_AGENT_TS_FILE = `import { Agent, tool } from '@strands-agents/sdk';
import {
  logModelErrors,
  logToolErrors,
  AgentsMcpServerClientStrands,
} from '@my-agent-project/agent-connection';
import { z } from 'zod';

export const getAgent = async () => {
  const agentsMcpServer = await AgentsMcpServerClientStrands.create();
  const agent = new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [agentsMcpServer],
  });
  logModelErrors(agent);
  logToolErrors(agent);
  return agent;
};
`;

// Regression fixture: TWO connection generators (mcp-connection AND
// a2a-connection) have each merged their own client import into the same
// statement — this is the exact shape found in a real workspace where the
// migration silently left logModelErrors/logToolErrors dangling in the
// import (GritQL's `$rest` metavariable only binds a single remaining
// specifier, not an arbitrary-length list).
const DOUBLY_MERGED_IMPORT_OLD_AGENT_TS_FILE = `import { Agent, tool } from '@strands-agents/sdk';
import {
  logModelErrors,
  logToolErrors,
  A2aAgentClientStrands,
  AgentsMcpServerClientStrands,
} from '@my-agent-project/agent-connection';
import { z } from 'zod';

export const getAgent = async () => {
  const agentsMcpServer = await AgentsMcpServerClientStrands.create();
  const a2aAgent = await A2aAgentClientStrands.create();
  const agent = new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [agentsMcpServer],
  });
  logModelErrors(agent);
  logToolErrors(agent);
  return agent;
};
`;

const AGUI_INDEX_TS_FILE_CONTENT = `import { StrandsAgent } from '@ag-ui/aws-strands';
import { runWithSessionId } from '@proj/agent-connection';
import { getAgent } from './agent.js';

void (async () => {
  const agent = await getAgent();
  await agent.initialize();

  const aguiAgent = new StrandsAgent({
    agent,
    name: 'TestProjectAgent',
    description: 'A Strands Agent exposed via the AG-UI protocol.',
  });
})();
`;

// Regression fixture: a customised StrandsAgent constructor (an extra prop)
// no longer matches the exact 3-prop shape the plugin rewrite targets.
const CUSTOMISED_AGUI_INDEX_TS_FILE_CONTENT = `import { StrandsAgent } from '@ag-ui/aws-strands';
import { runWithSessionId } from '@proj/agent-connection';
import { getAgent } from './agent.js';

void (async () => {
  const agent = await getAgent();
  await agent.initialize();

  const aguiAgent = new StrandsAgent({
    agent,
    name: 'TestProjectAgent',
    description: 'A Strands Agent exposed via the AG-UI protocol.',
    tags: ['custom'],
  });
})();
`;

const HTTP_INDEX_TS_FILE_CONTENT = `import { createServer } from 'http';
import { getAgent } from './agent.js';

createServer();
`;

const S3_SESSION_FILE = 'apps/test-project/src/agent/session.ts';

const S3_SESSION_FILE_CONTENT = `import { SessionManager } from '@strands-agents/sdk';
import { LocalFileStorage, S3Storage } from '@strands-agents/sdk/storage';
import {
  getCurrentSessionId,
  getAgentCoreRuntimeConfig,
} from '@proj/agent-connection';

export const getSessionManager = async (): Promise<
  SessionManager | undefined
> => {
  const sessionId = getCurrentSessionId();
  if (!sessionId) {
    throw new Error('No current session id.');
  }
  if (process.env.LOCAL_DEV === 'true') {
    return new SessionManager({
      sessionId,
      storage: new LocalFileStorage('../../tmp/agents/strands/test-project-agent'),
    });
  }
  const config = await getAgentCoreRuntimeConfig();
  const bucketName = config.agentRuntimes?.['TestAgent']?.session?.bucketName;
  if (!bucketName) {
    throw new Error("No S3 bucket configured for this agent's session.");
  }
  return new SessionManager({ sessionId, storage: new S3Storage(bucketName) });
};
`;

const MODEL_ERRORS_FILE =
  'packages/common/agent-connection/src/core/model-errors-strands.ts';
const TOOL_ERRORS_FILE =
  'packages/common/agent-connection/src/core/tool-errors-strands.ts';

const OLD_MODEL_ERRORS_FILE = `import { AfterModelCallEvent, type LocalAgent } from '@strands-agents/sdk';

const NO_CREDENTIALS =
  'Unable to invoke the model: no AWS credentials found. Configure credentials ' +
  '(e.g. run \`aws configure\`, set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / ' +
  'AWS_SESSION_TOKEN, or assume a role) before running the agent.';
const ACCESS_DENIED =
  'Unable to invoke the model: access denied. Grant your AWS principal permission ' +
  'to call bedrock:InvokeModelWithResponseStream for your model.';

const hasErrorNamed = (error: unknown, name: string): boolean => {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.name === name) return true;
    current = current.cause;
  }
  return false;
};

/** Logs model invocation errors, calling out missing credentials or denied permissions. */
export const logModelErrors = (agent: LocalAgent): void => {
  agent.addHook(AfterModelCallEvent, (event) => {
    const error = event.error;
    if (!error) return;
    if (hasErrorNamed(error, 'CredentialsProviderError')) {
      console.error(NO_CREDENTIALS);
    } else if (hasErrorNamed(error, 'AccessDeniedException')) {
      console.error(ACCESS_DENIED);
    } else {
      console.error(\`Model invocation failed: \${error.message}\`);
    }
  });
};
`;

const OLD_TOOL_ERRORS_FILE = `import {
  AfterToolCallEvent,
  type LocalAgent,
  TextBlock,
} from '@strands-agents/sdk';

/** Logs tool execution errors, including the tool name and underlying error or message when available. */
export const logToolErrors = (agent: LocalAgent): void => {
  agent.addHook(AfterToolCallEvent, (event) => {
    if (event.result.status !== 'error') return;
    const error = event.result.error ?? event.error;
    const message =
      error?.message ??
      event.result.content
        .filter((block): block is TextBlock => block instanceof TextBlock)
        .map((block) => block.text)
        .join(' ');
    console.error(
      \`Tool '\${event.toolUse.name}' failed\${message ? \`: \${message}\` : ''}\`,
    );
  });
};
`;
// Regression fixture: an extra statement in the hook body no longer matches
// the exact single-statement shape MODEL_ERRORS_CLASS_PATTERN targets.
const DIVERGED_MODEL_ERRORS_FILE = OLD_MODEL_ERRORS_FILE.replace(
  'export const logModelErrors = (agent: LocalAgent): void => {\n  agent.addHook(AfterModelCallEvent, (event) => {',
  "export const logModelErrors = (agent: LocalAgent): void => {\n  console.log('custom logging setup');\n  agent.addHook(AfterModelCallEvent, (event) => {",
);

describe('ts-agent-session-manager-support migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when there is nothing to migrate', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('reshapes the CDK agent construct agentcore namespace only, leaving connection as a bare string', async () => {
    tree.write(CDK_AGENT_FILE, OLD_CDK_AGENT_FILE);

    await migration(tree);

    const content = tree.read(CDK_AGENT_FILE, 'utf-8') ?? '';
    // Existing agents predate session management support and have no S3
    // bucket to reference, so no session field is added here — they get
    // in-memory session storage via a fresh session.ts instead.
    expect(
      content.match(/arn: this\.agentCoreRuntime\.agentRuntimeArn,/g),
    ).toHaveLength(1);
    expect(content).not.toContain('session:');
    // The connection namespace keeps its bare ARN string.
    expect(
      content.match(/MyAgent: this\.agentCoreRuntime\.agentRuntimeArn,/g),
    ).toHaveLength(1);
  });

  it('does not add a session field for MCP server runtimes', async () => {
    tree.write(CDK_MCP_SERVER_FILE, OLD_CDK_MCP_SERVER_FILE);

    await migration(tree);

    const content = tree.read(CDK_MCP_SERVER_FILE, 'utf-8');
    expect(content).not.toContain('session:');
  });

  it('reshapes the Terraform agentcore module only, leaving the connection module as a bare string', async () => {
    tree.write(TF_AGENT_FILE, OLD_TF_AGENT_FILE);

    await migration(tree);

    const content = tree.read(TF_AGENT_FILE, 'utf-8') ?? '';
    expect(content).toContain(
      'value     = { "MyAgent" = { arn = module.agent_core_runtime.agent_core_runtime_arn } }',
    );
    expect(content).not.toContain('session');
    // The connection module keeps its bare ARN string.
    expect(content).toContain(
      'value     = { "MyAgent" = module.agent_core_runtime.agent_core_runtime_arn }',
    );
  });

  it('reshapes the shared TS AgentCoreRuntimeConfig interface', async () => {
    tree.write(TS_RUNTIME_CONFIG_FILE, OLD_TS_RUNTIME_CONFIG_FILE);

    await migration(tree);

    const content = tree.read(TS_RUNTIME_CONFIG_FILE, 'utf-8');
    expect(content).toContain('export interface AgentRuntimeEntry');
    expect(content).toContain(
      'agentRuntimes?: Record<string, AgentRuntimeEntry>;',
    );
  });

  it('appends .arn to TS client agentRuntimes access', async () => {
    tree.write(TS_A2A_CLIENT_FILE, OLD_TS_A2A_CLIENT_FILE);

    await migration(tree);

    const content = tree.read(TS_A2A_CLIENT_FILE, 'utf-8');
    expect(content).toContain("config.agentRuntimes?.['MyTargetAgent']?.arn");
  });

  it('reshapes the agent-chat CLI agentcore.ts inline cast to { arn }', async () => {
    tree.write(AGENTCORE_CHAT_SCRIPT_FILE, OLD_AGENTCORE_CHAT_SCRIPT_FILE);

    await migration(tree);

    const content = tree.read(AGENTCORE_CHAT_SCRIPT_FILE, 'utf-8');
    expect(content).toContain(
      'agentRuntimes?: Record<string, { arn: string }>',
    );
    expect(content).not.toContain('agentRuntimes?: Record<string, string>');
    // The access expression is reshaped by the existing TS_CLIENT_ARN_PATTERNS
    // rewrite — asserted here too since a type that no longer matches what's
    // read off it is exactly the bug this migration must not reintroduce.
    expect(content).toContain("config.agentRuntimes?.['MyAgent']?.arn");
  });

  it('appends .get("arn") to Python client agentRuntimes access', async () => {
    tree.write(PY_A2A_CLIENT_FILE, OLD_PY_A2A_CLIENT_FILE);

    await migration(tree);

    const content = tree.read(PY_A2A_CLIENT_FILE, 'utf-8');
    expect(content).toContain(
      'agent_runtime_arn = agent_runtime.get("arn") if agent_runtime else None',
    );
  });

  it('leaves the React client provider untouched (connection namespace stays a bare ARN string)', async () => {
    tree.write(REACT_PROVIDER_FILE, OLD_REACT_PROVIDER_FILE);

    const result = await migration(tree);

    const content = tree.read(REACT_PROVIDER_FILE, 'utf-8');
    expect(content).toEqual(OLD_REACT_PROVIDER_FILE);
    expect(result.nextSteps.some((s) => s.includes(REACT_PROVIDER_FILE))).toBe(
      false,
    );
  });

  it('removes the model/tool error logging hooks from an AG-UI agent.ts', async () => {
    registerAgentProject(
      tree,
      'test-project',
      'apps/test-project',
      'ag-ui',
      'TestProjectAgent',
    );
    tree.write(AGUI_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(AGUI_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).not.toContain('logModelErrors');
    expect(content).not.toContain('logToolErrors');
  });

  it('leaves an AG-UI agent.ts entirely untouched (all-or-nothing) when the sibling index.ts constructor has diverged', async () => {
    registerAgentProject(
      tree,
      'test-project',
      'apps/test-project',
      'ag-ui',
      'TestProjectAgent',
    );
    tree.write(AGUI_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, CUSTOMISED_AGUI_INDEX_TS_FILE_CONTENT);

    const result = await migration(tree);

    // index.ts can't be wired with the equivalent plugins (it no longer
    // matches the 3-prop shape the rewrite targets), so agent.ts's calls are
    // left in place rather than being dropped with no replacement.
    expect(tree.read(AGUI_AGENT_TS_FILE, 'utf-8')).toEqual(OLD_AGENT_TS_FILE);
    expect(tree.read(AGUI_INDEX_TS_FILE, 'utf-8')).toEqual(
      CUSTOMISED_AGUI_INDEX_TS_FILE_CONTENT,
    );
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(AGUI_AGENT_TS_FILE) &&
          s.includes('could not be automatically wired'),
      ),
    ).toBe(true);
  });

  it('wires the error-logging plugins into an AG-UI index.ts', async () => {
    tree.write(AGUI_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);

    const result = await migration(tree);

    const content = tree.read(AGUI_INDEX_TS_FILE, 'utf-8') ?? '';
    expect(content).toContain('ModelErrorLoggingPlugin');
    expect(content).toContain('ToolErrorLoggingPlugin');
    expect(content).toContain('runWithSessionId');
    expect(content).toContain(
      'plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()]',
    );
    expect(result.nextSteps.some((s) => s.includes(AGUI_INDEX_TS_FILE))).toBe(
      true,
    );
  });

  it('wires sessionManagerProvider into an AG-UI index.ts and creates session.ts when its project is registered', async () => {
    registerAgentProject(
      tree,
      'test-project',
      'apps/test-project',
      'ag-ui',
      'TestProjectAgent',
    );
    tree.write(AGUI_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(AGUI_INDEX_TS_FILE, 'utf-8') ?? '';
    expect(content).toContain(
      "import { getSessionManager } from './session.js';",
    );
    expect(content).toContain(
      'config: { sessionManagerProvider: getSessionManager }',
    );

    const sessionPath = 'apps/test-project/src/agent/session.ts';
    const sessionManagerContent = tree.read(sessionPath, 'utf-8') ?? '';
    expect(sessionManagerContent).toContain(
      "import { getCurrentSessionId } from '@proj/agent-connection';",
    );
    expect(sessionManagerContent).toContain('new LocalFileStorage(');
  });

  it('leaves an AG-UI index.ts sessionManagerProvider wiring for manual follow-up when its project cannot be found', async () => {
    tree.write(AGUI_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);

    const result = await migration(tree);

    const content = tree.read(AGUI_INDEX_TS_FILE, 'utf-8') ?? '';
    expect(content).not.toContain('sessionManagerProvider');
    expect(content).not.toContain('getSessionManager');
    expect(
      tree.exists(
        `${AGUI_INDEX_TS_FILE.split('/').slice(0, -1).join('/')}/session.ts`,
      ),
    ).toBe(false);
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(AGUI_INDEX_TS_FILE) &&
          s.includes('could not determine the project root'),
      ),
    ).toBe(true);
  });

  it('leaves an existing S3-session session.ts untouched (regression: agentRuntimes reshape must not mangle its ?.session?.bucketName chain)', async () => {
    tree.write(S3_SESSION_FILE, S3_SESSION_FILE_CONTENT);

    const result = await migration(tree);

    const content = tree.read(S3_SESSION_FILE, 'utf-8') ?? '';
    expect(content).toContain(
      "config.agentRuntimes?.['TestAgent']?.session?.bucketName",
    );
    expect(content).not.toContain('?.arn?.session');
    expect(result.nextSteps.some((s) => s.includes(S3_SESSION_FILE))).toBe(
      false,
    );
  });

  it('adds the ModelErrorLoggingPlugin class to model-errors-strands.ts', async () => {
    tree.write(MODEL_ERRORS_FILE, OLD_MODEL_ERRORS_FILE);

    await migration(tree);

    const content = tree.read(MODEL_ERRORS_FILE, 'utf-8') ?? '';
    expect(content).toContain('type Plugin');
    expect(content).toContain(
      'export class ModelErrorLoggingPlugin implements Plugin',
    );
    expect(content).not.toContain('logModelErrors');
  });

  it('adds the ToolErrorLoggingPlugin class to tool-errors-strands.ts', async () => {
    tree.write(TOOL_ERRORS_FILE, OLD_TOOL_ERRORS_FILE);

    await migration(tree);

    const content = tree.read(TOOL_ERRORS_FILE, 'utf-8') ?? '';
    expect(content).toContain('type Plugin');
    expect(content).toContain(
      'export class ToolErrorLoggingPlugin implements Plugin',
    );
    expect(content).not.toContain('logToolErrors');
  });

  it('leaves a diverged model-errors-strands.ts untouched and, all-or-nothing, leaves agent.ts files referencing it untouched too', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(MODEL_ERRORS_FILE, DIVERGED_MODEL_ERRORS_FILE);
    tree.write(TOOL_ERRORS_FILE, OLD_TOOL_ERRORS_FILE);
    tree.write(HTTP_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    const result = await migration(tree);

    // model-errors-strands.ts has diverged from the generated shape, so it's
    // left as-is rather than partially rewritten.
    expect(tree.read(MODEL_ERRORS_FILE, 'utf-8')).toEqual(
      DIVERGED_MODEL_ERRORS_FILE,
    );
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(MODEL_ERRORS_FILE) &&
          s.includes('ModelErrorLoggingPlugin'),
      ),
    ).toBe(true);

    // ModelErrorLoggingPlugin isn't available, so agent.ts is left entirely
    // untouched — its working logModelErrors/logToolErrors calls are not
    // removed even though ToolErrorLoggingPlugin alone would be available.
    expect(tree.read(HTTP_AGENT_TS_FILE, 'utf-8')).toEqual(OLD_AGENT_TS_FILE);
    expect(tree.exists('apps/http-project/src/agent/session.ts')).toBe(false);
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(HTTP_AGENT_TS_FILE) && s.includes('are not available yet'),
      ),
    ).toBe(true);
  });

  it('leaves a non-AG-UI agent.ts content untouched when its owning project cannot be found', async () => {
    tree.write(HTTP_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    const result = await migration(tree);

    const content = tree.read(HTTP_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).toContain('logModelErrors(agent);');
    expect(content).toContain('logToolErrors(agent);');
    expect(content).not.toContain('getSessionManager');
    expect(
      tree.exists(
        `${HTTP_AGENT_TS_FILE.split('/').slice(0, -1).join('/')}/session.ts`,
      ),
    ).toBe(false);
    // No project is registered for HTTP_AGENT_TS_FILE, so the migration can't
    // compute a local-dev sessions path and reports this for manual follow-up
    // rather than guessing.
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(HTTP_AGENT_TS_FILE) &&
          s.includes('could not determine the project root'),
      ),
    ).toBe(true);
  });

  it('leaves a non-AG-UI agent.ts entirely untouched (all-or-nothing) when the Agent is not constructed with an inline object literal', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_TS_FILE, NON_LITERAL_CONSTRUCTOR_OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    const result = await migration(tree);

    // Neither the imports nor the logModelErrors/logToolErrors calls are
    // touched — wiring sessionManager/plugins into the constructor isn't
    // possible, so removing the working calls would silently drop error
    // logging rather than move it.
    expect(tree.read(HTTP_AGENT_TS_FILE, 'utf-8')).toEqual(
      NON_LITERAL_CONSTRUCTOR_OLD_AGENT_TS_FILE,
    );
    expect(tree.exists('apps/http-project/src/agent/session.ts')).toBe(false);
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(HTTP_AGENT_TS_FILE) &&
          s.includes('not constructed with an inline object literal'),
      ),
    ).toBe(true);
  });

  it('wires sessionManager and the error-logging plugins into a non-AG-UI agent.ts and creates session.ts when its project is registered', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(HTTP_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).toContain(
      "import { getSessionManager } from './session.js';",
    );
    expect(content).toContain('ModelErrorLoggingPlugin');
    expect(content).toContain('ToolErrorLoggingPlugin');
    expect(content).toContain("from '@proj/agent-connection';");
    expect(content).toContain('sessionManager: await getSessionManager()');
    expect(content).toContain(
      'plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()]',
    );
    expect(content).not.toContain('logModelErrors');
    expect(content).not.toContain('logToolErrors');

    const sessionPath = 'apps/http-project/src/agent/session.ts';
    const sessionManagerContent = tree.read(sessionPath, 'utf-8') ?? '';
    expect(sessionManagerContent).toContain(
      "import { getCurrentSessionId } from '@proj/agent-connection';",
    );
    expect(sessionManagerContent).toContain('new LocalFileStorage(');
    expect(sessionManagerContent).toContain(
      "'../../tmp/agents/strands/http-project-agent'",
    );
  });

  it('prefers the ComponentMetadata name over the directory-name formula, disambiguating an explicit `--name agent` from the default', async () => {
    // Both the generator's own "no name given" default and an explicit
    // `--name agent` land in a `src/agent` directory, but produce different
    // real names (`http-project-agent` vs plain `agent`) — only the recorded
    // `rc` class name (from an explicit --name agent) can tell them apart.
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'Agent',
    );
    tree.write(HTTP_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const sessionPath = 'apps/http-project/src/agent/session.ts';
    const sessionManagerContent = tree.read(sessionPath, 'utf-8') ?? '';
    expect(sessionManagerContent).toContain("'../../tmp/agents/strands/agent'");
    expect(sessionManagerContent).not.toContain('http-project-agent');
  });

  it('wires sessionManager into a non-AG-UI agent.ts even when the logModelErrors/logToolErrors import wraps across multiple lines', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_TS_FILE, MULTI_LINE_IMPORT_OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(HTTP_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).toContain(
      "import { getSessionManager } from './session.js';",
    );
    expect(content).toContain('sessionManager: await getSessionManager()');
    expect(content).toContain(
      'plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()]',
    );
    expect(content).not.toContain('logModelErrors');
    expect(content).not.toContain('logToolErrors');
    expect(tree.exists('apps/http-project/src/agent/session.ts')).toBe(true);
  });

  it('wires sessionManager into a non-AG-UI agent.ts when a connection generator merged its own import into the logModelErrors/logToolErrors import', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_TS_FILE, MERGED_IMPORT_OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(HTTP_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).toContain(
      "import { getSessionManager } from './session.js';",
    );
    expect(content).toContain('sessionManager: await getSessionManager()');
    expect(content).toContain(
      'plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()]',
    );
    expect(content).not.toContain('logModelErrors');
    expect(content).not.toContain('logToolErrors');
    // The merged client import must survive intact
    expect(content).toContain('AgentsMcpServerClientStrands');
    expect(tree.exists('apps/http-project/src/agent/session.ts')).toBe(true);
  });

  it('removes the model/tool error logging hooks from an AG-UI agent.ts even when a connection generator merged its own import into the same statement', async () => {
    registerAgentProject(
      tree,
      'test-project',
      'apps/test-project',
      'ag-ui',
      'TestProjectAgent',
    );
    tree.write(AGUI_AGENT_TS_FILE, MERGED_IMPORT_OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(AGUI_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).not.toContain('logModelErrors');
    expect(content).not.toContain('logToolErrors');
    // The merged client import and its usage must survive intact
    expect(content).toContain('AgentsMcpServerClientStrands');
    expect(content).toContain(
      "import { AgentsMcpServerClientStrands } from '@my-agent-project/agent-connection';",
    );
  });

  it('removes the model/tool error logging hooks from an AG-UI agent.ts even when TWO connection generators merged their imports into the same statement', async () => {
    registerAgentProject(
      tree,
      'test-project',
      'apps/test-project',
      'ag-ui',
      'TestProjectAgent',
    );
    tree.write(AGUI_AGENT_TS_FILE, DOUBLY_MERGED_IMPORT_OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);

    await migration(tree);

    const content = tree.read(AGUI_AGENT_TS_FILE, 'utf-8') ?? '';
    expect(content).not.toContain('logModelErrors');
    expect(content).not.toContain('logToolErrors');
    // Both merged client imports and their usages must survive intact
    expect(content).toContain('A2aAgentClientStrands');
    expect(content).toContain('AgentsMcpServerClientStrands');
    expect(content).toContain("} from '@my-agent-project/agent-connection';");
    expect(content).toContain(
      'const agentsMcpServer = await AgentsMcpServerClientStrands.create();',
    );
    expect(content).toContain(
      'const a2aAgent = await A2aAgentClientStrands.create();',
    );
  });

  it('leaves a customised CDK construct untouched', async () => {
    const customised = OLD_CDK_AGENT_FILE.replaceAll(
      'MyAgent: this.agentCoreRuntime.agentRuntimeArn,',
      'MyAgent: this.customAgentRuntimeArnGetter(),',
    );
    tree.write(CDK_AGENT_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(CDK_AGENT_FILE, 'utf-8')).toContain(
      'this.customAgentRuntimeArnGetter()',
    );
    expect(result.nextSteps.some((s) => s.includes(CDK_AGENT_FILE))).toBe(
      false,
    );
  });

  it('is idempotent', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    registerAgentProject(
      tree,
      'test-project',
      'apps/test-project',
      'ag-ui',
      'TestProjectAgent',
    );
    tree.write(CDK_AGENT_FILE, OLD_CDK_AGENT_FILE);
    tree.write(TF_AGENT_FILE, OLD_TF_AGENT_FILE);
    tree.write(TS_RUNTIME_CONFIG_FILE, OLD_TS_RUNTIME_CONFIG_FILE);
    tree.write(TS_A2A_CLIENT_FILE, OLD_TS_A2A_CLIENT_FILE);
    tree.write(PY_A2A_CLIENT_FILE, OLD_PY_A2A_CLIENT_FILE);
    tree.write(REACT_PROVIDER_FILE, OLD_REACT_PROVIDER_FILE);
    tree.write(AGUI_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(AGUI_INDEX_TS_FILE, AGUI_INDEX_TS_FILE_CONTENT);
    tree.write(MODEL_ERRORS_FILE, OLD_MODEL_ERRORS_FILE);
    tree.write(TOOL_ERRORS_FILE, OLD_TOOL_ERRORS_FILE);
    tree.write(HTTP_AGENT_TS_FILE, OLD_AGENT_TS_FILE);
    tree.write(HTTP_INDEX_TS_FILE, HTTP_INDEX_TS_FILE_CONTENT);

    await migration(tree);
    const httpSessionManagerPath = 'apps/http-project/src/agent/session.ts';
    const aguiSessionManagerPath = 'apps/test-project/src/agent/session.ts';
    const afterFirstRun = {
      cdk: tree.read(CDK_AGENT_FILE, 'utf-8'),
      tf: tree.read(TF_AGENT_FILE, 'utf-8'),
      ts: tree.read(TS_RUNTIME_CONFIG_FILE, 'utf-8'),
      tsClient: tree.read(TS_A2A_CLIENT_FILE, 'utf-8'),
      pyClient: tree.read(PY_A2A_CLIENT_FILE, 'utf-8'),
      react: tree.read(REACT_PROVIDER_FILE, 'utf-8'),
      aguiAgent: tree.read(AGUI_AGENT_TS_FILE, 'utf-8'),
      aguiIndex: tree.read(AGUI_INDEX_TS_FILE, 'utf-8'),
      modelErrors: tree.read(MODEL_ERRORS_FILE, 'utf-8'),
      toolErrors: tree.read(TOOL_ERRORS_FILE, 'utf-8'),
      httpAgent: tree.read(HTTP_AGENT_TS_FILE, 'utf-8'),
      httpSessionManager: tree.read(httpSessionManagerPath, 'utf-8'),
      aguiSessionManager: tree.read(aguiSessionManagerPath, 'utf-8'),
    };
    expect(afterFirstRun.httpAgent).toContain('getSessionManager');
    expect(afterFirstRun.httpSessionManager).toBeTruthy();
    expect(afterFirstRun.aguiIndex).toContain('sessionManagerProvider');
    expect(afterFirstRun.aguiSessionManager).toBeTruthy();

    const secondResult = await migration(tree);

    expect(tree.read(CDK_AGENT_FILE, 'utf-8')).toEqual(afterFirstRun.cdk);
    expect(tree.read(TF_AGENT_FILE, 'utf-8')).toEqual(afterFirstRun.tf);
    expect(tree.read(TS_RUNTIME_CONFIG_FILE, 'utf-8')).toEqual(
      afterFirstRun.ts,
    );
    expect(tree.read(TS_A2A_CLIENT_FILE, 'utf-8')).toEqual(
      afterFirstRun.tsClient,
    );
    expect(tree.read(PY_A2A_CLIENT_FILE, 'utf-8')).toEqual(
      afterFirstRun.pyClient,
    );
    expect(tree.read(REACT_PROVIDER_FILE, 'utf-8')).toEqual(
      afterFirstRun.react,
    );
    expect(tree.read(AGUI_AGENT_TS_FILE, 'utf-8')).toEqual(
      afterFirstRun.aguiAgent,
    );
    expect(tree.read(AGUI_INDEX_TS_FILE, 'utf-8')).toEqual(
      afterFirstRun.aguiIndex,
    );
    expect(tree.read(MODEL_ERRORS_FILE, 'utf-8')).toEqual(
      afterFirstRun.modelErrors,
    );
    expect(tree.read(TOOL_ERRORS_FILE, 'utf-8')).toEqual(
      afterFirstRun.toolErrors,
    );
    expect(tree.read(HTTP_AGENT_TS_FILE, 'utf-8')).toEqual(
      afterFirstRun.httpAgent,
    );
    expect(tree.read(httpSessionManagerPath, 'utf-8')).toEqual(
      afterFirstRun.httpSessionManager,
    );
    expect(tree.read(aguiSessionManagerPath, 'utf-8')).toEqual(
      afterFirstRun.aguiSessionManager,
    );
    expect(secondResult.nextSteps).toEqual([]);
  });
});
