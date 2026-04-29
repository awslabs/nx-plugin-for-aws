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

### End to End Tests

The end to end tests run our generators and check that generated projects function correctly (usually by performing a build).

First ensure you have at least compiled the Nx Plugin (`pnpm nx compile nx-plugin`)

You can run them using `pnpm nx test nx-plugin-e2e -- -t 'smoke test - xxx'` (replacing xxx with the test to run). The `--` separator forwards the `-t` flag to Vitest (Nx consumes a bare `-t` as its own `--target` option).

Note that we have a test which runs through our main tutorial (the Dungeon Adventure Game). If you have updated generators which affect files which we show the contents of in the tutorial, you will need to update this test. You can update the "before" files automatically by running:

`pnpm nx test nx-plugin-e2e -- -t 'dungeon-adventure' -u`

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
generator: ts#trpc-api
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
