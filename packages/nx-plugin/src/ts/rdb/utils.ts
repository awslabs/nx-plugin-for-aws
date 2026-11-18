/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger, type Tree } from '@nx/devkit';

const RDS_CA_BUNDLE_PATH = '/usr/local/share/ca-certificates/rds-bundle.crt';

const RDS_CA_RUN = [
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
  '    rm -rf /var/lib/apt/lists/* && \\',
  '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
  `    -o ${RDS_CA_BUNDLE_PATH} && \\`,
  '    update-ca-certificates',
].join('\n');

const RDS_CA_ENV = [
  '# Node trusts only its bundled CA store unless it is given extra certificates.',
  `ENV NODE_EXTRA_CA_CERTS=${RDS_CA_BUNDLE_PATH}`,
].join('\n');

/**
 * An `ENV` instruction that assigns NODE_EXTRA_CA_CERTS, in either Dockerfile
 * form: `ENV KEY=VALUE`, optionally preceded by other pairs on the same line,
 * or the legacy `ENV KEY VALUE`. Group 1 is the assigned value. A comment that
 * mentions the variable, a bare `ARG NODE_EXTRA_CA_CERTS` and a differently
 * named variable whose name contains it all fail to match, since none of them
 * gives Node a CA file to read.
 */
const NODE_EXTRA_CA_CERTS_ENV =
  /^[ \t]*ENV[ \t]+(?:[^\s=]+=\S*[ \t]+)*NODE_EXTRA_CA_CERTS(?:=|[ \t]+)(\S*)/m;

/** File content with Windows line endings replaced by Unix ones. */
export const normalizeNewlines = (content: string): string =>
  content.replace(/\r\n/g, '\n');

/**
 * Content to write back, carrying the line endings the file was read with. A
 * file holding any CRLF is written back entirely with CRLF.
 */
export const restoreNewlines = (content: string, original: string): string =>
  original.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content;

/**
 * The CA file path a Dockerfile assigns to NODE_EXTRA_CA_CERTS, or undefined
 * when it assigns nothing to it. Line continuations are joined first, so an
 * `ENV` instruction split across lines is still read, and a quoted value is
 * returned as the bare path it stands for.
 */
export const nodeExtraCaCertsValue = (content: string): string | undefined =>
  NODE_EXTRA_CA_CERTS_ENV.exec(
    normalizeNewlines(content).replace(/\\\n[ \t]*/g, ' '),
  )?.[1].replace(/^(["'])(.*)\1$/, '$2');

/**
 * Where to insert the CA step: at the `EXPOSE` line of the last build stage.
 * Anchoring in the last stage keeps the step and the `ENV` in the stage that
 * runs, rather than in a builder stage of a multi-stage Dockerfile. Undefined
 * when that stage has no `EXPOSE` line, since the step's place is then a guess.
 */
const finalStageExposeIndex = (content: string): number | undefined => {
  const stages = [...content.matchAll(/^FROM[ \t]/gm)];
  const lastStage = stages.at(-1)?.index ?? 0;
  const expose = /^EXPOSE[ \t]+\d+/m.exec(content.slice(lastStage));
  return expose === null ? undefined : lastStage + expose.index;
};

/**
 * Install the RDS CA bundle in a Node agent / MCP server image and point
 * NODE_EXTRA_CA_CERTS at it, since Node ignores the OS trust store.
 *
 * A Dockerfile with the CA step from an earlier version, but no
 * NODE_EXTRA_CA_CERTS, gets the ENV line after it. A NODE_EXTRA_CA_CERTS the
 * user set is never overridden, and a customised CA step is left alone.
 *
 * The step is recognised by the bundle filename alone: a Dockerfile that
 * downloads the bundle under another name gets this step as well, which works,
 * whereas skipping it would leave the image with no NODE_EXTRA_CA_CERTS.
 */
export const injectRdsCaBundleIntoDockerfile = (
  tree: Tree,
  dockerfilePath: string,
): void => {
  if (!tree.exists(dockerfilePath)) return;
  const original = tree.read(dockerfilePath, 'utf-8') ?? '';
  const content = normalizeNewlines(original);
  const hasStep = content.includes('rds-bundle.crt');
  const hasEnv = nodeExtraCaCertsValue(content) !== undefined;

  let updated = content;
  if (!hasStep) {
    const insertAt = finalStageExposeIndex(content);
    if (insertAt === undefined) {
      logger.warn(
        `${dockerfilePath}: the last build stage has no EXPOSE line, so the RDS CA step was not added. Download https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem to ${RDS_CA_BUNDLE_PATH} in that stage and set NODE_EXTRA_CA_CERTS to it, so Node trusts the Aurora certificate.`,
      );
      return;
    }
    const step = hasEnv ? RDS_CA_RUN : `${RDS_CA_RUN}\n${RDS_CA_ENV}`;
    updated = `${content.slice(0, insertAt)}${step}\n\n${content.slice(insertAt)}`;
  } else if (!hasEnv && content.includes(RDS_CA_RUN)) {
    updated = content.replace(RDS_CA_RUN, `${RDS_CA_RUN}\n${RDS_CA_ENV}`);
  }

  if (updated !== content) {
    tree.write(dockerfilePath, restoreNewlines(updated, original));
  }
};
