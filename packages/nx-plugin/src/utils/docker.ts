/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import { FsCommands } from './fs';
import { CONTAINER_VERSIONS } from './versions';

const TRIVY_IGNORE_FILE = '.trivyignore';

const TRIVY_IGNORE_CONTENTS = `# Trivy ignore file. Add one vulnerability ID (e.g. CVE-2021-12345) per line to
# suppress it during the image scan run on build.
# https://trivy.dev/latest/docs/configuration/filtering/#by-finding-ids
`;

export interface DockerImageScanOptions {
  /**
   * Container engine command to invoke (\`docker\` or \`finch\`).
   */
  readonly containerEngine: string;
  /**
   * Root of the project the image belongs to, used to locate the project's
   * \`.trivyignore\` and to stage scan artifacts under \`dist\`.
   */
  readonly projectRoot: string;
  /**
   * Tags of the images built by the docker target which should be scanned.
   */
  readonly imageTags: string[];
}

/**
 * Vend a \`.trivyignore\` at the project root (kept if it already exists) and
 * return the commands that scan each built image with the pinned ECR-hosted
 * Trivy image.
 *
 * Each image is saved to a tarball under \`dist/<projectRoot>/trivy\` (kept out
 * of any Docker build context) and scanned via a workspace-relative bind mount
 * so the same commands work under both docker and finch. The scan fails the
 * build (exit code 1) on fixable HIGH/CRITICAL vulnerabilities; \`--ignore-unfixed\`
 * keeps unactionable base-image advisories from blocking the build.
 *
 * The returned commands are intended to be appended to the docker target's
 * \`commands\`, running after the image build.
 */
export const addDockerImageScanCommands = (
  tree: Tree,
  options: DockerImageScanOptions,
): string[] => {
  const { containerEngine, projectRoot, imageTags } = options;

  const ignoreFilePath = joinPathFragments(projectRoot, TRIVY_IGNORE_FILE);
  if (!tree.exists(ignoreFilePath)) {
    tree.write(ignoreFilePath, TRIVY_IGNORE_CONTENTS);
  }

  const scanDir = joinPathFragments('dist', projectRoot, 'trivy');
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

  return commands;
};
