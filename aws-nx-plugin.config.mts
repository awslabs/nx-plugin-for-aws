/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AwsNxPluginConfig } from '@aws/nx-plugin';
import {
  DEFAULT_LICENSE_ALLOWLIST,
  npmCollector,
} from '@aws/nx-plugin/sdk/license';
export default {
  license: {
    source: {
      spdx: 'Apache-2.0',
      copyrightHolder: 'Amazon.com, Inc. or its affiliates',
      header: {
        content: {
          lines: [
            'Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.',
            'SPDX-License-Identifier: Apache-2.0',
          ],
        },
        format: {
          '**/*.{js,ts,mjs,mts,tsx,jsx}': {
            blockStart: '/**',
            lineStart: ' * ',
            blockEnd: ' */',
          },
          '**/*.{py,sh}': { blockStart: '# ', lineStart: '# ', blockEnd: '# ' },
        },
        exclude: ['e2e/src/linked-templates/**/*'],
      },
    },
    dependencies: {
      allow: DEFAULT_LICENSE_ALLOWLIST,
      collectors: [npmCollector()],
      exceptions: [
        {
          package: '@modelcontextprotocol/inspector',
          reason:
            'MCP project is licensed Apache-2.0 / MIT. Tarball omits the LICENSE file.',
          spdx: 'Apache-2.0',
        },
      ],
    },
  },
} satisfies AwsNxPluginConfig;
