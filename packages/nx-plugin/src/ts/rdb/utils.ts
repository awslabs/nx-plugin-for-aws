/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';

const RDS_CA_RUN = [
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
  '    rm -rf /var/lib/apt/lists/* && \\',
  '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
  '    -o /usr/local/share/ca-certificates/rds-bundle.crt && \\',
  '    update-ca-certificates',
].join('\n');

export const injectRdsCaBundleIntoDockerfile = (
  tree: Tree,
  dockerfilePath: string,
): void => {
  if (!tree.exists(dockerfilePath)) return;
  const content = tree.read(dockerfilePath, 'utf-8')!;
  if (content.includes('rds-bundle.crt')) return;
  tree.write(
    dockerfilePath,
    content.replace(/^(EXPOSE \d+)/m, `${RDS_CA_RUN}\n\n$1`),
  );
};
