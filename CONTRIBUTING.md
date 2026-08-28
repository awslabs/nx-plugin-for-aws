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

A migration's job is to carry an existing workspace to the state it would be in **had the user generated it from today's generators**. That is a higher bar than "keep it building": any change to a generator's output is a candidate for a migration, because otherwise a workspace generated last month silently diverges from one generated today. Ship a migration so `nx migrate @aws/nx-plugin` closes that gap automatically.

Migrations live under `packages/nx-plugin/src/migrations/<version>/<name>/` — grouped by the release that ships them, so their order stays visible as the collection grows — and are registered in `packages/nx-plugin/migrations.json`. A new migration lands in `latest/`; the weekly `update-versions` PR moves it into `v<x.y.z>/` once a release has shipped it, prefixing its folder with its commit order in that release (`0001-<name>`) so a released migration's run order is bedded into the folder layout (see [Order within a release](#order-within-a-release)).

#### The three kinds of migration

Migrations come in three forms, discriminated by which fields the `migrations.json` entry carries:

- **Deterministic** (`implementation`): a generator function with an exact before/after. Runs unattended, including in CI and non-interactive terminals.
- **Agentic** (`prompt`): a markdown instruction file applied by the user's local coding agent (Claude Code, Codex or OpenCode) via Nx's agentic migrate flow. When no agent runs (CI, no agent installed, consent declined), Nx writes the prompt to `tools/ai-migrations/` in the user's workspace as manual instructions — so prompts must read as standalone, self-contained instructions.
- **Hybrid** (`implementation` + `prompt`): both halves of one change. The `implementation` does everything it can mechanically and returns `agentContext` (a `MigrationReturnObject` field) describing what it changed *and what it couldn't*; Nx passes that context to the paired `prompt`, which directs the agent at whatever is left.

#### Scaffolding a migration

Use the `ts#nx-migration` generator to scaffold a new migration — it creates the right files for the chosen kind and registers it in `migrations.json` (with no `version`; see [Versioning](#versioning) below). Pass `--kind` to choose; deterministic is both the generator's default and the one to reach for first (see [Choosing the kind](#choosing-the-kind-prefer-deterministic)):

```bash
# Deterministic (the generator's default): a codemod alone
pnpm nx g @aws/nx-plugin:ts#nx-migration --project=@aws/nx-plugin --name=rename-foo-target --description="Rename the foo target to bar"

# Hybrid: a codemod that hands off to an agent
pnpm nx g @aws/nx-plugin:ts#nx-migration --project=@aws/nx-plugin --name=upgrade-framework --description="Upgrade the framework and reconcile call sites" --kind=hybrid

# Agentic: a prompt alone, applied by the user's agent
pnpm nx g @aws/nx-plugin:ts#nx-migration --project=@aws/nx-plugin --name=migrate-custom-handlers --description="Update custom handlers for the new API" --kind=agentic
```

Each kind scaffolds the appropriate files under `packages/nx-plugin/src/migrations/latest/<name>/`:

- **deterministic** — `migration.ts` (implementation skeleton with the guardrails baked in) + `migration.spec.ts`.
- **agentic** — `prompt.md` (self-contained agent/human instructions).
- **hybrid** — `migration.ts` (returning `agentContext`) + `migration.spec.ts` + `prompt.md`.

Entries are keyed by folder and name (`latest-<name>`, becoming `v<x.y.z>-<name>` once a release claims them), so reusing a name for a later change can't silently overwrite a migration that has already shipped.

`ts#nx-migration` is a public generator, so it works on any Nx Plugin project (it creates `migrations.json` and wires the `nx-migrations` field into the plugin's `package.json` if absent). See its [guide](./docs/src/content/docs/en/guides/nx-migration.mdx) for the full reference. Within this repo, always pass `--project=@aws/nx-plugin`.

#### What should be a migration

**Assume a migration is needed.** If a change alters what a generator produces, a workspace generated before it needs a migration to reach the same state — so a migration is the default, not the exception. That covers breaking changes, new features, security hardening and bug fixes alike, anywhere in the generated surface: vended config (`project.json`, `nx.json`, `aws-nx-plugin.config.mts`), `common/constructs` and `common/terraform`, generated clients and runtime-config wiring, and the application code we scaffold.

The narrow exceptions:

- Formatting or stylistic changes to vended templates
- Changes that only affect the *choices offered* at generation time (a new option whose default leaves existing output unchanged)
- Removing a file the generator no longer vends, where the leftover copy is harmless

#### Migrations that change infrastructure

A migration that touches IaC changes the resources a workspace deploys, so the diff isn't the whole story — the **transition** from the deployed stack to the migrated one has to be exercised with a real deployment. Deploy on the published version, apply the migration, deploy again, and confirm the update succeeds against live resources.

Some transitions can't be made safely, and those are the ones not to ship:

- **The update would break a user's deployment.** If the change can't be applied to an already-deployed stack — a replacement the platform refuses, a resource that can't be updated in place — don't provide a migration.
- **The change would cause data loss.** A resource replacement that discards a bucket, table or database takes the user's data with it. Don't provide a migration, whatever the deployed stack's contents happen to be in your test.

In either case leave existing workspaces on the shape they already deploy: new workspaces get the new resources from today's generators, and existing ones keep working. **Justify the missing migration in the PR description** so the omission is a recorded decision rather than an oversight.

#### Choosing the kind: prefer deterministic

**Start deterministic.** A codemod runs unattended and identically for everyone — no agent required, no consent prompt, no variation between runs, and it is covered by tests you can rely on. Most migrations touch a shape we vend and can be pattern-matched, so most migrations should be a plain `implementation`. Reporting what it skipped via `nextSteps` is often enough on its own: the user gets a precise manual follow-up rather than a migration that needs an agent to finish.

**Reach for hybrid when a change is critical and can't be fully applied deterministically.** The case for the extra prompt is strongest for breaking changes — where a workspace that only gets the deterministic half is left broken, and the leftover edits span too many shapes for a codemod to match. There the prompt is what carries users across; a `nextSteps` note asking them to hand-reconcile a breaking API change across their own code is a poor substitute. Add the prompt when:

- The change is breaking, and code the codemod can't safely match must also change for the workspace to keep working.
- The leftover edits depend on what the user built, so no single shape holds — `agent.ts` / `agent.py`, individual tRPC procedures and routers, custom CDK stacks, React components.

Choose pure agentic only when nothing can be matched mechanically at all.

When you do write a hybrid, split the work by how reliably the edit can be pattern-matched:

- **Deterministic half** — changes with a narrow, recognisable shape: vended config, `common/constructs` / `common/terraform`, generated clients, agent connection wiring, import paths and renamed exports. The transform must **match the exact shape it expects before writing**: read the target, confirm it still looks like what the generator produced, and if it doesn't, leave it alone and record that in `agentContext` and `nextSteps`. A transform that rewrites whatever it finds will destroy customisations.
- **Agentic half** — whatever the deterministic half skipped. Note that the split isn't "our files vs theirs" — put an edit in the deterministic half whenever it can be matched generically and safely, however user-facing the file, and defer it to the prompt only when it can't. **Judge mostly by complexity:** if a codemod would need a wide surface of shapes to handle, the prompt is the better home for it.

Worked examples:

- **Renaming a generator (new generator ID).** Deterministic. The generator metadata recorded in each project's `project.json` is what lets later generators identify a project, so a codemod rewriting the old ID to the new one across every `project.json` is both exhaustive and safe — miss it and generators on the new version no longer recognise projects created by the old one.
- **Adding a KMS key to the static website's S3 bucket.** Deterministic. The bucket is vended in `common/constructs` / `common/terraform`, so a codemod that matches that shape covers the ordinary case; where it finds a bucket definition it doesn't recognise it reports it via `nextSteps`. Nothing breaks if a user applies that note later, so the change doesn't warrant a prompt.
- **Upgrading to a new major of Vite.** Hybrid — breaking, and only partly matchable. The deterministic half performs the routine codemods (bump the vended config, apply the mechanical config-shape changes we know about); the prompt points the agent at the upstream migration guide and has it reconcile the user's own Vite config, plugins and build code against the new API, which a codemod can't do across the shapes those take.

#### Guardrails for codemods

These apply to any `implementation`, whether it stands alone or forms the deterministic half of a hybrid:

- **Transform source code with GritQL.** Any codemod that edits source — TypeScript, Python, HCL — must use the GritQL helpers in `utils/ast.ts` (`applyGritQL`, `matchGritQL`, `captureGritQL`, `insertViaGritQL`, `addDestructuredImport` and friends), the same way generators do. GritQL matches the AST, so one pattern holds across the formatting, whitespace, quoting and member ordering a user's copy will have drifted into. Regexes and string replacements are brittle by comparison: they match text that merely looks right, miss equivalent code written differently, and silently corrupt files — they are not acceptable for source transforms. Parse-able config is the exception, where a real parser beats both: `updateJson` for JSON, and the matching parser for other structured formats. Reserve textual edits for formats GritQL can't parse (e.g. Dockerfiles), and anchor them as tightly as you can.
- **Pattern-match before writing.** Confirm the target still matches the shape the generator produced. If it doesn't, skip it and report it via `nextSteps` — plus `agentContext` in a hybrid, so the paired prompt can pick it up (both are `MigrationReturnObject` fields). Never rewrite what you don't recognise. `matchGritQL` is the natural way to make that check.
- **`nextSteps` are work left for the user, not a log of what you did.** Nx prints them as the follow-up actions the user has to perform, so every entry must be something they need to do by hand: reconcile a file the codemod skipped, or finish something outside the migration's reach (`sync-vended-versions` asking for a package manager install to refresh the lock file, say). A note describing an edit the migration already made successfully is noise — it asks nothing of the user, and buries the entries that do among a list they have to read through. The migration's description already says what it changes, and `git diff` shows exactly what it did. So when a transform applies cleanly, add nothing; only the skipped and the not-yet-done get an entry. Don't add blanket advice that would apply to every migration either (redeploy, re-run the build) — that's noise for the same reason.
- **Idempotent.** Re-running the migration must be a no-op, mirroring the generator idempotency principle above. As with generators, guard GritQL rewrites that inject code with a `where { ... <: not contains ... }` clause so a second run doesn't append a duplicate.
- **Never destroy user intent.** The same rule as generators: unrecognised code is reported on, not rewritten.
- **Format what you write.** Finish with `await formatFilesInSubtree(tree)`. `updateJson` / `writeJson` re-serialise the whole file and expand inline arrays, which the vended `format` target rejects — without this a clean migration run leaves the user's `build` failing.

#### Versioning

Do not add a `version` field to `migrations.json` entries — versions arrive on their own:

- At release time `scripts/release.ts` runs `nx release version` (no tag, no commit) to write the pending version into the dist manifests, then stamps it into the compiled `migrations.json` (`stampMigrationsFile` in `scripts/stamp-migrations.ts`) before the release tags and publishes. The version is resolved from the latest git tag, so a net-new migration carries the version that actually shipped it. One that already shipped keeps the version of the first release tag that included it.
- The weekly `update-versions` PR records the version of the release that shipped each migration, moves it out of `latest/` into that release's `v<x.y.z>/` folder and re-keys it to match (`scripts/backfill-migration-versions.ts`), so `migrations.json` in `main` converges on the versions of everything already released. Only released migrations are touched; one that hasn't shipped stays in `latest/`.

A version already recorded in source always wins, so the backfilled values are stable and the release only has to reason about entries that are still unversioned.

##### Order within a release

Migrations shipped together share a version — a batch stamped with the same pending release, or a whole `v<x.y.z>/` folder replayed on a big version jump. `nx migrate` sorts the run ascending by version and keeps the manifest's order among equal versions, and the manifest is assembled in key order, so **within a version, migrations run in the order they were committed**. An earlier-authored migration therefore runs before a later one in the same release, so you can land a batch of dependent changes across separate commits without worrying about ordering — commit the migration a later one relies on first. Two migrations added in the same commit (a squashed PR) share a rank and fall back to alphabetical order, so if one depends on the other, split them across commits. The `everyMigration` sync entry always runs last regardless (see below).

That order is resolved from git only while a migration is unreleased. Commit order is read (`scripts/utils/migration-commit-order.ts`) for the `latest/` migrations, whose order isn't settled yet. Once a release ships them, the weekly `update-versions` backfill beds that order into the folder name — it moves each into `v<x.y.z>/` with a zero-padded `NNNN-` prefix giving its commit order in the release (`0001-<name>`), so the folder name alone sorts the version's migrations and their order no longer depends on git history. A released migration's order is fixed and inspectable in the tree; only the handful still in `latest/` are ranked from git on each release.

#### Vended dependency versions

Version bumps ship themselves, and everything that makes that work lives in `utils/version-upgrade-migration/`. The weekly `update-versions` PR rewrites the vended versions in `utils/versions.ts` and nothing else needs authoring or generating per bump: `migrations.json` carries one committed `sync-vended-versions` entry marked `everyMigration: true`, pointing at `migration.ts`. That delegates to `syncVendedVersions` (`sync-vended-versions.ts`), which syncs TypeScript dependencies (catalogs and direct ranges), Python `pyproject.toml` pins, Terraform provider versions and the plugin version the metrics files report.

An `everyMigration` entry is never backfilled or pinned — stamping re-writes its version to each pending release — so it runs on every upgrade, and always **last** in the run. Both fall out of the same mechanism: `nx migrate` gates a migration on `installed < version` and sorts the run ascending by version, so an entry carrying the pending version is always eligible and always sorts above the code migrations. Running last is what lets a code migration add a dependency that this then brings up to date. Target versions come from the installed plugin's own tables, so there is nothing release-specific to register. The flag is source-only and stripped from the published manifest.

##### Declaring the dependencies a generator owns

Only dependencies **this plugin added** are synced, so a package the user installed themselves keeps the version they chose. Every generator declares what it may add:

```ts
/** The metadata this generator records, which its predicates read. */
export interface TsMcpServerMetadata {
  readonly port: number;
  readonly auth: string;
}

export const DEPENDENCIES = declareDependencies<TsMcpServerMetadata>()({
  ts: [
    { name: '@modelcontextprotocol/sdk' },
    { name: 'express', when: (m) => m.auth === 'iam' },
    ...SHARED_CONSTRUCTS_DEPENDENCIES,
  ],
  py: [{ name: 'mcp' }, { name: 'boto3' }],
});
```

The declaration is passed to `withVersions` / `withPyVersions` and to every helper that adds dependencies, which is what enforces it: adding an undeclared package is a type error, and a helper's signature rejects a caller whose declaration doesn't cover what the helper adds — naming the missing packages. `MustDeclare` does that check, and a runtime guard catches anything that reaches it past the type checker.

Consequences for authoring a generator:

- **Declare every branch.** A declaration is static, so every conditional dependency appears; `when` decides which apply.
- **Spread the helpers you call.** A helper publishes a `*_DEPENDENCIES` constant (`FS_DEPENDENCIES`, `SHARED_CONSTRUCTS_DEPENDENCIES`) covering what it adds, including its own nested helpers, so spreading one constant covers the whole chain.
- **Name the export `DEPENDENCIES`.** The migration reads it by that name.
- **Cover what you delegate to.** A helper taken through `MustDeclare` is checked by the compiler, but one that merely exports its own `DEPENDENCIES` (the AG-UI react connection, for instance) is not — spread it, as `ts#agent#react-connection` does.
- **Wrap a spread the caller doesn't install.** A helper adds its packages to the project it owns, so a generator that spreads the constant to claim ownership must not also install it: wrap with `ownedElsewhere(...)`. Ownership is unaffected — the sync still upgrades those packages wherever they sit; only the install is skipped. If the helper is called down one branch only, wrap with `onlyWhen(..., predicate)` first, which keeps each entry's own condition as well as the branch:

  ```ts
  ...ownedElsewhere(onlyWhen(AGUI_DEPENDENCIES.ts, isAgUi)),
  ```
- **Record the generator against a project.** `addGeneratorMetadata` / `addComponentGeneratorMetadata` is what makes the declaration discoverable; without it the dependencies are never recognised as ours. Connection generators record too, even the ones that add no dependencies today, so adding one later is owned automatically.
- **Add dependencies from the declaration, not a second list.** Call `addTsDependencies` / `addPyDependencies` with the declaration and the metadata; the call site names no packages. Gate anything option-specific with a `when` predicate, and flag entries with `dev`, `root` (workspace root manifest), `group` (pyproject dependency group) or `versionOnly` (owned so its pinned version stays current, but never installed here):

  ```ts
  addTsDependencies(tree, DEPENDENCIES, { metadata, projectRoot: project.root });
  addPyDependencies(tree, DEPENDENCIES, { metadata, projectRoot: project.root });
  ```

  Both take the same options, so the two calls read alike. Omitting `projectRoot` targets the workspace root, which is also where `root: true` entries go regardless.

- **Build the metadata once and use it twice.** Pass the very object recorded via `addGeneratorMetadata` / `addComponentGeneratorMetadata` to the dependency call, so what the generator adds and what the migration owns cannot drift. If a recorded value is computed later (an assigned port, say), move the dependency call below it rather than duplicating the literal.
- **Only read recorded fields in a predicate.** The migration replays predicates against project metadata, so a field the generator never records can never match — the dependency would silently stop being upgraded. A predicate that reads absent metadata (or throws) counts as not applying: the migration will not claim a branch it cannot confirm. A test enforces that every field a predicate reads is a member of the generator's metadata interface.

At upgrade time the sync reads the declarations of the generators the workspace has run and moves only those versions, always upwards. Ownership is per workspace, not per manifest: if a generator that owns `zod` has run anywhere, every `zod` in the workspace is synced.

Two things follow for a generator author:

- **Write an override in both yarn descriptor forms.** A generator pins a package under an override when a dependency's own range would otherwise resolve a second, incompatible copy (`ts#mcp-server`'s `zod`, `ts#rdb`'s `@types/pg`). Classic yarn honours only the `**/`-prefixed descriptor in a workspace, while berry honours only the bare one and *deletes* a glob descriptor on install (`YN0057`) — so writing one form alone leaves the dedupe silently inert under the other major. The sync keeps whichever fields the workspace's package manager reads up to date.
- **Leave the nx packages alone.** They move through `packageJsonUpdates` rather than the sync, so `nx migrate` still collects Nx's own migrations for that hop. `TS_VERSIONS.nx` (`NX_VERSION`) is the single source of truth, and a test guards that every nx package matches it — a workspace nx even a patch apart hoists a second nested nx and the two deadlock `nx sync`.

#### Testing

Every migration needs a `migration.spec.ts` alongside it using `createTreeUsingTsSolutionSetup()`, covering: the migration applies to the vended shape, skips (and reports) code it doesn't recognise, and is idempotent.

The `migrate` e2e test then covers every migration together: it creates a workspace on a released version, scaffolds it with that version's own generators, and upgrades it to the local build with the real `nx migrate` cycle — asserting re-running the migrations changes nothing and the workspace still builds. Run it with:

```bash
pnpm nx run @aws/nx-plugin-e2e:smoke-test --name=migrate
```

It does that once per recent release, so locally it runs every hop back to back. CI spreads them across machines with `NX_E2E_SHARD=<index>/<total>`, which is also how you run a single hop:

```bash
NX_E2E_SHARD=1/5 pnpm nx run @aws/nx-plugin-e2e:smoke-test --name=migrate
```

Unit tests only prove the migration does what you wrote it to do. Also **test the migration manually against a real workspace generated by the latest published version**, since that is the state your users are upgrading from. The goal is to confirm the migrated workspace matches what today's generators would produce.

First build the local packages:

```bash
pnpm package:all
```

Then create a workspace on the **published** version, generate the projects your migration touches, and commit it so the migration's changes are easy to inspect:

```bash
pnpm create @aws/nx-workspace my-migration-test
cd my-migration-test
# Generate whatever your migration targets, on the published version
pnpm nx g @aws/nx-plugin:ts#website --name=website --no-interactive
git add -A && git commit -m "baseline on published version"
```

Now swap in the local build:

```bash
pnpm link <path-to-this-repo>/dist/packages/nx-plugin
```

`nx migrate @aws/nx-plugin@latest` resolves migrations from the **registry**, so it won't see one that hasn't been published — and running it replaces your link with the published version. Write `migrations.json` by hand instead, listing your migration exactly as it appears in `packages/nx-plugin/migrations.json` (any `version` above the installed one will do):

```json
{
  "migrations": [
    {
      "cli": "nx",
      "package": "@aws/nx-plugin",
      "name": "latest-my-migration",
      "version": "999.0.0",
      "description": "My migration",
      "implementation": "./src/migrations/latest/my-migration/migration"
    }
  ]
}
```

Then run it:

```bash
pnpm exec nx migrate --run-migrations
```

Finally, verify the outcome:

1. **Inspect the diff** (`git diff`) — every change should be one today's generators would make, and nothing else.
2. **Compare against a fresh workspace** — generate the same projects into a brand-new workspace using the local build, and diff the two. Remaining differences are gaps in the migration.
3. **Confirm it still builds** — `pnpm nx run-many --target build --all`.
4. **Re-run it** — running the migration a second time must report no changes.

Worth repeating with a *customised* workspace: hand-edit the files your migration touches first, then check it leaves your edits alone and reports them via `nextSteps` / `agentContext` instead of clobbering them.

### Connection Generators and the Graph Builder

The docs site has a [Graph Builder](https://awslabs.github.io/nx-plugin-for-aws/en/get_started/graph-builder) where users sketch a workspace and copy the commands that scaffold it. It derives itself from the plugin's metadata, so a new generator mostly appears in it for free — but a generator that takes part in a **connection** needs three small things.

1. **Declare the connection** in `packages/nx-plugin/src/connection/supported-connections.ts`. This is the source of truth for both the generator and the builder's palette and edges.

2. **Give the generator's `schema.json` an `x-label`** — the short noun the palette shows, e.g. `"x-label": "MCP Server"`. Without one, a node is labelled with its raw generator id. `title` and `description` aren't used here: they're prose written for CLI prompts.

3. **Record anything the connection requires of its endpoints' options** in `CONNECTION_CONSTRAINTS` in `packages/nx-plugin/src/connection/scaffold-catalog.ts`. If your connection generator throws when (say) the target isn't IAM-authenticated, add the matching constraint so the builder can tell the user while they're drawing rather than when the command fails.

Everything else is inferred — whether the generator creates a project or adds a component, which project hosts a component, and which public generator selects a hidden one. `scaffold-catalog.spec.ts` fails with a specific message if a connection names a generator it can't work out how to run, so you'll be told rather than left with a silently missing palette entry.

Finally, add the node's artwork and palette grouping to `PRESENTATION` in `docs/src/lib/graph-builder/catalog.ts`, alongside a logo in `docs/src/content/docs/assets/logos/`. A type without an entry still appears, just under "Other" with a generic mark.

### End to End Tests

The end to end tests run our generators and check that generated projects function correctly (usually by performing a build).

A new generator must be added to **both** generator matrices:

- `e2e/src/smoke-tests/generator-matrix.ts` — runs each generator through the CLI, one invocation at a time, as a user would. This is what the package manager and IaC provider smoke tests scaffold with.
- `packages/nx-plugin/src/internal/test-matrix/generator.ts` — a hidden generator which composes all the others for testing migrations between versions.

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
