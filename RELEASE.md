# Release Strategy

This repository uses a dual-branch release strategy to support parallel development of 1.0 release candidates alongside stable 0.x patches.

## Branches

| Branch        | Purpose                            | npm dist-tag | Version format             |
| ------------- | ---------------------------------- | ------------ | -------------------------- |
| `main`        | 1.0 development (breaking changes) | `next`       | `1.0.0-rc.N`               |
| `release/0.x` | Stable patches for current users   | `latest`     | `0.121.x`, `0.122.x`, etc. |

## How It Works

- **`main`** has `"preid": "rc"` in `nx.json`, so conventional-commit-driven bumps produce prerelease versions (e.g., a `feat:` becomes `1.0.0-rc.1` instead of `0.121.0`). These publish to the `next` dist-tag.
- **`release/0.x`** uses the original `nx.json` without `preid`, producing normal semver bumps. These publish to the `latest` dist-tag.
- **Docs** deploy only from `release/0.x`, keeping the public site on stable content.
- **Slack notifications** skip prerelease versions.

## For Contributors

### New features and breaking changes (targeting 1.0)

Target `main` as usual:

```bash
git checkout main
git checkout -b feat/my-feature
# ... make changes ...
git commit -m "feat(ts#api): consolidate API generators"
gh pr create --base main
```

### Bug fixes for current stable users

Target `release/0.x`:

```bash
git checkout release/0.x
git checkout -b fix/my-bugfix
# ... make changes ...
git commit -m "fix(ts#trpc-api): correct router import path"
gh pr create --base release/0.x
```

### Cherry-picking fixes between branches

If a fix applies to both branches:

```bash
# Fix on release/0.x first (since it's simpler)
git checkout release/0.x
git checkout -b fix/my-bugfix
# ... commit and merge via PR ...

# Then cherry-pick to main
git checkout main
git cherry-pick <commit-sha>
git push origin main
```

## For Maintainers

### Consuming prereleases

Users opt into release candidates explicitly:

```bash
npm install @aws/nx-plugin@next
# or pin a specific RC:
npm install @aws/nx-plugin@1.0.0-rc.1
```

The default `npm install @aws/nx-plugin` always resolves to the stable 0.x version.

### Manual release (if needed)

On `main` (prerelease):

```bash
pnpm nx release --yes
# Publishes 1.0.0-rc.N to "next" dist-tag
```

On `release/0.x` (stable):

```bash
pnpm nx release --yes
# Publishes 0.x.y to "latest" dist-tag
```

### Final cutover to 1.0

When all v1.0 workstreams are complete (see #718):

1. Remove `"preid": "rc"` from `nx.json` on `main`
2. Change `NPM_DIST_TAG` condition in `ci.yml` back to unconditional `latest`
3. Remove the `release/0.x` branch condition from `deploy_docs`
4. Publish `1.0.0` to `latest`
5. Archive `release/0.x`

See #737 for the full cutover checklist.
