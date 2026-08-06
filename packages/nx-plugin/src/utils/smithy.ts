/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { javaMavenDependency, MISE_VERSIONS, TS_VERSIONS } from './versions';

/**
 * The prefix a target command runs the Smithy CLI through.
 *
 * `mise` resolves the pinned CLI, downloading and caching it on first use, so a
 * Smithy build needs no tool installed on the machine.
 *
 * mise itself is fetched by `npx` rather than added as a workspace dependency. The
 * `mise` npm package is a stub that fetches its real binary in a `preinstall`, and
 * every package manager gates install scripts differently: pnpm, bun and yarn
 * Berry each need their own allowlist entry, bun and yarn fail silently when it is
 * missing, and `nx migrate` installs with `--ignore-scripts` — so a migrated
 * workspace ends up with the package present and no binary. `npx` sidesteps all of
 * it: it runs the package's own bin, resolving from `node_modules` when it happens
 * to be there and fetching it otherwise. A warm cache costs about a second.
 *
 * Both versions are pinned in the command so the version sync can move them
 * forward.
 */
export const smithyCliCommand = (): string =>
  `npx -y mise@${TS_VERSIONS.mise} exec smithy@${MISE_VERSIONS.smithy} -- smithy`;

/**
 * Substitution variables exposing the Smithy Maven pins to the generated
 * `smithy-build.json` templates.
 */
export const smithyMavenVersions = () => ({
  smithyModelDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-model',
  ),
  smithyAwsTraitsDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-aws-traits',
  ),
  smithyValidationModelDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-validation-model',
  ),
  smithyOpenApiDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-openapi',
  ),
  smithyTypeScriptCodegenDependency: javaMavenDependency(
    'software.amazon.smithy.typescript:smithy-aws-typescript-codegen',
  ),
});
