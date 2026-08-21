# Instructions for Claude

@CLAUDE.private.md

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

## Sandbox Deploy Environment Notes

Gotchas specific to the remote agent sandbox, not the generator design — recorded so deploy/e2e validation doesn't rediscover them each time:

- **`npm_config_virtual_store_dir`** may already be set globally to a path outside the current project, which breaks pnpm's virtual store layout and causes ESM upward `node_modules` resolution failures (e.g. `Cannot find package 'typescript'` from a nested dependency). Override it to a project-local path for every `pnpm`/`nx` invocation, e.g. `npm_config_virtual_store_dir=node_modules/.pnpm pnpm install`.
- **Low `ulimit -n`** can cause `EMFILE` errors on file-heavy targets (e.g. the docs build). Raise it before running such targets.
- **`node-pty`'s native build** (a root devDependency) needs `python3`, `make`, `g++` — run `apt-get install -y python3 make g++` before `pnpm install` if it fails on this step.
- **The `aws-cdk` CLI's bundled `SdkProvider`** can fail with `Could not load credentials from any providers` even when the standard SDK default credential chain (`aws sts get-caller-identity`, `@aws-sdk/credential-provider-node`) resolves fine from the same sandbox. Work around it by resolving credentials once via `defaultProvider()` and exporting them as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` for the `cdk deploy` subprocess. Also export `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION` explicitly — the generated CDK app's `main.ts` reads them directly and they aren't set by default in this sandbox.
- **This sandbox's `fetch()`/undici stack reports inflated latencies** for streaming responses (e.g. 25–30s for requests that server-side traces show completing in ~150ms). For accurate client-side timing measurements, use Node's raw `https.request` instead.

## Best Practices

- Always ensure the build passes before raising a PR.
- Update snapshots if there are failures due to snapshot changes.
- Use conventional commits, referencing the generator you are working on, eg "feat(ts#project): my commit message".
- Raise PRs following the PR template.
- After pushing to a PR, monitor the checks and iterate on any failures until all are green.

