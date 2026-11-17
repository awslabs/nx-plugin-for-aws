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
 * Set NODE_EXTRA_CA_CERTS in the ts#agent / ts#mcp-server Dockerfiles that
 * ts#rdb's agent and MCP server connections gave the RDS CA step.
 *
 * The step downloads the RDS global bundle into the OS trust store and runs
 * `update-ca-certificates`. Node ignores that store, so a direct connection to
 * Aurora (with RDS Proxy disabled) fails certificate verification. Pointing
 * NODE_EXTRA_CA_CERTS at the downloaded bundle makes Node trust it. New
 * connections get this from the generator; this brings existing Dockerfiles
 * up to date.
 *
 * The Dockerfiles are located from each project's component metadata. Only a
 * Dockerfile that still has the exact step the generator wrote is edited, by
 * adding the ENV line right after it. One that already sets
 * NODE_EXTRA_CA_CERTS (migrated or user-set) or has no RDS CA step is left
 * alone. One whose step has been customised is left alone and reported via
 * `nextSteps`.
 */

/**
 * The generators whose components get the RDS CA step. Hardcoded rather than
 * imported from the generators: a migration matches the ids workspaces
 * recorded at generation time, which must stay fixed even if the generators'
 * current ids change later.
 */
const NODE_RUNTIME_GENERATOR_IDS = ['ts#agent', 'ts#mcp-server'];

/** The RDS CA step the connection generators wrote before this change. */
const OLD_RDS_CA_RUN = [
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
  '    rm -rf /var/lib/apt/lists/* && \\',
  '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
  '    -o /usr/local/share/ca-certificates/rds-bundle.crt && \\',
  '    update-ca-certificates',
].join('\n');

const ENV_LINE =
  'ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-bundle.crt';

/** The lines this migration adds after the step, as the generator writes them. */
const RDS_CA_ENV = [
  '# Node trusts only its bundled CA store unless it is given extra certificates.',
  ENV_LINE,
].join('\n');

/** A project's root, falling back to sourceRoot for the TS-solution layout. */
const projectRoot = (project: ProjectConfiguration): string =>
  project.root ?? project.sourceRoot ?? '';

/** The Dockerfiles of every ts#agent / ts#mcp-server component. */
const nodeRuntimeDockerfiles = (tree: Tree): string[] => {
  const paths: string[] = [];
  for (const project of getProjects(tree).values()) {
    const components =
      (project.metadata as { components?: ComponentMetadata[] } | undefined)
        ?.components ?? [];
    for (const component of components) {
      if (
        !NODE_RUNTIME_GENERATOR_IDS.includes(component.generator) ||
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

const divergedNextStep = (filePath: string): string =>
  `${filePath}: its RDS CA step has been customised, so it was left unchanged. Add "${ENV_LINE}" after the step (pointing at the bundle it installs) so Node trusts the Aurora certificate.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const filePath of nodeRuntimeDockerfiles(tree)) {
    const content = tree.read(filePath, 'utf-8') ?? '';
    if (!content.includes('rds-bundle.crt')) {
      continue; // No rdb connection.
    }
    if (content.includes('NODE_EXTRA_CA_CERTS')) {
      continue; // Already migrated (or user-set).
    }
    if (!content.includes(OLD_RDS_CA_RUN)) {
      nextSteps.push(divergedNextStep(filePath));
      continue;
    }
    tree.write(
      filePath,
      content.replace(OLD_RDS_CA_RUN, `${OLD_RDS_CA_RUN}\n${RDS_CA_ENV}`),
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
