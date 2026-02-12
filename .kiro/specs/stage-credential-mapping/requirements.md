# Requirements Document

## Introduction

This feature redesigns the stage credential mapping system for the `@aws/nx-plugin` `ts#infra` generator. The previous implementation generated a `deploy-stage.ts` script per infra project and placed loose config files at the workspace root, which caused issues with `tsx` not being found on PATH, tsconfig `rootDir` conflicts, and cross-package imports. The new architecture introduces two proper Nx library projects under `packages/common/` — `infra-config` for stage configuration types and mappings, and `infra-scripts` for centralized deploy/destroy bin scripts. This eliminates per-project boilerplate, solves PATH resolution via `node_modules/.bin/`, and makes stage config importable from any package in the repo.

## Glossary

- **Generator**: An Nx code generator — a command run once (e.g., `npx nx generate @aws/nx-plugin:ts#infra --name=infra`) to scaffold a new project with pre-configured files and build targets.
- **Tree**: The Nx virtual file system used during generator execution for reading and writing files.
- **Infra_Project**: A CDK infrastructure project created by the `ts#infra` generator. Contains `main.ts` (entry point), CDK stages, and CDK stacks.
- **Stage_Name**: The CDK stage identifier extracted from deployment arguments (e.g., `my-app-dev` from `my-app-dev/*`).
- **Infra_Config_Package**: The `packages/common/infra-config/` Nx library project containing stage configuration types and the user's stage-to-credential mappings. Importable via scope alias (e.g., `@my-scope/common-infra-config`).
- **Infra_Scripts_Package**: The `packages/common/infra-scripts/` Nx library project containing `solution-deploy` and `solution-destroy` bin scripts. Registers bin entries in `package.json` so they appear in `node_modules/.bin/`.
- **StageCredentials**: A discriminated union type specifying credential resolution options: `profile` (AWS CLI profile name) or `assumeRole` (IAM role ARN with optional `externalId` and `sessionDuration`).
- **StageConfig**: Configuration for a single CDK stage, including credentials, an optional `account` field, and a required `region` field.
- **Project_Path**: The relative folder path of the infra project from the workspace root (e.g., `packages/infra` or `packages/my-app/infra`). Used as the key in the stages config for unambiguous project identification.
- **Target**: An Nx build target — a named command defined in `project.json` (e.g., `deploy`, `destroy`). Run with `pnpm nx run <project>:<target>`.
- **Bin_Script**: An executable script registered in a package's `package.json` `bin` field, making it available in `node_modules/.bin/` after install.

## Requirements

### Requirement 1: Generate Infra Config Package

**User Story:** As a developer using the ts#infra generator, I want a shared `infra-config` Nx library package generated lazily, so that I have a single importable location for stage configuration types and credential mappings.

#### Acceptance Criteria

1. WHEN the ts#infra Generator runs and no `packages/common/infra-config/project.json` exists, THE Generator SHALL create the Infra_Config_Package as a proper Nx TypeScript library project at `packages/common/infra-config/`
2. WHEN the ts#infra Generator runs and the Infra_Config_Package already exists, THE Generator SHALL preserve the existing package without modification
3. THE Infra_Config_Package SHALL contain a `src/stages.types.ts` file defining the `StageCredentials` discriminated union, `StageConfig` (with `credentials`, optional `account`, and required `region` fields), `ProjectConfig`, and `StagesConfig` types
4. THE Infra_Config_Package SHALL contain a `src/stages.config.ts` file with a default export using `satisfies StagesConfig`, including commented-out example entries showing profile-based and role-based credential configuration with project paths as keys (e.g., `'packages/infra'`)
5. WHEN the Infra_Config_Package is generated, THE Generator SHALL use `OverwriteStrategy.KeepExisting` for the `stages.config.ts` file so that user edits are preserved on subsequent generator runs
6. THE Infra_Config_Package SHALL be importable from any package in the workspace via the scope alias (e.g., `@my-scope/common-infra-config`)

### Requirement 2: Generate Infra Scripts Package

**User Story:** As a developer, I want centralized deploy and destroy bin scripts in a shared package, so that deployment logic is not duplicated across infra projects and the `tsx` PATH issue is eliminated.

#### Acceptance Criteria

1. WHEN the ts#infra Generator runs and no `packages/common/infra-scripts/project.json` exists, THE Generator SHALL create the Infra_Scripts_Package as a proper Nx TypeScript library project at `packages/common/infra-scripts/`
2. WHEN the ts#infra Generator runs and the Infra_Scripts_Package already exists, THE Generator SHALL preserve the existing package without modification
3. THE Infra_Scripts_Package SHALL contain a `solution-deploy` bin script that resolves credentials from the Infra_Config_Package, sets environment variables, and calls `cdk deploy`
4. THE Infra_Scripts_Package SHALL contain a `solution-destroy` bin script that resolves credentials from the Infra_Config_Package, sets environment variables, and calls `cdk destroy`
5. THE Infra_Scripts_Package SHALL register `solution-deploy` and `solution-destroy` as bin entries in its `package.json`, so they appear in `node_modules/.bin/` after package installation
6. THE Infra_Scripts_Package SHALL declare `@aws-sdk/client-sts` as a dependency for the `assumeRole` credential strategy
7. WHEN the bin scripts are invoked, THE scripts SHALL accept the infra project path (relative to workspace root, e.g., `packages/infra`) as the first argument to identify which project's stage config to use

### Requirement 3: Stage Configuration with Account and Region

**User Story:** As a developer, I want to specify the AWS region in my stage configuration and optionally specify the account, so that `main.ts` can read deployment environment settings from a single source of truth.

#### Acceptance Criteria

1. THE StageConfig type SHALL include a required `region` field of type `string`
2. THE StageConfig type SHALL include an optional `account` field of type `string`
3. WHEN the `account` field is not specified in a StageConfig entry, THE system SHALL infer the AWS account from the configured profile by calling STS GetCallerIdentity
4. WHEN the `account` field is specified in a StageConfig entry, THE system SHALL use the explicit account value without calling STS
5. THE `stages.config.ts` example entries SHALL include commented examples showing both explicit account and inferred account configurations

### Requirement 4: Update Deploy and Destroy Targets

**User Story:** As a developer, I want the deploy and destroy targets to use the centralized bin scripts from the Infra_Scripts_Package, so that deployments work from any folder without PATH issues.

#### Acceptance Criteria

1. WHEN the ts#infra Generator configures the deploy target, THE Generator SHALL set the command to `solution-deploy <project-path>` followed by forwarded arguments, where `<project-path>` is the infra project's relative path from the workspace root
2. WHEN the ts#infra Generator configures the destroy target, THE Generator SHALL set the command to `solution-destroy <project-path>` followed by forwarded arguments, where `<project-path>` is the infra project's relative path from the workspace root
3. WHEN the ts#infra Generator configures the deploy-ci and destroy-ci targets, THE Generator SHALL continue to invoke `cdk` directly without using the bin scripts
4. THE deploy and destroy targets SHALL work from any directory in the workspace because the bin scripts are resolved via `node_modules/.bin/`

### Requirement 5: Credential Lookup in Bin Scripts

**User Story:** As a developer, I want the bin scripts to resolve credentials in a deterministic order, so that project-specific settings override shared settings and I always know which credentials are used.

#### Acceptance Criteria

1. WHEN the bin script executes, THE script SHALL import the stages config from the Infra_Config_Package using the scope alias
2. WHEN a Stage_Name matches an entry in `config.projects[projectPath].stages[stageName]`, THE script SHALL use the project-specific StageCredentials
3. WHEN a Stage_Name does not match a project-specific entry but matches an entry in `config.shared.stages[stageName]`, THE script SHALL use the shared StageCredentials
4. WHEN a Stage_Name does not match any entry in the stages config, THE script SHALL fall back to the current environment variables without error
5. WHEN the bin script resolves credentials, THE script SHALL log which credential source is being used (project-specific, shared, or environment fallback) to stderr

### Requirement 6: Credential Application

**User Story:** As a developer, I want the bin scripts to set the correct AWS environment variables only for the spawned CDK process, so that CDK uses the right credentials for each stage without polluting my shell environment.

#### Acceptance Criteria

1. WHEN the resolved StageCredentials contain a `profile` field (type `profile`), THE script SHALL pass `AWS_PROFILE` in the `env` option of `spawnSync` for the CDK child process, without modifying `process.env` of the bin script itself
2. WHEN the resolved StageCredentials contain an `assumeRole` field (type `assumeRole`), THE script SHALL call AWS STS AssumeRole with the specified ARN, using a session name derived from the project path, and pass `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` in the `env` option of `spawnSync` for the CDK child process
3. WHEN the resolved StageCredentials contain both `profile` and `assumeRole` fields, THE script SHALL first use the profile's credentials as the source identity for the AssumeRole call, then pass the resulting temporary credentials in the `env` option of `spawnSync`
4. THE script SHALL construct a child process environment by copying `process.env` and overlaying only the resolved credential variables, so that the parent process environment remains unmodified after the script exits
5. THE script SHALL execute the CDK command with `--require-approval=never` by default. IF the user provides a `--require-approval` flag, THE script SHALL respect the user's value instead of the default.
6. THE script SHALL use `spawnSync` without `shell: true` to execute the CDK command, passing command and arguments as an array for cross-platform safety

### Requirement 7: Stage Name Parsing

**User Story:** As a developer, I want the bin scripts to correctly extract the stage name from various CDK argument formats, so that credential lookup works regardless of how I specify the deployment target.

#### Acceptance Criteria

1. WHEN the deployment arguments contain a pattern like `stage-name/*`, THE script SHALL extract `stage-name` as the Stage_Name
2. WHEN the deployment arguments contain a plain stage name without a `/`, THE script SHALL use the entire argument as the Stage_Name
3. WHEN no positional arguments are provided (only flags or no arguments at all), THE script SHALL skip credential lookup and fall back to environment variables
4. WHEN the deployment arguments contain flags before the stage selector (e.g., `-c key=value my-stage/*`), THE script SHALL skip flag arguments to find the first positional argument for stage name extraction

### Requirement 8: Infra Project main.ts Imports Stage Config

**User Story:** As a developer, I want `main.ts` in my infra project to import stage configuration from the Infra_Config_Package, so that CDK stage `env` properties (account and region) are defined in a single source of truth.

#### Acceptance Criteria

1. WHEN the ts#infra Generator creates `main.ts`, THE Generator SHALL generate code that imports the stages config from the Infra_Config_Package via the scope alias
2. THE generated `main.ts` SHALL use the `region` field from the stage config to set the CDK stage `env.region` property
3. WHEN the `account` field is present in the stage config, THE generated `main.ts` SHALL use it for `env.account`. WHEN absent, THE generated `main.ts` SHALL fall back to `process.env.CDK_DEFAULT_ACCOUNT`
4. THE generated `main.ts` SHALL include a commented example showing how to add additional stages using the config

### Requirement 9: No Per-Project Deploy Script

**User Story:** As a developer, I want infra projects to contain only clean CDK code without generated deployment boilerplate, so that the project structure is simple and maintainable.

#### Acceptance Criteria

1. THE ts#infra Generator SHALL NOT generate a `deploy-stage.ts` file inside the Infra_Project
2. THE ts#infra Generator SHALL NOT generate any deployment scripts inside the Infra_Project's `src/` or `scripts/` directory
3. THE Infra_Project SHALL contain only CDK application code (`main.ts`, stages, stacks) and standard configuration files (`cdk.json`, `checkov.yml`)

### Requirement 10: Package Manager Agnostic

**User Story:** As a developer, I want the generated code to work with any package manager (npm, pnpm, yarn), so that the solution is not tied to a specific monorepo setup.

#### Acceptance Criteria

1. THE Infra_Scripts_Package bin scripts SHALL resolve dependencies using standard Node.js module resolution, without assuming a specific package manager
2. THE bin scripts SHALL work in both monorepo and single-package repository layouts
3. THE generated code SHALL have no runtime dependency on `@aws/nx-plugin` — the generated packages are standalone

### Requirement 11: Generator Testing

**User Story:** As a contributor to the nx-plugin, I want the generator changes to be covered by tests, so that future changes do not break the stage credential mapping feature.

#### Acceptance Criteria

1. WHEN the generator test suite runs, THE test suite SHALL verify that the Infra_Config_Package is created with the correct files (`stages.types.ts`, `stages.config.ts`)
2. WHEN the generator test suite runs, THE test suite SHALL verify that the Infra_Scripts_Package is created with bin scripts and correct `package.json` bin entries
3. WHEN the generator test suite runs, THE test suite SHALL verify that the deploy target command uses `solution-deploy` with the correct project path
4. WHEN the generator test suite runs, THE test suite SHALL verify that the destroy target command uses `solution-destroy` with the correct project path
5. WHEN the generator test suite runs, THE test suite SHALL verify that existing Infra_Config_Package and Infra_Scripts_Package files are not overwritten
6. WHEN the generator test suite runs, THE test suite SHALL verify that deploy-ci and destroy-ci targets remain unchanged
7. WHEN the generator test suite runs, THE test suite SHALL verify that `main.ts` imports stage config from the Infra_Config_Package

### Requirement 12: Revert Previous Implementation

**User Story:** As a contributor, I want the previous deploy-stage.ts implementation reverted, so that the codebase is clean before the new architecture is applied.

#### Acceptance Criteria

1. THE implementation SHALL remove the `deploy-stage.ts.template` file from `packages/nx-plugin/src/infra/app/files/app/scripts/`
2. THE implementation SHALL remove the `stages.config.ts.template` and `stages.types.ts.template` files from `packages/nx-plugin/src/infra/app/files/config/`
3. THE implementation SHALL remove the `deploy-stage.spec.ts` test file
4. THE implementation SHALL remove the empty `packages/nx-plugin/src/infra/app/files/stages-config/` directory
5. THE implementation SHALL update the generator to remove references to the old template variables (`stagesConfigRelativePath`, `stagesTypesRelativePath`) and old config directory generation logic
