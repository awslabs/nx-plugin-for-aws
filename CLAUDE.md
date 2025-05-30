# Instructions for Claude

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

## Best Practices

- Always ensure the build passes before raising a PR
- Update snapshots if there are failures due to snapshot changes
- Use conventional commits, referencing the generator you are working on, eg "feat(ts#project): my commit message"
- Raise PRs following the PR template
- Use the existing codebase to inform code style, testing style, etc
