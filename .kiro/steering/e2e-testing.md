---
inclusion: manual
---

# E2E Testing Plan for ts#infra Generator

## Prerequisites

- Local plugin compiled: `pnpm nx compile @aws/nx-plugin`
- Test project directory: `/Users/plesciuc/workspace/test-nx-project/`
- AWS profile: `me`, region: `eu-west-2` (bootstrapped)
- Always use `NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false` env vars when running nx commands in the test project to avoid interactive TUI blocking

## Environment Variables for Non-Interactive Nx

All nx commands in the test project must be prefixed with:
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false
```

## Setup: Create Fresh Test Workspace

```bash
rm -rf /Users/plesciuc/workspace/test-nx-project/my-test-app
pushd /Users/plesciuc/workspace/test-nx-project && \
  npx create-nx-workspace@latest my-test-app \
    --preset=@aws/nx-plugin --pm=pnpm --nxCloud=skip \
    --no-interactive --iacProvider=CDK && \
  popd
```

Then link local plugin build:
```bash
pushd /Users/plesciuc/workspace/test-nx-project/my-test-app && \
  sed -i '' 's|"@aws/nx-plugin": "[^"]*"|"@aws/nx-plugin": "file:/Users/plesciuc/workspace/nx-plugin-for-aws/dist/packages/nx-plugin"|' package.json && \
  pnpm install --no-frozen-lockfile 2>&1 && \
  popd
```

## Test 1: Default Mode (enableStageConfig=false)

### 1a. Generate infra project (default)
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx generate @aws/nx-plugin:ts#infra --name=infra --directory=packages --no-interactive
```

### 1b. Verify structure
- `packages/common/` should only contain `constructs/` (no infra-config, no infra-scripts)
- `packages/infra/src/main.ts` should NOT import from infra-config, should use `process.env.CDK_DEFAULT_ACCOUNT` and `process.env.CDK_DEFAULT_REGION` directly
- `packages/infra/project.json` deploy target should be `cdk deploy --require-approval=never` with `cwd: packages/infra`
- No `solution-deploy` in `node_modules/.bin/`

### 1c. Compile
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx sync && \
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:compile
```

### 1d. Deploy (default mode uses env credentials)
Note: quote the glob to prevent zsh expansion.
```bash
AWS_PROFILE=me NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:deploy -- 'my-test-app-infra-sandbox/*'
```

### 1e. Destroy
Note: `--force` skips the interactive "are you sure?" prompt from CDK.
```bash
AWS_PROFILE=me NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:destroy -- 'my-test-app-infra-sandbox/*' --force
```

## Test 2: Stage Config Mode (enableStageConfig=true)

### 2a. Remove infra and regenerate with flag
```bash
rm -rf packages/infra
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx generate @aws/nx-plugin:ts#infra --name=infra --directory=packages --enableStageConfig=true --no-interactive
```

### 2b. Verify structure
- `packages/common/` should contain `constructs/`, `infra-config/`, `infra-scripts/`
- `packages/infra/src/main.ts` should import from `:my-test-app/common-infra-config`
- `packages/infra/project.json` deploy target should be `solution-deploy packages/infra` (no cwd)
- `solution-deploy` and `solution-destroy` should exist in `node_modules/.bin/`
- `packages/common/infra-scripts/package.json` should have bin entries
- `packages/common/infra-config/src/stages.types.ts` should have discriminated union types
- `packages/common/infra-config/src/stages.config.ts` should have commented examples

### 2c. Compile
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx sync && \
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:compile
```

### 2d. Deploy without stage config (fallback to env)
```bash
AWS_PROFILE=me NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:deploy -- 'my-test-app-infra-sandbox/*'
```

### 2e. Configure stage credentials
Edit `packages/common/infra-config/src/stages.config.ts`:
```typescript
import type { StagesConfig } from './stages.types.js';

const config: StagesConfig = {
  projects: {
    'packages/infra': {
      stages: {
        'my-test-app-infra-sandbox': {
          credentials: { type: 'profile', profile: 'me' },
          region: 'eu-west-2',
        },
      },
    },
  },
};

export default config;
```

### 2f. Deploy with stage config (credential resolution)
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:deploy -- 'my-test-app-infra-sandbox/*'
```
Should see log output like: `[solution-deploy] Using profile 'me' for 'my-test-app-infra-sandbox' (project-specific)`

### 2g. Destroy
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:destroy -- 'my-test-app-infra-sandbox/*' --force
```

## Test 3: Idempotency

### 3a. Run generator again with enableStageConfig=true on existing project
Should not overwrite user-edited `stages.config.ts`.

### 3b. Run generator for a second infra project
```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx generate @aws/nx-plugin:ts#infra --name=infra2 --directory=packages --enableStageConfig=true --no-interactive
```
Should reuse existing infra-config and infra-scripts packages.

## Cleanup

```bash
NX_DAEMON=false NX_INTERACTIVE=false NX_TUI=false \
  pnpm nx run @my-test-app/infra:destroy -- 'my-test-app-infra-sandbox/*' --force
rm -rf /Users/plesciuc/workspace/test-nx-project/my-test-app
```
