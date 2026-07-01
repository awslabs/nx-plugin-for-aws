# Release Strategy

This repository releases 1.0 release candidates from `main`. Each release
candidate is published to the `latest` npm dist-tag so the default install path
resolves to the current RC (there is no separate `next` line to opt into).

## Branch

| Branch | Purpose                | npm dist-tag | Version format |
| ------ | ---------------------- | ------------ | -------------- |
| `main` | 1.0 release candidates | `latest`     | `1.0.0-rc.N`   |

## How It Works

- **`main`** CI uses `--specifier premajor --preid rc` for the first RC (producing `1.0.0-rc.0`), then `--preid rc` for subsequent RCs (auto-incrementing to `1.0.0-rc.1`, `1.0.0-rc.2`, etc.).
- Each RC is published to the `latest` dist-tag.
- Publishing uses npm OIDC trusted publishing, which authenticates only `npm publish` and sets a single dist-tag per version. There is no token available for post-publish dist-tag management, so `latest` is the one tag we set.
- The previously used `next` dist-tag is no longer updated — it is redundant now that the RC is the default install.
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
# or pin a specific RC:
npm install @aws/nx-plugin@1.0.0-rc.1
```

### Manual release (if needed)

First prerelease:

```bash
pnpm nx release --skip-publish --specifier premajor --preid rc
pnpm nx release publish --tag latest
```

Subsequent prereleases (after the first `v1.0.0-rc.N` tag exists):

```bash
pnpm nx release --skip-publish --preid rc
pnpm nx release publish --tag latest
```

### Final cutover to 1.0

When all v1.0 workstreams are complete (see #718), remove the
`--specifier premajor --preid rc` logic from the `main` release step in
`ci.yml` so `nx release` resolves a stable `1.0.0` bump. See #737 for the full
cutover checklist.

### Re-triggering a release

The release and docs-deploy steps only run on `push` events. Re-running a
stuck CI run preserves the original `push` event, so a rerun still publishes;
a manual `workflow_dispatch` run intentionally does not.
