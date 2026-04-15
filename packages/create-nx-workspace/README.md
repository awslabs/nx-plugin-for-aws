# @aws/create-nx-workspace

The quickest way to start building on AWS with the [Nx Plugin for AWS](https://github.com/awslabs/nx-plugin-for-aws).

## Getting Started

```bash
pnpm create @aws/nx-workspace my-project
```

This creates a new [Nx](https://nx.dev) workspace pre-configured with the [`@aws/nx-plugin`](https://www.npmjs.com/package/@aws/nx-plugin) preset — giving you access to generators for building full-stack AWS applications with TypeScript, Python, React, CDK, Terraform, and more.

<details>
<summary>Using another package manager?</summary>

```bash
# npm
npm create @aws/nx-workspace -- my-project

# yarn
yarn create @aws/nx-workspace my-project

# bun
bun create @aws/nx-workspace my-project
```

</details>

## What's Included

The Nx Plugin for AWS provides generators for:

- **APIs** — tRPC, FastAPI, Smithy
- **Websites** — React with Cloudscape or Shadcn
- **Infrastructure** — AWS CDK and Terraform
- **AI** — Strands Agents, MCP Servers
- **And more** — Lambda functions, Nx plugins, license management

## Learn More

- [Documentation](https://awslabs.github.io/nx-plugin-for-aws/)
- [GitHub](https://github.com/awslabs/nx-plugin-for-aws)

## License

Apache-2.0
