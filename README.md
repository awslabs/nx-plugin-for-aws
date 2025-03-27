# nx-plugin-for-aws

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
