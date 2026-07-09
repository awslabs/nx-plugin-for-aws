/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';

const RDS_CA_RUN = [
  'ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/ca-certificates/rds-global-bundle.crt',
  'RUN update-ca-certificates',
].join('\n');

export const injectRdsCaBundleIntoDockerfile = (
  tree: Tree,
  dockerfilePath: string,
): void => {
  if (!tree.exists(dockerfilePath)) return;
  const content = tree.read(dockerfilePath, 'utf-8');
  if (!content) return;
  if (content.includes('global-bundle.pem')) return;
  tree.write(
    dockerfilePath,
    content.replace(/^(EXPOSE \d+)/m, `${RDS_CA_RUN}\n\n$1`),
  );
};
