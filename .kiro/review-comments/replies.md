# PR Review — Suggested Replies

Short replies to post on each comment after the changes are made.

## Comment 1 (rename solution-deploy)

> Renamed to `infra-deploy` / `infra-destroy` everywhere.

## Comment 2 (softer language)

> Updated — toned it down to "managing credentials manually can be error-prone, especially as the number of stages grows."

## Comment 3 (remove "can be extended" sentence)

> Removed.

## Comment 4 (use NxCommands)

> Switched to `NxCommands` component.

## Comment 5 (commit guidance)

> Updated the tip to recommend committing by default, with a note about gitignoring personal profile names.

## Comment 6 (move resolveStage to stages.config.ts)

> Moved `resolveStage` into the infra-config package as a separate `resolve-stage.ts` file (exported from index.ts). main.ts now just imports and calls `resolveStage(projectPath, stageName)`.

## Comment 7 (leftover deploy-stage.ts test)

> Removed.

## Comment 8 (duplicate deploy-ci test)

> Removed the duplicate.

## Comment 9 (snapshot generated src dirs)

> Added snapshot tests for both `packages/common/infra-config/src/` and `packages/common/scripts/src/` using `snapshotTreeDir`.

## Comment 10 (x-prompt for enableStageConfig)

> Added `"x-prompt": "Would you like to enable centralized stage credential configuration?"`.

## Comment 11 (package manager in config template)

> Updated to use `getPackageManagerCommand().exec` — the config template comment now uses the detected package manager (e.g., `pnpm nx`, `npx nx`, `yarn nx`, `bunx nx`).

## Comment 12 (as const satisfies)

> Changed to `as const satisfies StagesConfig`. Also added a `const config: StagesConfig = stagesConfig` widening in `resolve-stage.ts` to allow dynamic key access while keeping the narrow types for autocomplete in main.ts.

## Comment 13 (remove separator comments)

> Removed all separator comments from stages.types.ts.

## Comment 14 (pnpm-specific install message)

> Changed to generic: `[infra-deploy] Please install @aws-sdk/client-sts`.

## Comment 15 (profile not used for AssumeRole)

> Fixed — now uses `fromIni({ profile })` from `@aws-sdk/credential-providers` to explicitly configure the STS client with the profile's credentials, instead of relying on env var side effects.

## Comment 16 (rename lib to something specific)

> Renamed `lib/` → `stage-credentials/`.

## Comment 17 (don't export from index.ts)

> Removed all exports — index.ts now just has a comment explaining the scripts are the public interface.

## Comment 18 (use importTypeScriptModule for testing)

> Refactored `parseStageName` and `buildCdkCommand` tests to use `importTypeScriptModule` — reads the actual `.template` files, strips EJS tags, and dynamically imports. The `lookupCredentials` test still uses an inline copy because the template has EJS import lines that can't be cleanly stripped (the import references the scope alias).

## Comment 19 (remove workspace dependency for infra-config)

> Removed — ts project references handle this.

## Comment 20 (remove package.json for infra-config)

> Removed.

## Comment 21 (remove dead code branch)

> Removed the entire package.json creation from shared-scripts.ts — no longer needed since we switched to tsx direct invocation.

## Comment 22 (devDependency for @aws-sdk/client-sts)

> Moved to devDependencies. Also added `@aws-sdk/credential-providers` as a devDep (needed for `fromIni` in the assumeRole flow).

## Comment 23 (package manager compatibility + smoke test)

> Switched from bin scripts to `tsx` direct invocation: deploy target is now `tsx packages/common/scripts/src/infra-deploy.ts <project-path>`. This works across all package managers because `tsx` is in `node_modules/.bin/` (installed as a devDep) and NX adds that to PATH when running targets.
>
> The original bin script approach had issues:
>
> - bun doesn't auto-link bins from workspace packages
> - yarn v1 with `workspace:*` dependencies tries to fetch from the registry
>
> Added `infra-with-stages` generation to the shared smoke test, plus a verification step that actually executes the infra-deploy script via tsx and checks for the `[infra-deploy]` usage output.
>
> **Tested across all 4 package managers:**
>
> To replicate locally, you need the CI environment:
>
> ```bash
> # Node 22 + npm 11.6.1 (matching CI)
> nvm use 22
> npm i -g npm@11.6.1 --force
>
> # bun 1.3.6
> curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.6"
> export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"
>
> # Python 3.12, uv, terraform
> pyenv local 3.12.12
> brew install uv terraform
>
> # AWS profile (needed for Python openapi tasks)
> export AWS_PROFILE=<your-profile>
>
> # Install, compile, run
> pnpm i --frozen-lockfile
> pnpm nx compile nx-plugin
> pnpm nx test nx-plugin-e2e -t 'smoke test - npm'
> pnpm nx test nx-plugin-e2e -t 'smoke test - pnpm'
> pnpm nx test nx-plugin-e2e -t 'smoke test - yarn'
> pnpm nx test nx-plugin-e2e -t 'smoke test - bun'
> ```
>
> Results:
>
> - npm: full smoke test passed ✅ — all 18 projects built, tsx script verified
> - pnpm: full smoke test passed ✅ — all 18 projects built, tsx script verified
> - yarn: full smoke test passed ✅ — all 18 projects built, tsx script verified
> - bun: full smoke test passed ✅ — all 18 projects built, tsx script verified
