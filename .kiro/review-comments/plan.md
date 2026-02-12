# PR Review Comments — Action Plan

## Comment 1: Rename "solution-deploy" / "solution-destroy"
**File:** `docs/src/content/docs/en/guides/typescript-infrastructure.mdx` (lines 57-58)
**Reviewer says:** "Nit: 'solution' can be a loaded term, I wonder if we name them infra-deploy or just deploy?"

**Action:** Rename `solution-deploy` → `infra-deploy` and `solution-destroy` → `infra-destroy` everywhere:
- Template files: `solution-deploy.ts.template` → `infra-deploy.ts.template`, same for destroy
- `shared-scripts.ts`: bin entries
- `shared-constructs-constants.ts`: if any constants reference the names
- `generator.ts`: deploy/destroy target commands
- `run.ts.template`: log prefix `[solution-deploy]` → `[infra-deploy]`
- `credentials.ts.template`: error messages
- Docs: all references
- Tests: all references

**Reply:** "Good call — renamed to `infra-deploy` / `infra-destroy`."

---

## Comment 2: Softer language about credential management
**File:** `docs/src/content/docs/en/guides/typescript-infrastructure.mdx` (lines 160-163)
**Reviewer says:** "Nit: maybe softer language here, like 'managing credentials manually can be error-prone'?"

**Action:** Change the paragraph from "managing credentials manually gets tedious and error-prone. You'd need to remember which profile or role goes with which stage, and a mistake could mean deploying to the wrong account." to something softer like "managing credentials manually can be error-prone, especially as the number of stages grows."

**Reply:** "Updated — toned it down."

---

## Comment 3: Remove "This package can also be extended..." sentence
**File:** `docs/src/content/docs/en/guides/typescript-infrastructure.mdx` (lines 165-168)
**Reviewer says:** "Nit: probably can delete 'This package can also be extended...'"

**Action:** Remove the sentence "This package can also be extended with other build-time scripts in the future." from the docs.

**Reply:** "Removed."

---

## Comment 4: Use NxCommands component
**File:** `docs/src/content/docs/en/guides/typescript-infrastructure.mdx` (lines 212-215)
**Reviewer says:** "We can use `<NxCommands commands={[...]} />` instead so we render for users' preferred package manager :)"

**Action:** Replace `pnpm nx run infra:deploy my-app-dev/*` with `<NxCommands commands={['run infra:deploy my-app-dev/*']} />`.

**Reply:** "Nice, switched to `NxCommands`."

---

## Comment 5: Guidance on committing stages.config.ts
**File:** `docs/src/content/docs/en/guides/typescript-infrastructure.mdx` (lines 253-256)
**Reviewer says:** "What do you think the guidance is if there's a mix? Not really a big deal, I imagine you'd err on the side of checking this in :)"

**Action:** Update the tip to recommend committing by default, noting you can gitignore personal profile names if needed. Something like: "We recommend committing `stages.config.ts` so the team shares a single source of truth. If it contains personal profile names, you can add it to `.gitignore` and use a `.gitignore`d local override instead."

**Reply:** "Updated the tip to recommend committing by default."

---

## Comment 6: Move resolveStage into stages.config.ts
**File:** `packages/nx-plugin/src/infra/app/files/app/src/main.ts.template`
**Reviewer says:** "I wonder if this might fit better inside stages.config.ts?"

**Action:** Move the `resolveStage` helper function into `stages.config.ts.template` (or `index.ts` of infra-config) and export it. Then `main.ts` just imports and calls it. This keeps `main.ts` clean and puts config resolution logic next to the config.

**Reply:** "Agreed — moved `resolveStage` into the infra-config package so main.ts stays clean."

---

## Comment 7: Remove leftover deploy-stage.ts test
**File:** `packages/nx-plugin/src/infra/app/generator.spec.ts`
**Reviewer says:** "Might be a left over test from a previous iteration? Not sure there's ever a deploy-stage.ts script generated? :)"

**Action:** Remove the test `it('should not generate deploy-stage.ts in infra project', ...)`. This was a regression guard from the old implementation that no longer makes sense.

**Reply:** "Yep, leftover from the old implementation — removed."

---

## Comment 8: Remove duplicate deploy-ci/destroy-ci test
**File:** `packages/nx-plugin/src/infra/app/generator.spec.ts`
**Reviewer says:** "I think we already have a test for this :)"

**Action:** Remove the duplicate `it('should leave deploy-ci and destroy-ci targets unchanged', ...)` inside the `with enableStageConfig` describe block. The one in the outer scope already covers this, and the `enableStageConfig` variant doesn't change CI targets.

**Reply:** "Good catch — removed the duplicate."

---

## Comment 9: Add snapshot tests for generated scripts and infra-config src dirs
**File:** `packages/nx-plugin/src/infra/app/generator.spec.ts`
**Reviewer says:** "It'd be great to add a test which snapshots scripts and infra-config's src dirs so it's clear what generated output changes when things are modified in future :)"

**Action:** Add a test in the `with enableStageConfig` describe block that uses `snapshotTreeDir` (from `../../utils/test`) to snapshot:
- `packages/common/infra-config/src/`
- `packages/common/scripts/src/`

**Reply:** "Added snapshot tests for both generated src directories."

---

## Comment 10: Add x-prompt for enableStageConfig in schema.json
**File:** `packages/nx-plugin/src/infra/app/schema.json`
**Reviewer says:** "Please could we add x-prompt for the interactive cli too? :)"

**Action:** Add `"x-prompt": "Would you like to enable centralized stage credential configuration?"` to the `enableStageConfig` property in `schema.json`.

**Reply:** "Added."

---

## Comment 11: Replace pnpm with user's package manager in stages.config.ts template
**File:** `packages/nx-plugin/src/utils/files/common/infra-config/src/stages.config.ts.template`
**Reviewer says:** "Nit: can we replace pnpm with the user's package manager?"

**Action:** Use `detectPackageManager()` in the generator to determine the package manager, then pass it as a template variable. In the template, use `<%= pkgMgrRunNx %>` (e.g., `pnpm nx`, `bun nx`, `yarn nx`, `npx nx`). Use `getPackageManagerCommand()` to get the right exec prefix.

**Reply:** "Updated to use the detected package manager."

---

## Comment 12: Use `as const satisfies StagesConfig`
**File:** `packages/nx-plugin/src/utils/files/common/infra-config/src/stages.config.ts.template`
**Reviewer says:** "I wonder if we do `as const satisfies StagesConfig` to make it a bit more type-safe in terms of the defined keys available in main.ts? :)"

**Action:** Change `satisfies StagesConfig` to `as const satisfies StagesConfig` in the template. This preserves literal types for stage names and project paths, making autocomplete work better in main.ts.

**Reply:** "Great idea — changed to `as const satisfies StagesConfig`."

---

## Comment 13: Remove separator comments in stages.types.ts
**File:** `packages/nx-plugin/src/utils/files/common/infra-config/src/stages.types.ts.template`
**Reviewer says:** "Nit: not a big fan of the separator comments — the file isn't all that large so don't think there's much need for them :)"

**Action:** Remove the `// ─────` separator comment lines from the types file.

**Reply:** "Removed."

---

## Comment 14: Remove pnpm-specific install instruction
**File:** `packages/nx-plugin/src/utils/files/common/scripts/src/lib/credentials.ts.template`
**Reviewer says:** "Nit: pnpm specific (maybe easiest to just say please install)"

**Action:** Change `console.error('[infra-deploy] Run: pnpm add @aws-sdk/client-sts');` to something generic like `console.error('[infra-deploy] Please install @aws-sdk/client-sts');`.

**Reply:** "Updated to a generic message."

---

## Comment 15: Profile not used as source identity for AssumeRole
**File:** `packages/nx-plugin/src/utils/files/common/scripts/src/lib/credentials.ts.template`
**Reviewer says:** "Not sure profile is used as the source identity for this assume role per the docs? :)"

**Action:** The current code sets `AWS_PROFILE` before creating the STS client, which means the SDK picks up that profile's credentials for the AssumeRole call. But the reviewer is right that this isn't "source identity" in the STS sense. The `profile` field on `AssumeRoleCredentials` should be used to configure the STS client with that profile's credentials before calling AssumeRole. Need to review the AWS SDK docs and fix the implementation — likely need to create a credential provider from the profile and pass it to the STS client constructor, rather than relying on env var side effects.

Actually, looking more carefully: the code sets `env.AWS_PROFILE` then creates `new STSClient({})` — but the STS client reads from `process.env`, not from the local `env` variable. So the profile isn't actually being used for the AssumeRole call at all. Need to fix this by explicitly configuring the STS client with the profile credentials.

**Reply:** "You're right — the profile wasn't actually being used for the AssumeRole call since the STS client reads from process.env, not the local env copy. Fixed by explicitly configuring the STS client with the profile's credentials."

---

## Comment 16: Rename `lib` to something more specific
**File:** `packages/nx-plugin/src/utils/files/common/scripts/src/lib/run.ts.template`
**Reviewer says:** "Nit: given this is a more generic scripts package, we should probably rename lib to something more specific to stage credentials?"

**Action:** Rename `lib/` → `stage-credentials/` (or `infra-deploy/`) in the scripts package templates. Update all imports accordingly.

**Reply:** "Renamed to `stage-credentials/`."

---

## Comment 17: Don't export from index.ts
**File:** `packages/nx-plugin/src/utils/files/common/scripts/src/index.ts.template`
**Reviewer says:** "Nit: not sure we need to export any of these?"

**Action:** Make `index.ts` empty or remove it. The bin scripts are the public API of this package, not the library functions. The functions were exported for testing, but comment #18 provides a better testing approach.

**Reply:** "Removed the exports — the bin scripts are the public interface."

---

## Comment 18: Use importTypeScriptModule for testing instead of copying functions
**File:** `packages/nx-plugin/src/utils/infra-scripts.spec.ts`
**Reviewer says:** "Instead of redefining I think we might be able to test this in the same way we test open-api/ts-client and ts-hooks? :) Check out importTypeScriptModule"

**Action:** Rewrite `infra-scripts.spec.ts` to:
1. Read the `.template` files from disk using `fs.readFileSync`
2. Strip EJS tags (or provide dummy values)
3. Use `importTypeScriptModule` to dynamically import the functions
4. Test the imported functions directly

This eliminates the duplicated type/function definitions and tests the actual template code.

**Reply:** "Refactored to use `importTypeScriptModule` — now testing the actual template code instead of copies."

---

## Comment 19: Remove workspace dependency registration for infra-config
**File:** `packages/nx-plugin/src/utils/shared-infra-config.ts`
**Reviewer says:** "This shouldn't be needed, the package should already be importable like others :) dependencies are managed via ts project references :)"

**Action:** Remove the `addDependenciesToPackageJson` call that adds `@scope/common-infra-config: 'workspace:*'` to root package.json. TS project references handle the dependency.

**Reply:** "Removed — project references handle this."

---

## Comment 20: Remove package.json creation for infra-config
**File:** `packages/nx-plugin/src/utils/shared-infra-config.ts`
**Reviewer says:** "I don't think we need a package.json here, dependencies are added via the root package.json file."

**Action:** Remove the `if (!tree.exists(pkgJsonPath))` block that creates a package.json for infra-config. The tsProjectGenerator handles this, and dependencies go in root package.json.

**Reply:** "Removed."

---

## Comment 21: Remove dead code branch for missing package.json in shared-scripts
**File:** `packages/nx-plugin/src/utils/shared-scripts.ts` (lines 79-87)
**Reviewer says:** "don't think we'd ever have this case as the tsProjectGenerator doesn't vend a package.json :)"

**Action:** Remove the `if (!tree.exists(pkgJsonPath))` branch and just always write the package.json with bin entries (since tsProjectGenerator doesn't create one for workspace projects).

**Reply:** "Simplified — just write the package.json directly since tsProjectGenerator doesn't create one."

---

## Comment 22: Make @aws-sdk/client-sts a devDependency
**File:** `packages/nx-plugin/src/utils/shared-scripts.ts` (lines 89-91)
**Reviewer says:** "I think this should be a dev dependency as it's just used by build/deploy-time scripts?"

**Action:** Change `addDependenciesToPackageJson(tree, withVersions(['@aws-sdk/client-sts']), {})` to `addDependenciesToPackageJson(tree, {}, withVersions(['@aws-sdk/client-sts']))` (second arg = devDeps).

**Reply:** "Good point — moved to devDependencies."

---

## Comment 23: Package manager compatibility + add smoke test
**File:** `packages/nx-plugin/src/utils/shared-scripts.ts` (lines 93-99)
**Reviewer says:** "Does this work with all the package managers? I wonder if it'd be simpler to drop the package.json and bin scripts, and instead just `tsx packages/common/scripts/src/deploy.ts`? ... We should also add one more infra project to the smoke test with this option set to true..."

**Analysis:** The reviewer suggests using `tsx` directly, but we originally chose the bin script approach specifically because `tsx` has PATH resolution issues — when NX runs a target with `cwd` set to the project directory, `tsx` isn't always resolvable depending on the package manager's hoisting behavior. The bin script approach works because bin entries get symlinked into `node_modules/.bin/`, which NX adds to PATH when running commands (same reason `cdk` works without a full path).

**Action — keep bin scripts but verify with smoke tests:**
1. Keep the bin script approach (it solves a real problem)
2. Remove the workspace dependency registration (comment 19 overlap) — the bin scripts package needs its own `package.json` with `bin` entries, but we don't need to register it as a workspace dep if the package manager handles it via workspace protocol
3. Add `enableStageConfig` infra project to the shared `runSmokeTest` in `e2e/src/smoke-tests/smoke-test.ts` — this runs for all 4 package managers (npm, pnpm, yarn, bun) automatically
4. The smoke test addition is simple: add one more `runCLI` call to generate a second infra project with `--enableStageConfig=true`, and the existing `run-many --target build` will verify it compiles

Specifically, add to `smoke-test.ts`:
```ts
await runCLI(
  `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
  opts,
);
```

This gets tested across all 4 package managers since `smokeTest()` is called from `npm.spec.ts`, `pnpm.spec.ts`, `yarn.spec.ts`, and `bun.spec.ts`.

**Reply:** "We originally tried the `tsx` direct invocation approach but ran into PATH resolution issues — when NX runs a target with `cwd` set to the project directory, `tsx` isn't always resolvable depending on the package manager's hoisting behavior. The bin script approach works because bin entries get symlinked into `node_modules/.bin/`, which NX adds to PATH when running commands (same reason `cdk` works).

Added a smoke test with `enableStageConfig: true` that runs across all 4 package managers (npm, pnpm, yarn, bun) to verify the bin scripts work everywhere."

---

## Execution Order

These comments have dependencies. Suggested order:

1. **Comment 1** (rename solution-deploy → infra-deploy — touches many files, do first)
2. **Comments 16, 17** (rename lib/ → stage-credentials/, remove exports)
3. **Comments 19, 20, 21** (cleanup shared-infra-config.ts and shared-scripts.ts — remove unnecessary code)
4. **Comment 22** (move @aws-sdk/client-sts to devDependencies)
5. **Comment 15** (fix profile/assumeRole credential handling)
6. **Comment 6** (move resolveStage to infra-config)
7. **Comment 12** (as const satisfies)
8. **Comments 11, 14** (package manager detection in templates)
9. **Comment 13** (remove separator comments)
10. **Comments 7, 8** (remove leftover/duplicate tests)
11. **Comment 9** (add snapshot tests)
12. **Comment 18** (refactor test to use importTypeScriptModule)
13. **Comment 10** (add x-prompt)
14. **Comments 2, 3, 4, 5** (docs changes — do last since other changes affect docs)
15. **Comment 23** (add smoke test — do last after all code changes are stable)
