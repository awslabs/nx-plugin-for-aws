/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AwsNxPluginConfig } from '@aws/nx-plugin';
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
          package: 'eslint-plugin-local-custom-nx-plugin-for-aws-rules',
          reason:
            'First-party Apache-2.0 workspace tooling; license metadata is not exposed via the file: linked node_modules copy.',
          spdx: 'Apache-2.0',
        },
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
