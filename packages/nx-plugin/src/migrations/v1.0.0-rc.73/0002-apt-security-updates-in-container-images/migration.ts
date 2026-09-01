/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import type { ComponentMetadata } from '../../../utils/nx.js';

/**
 * Apply the distribution's security updates in the vended agent / MCP server
 * images.
 *
 * A base image tag lags behind its distribution's security suite, so the OS
 * packages it ships carry vulnerabilities that already have a fixed version
 * published — which the image scan flags as HIGH/CRITICAL. Upgrading them in the
 * image build clears those findings whenever the scan runs, rather than waiting
 * for the base image to be rebuilt. New workspaces get this from the generator
 * templates; this brings existing ones up to date.
 *
 * Only the Dockerfiles of the components whose images the generators vend are
 * touched, located from their project metadata. The Dockerfile is generated
 * `KeepExisting`, so it is edited in place: the upgrade is inserted right after
 * the `FROM` line, ahead of every other instruction, so later layers install
 * against the upgraded packages. One that already runs `apt-get upgrade`, or
 * which has been re-based onto an image `apt-get` can't upgrade, is left alone.
 */

/**
 * The generators whose runtime images the vended Dockerfiles build. Hardcoded
 * rather than imported from the generators: a migration matches the ids
 * workspaces recorded at generation time, which must stay fixed even if the
 * generators' current ids change later.
 */
const RUNTIME_IMAGE_GENERATOR_IDS = [
  'py#agent',
  'py#mcp-server',
  'ts#agent',
  'ts#mcp-server',
];

const APT_UPGRADE = `# Apply the distribution's security updates: base image tags lag behind the
# security suite, so its OS packages carry fixed HIGH/CRITICAL vulnerabilities
# flagged by the image scan.
RUN apt-get update && \\
    apt-get upgrade -y --no-install-recommends && \\
    rm -rf /var/lib/apt/lists/*`;

/** The apt command this migration adds; used to detect an applied fix. */
const APT_UPGRADE_COMMAND = 'apt-get upgrade';

/**
 * The Debian-derived base images the generators vend, whose packages `apt-get`
 * upgrades. A user who has re-based onto another image (Alpine, distroless,
 * Amazon Linux) needs a different command, so theirs is left as they wrote it.
 */
const DEBIAN_BASE_IMAGE = /^FROM\s+\S*(?:node|python):\S*\n/m;

/**
 * The Dockerfiles of every runtime image component, located from each project's
 * recorded component metadata (`path` is the component directory relative to
 * the project root).
 */
const runtimeImageDockerfiles = (tree: Tree): string[] => {
  const paths: string[] = [];
  for (const project of getProjects(tree).values()) {
    const components = ((
      project.metadata as { components?: ComponentMetadata[] }
    )?.components ?? []) as ComponentMetadata[];
    for (const component of components) {
      if (
        !RUNTIME_IMAGE_GENERATOR_IDS.includes(component.generator) ||
        !component.path
      ) {
        continue;
      }
      const dockerfile = joinPathFragments(
        projectRoot(project),
        component.path,
        'Dockerfile',
      );
      if (tree.exists(dockerfile)) {
        paths.push(dockerfile);
      }
    }
  }
  return paths;
};

/** A project's root, falling back to sourceRoot for the TS-solution layout. */
const projectRoot = (project: ProjectConfiguration): string =>
  project.root ?? project.sourceRoot ?? '';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  for (const filePath of runtimeImageDockerfiles(tree)) {
    const content = tree.read(filePath, 'utf-8');
    if (!content) {
      continue;
    }
    if (content.includes(APT_UPGRADE_COMMAND)) {
      continue; // Already upgrading (migrated or user-added).
    }

    const from = content.match(DEBIAN_BASE_IMAGE);
    if (from?.index === undefined) {
      continue; // The user has re-based the image; theirs to patch, not ours.
    }

    // Insert the upgrade after the FROM line, ahead of every other instruction
    // so later layers install against the upgraded packages, with the spacing a
    // freshly generated Dockerfile has.
    const insertAt = from.index + from[0].length;
    tree.write(
      filePath,
      `${content.slice(0, insertAt)}\n${APT_UPGRADE}\n${content.slice(insertAt)}`,
    );
  }

  await formatFilesInSubtree(tree);

  return {};
}
