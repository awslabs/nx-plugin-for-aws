/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DependencyCheckException } from './dependency-check/types';

export const AG_UI_LANGGRAPH_EXCEPTIONS: DependencyCheckException[] = [
  {
    package: 'jsonpatch',
    reason:
      'Unconditional dependency of langchain-core. Genuinely BSD-3-Clause (LICENSE matches the SPDX BSD-3-Clause template), but the wheel only carries the free-text "Modified BSD License" metadata, not an SPDX expression.',
    spdx: 'BSD-3-Clause',
  },
  {
    package: 'jsonpointer',
    reason:
      'Transitive dependency of jsonpatch (via langchain-core). Genuinely BSD-3-Clause (LICENSE matches the SPDX BSD-3-Clause template), but the wheel only carries the free-text "Modified BSD License" metadata, not an SPDX expression.',
    spdx: 'BSD-3-Clause',
  },
];
