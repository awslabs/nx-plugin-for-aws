/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';

/**
 * The generator option values the page is being read under.
 *
 * A guide's diagram is not itself configurable — the reader picks option values
 * once, in the run-generator card's command, and every part of the guide follows.
 * The page's option controller publishes the selection on its own element and
 * announces each change, so a diagram redraws with the architecture those options
 * deploy.
 *
 * Pages that track no options simply never see a selection.
 */
export const usePageOptions = (
  enabled: boolean,
): Readonly<Record<string, string>> => {
  const [selected, setSelected] = useState<Readonly<Record<string, string>>>(
    {},
  );

  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector<HTMLElement>('[data-page-options]');
    if (root?.dataset.selection) {
      try {
        setSelected(JSON.parse(root.dataset.selection));
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
