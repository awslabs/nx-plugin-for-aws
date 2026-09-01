# Instructions for Claude

## Required Reading

Read the following before making changes:

- [CONTRIBUTING.md](./CONTRIBUTING.md) — the authoritative guide for generator idempotency, testing expectations, writing documentation, and the PR process.
- [Contributing a Generator tutorial](./docs/src/content/docs/en/get_started/tutorials/contribute-generator.mdx) — how to build a generator end to end, including working backwards from a real project to inform the generator changes.

## Commands

Install dependencies:

```bash
pnpm i
```

Build:

```bash
pnpm nx run-many --target build --all
```

Run tests and update snapshots:

```bash
pnpm nx run @aws/nx-plugin:test -u
```

## Tips

- Always use `npx -y` (not bare `npx`) to avoid the "Ok to proceed?" prompt hanging in non-interactive environments.

## Code Style

- Keep comments succinct and always describe the current state — never include historical context or changelog-style notes.
- Comments in generated/template files should be minimal.
- Use the existing codebase to inform code style, testing style, etc.

## Testing Changes End-to-End

Before raising a PR, validate changed generators in an example workspace using locally compiled versions:

- Consult the Nx Plugin for AWS MCP server (`create-workspace-command`, `list-generators`, `generator-guide`, `general-guidance`) as the baseline for creating workspaces and running generators. Expect deviations driven by the local changes under test.
- Make the locally compiled packages available to the workspace — either publish them to a local Verdaccio registry, or use `pnpm link`.
- Create a fresh workspace, then invoke the relevant changed generators with the locally compiled versions.
- Confirm everything builds and runs locally, including the `dev` target.
- If the change warrants it, deploy to AWS, test there, then tear down all provisioned resources.

## Best Practices

- Always ensure the build passes before raising a PR.
- Update snapshots if there are failures due to snapshot changes.
- Use conventional commits, referencing the generator you are working on, eg "feat(ts#project): my commit message".
- Raise PRs following the PR template.
- After pushing to a PR, monitor the checks and iterate on any failures until all are green.
