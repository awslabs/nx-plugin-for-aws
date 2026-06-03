/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DependencyCheckException } from './dependency-check/types';

export const MCP_INSPECTOR_EXCEPTIONS: DependencyCheckException[] = [
  {
    package: '@modelcontextprotocol/inspector',
    reason:
      'MCP project is licensed Apache-2.0 / MIT. Tarball omits the LICENSE file.',
    spdx: 'Apache-2.0',
  },
  {
    package: '@modelcontextprotocol/inspector-cli',
    reason:
      'MCP project is licensed Apache-2.0 / MIT. Tarball omits the LICENSE file.',
    spdx: 'Apache-2.0',
  },
  {
    package: '@modelcontextprotocol/inspector-server',
    reason:
      'MCP project is licensed Apache-2.0 / MIT. Tarball omits the LICENSE file.',
    spdx: 'Apache-2.0',
  },
  {
    package: '@modelcontextprotocol/inspector-client',
    reason:
      'MCP project is licensed Apache-2.0 / MIT. Tarball omits the LICENSE file.',
    spdx: 'Apache-2.0',
  },
];

export const AG_UI_STRANDS_EXCEPTIONS: DependencyCheckException[] = [
  {
    package: 'ag_ui_strands',
    reason:
      'Part of MIT-licensed ag-ui-protocol/ag-ui repo. Wheel ships without license metadata.',
    spdx: 'MIT',
  },
];
