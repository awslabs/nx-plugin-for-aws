/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';

/**
 * The generator option values the page's filter bar has selected.
 *
 * A guide's diagram is not itself configurable — the reader picks option values
 * once, in the filter bar at the top of the page, and every part of the guide
 * follows. The bar publishes its selection on the element itself and announces
 * each change, so a diagram redraws with the architecture those options deploy.
 *
 * Pages without a filter bar simply never see a selection.
 */
export const usePageOptions = (
  enabled: boolean,
): Readonly<Record<string, string>> => {
  const [selected, setSelected] = useState<Readonly<Record<string, string>>>(
    {},
  );

  useEffect(() => {
    if (!enabled) return;
    const bar = document.querySelector<HTMLElement>('[data-option-filter-bar]');
    if (bar?.dataset.selection) {
      try {
        setSelected(JSON.parse(bar.dataset.selection));
      } catch {
        // A malformed selection is nothing to act on; the next change re-reads it.
      }
    }
    const onChange = (event: Event) =>
      setSelected((event as CustomEvent<Record<string, string>>).detail ?? {});
    document.addEventListener('npfa:option-filter-change', onChange);
    return () =>
      document.removeEventListener('npfa:option-filter-change', onChange);
  }, [enabled]);

  return selected;
};
