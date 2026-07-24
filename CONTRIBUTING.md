# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

- A reproducible test case or series of steps
- The version of our code being used
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the _main_ branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository, and install dependencies `pnpm i`
1. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
1. Run tests `pnpm nx run @aws/nx-plugin:test`
1. (Optional) Update snapshots if required `pnpm nx run @aws/nx-plugin:test -u`
1. Ensure local tests pass (run a full build with `pnpm nx run-many --target build --all`).
1. Update and run any integration tests relevant to your changes.
1. Commit to your fork using clear commit messages ([see section below](#end-to-end-tests))
1. Send us a pull request, answering any default questions in the pull request interface.
1. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

For a detailed guide on contributing a generator, check out the [Contributing a Generator tutorial here](https://awslabs.github.io/nx-plugin-for-aws/get_started/tutorials/contribute-generator).

### Generator Idempotency

Users re-run generators all the time: to add a second API, to recover from a failed run, to pick up updated templates, or to escalate a project from no infrastructure to deployed infrastructure. **Every generator must be idempotent.**

#### The principle

> **Never destroy user intent.** A re-run must not overwrite anything the user has touched, must not duplicate anything, and must not error. Framework-owned artifacts converge to the desired state; user-owned artifacts are created once and then left alone; changing options is additive or updates in place, never destructive.

Everything below follows from that principle. The right behaviour depends on _what a generator produces_, which splits them into two kinds.

#### Project generators

These create a project (and often its infrastructure): `ts#project`, `py#fast-api`, `ts#smithy-api`, `ts#react-website`, `ts#lambda-function`, `ts#infra`, `terraform#project`, `ts#dynamodb`, `ts#rdb`, `ts#nx-generator`, and so on.

- **First run** scaffolds the project.
- **Re-run with the same name** must not re-scaffold user-owned files. Guard project creation so it runs only once, and generate user-editable files (handlers, components, the generator skeleton emitted by `ts#nx-generator`) with `OverwriteStrategy.KeepExisting`. Framework-owned config (project targets, `generators.json` entries, tsconfig references) updates in place / merges, keyed so it overwrites rather than duplicates.
- **Re-run with changed options** is additive: add the newly-requested thing, don't tear down what was there. **Infrastructure escalation** is the canonical case — running with `--infra none` first and later re-running with an infra option (e.g. `--infra rest-lambda`) must add the infrastructure cleanly, with no duplicate constructs or `dependsOn` entries.
- **Run with a different name** creates an independent new project.

#### Component generators

These wire one project into another, or add a component to a project: the `connection` generators, `ts#trpc-api#react-connection`, the agent connections, `agui`, auth, runtime-config.

- **Re-run with the same inputs** is a clean no-op — detect existing wiring and skip it rather than appending a second provider wrapper, route, dependency, or runtime-config override.
- **Adding a second, differently-named component** is additive: each component gets its own keyed registry entry, and the existing one is untouched.

#### Patterns for achieving idempotency

- **Guard project creation.** Wrap `addProjectConfiguration`/`libraryGenerator` in an existence check — read the project config in a `try/catch` and skip creation if it already exists, rather than letting Nx throw "a project already exists". Continue the rest of the generator so changed options still apply.
- **Preserve user-owned files.** Generate handlers, components, generator skeletons, and other user-editable files with `OverwriteStrategy.KeepExisting`. Reserve `OverwriteStrategy.Overwrite` for framework-owned, fully-generated files (e.g. OpenAPI clients).
- **Dedup config additions.** Use `addDependencyToTargetIfNotPresent` for `dependsOn` entries, and filter-then-append for arrays. Never push onto a `commands`/`dependsOn`/`ports` array without checking for the existing entry first.
- **Guard target transforms.** When a generator rewrites an existing target (e.g. wrapping a single `command` into a `commands` array), check whether the target is already in its transformed shape and skip, so a re-run doesn't mangle it.
- **Guard AST mutations.** GritQL transforms that inject imports, providers, route entries, or config statements must carry a `where { ... <: not contains ... }` clause so a re-run does not append a second copy.
- **Reuse assigned ports.** Assign local dev ports with the `assignPort` / `assignSharedPort` helpers in `utils/port.ts` rather than rolling your own. They return a project's already-assigned port on re-run instead of allocating a fresh one; for a project that hosts a port per component (e.g. one per agent or MCP server), pass `assignPort`'s `component` option so the right port is reused.
- **Key config entries by name.** Write `generators.json` / metadata entries keyed by name so a same-name re-run overwrites rather than duplicates, and preserve derived values (e.g. an existing entry's metric) rather than recomputing and churning them.
- **Log what was skipped.** When a generator skips work because state already exists, log it clearly so the user understands the no-op.

#### When a guarded refusal is acceptable

Idempotency is the rule, but a generator may legitimately refuse a re-run when continuing would be genuinely ambiguous (for example, adding auth a second time when the user may have customised the first). In that case throw a clear, actionable error explaining why, and document the behaviour in the generator's guide. This is a deliberate, narrow exception — not a category of generator that gets to skip idempotency.

#### Testing expectations

Every generator must have an idempotency test:

```ts
it('should be idempotent when re-run with same options', async () => {
  await myGenerator(tree, options);
  await myGenerator(tree, options);

  // assert no duplication: ports unchanged, dependsOn entries appear once,
  // imports/providers/routes appear once, file content unchanged
});
```

- **Project generators**: run twice with the same name and assert no duplication and that a file the user might edit (write custom content into it between runs) is preserved. For infra-vending generators, add an escalation test that runs with `--infra none` then re-runs with an infra option and asserts the infrastructure is added exactly once. Add a separate test that a different name creates an independent project.
- **Component generators**: run twice with the same inputs and assert the tree is unchanged after the second run (no duplicate wiring), and that adding a second differently-named component leaves the first intact.
- **Guarded refusals**: assert the generator throws the expected error on re-run.

### Migrations

When a change breaks projects generated by a previous version — renamed targets, changed vended config, a dependency bump requiring code changes — ship a migration so `nx migrate @aws/nx-plugin` upgrades users automatically. Migrations live under `packages/nx-plugin/src/migrations/<name>/` and are registered in `packages/nx-plugin/migrations.json`.

#### The three kinds of migration

Nx 23 migrations come in three forms, discriminated by which fields the `migrations.json` entry carries:

- **Deterministic** (`implementation`): a generator function with an exact before/after. Runs unattended, including in CI and non-interactive terminals. This is the required upgrade path — deterministic migrations alone must take an uncustomised generated workspace from one version to the next with build, lint and test green.
- **Agentic** (`prompt`): a markdown instruction file applied by the user's local coding agent (Claude Code, Codex or OpenCode) via Nx's agentic migrate flow. Use for changes to user-owned code where the correct edit depends on what the user has built. When no agent runs (CI, no agent installed, consent declined), Nx writes the prompt to `tools/ai-migrations/` in the user's workspace as manual instructions — so prompts must read as standalone, self-contained instructions.
- **Hybrid** (`implementation` + `prompt`): one breaking change with a mechanical half and a judgment half. The `implementation` does everything we own deterministically and returns `agentContext` (a `MigrationReturnObject` field) describing what it changed or skipped; Nx passes that context to the paired `prompt`, which directs the agent at the user-owned call sites.

#### Scaffolding a migration

Use the internal `nx-migration` generator to scaffold a new migration — it creates the right files for the chosen kind and registers it in `migrations.json` (with no `version`; see [Versioning](#versioning) below). Pass `--kind` to choose deterministic (default), agentic, or hybrid:

```bash
# Deterministic (default): a codemod
pnpm nx g @aws/nx-plugin:nx-migration --name=rename-foo-target --description="Rename the foo target to bar"

# Agentic: a prompt applied by the user's agent
pnpm nx g @aws/nx-plugin:nx-migration --name=migrate-custom-handlers --description="Update custom handlers for the new API" --kind=agentic

# Hybrid: a codemod that hands off to an agent
pnpm nx g @aws/nx-plugin:nx-migration --name=upgrade-framework --description="Upgrade the framework and reconcile call sites" --kind=hybrid
```

Each kind scaffolds the appropriate files under `packages/nx-plugin/src/migrations/<name>/`:

- **deterministic** — `migration.ts` (implementation skeleton with the guardrails baked in) + `migration.spec.ts`.
- **agentic** — `prompt.md` (self-contained agent/human instructions).
- **hybrid** — `migration.ts` (returning `agentContext`) + `migration.spec.ts` + `prompt.md`.

`nx-migration` is internal to this repo — it is stripped from the published package and never runs in users' workspaces.

#### What should be a migration

Decide with two questions: **is the change deterministic?** and **do we own the target file?**

Deterministic migrations should cover:

- Vended dependency version bumps that require accompanying changes (JS bumps alone use Nx's declarative `packageJsonUpdates`; `pyproject.toml` bumps need a generator migration)
- Config the plugin fully owns: `project.json` targets and options, `nx.json` plugin/sync-generator entries, `aws-nx-plugin.config.mts`
- Generated files users aren't expected to edit: shared constructs following the vended pattern, generated clients, runtime-config wiring
- Mechanical AST edits with an exact before/after: import paths, renamed exports, renamed generator ID references

Agentic (prompt) migrations should cover:

- User-authored code built on scaffolding that changed: agent implementations, custom CDK stacks, custom routers and components
- Framework major upgrades whose required edits land in user code

Not a migration at all:

- Formatting or stylistic changes
- New optional features — users adopt them by re-running the (idempotent) generator
- Generator changes that only affect newly generated output and leave existing workspaces working (e.g. a file the generator no longer vends, where the leftover copy is harmless)

#### Guardrails for deterministic migrations

- **Pattern-match before writing.** If the target file has diverged from the vended shape, skip it and report via `nextSteps` (see `MigrationReturnObject` in `@nx/devkit`) rather than clobbering user changes.
- **Idempotent.** Re-running the migration must be a no-op, mirroring the generator idempotency principle above.
- **Never destroy user intent.** The same rule as generators: user-owned files are reported on, not rewritten.

#### Versioning

Do not add a `version` field to `migrations.json` entries. Versions are stamped at package time (`scripts/stamp-migrations.ts`): a migration that already shipped keeps the version of the first release tag that included it, and an unshipped migration gets a version just above the latest release tag so it runs for every user upgrading from any released version.

#### Testing

Every migration needs a `migration.spec.ts` alongside it using `createTreeUsingTsSolutionSetup()`, covering: the migration applies to the vended shape, skips (and reports) customised files, and is idempotent.

### End to End Tests

The end to end tests run our generators and check that generated projects function correctly (usually by performing a build).

First ensure you have at least compiled the Nx Plugin (`pnpm nx compile nx-plugin`)

You can run them using `pnpm nx run @aws/nx-plugin-e2e:smoke-test --name=xxx` (replacing xxx with the test to run, e.g. `pnpm-10`, `dungeon-adventure`). The `smoke-test` target wraps Vitest with the correct `-t` pattern so the same invocation works on Windows (where shell quoting via `--args` is unreliable).

Note that we have a test which runs through our main tutorial (the Dungeon Adventure Game). If you have updated generators which affect files which we show the contents of in the tutorial, you will need to update this test. You can update the "before" files automatically by running:

`pnpm nx run @aws/nx-plugin-e2e:smoke-test:update-snapshot --name=dungeon-adventure`

However you will still need to make changes to any "after" files manually to ensure the tutorial works end to end. You can also use `pnpm nx start docs` to run the docs site locally and follow the tutorial yourself.

Note that if you are running e2e tests that use `pnpm` as the package manager, you may need to run `pnpm store prune` to ensure that your changes are picked up in the tests.

### Writing Documentation

Each generator has a guide page under `docs/src/content/docs/en/guides/`. These pages are consumed both by the docs site (at `https://awslabs.github.io/nx-plugin-for-aws/`) and by the MCP `generator-guide` tool, so they should read well as prose _and_ slice cleanly when an MCP agent asks for a specific option combination.

#### Only edit English

All authoring happens in `docs/src/content/docs/en/`. Translations under other locales are produced automatically from the English source by the translation workflow — do not edit translated files directly.

#### Linking a guide to its generator

Add `generator: <id>` to the page's frontmatter. This wires the page into the option-filter bar and enables the build-time validator that checks every `<OptionFilter>` predicate against the generator's JSON schema.

```mdx
---
title: tRPC API
description: Reference documentation for the tRPC API generator
generator: ts#api
---
```

#### OptionFilter: conditional sections

Wrap any content that only applies to a subset of option values in `<OptionFilter>`. The docs site shows a filter bar above the page (one dropdown per referenced option key, pulled from the schema enum) that hides mismatching blocks; the MCP server drops mismatching blocks from the response when the agent passes `options`.

```mdx
import OptionFilter from '@components/option-filter.astro';

<OptionFilter when={{ computeType: 'ServerlessApiGatewayRestApi' }} description="Streaming subscriptions — REST API only">
  ### Subscriptions (Streaming) ...
</OptionFilter>

<OptionFilter when={{ auth: ['Cognito', 'IAM'] }}>...applies to either Cognito OR IAM auth...</OptionFilter>

<OptionFilter not when={{ iacProvider: 'Terraform' }}>
  ...applies to everything EXCEPT Terraform...
</OptionFilter>
```

Semantics: multiple keys in `when` are **AND**-ed, array values within a key are **OR**-ed, `not` negates the whole predicate. The optional `description` shows as a tooltip on the pill and is surfaced to MCP agents.

#### Infrastructure: CDK vs Terraform

Use `<Infrastructure>` with named `cdk`/`terraform` slots for IaC content that differs between providers. The docs site renders this as a side-by-side tab widget; the MCP server collapses it to the matching slot when the agent supplies `iacProvider`.

```mdx
import Infrastructure from '@components/infrastructure.astro';

<Infrastructure>
  <Fragment slot="cdk">...CDK-specific guidance...</Fragment>
  <Fragment slot="terraform">...Terraform-specific guidance...</Fragment>
</Infrastructure>
```

#### Tabs with `_filter`

Regular Starlight `<Tabs>` are rendered on the docs site as visible tabs. If a tab only applies to a specific option value, add a `_filter={{ key: 'value' }}` prop to its `<TabItem>`. The MCP server collapses the tab group to the matching item so agents see just the relevant variant; the docs site ignores `_filter` and keeps the tab visible to click through.

```mdx
<Tabs syncKey="http-rest">
  <TabItem label="REST API" _filter={{ computeType: 'ServerlessApiGatewayRestApi' }}>
    ...REST handler code...
  </TabItem>
  <TabItem label="HTTP API" _filter={{ computeType: 'ServerlessApiGatewayHttpApi' }}>
    ...HTTP handler code...
  </TabItem>
</Tabs>
```

#### Page-level frontmatter `when:`

If a generator has so many combinations that inline `<OptionFilter>` blocks become unreadable (in practice this is just the `connection` generator today), split each combination into its own guide page and add a `when:` predicate to the page's frontmatter. The MCP server fetches every page listed for the generator, keeps only those whose `when:` matches the agent's `options`, and warns with "Unsupported combination" + the list of supported predicates when the agent picks values that don't match any variant.

```mdx
---
title: React to tRPC
when:
  sourceType: react
  targetType: ts#trpc-api
---
```

Array values are OR'd within a key (`protocol: [HTTP, A2A]` matches either), and keys are AND'd across the predicate. An `overview` page with no `when:` is always included. Use this only when per-combination prose genuinely diverges — for conditional paragraphs or code blocks inside a single guide, stick with `<OptionFilter>` / `<Tabs _filter>`.

#### When to choose each

- **`<OptionFilter>`** — content that _doesn't apply_ to some options (hides the mismatch). **Don't nest `<OptionFilter>` blocks inside each other** — the docs site renders them as stacked indented stanzas which is confusing. If you need option-dependent content inside an already-filtered section, use `<Tabs>` with `_filter` on each `<TabItem>` instead.
- **`<Infrastructure>`** — CDK vs Terraform side-by-side that the reader compares visually.
- **`<Tabs _filter>`** — any other "A vs B" switch where the site benefits from both variants being visible but an MCP agent should only see one. Also the right choice for option-dependent content inside an `<OptionFilter>` section.
- **Frontmatter `when:`** — one guide page per supported combination, for generators like `connection` where every combination wants its own prose.

Running `pnpm nx start docs` shows your changes with the filter bar live. Running `pnpm nx mcp-inspect @aws/nx-plugin` starts the MCP server against your local guides so you can call `generator-guide` with various `options` and verify the output an agent would receive.

### Documentation Translation

The project supports automatic translation of documentation using Anthropic's Claude Sonnet 4.5 model on Amazon Bedrock. Documentation is translated from English to multiple languages (currently Japanese, with support for French, Spanish, German, Chinese, Vietnamese and Korean).

> **_NOTE:_** It is important that only files in english (en folder) are modified directly as the translated files are generating using english as a base.

#### Running Translations Locally

> **_NOTE:_** Ensure you have your aws cli configured to an AWS account with Claude Sonnet 4.5 Bedrock model access before continuing.

To translate documentation locally:

```bash
# Translate only changed files
pnpm tsx ./scripts/translate.ts

# Translate all files
pnpm tsx ./scripts/translate.ts --all

# Translate to specific languages
pnpm tsx ./scripts/translate.ts --languages jp,fr,es

# Show what would be translated without actually translating
pnpm tsx ./scripts/translate.ts --dry-run
```

#### GitHub Workflow

A GitHub workflow automatically translates documentation when changes are made to English documentation files in pull requests. The workflow:

1. Detects changes to English documentation files
2. Translates the changed files using DeepSeek and Haiku 3.5 on AWS Bedrock
3. Commits the translations back to the source branch
4. Updates the PR with files translated

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.
