<div align="center">
  <h1>Nx Plugin for AWS</h1>
  <h3>Build full-stack AWS apps in minutes</h3>
  <a href="https://opensource.org/licenses/Apache-2.0">
    <img
      src="https://img.shields.io/badge/License-Apache%202.0-yellowgreen.svg"
      alt="Apache 2.0 License"
    />
  </a>
  <a href="https://codecov.io/gh/awslabs/nx-plugin-for-aws">
    <img src="https://codecov.io/gh/awslabs/nx-plugin-for-aws/graph/badge.svg?token=X27pgFfxuQ" />
  </a>
  <a href="https://github.com/awslabs/nx-plugin-for-aws/actions/workflows/ci.yml">
    <img
      src="https://github.com/awslabs/nx-plugin-for-aws/actions/workflows/ci.yml/badge.svg"
      alt="Release badge"
    />
  </a>
  <a href="https://github.com/awslabs/nx-plugin-for-aws/commits/main">
    <img
      src="https://img.shields.io/github/commit-activity/w/awslabs/nx-plugin-for-aws"
      alt="Commit activity"
    />
  </a>
</div>

---

**@aws/nx-plugin** is a collection of code generators that scaffold full-stack, production-ready AWS applications inside an [Nx](https://nx.dev) monorepo. Every generator produces best-practice application code **and** the infrastructure to deploy it — type-safe, locally runnable, and ready to deploy.

## Quick Start

### Build with AI

Add the MCP server to your AI assistant and let it build for you.

```bash
claude mcp add nx-plugin-for-aws -- npx -y @aws/nx-plugin-mcp
```

<details>
<summary><strong>Kiro</strong></summary>

Install the [Kiro Power](https://kiro.dev/docs/powers/) for the best experience — no manual MCP configuration needed:

1. Open the Kiro Powers panel from the sidebar
2. Click `+` to add a custom power
3. Paste: `https://github.com/awslabs/nx-plugin-for-aws/tree/main/powers/nx-plugin-for-aws`
4. Click install

Or add the MCP server manually in `.kiro/mcp.json`:

```json
{
  "mcpServers": {
    "nx-plugin-for-aws": {
      "command": "npx",
      "args": ["-y", "@aws/nx-plugin-mcp"]
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add nx-plugin-for-aws -- npx -y @aws/nx-plugin-mcp
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nx-plugin-for-aws": {
      "command": "npx",
      "args": ["-y", "@aws/nx-plugin-mcp"]
    }
  }
}
```

</details>

<details>
<summary><strong>Codex</strong></summary>

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.nx-plugin-for-aws]
command = "npx"
args = ["-y", "@aws/nx-plugin-mcp"]
```

</details>

<details>
<summary><strong>Other assistants</strong></summary>

Most MCP-compatible assistants use a JSON configuration file. Add the following entry:

```json
{
  "mcpServers": {
    "nx-plugin-for-aws": {
      "command": "npx",
      "args": ["-y", "@aws/nx-plugin-mcp"]
    }
  }
}
```

</details>

Then just ask:

> _"Use the Nx Plugin for AWS to build a full-stack app with a React website, a tRPC API, Cognito auth, and CDK infrastructure."_

Your AI assistant will use the MCP tools to scaffold, connect, and configure everything. See the [Building with AI guide](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/building-with-ai/) for more details.

### Build with the CLI

Create a workspace and start adding components — zero configuration required:

```bash
# Create a new workspace
pnpm create @aws/nx-workspace my-project
cd my-project

# Add a tRPC API
pnpm nx g @aws/nx-plugin:ts#trpc-api

# Add a Strands AI agent (Python)
pnpm nx g @aws/nx-plugin:py#strands-agent

# Add a React website
pnpm nx g @aws/nx-plugin:ts#react-website

# Add authentication to your website
pnpm nx g @aws/nx-plugin:ts#react-website#auth

# Connect your website to your API and agent
pnpm nx g @aws/nx-plugin:connection

# Add CDK infrastructure to deploy it all (or choose Terraform)
pnpm nx g @aws/nx-plugin:ts#infra
```

> See the full [Quick Start guide](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/quick-start) and [Dungeon Adventure tutorial](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/tutorials/dungeon-game/overview/) for a deeper walkthrough.

## Available Generators

| Generator               | Description                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ts#project`            | TypeScript library                                                                                                |
| `ts#trpc-api`           | tRPC API with API Gateway + Lambda + [Powertools](https://github.com/aws-powertools/powertools-lambda-typescript) |
| `ts#react-website`      | React app (Vite)                                                                                                  |
| `ts#react-website#auth` | Add Cognito auth to a React website                                                                               |
| `ts#infra`              | AWS CDK infrastructure project                                                                                    |
| `ts#lambda-function`    | TypeScript Lambda with type-safe event sources                                                                    |
| `ts#mcp-server`         | MCP server (TypeScript)                                                                                           |
| `ts#strands-agent`      | [Strands Agent](https://strandsagents.com/) (TypeScript)                                                          |
| `ts#nx-generator`       | Nx generator scaffold                                                                                             |
| `py#project`            | Python project (uv)                                                                                               |
| `py#fast-api`           | FastAPI with API Gateway + Lambda + [Powertools](https://github.com/aws-powertools/powertools-lambda-python)      |
| `py#lambda-function`    | Python Lambda with type-safe event sources                                                                        |
| `py#mcp-server`         | MCP server (Python)                                                                                               |
| `py#strands-agent`      | [Strands Agent](https://strandsagents.com/) (Python)                                                              |
| `connection`            | Connect projects together (e.g. frontend to API)                                                                  |
| `terraform#project`     | Terraform project                                                                                                 |
| `license`               | Manage LICENSE files and source headers                                                                           |

## Community

Join us on Slack in the [#nx-plugin-for-aws](https://cdk-dev.slack.com/archives/C0AG11EUHM4) channel to ask questions, share feedback, and connect with other users and contributors.

## Contributing

Read our [Contributing Guide](/CONTRIBUTING.md) to learn about our development process, how to propose bugfixes and improvements, and how to build and test your changes.

## Code of Conduct

This project has adopted a Code of Conduct that we expect project participants to adhere to. Please read the [Code of Conduct](/CODE_OF_CONDUCT.md) so that you can understand what actions will and will not be tolerated.

## License

@aws/nx-plugin is [Apache 2.0 licensed](/LICENSE).
