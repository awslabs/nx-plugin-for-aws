/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';

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
 * Install the RDS CA bundle in a Node agent / MCP server image and point
 * NODE_EXTRA_CA_CERTS at it, since Node ignores the OS trust store.
 *
 * A Dockerfile with the CA step from an earlier version, but no
 * NODE_EXTRA_CA_CERTS, gets the ENV line after it. A NODE_EXTRA_CA_CERTS the
 * user set is never overridden, and a customised CA step is left alone.
 */
export const injectRdsCaBundleIntoDockerfile = (
  tree: Tree,
  dockerfilePath: string,
): void => {
  if (!tree.exists(dockerfilePath)) return;
  const content = tree.read(dockerfilePath, 'utf-8') ?? '';
  const hasStep = content.includes('rds-bundle.crt');
  const hasEnv = content.includes('NODE_EXTRA_CA_CERTS');

  let updated = content;
  if (!hasStep) {
    const step = hasEnv ? RDS_CA_RUN : `${RDS_CA_RUN}\n${RDS_CA_ENV}`;
    updated = content.replace(/^(EXPOSE \d+)/m, `${step}\n\n$1`);
  } else if (!hasEnv && content.includes(RDS_CA_RUN)) {
    updated = content.replace(RDS_CA_RUN, `${RDS_CA_RUN}\n${RDS_CA_ENV}`);
  }

  if (updated !== content) {
    tree.write(dockerfilePath, updated);
  }
};
