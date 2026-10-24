/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx.js';

// `import.meta.dirname` (not `import.meta.url`): under Vite/Vitest's module
// transform, this file's `import.meta.url` carries a root-relative pathname
// with the real filesystem prefix stripped, so a sibling path built from it
// resolves to a nonexistent file and `getGeneratorInfo` silently returns
// `undefined`. `import.meta.dirname` reflects the real directory in both the
// built and the transformed dev/test module.
export const GREENGRASS_COMPONENT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(path.join(import.meta.dirname, 'generator.ts'));
