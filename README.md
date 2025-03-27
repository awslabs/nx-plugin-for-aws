# nx-plugin-for-aws

<a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-yellowgreen.svg" alt="Apache 2.0 License"/></a>
<a href="https://codecov.io/gh/awslabs/nx-plugin-for-aws" ><img src="https://codecov.io/gh/awslabs/nx-plugin-for-aws/graph/badge.svg?token=X27pgFfxuQ"/></a>
<a href="https://gitpod.io/new/?workspaceClass=g1-large#https://github.com/awslabs/nx-plugin-for-aws"><img src="https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod" alt="Gitpod ready-to-code"/></a>
<a href="https://github.com/awslabs/nx-plugin-for-aws/actions/workflows/ci.yml"><img src="https://github.com/awslabs/nx-plugin-for-aws/actions/workflows/ci.yml/badge.svg" alt="Release badge"/></a>
<a href="https://github.com/awslabs/nx-plugin-for-aws/commits/main"><img src="https://img.shields.io/github/commit-activity/w/awslabs/nx-plugin-for-aws" alt="Commit activity"/></a>

## Integrate with editors

Enhance your Nx experience by installing [Nx Console](https://nx.dev/nx-console) for your favorite editor. Nx Console
provides an interactive UI to view your projects, run tasks, generate code, and more! Available for VSCode, IntelliJ and
comes with a LSP for Vim users.

## Build

```
pnpm nx run-many --target build --all
```

## Docs

Run the local docs site with:

```
pnpm nx serve docs
```

## Examples

```
pnpm nx generate @aws/nx-plugin:ts#infra infra --name=infra --directory=lib
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
