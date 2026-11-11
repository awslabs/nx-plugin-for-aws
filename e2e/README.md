# End-to-end tests

Follow the prerequisites in [CONTRIBUTING.md](../CONTRIBUTING.md). Smoke tests
normally publish locally built packages to Verdaccio and create fresh workspaces
using those packages.

## Smoke tests against a public release

Set `NX_E2E_PUBLIC_VERSION` to an exact release version to skip publishing local
packages and create test workspaces with that public release:

```sh
NX_E2E_PUBLIC_VERSION=1.2.0 NX_DAEMON=false NX_NO_CLOUD=true \
VITEST_MAX_WORKERS=4 UV_PYTHON_PREFERENCE=system \
NODE_OPTIONS=--dns-result-order=ipv4first \
pnpm exec vitest run --config e2e/vite.config.mts \
  e2e/src/smoke-tests/greengrass-tutorial.spec.ts \
  e2e/src/smoke-tests/dungeon-adventure.spec.ts \
  e2e/src/smoke-tests/dungeon-dice.spec.ts \
  --no-fsModuleCache
```

Dungeon Adventure's local runtime checks require a running Docker engine. These
three specs build and synthesize infrastructure without deploying to AWS.
