/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';
import { installFinch, setFinchAsContainerEngine } from './finch-install';

// Runs the full generator matrix with `containers.engine: finch` to verify
// every generator that ships container tooling honours the workspace
// override end-to-end. Linux only — installs the upstream Finch .deb and
// runs the finch-daemon (containerd-backed Docker-compatible socket).
smokeTest('pnpm', {
  variant: 'finch',
  setup: () => {
    installFinch();
  },
  onProjectCreate: setFinchAsContainerEngine,
});
