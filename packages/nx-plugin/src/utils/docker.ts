/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { FsCommands } from './fs';
import { addDependencyToTargetIfNotPresent } from './nx';
import { CONTAINER_VERSIONS } from './versions';

const TRIVY_IGNORE_FILE = '.trivyignore';

const TRIVY_IGNORE_CONTENTS = `# Trivy ignore file. Add one vulnerability ID (e.g. CVE-2021-12345) per line to
# suppress it during the image scan run on build.
# https://trivy.dev/latest/docs/configuration/filtering/#by-finding-ids
`;

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
 * Add a cacheable Trivy scan target for the images built by a docker target,
 * wire it under the aggregate \`trivy\` target, and make \`build\` depend on it.
 *
 * The scan target depends on the docker target and declares the project source
 * as its inputs, so an unchanged image is never re-scanned (a cache hit skips
 * the scan entirely). Each image is saved to a tarball under
 * \`dist/<projectRoot>/trivy/<scan-key>\` (kept out of any Docker build context)
 * and scanned with the pinned ECR-hosted Trivy image via a workspace-relative
 * bind mount, so the same commands work under both docker and finch. The scan
 * fails the build (exit code 1) on HIGH/CRITICAL vulnerabilities.
 *
 * A \`.trivyignore\` is vended at the project root (kept if it already exists)
 * for suppressing findings.
 */
export const addDockerScanTarget = (
  tree: Tree,
  options: DockerScanTargetOptions,
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
  const trivyImage = `public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy}`;

  const fs = new FsCommands(tree);
  const commands = [
    fs.rm(scanDir),
    fs.mkdir(scanDir),
    fs.cp(ignoreFilePath, joinPathFragments(scanDir, TRIVY_IGNORE_FILE)),
  ];

  imageTags.forEach((imageTag, index) => {
    const tarName = `image-${index}.tar`;
    commands.push(
      `${containerEngine} save -o ${joinPathFragments(scanDir, tarName)} ${imageTag}`,
      `${containerEngine} run --rm -v "./${scanDir}":/scan ${trivyImage} image --input /scan/${tarName} --ignorefile /scan/${TRIVY_IGNORE_FILE} --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q`,
    );
  });

  project.targets ??= {};
  project.targets[trivyTargetName] = {
    cache: true,
    // The scanned image is fully determined by the project source, so caching
    // on the source ensures an unchanged image is never re-scanned.
    inputs: ['default', '^production'],
    outputs: [`{workspaceRoot}/${scanDir}`],
    executor: 'nx:run-commands',
    options: {
      commands,
      parallel: false,
    },
    dependsOn: [dockerTargetName],
  };

  // Aggregate per-component scan targets under a single `trivy` target, and
  // make `build` run the scan.
  if (trivyTargetName !== 'trivy') {
    addDependencyToTargetIfNotPresent(project, 'trivy', trivyTargetName);
  }
  addDependencyToTargetIfNotPresent(project, 'build', 'trivy');
};
