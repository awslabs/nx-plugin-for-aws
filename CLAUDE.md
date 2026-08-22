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
- **The `aws-cdk` CLI's bundled `SdkProvider`** can fail with `Could not load credentials from any providers` even when the standard SDK default credential chain (`aws sts get-caller-identity`, `@aws-sdk/credential-provider-node`) resolves fine from the same sandbox. Work around it by exporting the resolved credentials as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` for the `cdk deploy` subprocess — the simplest way is `eval "$(aws configure export-credentials --format env)"` (equivalent to resolving via `@aws-sdk/credential-provider-node`'s `defaultProvider()` and exporting by hand). Also export `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION` explicitly — the generated CDK app's `main.ts` reads them directly and they aren't set by default in this sandbox.
- **This sandbox's `fetch()`/undici stack reports inflated latencies** for streaming responses (e.g. 25–30s for requests that server-side traces show completing in ~150ms). For accurate client-side timing measurements, use Node's raw `https.request` instead.
- **`/mnt/workspace` has a small, real disk quota** (~1GB) despite `df` reporting `0` used and the mount looking otherwise empty — a full monorepo `pnpm i` (multiple GB of `node_modules`) will hit `ENOSPC` partway through. Keep the git checkout at `/mnt/workspace/...` (small, since it's just source), but do `pnpm i` / builds / test runs / scaffolded e2e workspaces from a plain copy on the roomier container root filesystem (e.g. `/root/work/...`, `tar`'d over excluding `node_modules` and `.git`) — that filesystem has several GB free. Sync specific changed paths back to the `/mnt/workspace` git checkout (also via `tar`) before committing.
- **`uvx`/`uv` are not preinstalled** in this sandbox, so any target that shells out to them (e.g. the generated infra project's `checkov` target, or `ruff`-based Python lint tests) fails with `uvx: not found` / `spawnSync uvx ENOENT` — install with `curl -LsSf https://astral.sh/uv/install.sh | sh` (installs to `~/.local/bin`) before running such targets.
- **A `cdk` subprocess killed by a tool/shell timeout can leave a stale `read.<pid>.<n>.lock` file** under `dist/<infra-project>/cdk.out`, which makes the next `cdk deploy`/`synth` fail with `Other CLIs (PID=...) are currently reading from .../cdk.out`. Delete the stale lock file (`rm dist/**/cdk.out/read.*.lock`) and retry — it does not indicate a real concurrent process. Run `cdk deploy` as a backgrounded command with a generous timeout rather than a foreground command capped at a short timeout, to avoid triggering this in the first place.
- **`scaffold-catalog.integration.spec.ts` and any in-process run of `internal#test-matrix` are flaky in this sandbox specifically for the `@nx/js`-backed generators (`ts#project`, `ts#website`, `ts#api`, `ts#infra`, …)** — they intermittently throw `TypeError: Cannot read properties of null (reading 'version')` from `@nx/js`'s `library.js`, which does `require(join('@nx/js', 'package.json')).version` to read its own version. This reproduces non-deterministically even for connections already on `main` (confirmed on the plain `ts#react-website -> ts#trpc-api` pair, not just newly-added ones) and even at the very first `@nx/js`-backed generator call in a test run — a race in this sandbox's pnpm store/self-reference resolution under Vitest, not a generator defect. It is not fixed by `pnpm install --frozen-lockfile`, by running via `nx run @aws/nx-plugin:test` instead of bare `vitest`, or by warming the module cache with an earlier passing test in the same file. Workaround: treat any test hitting these generators as unreliable in this sandbox and don't gate a PR on it — rely on the generator-scoped unit/snapshot tests instead (they don't hit this code path), and note in the PR body which broader matrix/integration tests could not be verified here and why.

## Best Practices

- Always ensure the build passes before raising a PR.
- Update snapshots if there are failures due to snapshot changes.
- Use conventional commits, referencing the generator you are working on, eg "feat(ts#project): my commit message".
- Raise PRs following the PR template.
- After pushing to a PR, monitor the checks and iterate on any failures until all are green.

