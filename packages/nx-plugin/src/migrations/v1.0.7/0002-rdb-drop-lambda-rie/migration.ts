/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { PY_RDB_GENERATOR_INFO } from '../../../py/rdb/generator.js';
import { TS_RDB_GENERATOR_INFO } from '../../../ts/rdb/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Remove the Lambda Runtime Interface Emulator (RIE) from the vended ts#rdb
 * and py#rdb Dockerfiles.
 *
 * `/lambda-entrypoint.sh` only invokes RIE when AWS_LAMBDA_RUNTIME_API is
 * unset, i.e. for local `docker run` emulation outside Lambda — the deployed
 * function never runs it. Its upstream build lags the Go toolchain, so it
 * carries known HIGH vulnerabilities (net/http and crypto/tls DoS CVEs) the
 * image scan flags with no fixed upstream image coming soon. Stripping it
 * follows the same pattern the templates already use for other unused,
 * vulnerable parts of the base image (py#rdb removing pip, ts#rdb removing
 * the runtime's AWS SDK copy). New workspaces get this from the generator
 * templates; this brings existing ones up to date.
 *
 * Only the three Dockerfiles the ts#rdb / py#rdb generators vend are touched,
 * located from each rdb project's root (recorded in its metadata). Each is
 * edited in place only where its comment + `RUN microdnf upgrade ...` block
 * still has the exact shape the generator wrote before this change; one that
 * has diverged (a customised comment or upgrade command) is left untouched
 * and reported via `nextSteps`.
 */

const AWS_LAMBDA_RIE = '/usr/local/bin/aws-lambda-rie';

/**
 * The exact comment + `RUN microdnf upgrade ...` block ts#rdb's Dockerfile had
 * before this migration, and what it becomes.
 */
const TS_RDB_OLD_UPGRADE = `# Patch OS packages beyond the base image's pinned release, and drop the
# runtime's convenience copy of the AWS SDK (the handler bundle inlines its
# own dependencies), keeping the image free of known HIGH/CRITICAL
# vulnerabilities
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/runtime/node_modules/@aws-sdk`;
const TS_RDB_NEW_UPGRADE = `# Patch OS packages beyond the base image's pinned release, and drop the
# runtime's convenience copy of the AWS SDK (the handler bundle inlines its
# own dependencies), keeping the image free of known HIGH/CRITICAL
# vulnerabilities. Also drop the Lambda Runtime Interface Emulator: it is only
# used for local \`docker run\` emulation outside Lambda, never by the deployed
# function, and carries known HIGH vulnerabilities.
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/runtime/node_modules/@aws-sdk ${AWS_LAMBDA_RIE}`;

/**
 * The exact comment + `RUN microdnf upgrade ...` block py#rdb's two Dockerfiles
 * had before this migration, and what it becomes. Both Dockerfile.migration and
 * Dockerfile.create-db-user share this block verbatim.
 */
const PY_RDB_OLD_UPGRADE = `# Patch OS packages beyond the base image's pinned release, and drop pip, whose
# vendored copies of msgpack and setuptools carry known HIGH vulnerabilities.
# The handler's dependencies are already installed in the image, so nothing
# installs packages at runtime.
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/lang/lib/python*/site-packages/pip \\
    /var/lang/lib/python*/site-packages/pip-*.dist-info`;
const PY_RDB_NEW_UPGRADE = `# Patch OS packages beyond the base image's pinned release, and drop pip, whose
# vendored copies of msgpack and setuptools carry known HIGH vulnerabilities.
# The handler's dependencies are already installed in the image, so nothing
# installs packages at runtime. Also drop the Lambda Runtime Interface
# Emulator: it is only used for local \`docker run\` emulation outside Lambda,
# never by the deployed function, and carries known HIGH vulnerabilities.
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/lang/lib/python*/site-packages/pip \\
    /var/lang/lib/python*/site-packages/pip-*.dist-info \\
    ${AWS_LAMBDA_RIE}`;

/** The marker checked to detect an already-migrated (or user-added) removal. */
const RIE_REMOVED_MARKER = AWS_LAMBDA_RIE;

const divergedNextStep = (filePath: string): string =>
  `${filePath}: its microdnf upgrade command has been customised, so it was left unchanged. Remove the Lambda Runtime Interface Emulator by adding "${AWS_LAMBDA_RIE}" to its "rm -rf" — it is only used for local \`docker run\` emulation outside Lambda and carries known HIGH vulnerabilities.`;

/**
 * Replace a Dockerfile's old comment + upgrade block with the new one, only
 * when the file still has the exact shape the generator wrote. Already
 * migrated and diverged files are both left alone; the latter is reported via
 * nextSteps.
 */
const migrateDockerfile = (
  tree: Tree,
  filePath: string,
  oldBlock: string,
  newBlock: string,
  nextSteps: string[],
): void => {
  if (!tree.exists(filePath)) {
    return;
  }

  const content = tree.read(filePath, 'utf-8') ?? '';
  if (content.includes(RIE_REMOVED_MARKER)) {
    return; // Already migrated (or user-added).
  }

  if (!content.includes(oldBlock)) {
    nextSteps.push(divergedNextStep(filePath));
    return;
  }

  tree.write(filePath, content.replace(oldBlock, newBlock));
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;

    if (generator === TS_RDB_GENERATOR_INFO.id) {
      migrateDockerfile(
        tree,
        joinPathFragments(project.root, 'Dockerfile'),
        TS_RDB_OLD_UPGRADE,
        TS_RDB_NEW_UPGRADE,
        nextSteps,
      );
    } else if (generator === PY_RDB_GENERATOR_INFO.id) {
      migrateDockerfile(
        tree,
        joinPathFragments(project.root, 'Dockerfile.migration'),
        PY_RDB_OLD_UPGRADE,
        PY_RDB_NEW_UPGRADE,
        nextSteps,
      );
      migrateDockerfile(
        tree,
        joinPathFragments(project.root, 'Dockerfile.create-db-user'),
        PY_RDB_OLD_UPGRADE,
        PY_RDB_NEW_UPGRADE,
        nextSteps,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
