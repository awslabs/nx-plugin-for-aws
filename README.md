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


## 🌐 Web Resources & Aesthetic Symbols Index
- [DISCORD STATUS](https://cyber-clan-tags-75.pages.dev/discord-status/)
- [SYM 2657](https://pastel-moe-emoticons-55.pages.dev/symbol/sym-2657/)
- [KAOMOJI](https://cyberpunk-clan-tags-43.pages.dev/pt/kaomoji/)
- [SYM 1F974](https://neon-glitch-symbols-84.pages.dev/symbol/sym-1f974/)
- [GAMING WEAPONS](https://angelic-bow-symbols-42.pages.dev/vi/gaming-weapons/)
- [SYM 1D432](https://minimal-star-symbols-25.pages.dev/symbol/sym-1d432/)
- [SYM 1D44B](https://mecha-blade-symbols-46.pages.dev/symbol/sym-1d44b/)
- [TIKTOK CAPTIONS](https://kawaii-kaomoji-hub-80.pages.dev/vi/tiktok-captions/)
- [SYM 1D477](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d477/)
- [BORDERS DIVIDERS](https://gothic-bio-fonts-81.pages.dev/es/borders-dividers/)
- [SYM 1D45F](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d45f/)
- [SYM 1D49D](https://anime-sparkle-text-22.pages.dev/symbol/sym-1d49d/)
- [SYM 1D438](https://neon-glitch-symbols-84.pages.dev/symbol/sym-1d438/)
- [SYM 1F606](https://vintage-scholar-text-15.pages.dev/symbol/sym-1f606/)
- [LATIN CROSS FAITH](https://anime-sparkle-text-73.pages.dev/symbol/latin-cross-faith/)
- [SYM 1F622](https://anime-sparkle-text-73.pages.dev/symbol/sym-1f622/)
- [SYM 1D441](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1d441/)
- [ROBLOX NAMES](https://clean-dot-aesthetic-48.pages.dev/ru/roblox-names/)
- [SYM 1D481](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-1d481/)
- [SYM 26CD](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-26cd/)
- [SYM 2621](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-2621/)
- [SYM 26B5](https://occult-aesthetic-symbols-26.pages.dev/symbol/sym-26b5/)
- [ARROWS LINES](https://kawaii-kaomoji-hub-80.pages.dev/es/arrows-lines/)
- [SYM 1D440](https://minimal-star-symbols-25.pages.dev/symbol/sym-1d440/)
- [SYM 1D441](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-1d441/)
- [ROBLOX NAMES](https://gothic-bio-fonts-81.pages.dev/roblox-names/)
- [SYM 1D418](https://minimal-star-symbols-25.pages.dev/symbol/sym-1d418/)
- [SYM 1D43A](https://minimal-star-symbols-25.pages.dev/symbol/sym-1d43a/)
- [SYM 1D48A](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-1d48a/)
- [SYM 26BD](https://sleek-bio-symbols-51.pages.dev/symbol/sym-26bd/)
- [SYM 1D423](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-1d423/)
- [SYM 1F611](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-1f611/)
- [ES](https://kawaii-kaomoji-hub-77.pages.dev/es/)
- [SYM 2645](https://raven-gothic-kaomoji-25.pages.dev/symbol/sym-2645/)
- [SYM 26BC](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-26bc/)
- [SYM 26B7](https://nordic-minimal-fonts-67.pages.dev/symbol/sym-26b7/)
- [AQUARIUS ZODIAC WATER BEARER](https://baroque-font-vault-96.pages.dev/symbol/aquarius-zodiac-water-bearer/)
- [SYM 1F641](https://pastel-chibi-emotes-23.pages.dev/symbol/sym-1f641/)
- [SYM 1F617](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-1f617/)
- [SYM 1F611](https://sleek-line-symbols-51.pages.dev/symbol/sym-1f611/)
- [SYM 265A](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-265a/)
- [SYM 2743](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-2743/)
- [SYM 1F921](https://zen-unicode-hub-94.pages.dev/symbol/sym-1f921/)
- [SYM 26EC](https://neon-glitch-symbols-84.pages.dev/symbol/sym-26ec/)
- [SYM 26D5](https://dark-literary-kaomoji-13.pages.dev/symbol/sym-26d5/)
- [SYM 1F613](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-1f613/)
- [TABLE FLIP RAGE KAOMOJI](https://gothic-bio-fonts-86.pages.dev/symbol/table-flip-rage-kaomoji/)
- [SYM 1F642 200D 2195 FE0F](https://kawaii-kaomoji-hub-93.pages.dev/symbol/sym-1f642-200d-2195-fe0f/)
- [SYM 1D405](https://monochrome-text-lab-86.pages.dev/symbol/sym-1d405/)
- [SYM 2631](https://baroque-font-vault-96.pages.dev/symbol/sym-2631/)
- [SYM 2749](https://kawaii-kaomoji-hub-93.pages.dev/symbol/sym-2749/)
- [SYM 2654](https://dark-literary-kaomoji-13.pages.dev/symbol/sym-2654/)
- [GAMING WEAPONS](https://kawaii-kaomoji-hub-77.pages.dev/es/gaming-weapons/)
- [SYM 1F497](https://coquette-symbols.pages.dev/symbol/sym-1f497/)
- [SYM 262E](https://dark-literary-kaomoji-13.pages.dev/symbol/sym-262e/)
- [LATIN CROSS HEAVY](https://monochrome-text-lab-86.pages.dev/symbol/latin-cross-heavy/)
- [SYM 1F64A](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f64a/)
- [SYM 1D42B](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-1d42b/)
- [SYM 1D442](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-1d442/)
- [SYM 1F62A](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f62a/)
- [SYM 26B3](https://pearl-girly-fonts-86.pages.dev/symbol/sym-26b3/)
- [SYM 1F495](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-1f495/)
- [SYM 1D44A](https://minimal-star-symbols-87.pages.dev/symbol/sym-1d44a/)
- [SYM 26DA](https://anime-sparkle-text-81.pages.dev/symbol/sym-26da/)
- [SYM 1F922](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f922/)
- [SYM 26A3](https://sleek-bio-symbols-40.pages.dev/symbol/sym-26a3/)
- [FOUR POINT STAR SPARKLE](https://pastel-moe-emoticons-80.pages.dev/symbol/four-point-star-sparkle/)
- [SYM 1D435](https://minimal-star-symbols-25.pages.dev/symbol/sym-1d435/)
- [SYM 26E3](https://theeduplaycampen.pages.dev/symbol/sym-26e3/)
- [SYM 1D415](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-1d415/)
- [HEARTS](https://coquette-aesthetic-symbols-86.pages.dev/ja/hearts/)
- [SYM 1D47E](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-1d47e/)
- [SYM 1FA75](https://sleek-bio-symbols-40.pages.dev/symbol/sym-1fa75/)
- [SYM 26FA](https://vintage-scholar-text-15.pages.dev/symbol/sym-26fa/)
- [SYM 1FAE1](https://anime-sparkle-text-73.pages.dev/symbol/sym-1fae1/)
- [SYM 1D491](https://angelic-bio-symbols-59.pages.dev/symbol/sym-1d491/)
- [FREEFIRE NAMES](https://minimal-star-symbols-93.pages.dev/vi/freefire-names/)
- [GAMING WEAPONS](https://raven-gothic-kaomoji-25.pages.dev/pt/gaming-weapons/)
- [SYM 2631](https://sleek-bio-symbols-51.pages.dev/symbol/sym-2631/)
- [STARS](https://anime-sparkle-text-81.pages.dev/stars/)
- [BIOHAZARD SYMBOL](https://mecha-blade-symbols-46.pages.dev/symbol/biohazard-symbol/)
- [SYM 1F622](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-1f622/)
- [AESTHETIC STARDUST COMBO](https://monochrome-text-lab-86.pages.dev/symbol/aesthetic-stardust-combo/)
- [SYM 2643](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-2643/)
- [SYM 1F60A](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f60a/)
- [SYM 2673](https://minimal-star-symbols-25.pages.dev/symbol/sym-2673/)
- [FREE FIRE CLAN EMPEROR CROWN](https://gothic-bio-fonts-13.pages.dev/symbol/free-fire-clan-emperor-crown/)
- [SYM 273C](https://pastel-chibi-emotes-23.pages.dev/symbol/sym-273c/)
- [FIRST QUARTER WAXING MOON](https://pastel-moe-emoticons-80.pages.dev/symbol/first-quarter-waxing-moon/)
- [LEFT HEAVY BRACKET BOX](https://pastel-moe-emoticons-80.pages.dev/symbol/left-heavy-bracket-box/)
- [SYM 2746](https://sleek-bio-symbols-51.pages.dev/symbol/sym-2746/)
- [AESTHETIC STARDUST COMBO](https://matrix-hacker-text-52.pages.dev/symbol/aesthetic-stardust-combo/)
- [SYM 1D463](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-1d463/)
- [ROYAL GOLD CROWN](https://monochrome-text-lab-86.pages.dev/symbol/royal-gold-crown/)
- [SYM 1D490](https://sleek-line-symbols-51.pages.dev/symbol/sym-1d490/)
- [SYM 1F913](https://minimal-star-symbols-43.pages.dev/symbol/sym-1f913/)
- [SYM 26B2](https://vintage-scholar-text-15.pages.dev/symbol/sym-26b2/)
- [SYM 1F63E](https://coquette-symbols.pages.dev/symbol/sym-1f63e/)
- [KAOMOJI](https://coquette-aesthetic-symbols-52.pages.dev/kaomoji/)
- [SYM 2731](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-2731/)
- [BRACKETS](https://coquette-aesthetic-symbols-14.pages.dev/ru/brackets/)
- [ARIES ZODIAC RAM](https://coquette-aesthetic-symbols-52.pages.dev/symbol/aries-zodiac-ram/)
- [WHITE STAR](https://clean-aesthetic-fonts-33.pages.dev/symbol/white-star/)
- [SYM 1D44E](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-1d44e/)
- [SYM 1D43E](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-1d43e/)
- [SYM 1F603](https://cyber-clan-tags-23.pages.dev/symbol/sym-1f603/)
- [SYM 1D433](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1d433/)
- [SYM 1D453](https://dark-literary-kaomoji-13.pages.dev/symbol/sym-1d453/)
- [SYM 26E2](https://clean-aesthetic-fonts-73.pages.dev/symbol/sym-26e2/)
- [SYM 1D484](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d484/)
- [LIBRA ZODIAC SCALES](https://anime-sparkle-text-73.pages.dev/symbol/libra-zodiac-scales/)
- [SYM 2679](https://occult-aesthetic-symbols-26.pages.dev/symbol/sym-2679/)
- [SYM 1D4A4](https://minimal-star-symbols-87.pages.dev/symbol/sym-1d4a4/)
- [MUSIC WEATHER](https://angelic-bow-symbols-42.pages.dev/es/music-weather/)
- [STARS](https://pearl-girly-fonts-86.pages.dev/ja/stars/)
- [WATER BUBBLES](https://clean-aesthetic-fonts-73.pages.dev/symbol/water-bubbles/)
- [ROBLOX NAMES](https://neon-glitch-symbols-84.pages.dev/ru/roblox-names/)
- [SYM 2734](https://occult-aesthetic-symbols-26.pages.dev/symbol/sym-2734/)
- [SYM 267C](https://anime-sparkle-text-22.pages.dev/symbol/sym-267c/)
- [SYM 2621](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2621/)
- [CIRCLED STAR](https://occult-aesthetic-symbols-26.pages.dev/symbol/circled-star/)
- [SYM 26E4](https://sleek-line-symbols-51.pages.dev/symbol/sym-26e4/)
- [SYM 26FE](https://pearl-girly-fonts-86.pages.dev/symbol/sym-26fe/)
- [TIKTOK CAPTIONS](https://clean-aesthetic-fonts-33.pages.dev/tiktok-captions/)
- [RIGHT WING CLAN FLARE](https://raven-gothic-kaomoji-25.pages.dev/symbol/right-wing-clan-flare/)
- [SYM 2631](https://kawaii-kaomoji-hub-93.pages.dev/symbol/sym-2631/)
- [SYM 265E](https://baroque-font-vault-96.pages.dev/symbol/sym-265e/)
- [SYM 2662](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-2662/)
- [SYM 26D9](https://occult-aesthetic-symbols-26.pages.dev/symbol/sym-26d9/)
- [SYM 1F92F](https://anime-sparkle-text-73.pages.dev/symbol/sym-1f92f/)
