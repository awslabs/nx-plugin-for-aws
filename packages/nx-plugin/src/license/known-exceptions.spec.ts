/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AG_UI_LANGGRAPH_EXCEPTIONS } from './known-exceptions';

describe('AG_UI_LANGGRAPH_EXCEPTIONS', () => {
  // The license check matches exception `package` against the name pip-licenses
  // reports, exactly (check.ts findException: `e.package === name`). pip-licenses
  // reports ag-ui-langgraph with HYPHENS (unlike ag_ui_strands, which reports
  // underscores). A copied-from-strands underscore name silently never matches,
  // and the langchain agent fails license-check as UNKNOWN.
  it('declares ag-ui-langgraph with the hyphenated name pip-licenses reports', () => {
    const agui = AG_UI_LANGGRAPH_EXCEPTIONS.find(
      (e) => e.package === 'ag-ui-langgraph',
    );
    expect(agui).toBeDefined();
    expect(
      AG_UI_LANGGRAPH_EXCEPTIONS.some((e) => e.package === 'ag_ui_langgraph'),
    ).toBe(false);
  });

  // jsonpatch (and its transitive jsonpointer) are unconditional deps of
  // langchain-core. Their wheels carry only the free-text "Modified BSD License"
  // metadata, so they need per-package BSD-3-Clause exceptions rather than a
  // broad allowlist alias.
  it('covers the jsonpatch / jsonpointer langchain-core transitives', () => {
    for (const pkg of ['jsonpatch', 'jsonpointer']) {
      const entry = AG_UI_LANGGRAPH_EXCEPTIONS.find((e) => e.package === pkg);
      expect(entry).toBeDefined();
      expect(entry!.spdx).toBe('BSD-3-Clause');
    }
  });
});
