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
import {
  nodeExtraCaCertsValue,
  normalizeNewlines,
  restoreNewlines,
} from '../../../ts/rdb/utils.js';
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
 * adding the ENV line right after it. One that already points
 * NODE_EXTRA_CA_CERTS at the bundle (migrated, or set by the user) or has no
 * RDS CA step is left alone. Two cases are left alone and reported via
 * `nextSteps`: a CA step that no longer matches the step this version wrote,
 * and a NODE_EXTRA_CA_CERTS pointing at a CA file other than the bundle.
 */

/**
 * The generators whose components get the RDS CA step. Hardcoded rather than
 * imported from the generators: a migration matches the ids workspaces
 * recorded at generation time, which must stay fixed even if the generators'
 * current ids change later. `ts#strands-agent` is the id ts#agent recorded
 * before it was renamed in v0.117.0, which is the id the workspaces that first
 * got the CA step (v0.114.3) still carry.
 */
const NODE_RUNTIME_GENERATOR_IDS = [
  'ts#agent',
  'ts#strands-agent',
  'ts#mcp-server',
];

const RDS_CA_BUNDLE_PATH = '/usr/local/share/ca-certificates/rds-bundle.crt';

/** The RDS CA step the connection generators wrote before this change. */
const OLD_RDS_CA_RUN = [
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
  '    rm -rf /var/lib/apt/lists/* && \\',
  '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
  `    -o ${RDS_CA_BUNDLE_PATH} && \\`,
  '    update-ca-certificates',
].join('\n');

/**
 * Markers of an RDS CA step. The bundle filename is what the generator writes;
 * the truststore host catches a step the user kept but changed, including one
 * that downloads the bundle under another name or to another directory.
 */
const RDS_CA_STEP_MARKERS = [
  'rds-bundle.crt',
  'truststore.pki.rds.amazonaws.com',
];

const ENV_LINE = `ENV NODE_EXTRA_CA_CERTS=${RDS_CA_BUNDLE_PATH}`;

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
  `${filePath}: its RDS CA step does not match the step this version wrote, so it was left unchanged. Add "${ENV_LINE}" after the step (pointing at the bundle it installs) so Node trusts the Aurora certificate.`;

const otherCaFileNextStep = (filePath: string, caFile: string): string =>
  `${filePath}: NODE_EXTRA_CA_CERTS points at "${caFile}" rather than the RDS bundle at ${RDS_CA_BUNDLE_PATH}, so it was left unchanged. Node reads one CA file only, so append the RDS bundle to "${caFile}" (for example "RUN cat ${RDS_CA_BUNDLE_PATH} >> ${caFile}" after the CA step) so Node trusts the Aurora certificate.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const filePath of nodeRuntimeDockerfiles(tree)) {
    const original = tree.read(filePath, 'utf-8') ?? '';
    const content = normalizeNewlines(original);
    if (!RDS_CA_STEP_MARKERS.some((marker) => content.includes(marker))) {
      continue; // No rdb connection.
    }
    const caFile = nodeExtraCaCertsValue(content);
    if (caFile !== undefined) {
      if (caFile !== RDS_CA_BUNDLE_PATH) {
        nextSteps.push(otherCaFileNextStep(filePath, caFile));
      }
      continue; // Already migrated, or set by the user.
    }
    if (!content.includes(OLD_RDS_CA_RUN)) {
      nextSteps.push(divergedNextStep(filePath));
      continue;
    }
    tree.write(
      filePath,
      restoreNewlines(
        content.replace(OLD_RDS_CA_RUN, `${OLD_RDS_CA_RUN}\n${RDS_CA_ENV}`),
        original,
      ),
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
