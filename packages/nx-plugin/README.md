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
  <p>
    <a href="https://awslabs.github.io/nx-plugin-for-aws/"><b>Documentation Site</b></a>
  </p>
</div>

---

**@aws/nx-plugin** is a collection of code generators that scaffold full-stack AWS applications inside an [Nx](https://nx.dev) monorepo. Every generator produces best-practice application code **and** the infrastructure to deploy it — type-safe, locally runnable, and deployable from the start, getting you closer to production.

<div align="center">
  <img
    src="https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/main/docs/src/content/docs/assets/nx-plugin-showcase-desktop-dark.gif"
    alt="Scaffolding, running and deploying a full-stack AWS application with the Nx Plugin for AWS"
    width="900"
  />
</div>

## Quick Start

### Build with AI

**1. Create a workspace**

```bash
pnpm create @aws/nx-workspace my-project
cd my-project
```

**2. Open your AI assistant in the created workspace and prompt it**

> _"Use the Nx Plugin for AWS to build a full-stack application consisting of a React website with shadcn and Cognito authentication, connected to a TypeScript Strands agent via the AG-UI protocol, and infrastructure to deploy it."_

Your AI assistant will use the Nx Plugin for AWS MCP server, which is preconfigured in every workspace you create with the command above, to scaffold, connect, and configure everything. See the [Building with AI guide](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/building-with-ai/) for more details.

### Build with the CLI

Create a workspace and start adding components — zero configuration required:

```bash
# Create a new workspace
pnpm create @aws/nx-workspace my-project
cd my-project

# Add a tRPC API
pnpm nx g @aws/nx-plugin:ts#api --framework=trpc

# Add a Strands AI agent (Python)
pnpm nx g @aws/nx-plugin:py#agent

# Add a React website
pnpm nx g @aws/nx-plugin:ts#website --framework=react

# Add authentication to your website
pnpm nx g @aws/nx-plugin:ts#website#auth

# Connect your website to your API and agent
pnpm nx g @aws/nx-plugin:connection

# Add CDK infrastructure to deploy it all (or choose Terraform)
pnpm nx g @aws/nx-plugin:ts#infra
```

> See the full [Quick Start guide](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/quick-start) and [Dungeon Adventure tutorial](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/tutorials/dungeon-game/overview/) for a deeper walkthrough.

## Available Generators

| Generator            | Description                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `init`               | Configure an existing Nx workspace to use the plugin                                                                                     |
| `ts#project`         | TypeScript library                                                                                                                       |
| `ts#api`             | TypeScript API (tRPC or Smithy) with API Gateway + Lambda + [Powertools](https://github.com/aws-powertools/powertools-lambda-typescript) |
| `ts#rdb`             | Relational databases with Aurora RDS                                                                                                     |
| `ts#dynamodb`        | Type-safe DynamoDB single-table design (TypeScript, ElectroDB)                                                                           |
| `ts#website`         | React app (Vite)                                                                                                                         |
| `ts#website#auth`    | Add Cognito auth to a website                                                                                                            |
| `ts#infra`           | AWS CDK infrastructure project                                                                                                           |
| `ts#lambda-function` | TypeScript Lambda with type-safe event sources                                                                                           |
| `ts#mcp-server`      | MCP server (TypeScript)                                                                                                                  |
| `ts#dcr-proxy`       | OAuth DCR proxy construct for Cognito-authenticated MCP servers                                                                          |
| `ts#agent`           | [Strands Agent](https://strandsagents.com/) (TypeScript)                                                                                 |
| `ts#nx-generator`    | Nx generator scaffold                                                                                                                    |
| `ts#docs`            | Documentation site (Astro + Starlight)                                                                                                   |
| `smithy#project`     | Smithy model project — a service model, or a shape library shared between Smithy projects                                                |
| `py#project`         | Python project (uv)                                                                                                                      |
| `py#api`             | Python API (FastAPI) with API Gateway + Lambda + [Powertools](https://github.com/aws-powertools/powertools-lambda-python)                |
| `py#rdb`             | Relational databases with Aurora RDS (Python)                                                                                            |
| `py#dynamodb`        | Python DynamoDB project                                                                                                                   |
| `py#lambda-function` | Python Lambda with type-safe event sources                                                                                               |
| `py#mcp-server`      | MCP server (Python)                                                                                                                      |
| `py#agent`           | [Strands Agent](https://strandsagents.com/) (Python)                                                                                     |
| `agentcore-gateway`  | [AgentCore Gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html) project                                  |
| `agentcore-harness`  | [AgentCore Harness](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness.html) agent loop (experimental)                |
| `connection`         | Connect projects together (e.g. frontend to API)                                                                                         |
| `terraform#project`  | Terraform project                                                                                                                        |
| `license`            | Manage LICENSE files and source headers                                                                                                  |

## Community

Join us on Slack in the [#nx-plugin-for-aws](https://cdk-dev.slack.com/archives/C0AG11EUHM4) channel to ask questions, share feedback, and connect with other users and contributors.

## Contributing

Read our [Contributing Guide](/CONTRIBUTING.md) to learn about our development process, how to propose bugfixes and improvements, and how to build and test your changes.

## Code of Conduct

This project has adopted a Code of Conduct that we expect project participants to adhere to. Please read the [Code of Conduct](/CODE_OF_CONDUCT.md) so that you can understand what actions will and will not be tolerated.

## License

@aws/nx-plugin is [Apache 2.0 licensed](/LICENSE).
