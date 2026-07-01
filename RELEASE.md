# Release Strategy

This repository releases 1.0 release candidates from `main`. Each release
candidate is published to **both** the `latest` and `next` npm dist-tags so the
default install path resolves to the current RC while `@next` continues to work
for anyone already pinned to it.

## Branch

| Branch | Purpose                | npm dist-tags     | Version format |
| ------ | ---------------------- | ----------------- | -------------- |
| `main` | 1.0 release candidates | `latest` + `next` | `1.0.0-rc.N`   |

## How It Works

- **`main`** CI uses `--specifier premajor --preid rc` for the first RC (producing `1.0.0-rc.0`), then `--preid rc` for subsequent RCs (auto-incrementing to `1.0.0-rc.1`, `1.0.0-rc.2`, etc.).
- Each RC is published to the `latest` dist-tag, then the `next` dist-tag is pointed at the same version.
- **Docs** deploy from `main` on every release.

## For Contributors

All work targets `main`:

```bash
git checkout main
git checkout -b feat/my-feature
# ... make changes ...
git commit -m "feat(ts#api): consolidate API generators"
gh pr create --base main
```

## For Maintainers

### Consuming the release candidate

The default install resolves to the current RC:

```bash
npm install @aws/nx-plugin
# @next resolves to the same version:
npm install @aws/nx-plugin@next
# or pin a specific RC:
npm install @aws/nx-plugin@1.0.0-rc.1
```

### Manual release (if needed)

First prerelease:

```bash
pnpm nx release --skip-publish --specifier premajor --preid rc
pnpm nx release publish --tag latest
# Point "next" at the same version:
for pkg in @aws/nx-plugin @aws/nx-plugin-mcp @aws/create-nx-workspace; do
  npm dist-tag add "$pkg@$(git describe --tags --abbrev=0 | sed 's/^v//')" next
done
```

Subsequent prereleases (after the first `v1.0.0-rc.N` tag exists):

```bash
pnpm nx release --skip-publish --preid rc
pnpm nx release publish --tag latest
for pkg in @aws/nx-plugin @aws/nx-plugin-mcp @aws/create-nx-workspace; do
  npm dist-tag add "$pkg@$(git describe --tags --abbrev=0 | sed 's/^v//')" next
done
```

### Final cutover to 1.0

When all v1.0 workstreams are complete (see #718), remove the
`--specifier premajor --preid rc` logic from the `main` release step in
`ci.yml` so `nx release` resolves a stable `1.0.0` bump. See #737 for the full
cutover checklist.
