/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AwsNxPluginConfig } from '@aws/nx-plugin';
export default {
  license: {
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
      exclude: [],
    },
  },
} satisfies AwsNxPluginConfig;
