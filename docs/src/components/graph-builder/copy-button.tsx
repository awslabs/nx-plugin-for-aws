/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';

interface Props {
  /** What lands on the clipboard. */
  text: string;
  /**
   * The button's label. Left off, the button is the icon alone — for a window's
   * title bar, where there is no room for words.
   */
  label?: string;
  /** The label the button takes while showing that it copied. */
  copiedLabel?: string;
  /** Used as the accessible name when there is no visible label. */
  title?: string;
  disabled?: boolean;
}

/**
 * A copy-to-clipboard button that reports back, in the plugin's accent, whether
 * it is labelled or icon-only.
 */
export const CopyButton = ({
  text,
  label,
  copiedLabel = 'Copied',
  title,
  disabled,
}: Props) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; nothing to fall back to here.
    }
  };

  return (
    <button
      type="button"
      className={`gb-copy-btn${label ? '' : ' gb-copy-btn--icon'}${
        copied ? ' is-copied' : ''
      }`}
      onClick={copy}
      disabled={disabled}
      title={title}
      aria-label={label ? undefined : title}
    >
      <svg
        className="gb-copy-icon gb-copy-icon--copy"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <svg
        className="gb-copy-icon gb-copy-icon--check"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {label && <span>{copied ? copiedLabel : label}</span>}
    </button>
  );
};
