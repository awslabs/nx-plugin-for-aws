# Implementation Plan: Stage Credential Mapping (Redesign)

## Overview

First prototype the two shared packages (`infra-config` and `infra-scripts`) as real files in a generated project to validate the structure and behavior. Once the prototype works end-to-end, work backwards to make the Nx generator produce these packages automatically.

## Tasks

### Phase 1: Prototype the output (what the generator should produce)

- [x] 1. Create the infra-config package prototype
  - [x] 1.1 Create `packages/common/infra-config/` as a proper Nx TypeScript library project
    - Create `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `package.json` following the same structure as `packages/common/constructs/`
    - _Requirements: 1.1, 1.6_
  - [x] 1.2 Create `packages/common/infra-config/src/stages.types.ts`
    - Define `ProfileCredentials`, `AssumeRoleCredentials`, `StageCredentials` discriminated union
    - Define `StageConfig` with `credentials`, `region: string`, `account?: string`
    - Define `ProjectConfig` and `StagesConfig` types
    - _Requirements: 1.3, 3.1, 3.2_
  - [x] 1.3 Create `packages/common/infra-config/src/stages.config.ts`
    - Default export with `satisfies StagesConfig`
    - Commented-out examples using project paths as keys, showing profile-based and role-based credentials, explicit and inferred account
    - _Requirements: 1.4, 3.5_
  - [x] 1.4 Create `packages/common/infra-config/src/index.ts`
    - Re-export types from `stages.types.js` and default config from `stages.config.js`
    - _Requirements: 1.6_

- [x] 2. Create the infra-scripts package prototype
  - [x] 2.1 Create `packages/common/infra-scripts/` as a proper Nx TypeScript library project
    - Create `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `package.json`
    - Add `bin` entries in `package.json`: `solution-deploy` and `solution-destroy` pointing to `./src/solution-deploy.ts`/`./src/solution-destroy.ts`
    - Add `@aws-sdk/client-sts` as a dependency
    - _Requirements: 2.1, 2.5, 2.6_
  - [x] 2.2 Create `packages/common/infra-scripts/src/lib/stage-parser.ts`
    - Implement and export `parseStageName(firstArg)` function
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 2.3 Create `packages/common/infra-scripts/src/lib/credentials.ts`
    - Implement and export `lookupCredentials(config, projectPath, stageName)` function
    - Implement and export `buildChildEnv(credentials, projectPath)` function — returns new env object, never modifies process.env
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - [x] 2.4 Create `packages/common/infra-scripts/src/lib/cdk-command.ts`
    - Implement and export `buildCdkCommand(action, remainingArgs)` function
    - _Requirements: 6.5_
  - [x] 2.5 Create `packages/common/infra-scripts/src/lib/run.ts`
    - Implement shared `run(action)` function that orchestrates: parse args → load config → lookup credentials → build child env → spawn CDK
    - Uses `spawnSync` without `shell: true`, passes `childEnv` via `env` option
    - _Requirements: 2.3, 2.4, 2.7, 5.1, 5.5, 6.6_
  - [x] 2.6 Create bin entry points
    - Create `packages/common/infra-scripts/src/solution-deploy.ts` with `#!/usr/bin/env tsx` shebang, calls `run('deploy')`
    - Create `packages/common/infra-scripts/src/solution-destroy.ts` with `#!/usr/bin/env tsx` shebang, calls `run('destroy')`
    - _Requirements: 2.3, 2.4_
  - [x] 2.7 Create `packages/common/infra-scripts/src/index.ts`
    - Re-export pure functions (`parseStageName`, `lookupCredentials`, `buildCdkCommand`, `buildChildEnv`) for testing
    - _Requirements: 10.3_

- [x] 3. Update an infra project's main.ts to import from infra-config
  - [x] 3.1 Update `main.ts` in an existing infra project to import `stagesConfig` from the infra-config package via scope alias
    - Use project path as the config key to look up stage config
    - Set `env.account` from config (fallback to `CDK_DEFAULT_ACCOUNT`) and `env.region` from config (fallback to `CDK_DEFAULT_REGION`)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 4. Checkpoint — Validate prototype end-to-end
  - Verify the infra-config package is importable from the infra project
  - Verify `solution-deploy` and `solution-destroy` appear in `node_modules/.bin/` after install
  - Verify deploying with `solution-deploy packages/infra my-stage/*` resolves credentials correctly
  - Ask the user if the structure and behavior look correct before proceeding to generator work

### Phase 2: Revert old implementation

- [x] 5. Remove previous implementation artifacts
  - [x] 5.1 Remove old template files and test file
    - Delete `packages/nx-plugin/src/infra/app/files/app/scripts/deploy-stage.ts.template`
    - Delete `packages/nx-plugin/src/infra/app/files/config/stages.config.ts.template`
    - Delete `packages/nx-plugin/src/infra/app/files/config/stages.types.ts.template`
    - Delete `packages/nx-plugin/src/infra/app/files/stages-config/` directory
    - Delete `packages/nx-plugin/src/infra/app/deploy-stage.spec.ts`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 5.2 Clean up old references in `generator.ts`
    - Remove `stagesConfigRelativePath`, `stagesTypesRelativePath`, `projectName` template variable computation
    - Remove the `config/` directory generation block
    - Remove `@aws-sdk/client-sts` from root `addDependenciesToPackageJson`
    - _Requirements: 12.5_

### Phase 3: Make the generator produce the prototype

- [x] 6. Create shared package generators
  - [x] 6.1 Add constants for new shared packages to `shared-constructs-constants.ts`
    - Add `SHARED_INFRA_CONFIG_NAME`, `SHARED_INFRA_CONFIG_DIR`, `SHARED_INFRA_SCRIPTS_NAME`, `SHARED_INFRA_SCRIPTS_DIR`
    - _Requirements: 1.1, 2.1_
  - [x] 6.2 Create `sharedInfraConfigGenerator` in `packages/nx-plugin/src/utils/shared-infra-config.ts`
    - Follow `sharedConstructsGenerator` pattern: lazy creation, `tsProjectGenerator`, `generateFiles` with `OverwriteStrategy.KeepExisting`
    - Template files based on the prototype from Phase 1
    - _Requirements: 1.1, 1.2, 1.5_
  - [x] 6.3 Create template files for infra-config under `packages/nx-plugin/src/utils/files/common/infra-config/`
    - Convert prototype files to `.template` files with EJS variables where needed
    - _Requirements: 1.3, 1.4, 3.1, 3.2, 3.5_
  - [x] 6.4 Create `sharedInfraScriptsGenerator` in `packages/nx-plugin/src/utils/shared-infra-scripts.ts`
    - Lazy creation, `tsProjectGenerator`, `generateFiles`, add bin entries to `package.json`, add `@aws-sdk/client-sts` dependency
    - _Requirements: 2.1, 2.2, 2.5, 2.6_
  - [x] 6.5 Create template files for infra-scripts under `packages/nx-plugin/src/utils/files/common/infra-scripts/`
    - Convert prototype files to `.template` files with EJS variables (scope alias for imports)
    - _Requirements: 2.3, 2.4, 2.7, 5.2, 6.1, 7.1_

- [x] 7. Update the infra generator
  - [x] 7.1 Wire shared generators into `tsInfraGenerator`
    - Call `sharedInfraConfigGenerator(tree)` and `sharedInfraScriptsGenerator(tree)` lazily
    - Add tsconfig reference to infra-config package from the infra project
    - _Requirements: 1.1, 2.1_
  - [x] 7.2 Update deploy and destroy targets
    - Deploy: `solution-deploy ${libraryRoot}`
    - Destroy: `solution-destroy ${libraryRoot}`
    - Leave deploy-ci and destroy-ci unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 7.3 Update `main.ts.template` to import from infra-config
    - Import via scope alias, use project path (`<%= dir %>`) as config key
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_

- [x] 8. Checkpoint — Verify generator produces correct output
  - Ensure the generator output matches the prototype structure from Phase 1
  - Ask the user if questions arise.

### Phase 4: Tests

- [x] 9. Update generator tests
  - [x] 9.1 Update `packages/nx-plugin/src/infra/app/generator.spec.ts`
    - Remove old deploy-stage.ts related test cases
    - Add test: infra-config package created with correct files
    - Add test: infra-scripts package created with bin entries
    - Add test: deploy target uses `solution-deploy <project-path>`
    - Add test: destroy target uses `solution-destroy <project-path>`
    - Add test: deploy-ci and destroy-ci unchanged
    - Add test: existing infra-config/infra-scripts files preserved
    - Add test: main.ts imports from infra-config
    - Add test: no deploy-stage.ts in infra project
    - Update snapshots
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  - [ ]* 9.2 Write property test for existing files preservation
    - **Property 6: Existing files preservation**
    - **Validates: Requirements 1.2, 1.5, 2.2**

- [x] 10. Write bin script logic tests
  - [ ]* 10.1 Write property test for stage name parsing
    - **Property 1: Stage name parsing**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  - [ ]* 10.2 Write property test for credential lookup priority
    - **Property 2: Credential lookup priority**
    - **Validates: Requirements 5.2, 5.3, 5.4**
  - [ ]* 10.3 Write property test for CDK command construction
    - **Property 3: CDK command construction**
    - **Validates: Requirements 6.5**
  - [ ]* 10.4 Write property test for profile credential in child env
    - **Property 4: Profile credential in child env**
    - **Validates: Requirements 6.1, 6.2**
  - [ ]* 10.5 Write property test for parent environment immutability
    - **Property 5: Parent environment immutability**
    - **Validates: Requirements 6.4**

- [x] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Phase 1 creates real files to validate structure and behavior before automating generation
- Phase 2 cleans up the old implementation
- Phase 3 converts the validated prototype into generator templates
- Phase 4 adds comprehensive tests
- The prototype files from Phase 1 will be deleted from the test project once the generator can produce them (or kept if the test project is the workspace itself)
- Property tests use `fast-check` with Vitest, minimum 100 iterations per property
