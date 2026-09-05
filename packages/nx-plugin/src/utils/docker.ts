/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from './declared-dependencies.js';
import { FS_DEPENDENCIES, FsCommands } from './fs.js';
import {
  addDependencyToTargetIfNotPresent,
  normalizeTargetKeyOrder,
} from './nx.js';
import { containerImage, type ITsDepVersion, TS_VERSIONS } from './versions.js';

/** Dependencies a caller must declare to add a Docker scan target. */
export const DOCKER_DEPENDENCIES = [...FS_DEPENDENCIES] as const;

/**
 * The `cache` setting every target that builds a container image must use.
 *
 * A built image lives in the container engine's own store, not under any
 * `outputs` path, so Nx has nothing to restore a cache hit from: it would
 * report the build complete while the image is missing, and the `trivy` scan
 * that depends on it would report a cached pass against an image that isn't
 * there. The container engine's layer cache is the sound cache here — it is
 * keyed on the build context and lives alongside the image, so an unchanged
 * context rebuilds in well under a second and always leaves the image present.
 */
export const IMAGE_BUILD_CACHE = false;

const TRIVY_IGNORE_FILE = '.trivyignore';

const TRIVY_IGNORE_CONTENTS = `# Trivy ignore file. Add one vulnerability ID (e.g. CVE-2021-12345) per line to
# suppress it during the image scan (\`nx run-many --target trivy\`).
# https://trivy.dev/latest/docs/configuration/filtering/#by-finding-ids
`;

/**
 * Substitution variables for the vended Node `Dockerfile` templates: the npm
 * version to install globally, and the versions its dependency overrides pin.
 */
export const nodeImageVersions = () => ({
  npmVersion: TS_VERSIONS.npm,
  minimatchVersion: TS_VERSIONS.minimatch,
});

/**
 * Packages a vended Node `Dockerfile` pins, which every generator writing one
 * must declare so the version sync keeps those pins current.
 *
 * Spread through `ownedElsewhere`: the pin lives in the image build rather than
 * in any manifest, so nothing is installed into the workspace. Left undeclared
 * these would be the only vended versions never upgraded — and they are
 * precisely the ones held at a version clear of a known HIGH/CRITICAL
 * vulnerability.
 */
export const NODE_IMAGE_DEPENDENCIES = [
  { name: 'npm' },
  { name: 'minimatch' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Packages the prisma CLI install in a vended RDB migration `Dockerfile` pins.
 * The CLI's own ranges resolve both below a known HIGH vulnerability's fix, so
 * the image overrides them. Spread through `ownedElsewhere` for the same reason
 * as {@link NODE_IMAGE_DEPENDENCIES}.
 */
export const PRISMA_IMAGE_DEPENDENCIES = [
  { name: 'deepmerge-ts' },
  { name: 'mysql2' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Packages the AWS Distro for OpenTelemetry install in a vended `Dockerfile`
 * pins, for the images that auto-instrument with it. Spread through
 * `ownedElsewhere` for the same reason as {@link NODE_IMAGE_DEPENDENCIES}.
 */
export const ADOT_IMAGE_DEPENDENCIES = [
  { name: '@aws/aws-distro-opentelemetry-node-autoinstrumentation' },
  { name: '@opentelemetry/propagator-jaeger' },
] as const satisfies readonly { name: ITsDepVersion }[];

export interface DockerScanTargetOptions {
  /**
   * Project configuration to add the scan target to (mutated in place).
   */
  readonly project: ProjectConfiguration;
  /**
   * Container engine command to invoke (\`docker\` or \`finch\`).
   */
  readonly containerEngine: string;
  /**
   * Name of the scan target to add, e.g. \`my-agent-trivy\`.
   */
  readonly trivyTargetName: string;
  /**
   * Name of the docker target that builds the image(s) to scan. The scan
   * target depends on it.
   */
  readonly dockerTargetName: string;
  /**
   * Tags of the images built by the docker target which should be scanned.
   */
  readonly imageTags: string[];
}

/**
 * Add a Trivy scan target for the images built by a docker target and wire it
 * under the aggregate \`trivy\` target. The scan is not part of \`build\` — run
 * \`nx run-many --target trivy\` (the root \`trivy\` script) in CI.
 *
 * The scan target depends on the docker target and is not cacheable, because
 * what it scans lives in the container engine rather than under its \`outputs\`.
 * Each image is saved to a tarball under \`dist/<projectRoot>/trivy/<scan-key>\`
 * (kept out of any Docker build context) and scanned with the pinned ECR-hosted
 * Trivy image via a workspace-relative bind mount, so the same commands work
 * under both docker and finch. The scan exits non-zero (exit code 1) on
 * HIGH/CRITICAL vulnerabilities.
 *
 * A \`.trivyignore\` is vended at the project root (kept if it already exists)
 * for suppressing findings.
 */
export const addDockerScanTarget = <const D extends DependencyDeclaration>(
  tree: Tree,
  options: DockerScanTargetOptions,
  declaration: D & MustDeclare<typeof DOCKER_DEPENDENCIES, D>,
): void => {
  const { project, containerEngine, trivyTargetName, dockerTargetName } =
    options;
  const { imageTags } = options;
  const projectRoot = project.root;

  const ignoreFilePath = joinPathFragments(projectRoot, TRIVY_IGNORE_FILE);
  if (!tree.exists(ignoreFilePath)) {
    tree.write(ignoreFilePath, TRIVY_IGNORE_CONTENTS);
  }

  // Stage scan artifacts in a directory unique to this scan target so that
  // sibling targets in the same project (e.g. multiple agents) don't clobber
  // each other's tarballs when run in parallel. The first image tag is unique
  // per target, so it makes a stable, collision-free key.
  const scanKey = imageTags[0].replace(/[^a-zA-Z0-9-]/g, '-');
  const scanDir = joinPathFragments('dist', projectRoot, 'trivy', scanKey);
  const trivyImage = containerImage('trivy');

  const fs = new FsCommands(
    tree,
    forDependencies<typeof DOCKER_DEPENDENCIES>(declaration),
  );
  const commands = [
    fs.rm(scanDir),
    fs.mkdir(scanDir),
    fs.cpFile(ignoreFilePath, joinPathFragments(scanDir, TRIVY_IGNORE_FILE)),
  ];

  imageTags.forEach((imageTag, index) => {
    const tarName = `image-${index}.tar`;
    commands.push(
      `${containerEngine} save -o ${joinPathFragments(scanDir, tarName)} ${imageTag}`,
      `${containerEngine} run --rm -v "./${scanDir}":/scan ${trivyImage} image --input /scan/${tarName} --ignorefile /scan/${TRIVY_IGNORE_FILE} --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q`,
    );
  });

  project.targets ??= {};
  project.targets[trivyTargetName] = normalizeTargetKeyOrder({
    // The image being scanned is only reachable through the container engine,
    // so a restored cache entry would report a pass for an image that may no
    // longer exist. The scan re-runs and either scans the real image or fails.
    // Nx only hashes a cacheable task, so declaring `inputs` here would have no
    // effect.
    cache: false,
    outputs: [`{workspaceRoot}/${scanDir}`],
    executor: 'nx:run-commands',
    options: {
      commands,
      parallel: false,
    },
    dependsOn: [dockerTargetName],
  });

  // Aggregate per-component scan targets under a single `trivy` target. The
  // scan is intentionally NOT wired into `build`: image scanning is slow and
  // its result depends on the ever-changing vulnerability database (a scan
  // that passes today can fail tomorrow when a new CVE is published), so
  // coupling it to `build` would make local and CI builds non-deterministic.
  // Run `nx run-many --target trivy` (the root `trivy` script) in CI instead.
  if (trivyTargetName !== 'trivy') {
    addDependencyToTargetIfNotPresent(project, 'trivy', trivyTargetName);
  }
};
