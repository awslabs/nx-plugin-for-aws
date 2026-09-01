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
 * Remove pip from the vended Python agent / MCP server images.
 *
 * The runtime runs entirely from the bundled `/app` environment and never needs
 * pip, whose vendored packages (setuptools, msgpack) in the base image carry
 * known HIGH/CRITICAL vulnerabilities the image scan flags. New workspaces get
 * this from the generator templates; this brings existing ones up to date.
 *
 * Only the Dockerfiles of `py#agent` / `py#mcp-server` components are touched,
 * located from their project metadata. The Dockerfile is generated
 * `KeepExisting`, so it is edited in place: the pip removal is inserted right
 * after the `FROM` line. A Dockerfile whose pip usage has been customised (an
 * added `pip install`, or any pip command other than this removal) is left
 * untouched and reported via `nextSteps`, since stripping pip could break it.
 */

/**
 * The generators whose runtime images vend pip and should have it stripped.
 * Hardcoded rather than imported from the generators: a migration matches the
 * ids workspaces recorded at generation time, which must stay fixed even if the
 * generators' current ids change later.
 */
const RUNTIME_IMAGE_GENERATOR_IDS = ['py#agent', 'py#mcp-server'];

const PIP_REMOVAL = `# Remove the base image's pip: the runtime runs from the bundled environment and
# never needs it, and pip's vendored packages carry known HIGH/CRITICAL
# vulnerabilities flagged by the image scan.
RUN python -m pip uninstall -y pip && \\
    rm -rf /usr/local/lib/python*/site-packages/pip \\
           /usr/local/lib/python*/site-packages/pip-*.dist-info`;

/** The exact pip command this migration adds; used to detect an applied fix. */
const PIP_UNINSTALL = 'pip uninstall -y pip';

/** Matches any `pip` invocation in a RUN instruction (python -m pip … or pip …). */
const PIP_COMMAND = /\b(?:python\s+-m\s+)?pip\s+\S+/g;

/**
 * The Dockerfiles of every `py#agent` / `py#mcp-server` component, located from
 * each project's recorded component metadata (`path` is the component directory
 * relative to the project root).
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
  const nextSteps: string[] = [];

  for (const filePath of runtimeImageDockerfiles(tree)) {
    const content = tree.read(filePath, 'utf-8');
    if (!content) {
      continue;
    }
    if (content.includes(PIP_UNINSTALL)) {
      continue; // Already stripped (migrated or user-added).
    }

    // Leave a customised Dockerfile alone: any pip usage other than this
    // migration's removal (e.g. an added `pip install`) means stripping pip
    // could break the image, so flag it for the user instead of editing.
    const pipUsages = content.match(PIP_COMMAND) ?? [];
    if (pipUsages.length > 0) {
      nextSteps.push(
        `In ${filePath}: this image uses pip (${pipUsages.join(', ')}), so it was left unchanged. pip's vendored packages carry known vulnerabilities flagged by the image scan — remove pip once it is no longer needed, e.g. \`RUN python -m pip uninstall -y pip && rm -rf /usr/local/lib/python*/site-packages/pip /usr/local/lib/python*/site-packages/pip-*.dist-info\`.`,
      );
      continue;
    }

    // Insert the pip removal after the FROM line and its trailing blank line,
    // matching the spacing a freshly generated Dockerfile has.
    const updated = content.replace(
      /^(FROM\s+\S*python:.*\n)\n/m,
      `$1\n${PIP_REMOVAL}\n\n`,
    );
    if (updated === content) {
      nextSteps.push(
        `In ${filePath}: remove pip from the image so its vulnerable vendored packages are not scanned — add \`RUN python -m pip uninstall -y pip && rm -rf /usr/local/lib/python*/site-packages/pip /usr/local/lib/python*/site-packages/pip-*.dist-info\` after the FROM line (the runtime does not need pip).`,
      );
      continue;
    }
    tree.write(filePath, updated);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
