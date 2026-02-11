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

You can run them using `pnpm nx test nx-plugin-e2e -t 'smoke test - xxx'` (replacing xxx with the test to run).

Note that we have a test which runs through our main tutorial (the Dungeon Adventure Game). If you have updated generators which affect files which we show the contents of in the tutorial, you will need to update this test. You can update the "before" files automatically by running:

`pnpm nx test nx-plugin-e2e -t 'dungeon-adventure' -u`

However you will still need to make changes to any "after" files manually to ensure the tutorial works end to end. You can also use `pnpm nx start docs` to run the docs site locally and follow the tutorial yourself.

Note that if you are running e2e tests that use `pnpm` as the package manager, you may need to run `pnpm store prune` to ensure that your changes are picked up in the tests.

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
