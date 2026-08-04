/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo, useState } from 'react';
import {
  CATEGORY_ORDER,
  NODE_TYPES,
  type NodeType,
} from '../../lib/graph-builder/catalog';
import { NodeLogo } from './node-logo';

interface Props {
  /** Called when a palette entry is dragged out, carrying the type id. */
  onDragStart: (typeId: string) => void;
  onDragEnd: () => void;
  /** Called when an entry is activated by click or keyboard. */
  onAdd: (typeId: string) => void;
  /** Type ids that can connect to or from the current selection, if any. */
  highlighted?: Set<string>;
}

const LANGUAGE_LABELS: Record<NodeType['language'], string> = {
  ts: 'TypeScript',
  py: 'Python',
  agnostic: 'Any',
};

export const Palette = ({
  onDragStart,
  onDragEnd,
  onAdd,
  highlighted,
}: Props) => {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = NODE_TYPES.filter(
      (type) =>
        term === '' ||
        type.label.toLowerCase().includes(term) ||
        type.id.toLowerCase().includes(term) ||
        type.generator.toLowerCase().includes(term),
    );
    // Categories in sidebar order, with any category not in the list appended —
    // a node type from a newly added generator still shows up.
    const categories = [
      ...CATEGORY_ORDER.filter((c) => matches.some((m) => m.category === c)),
      ...[...new Set(matches.map((m) => m.category))].filter(
        (c) => !(CATEGORY_ORDER as readonly string[]).includes(c),
      ),
    ];
    return categories.map((category) => ({
      category,
      types: matches.filter((m) => m.category === category),
    }));
  }, [query]);

  return (
    <div className="gb-palette">
      <div className="gb-palette-search">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder="Search components"
          aria-label="Search components"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="gb-palette-scroll">
        {groups.map(({ category, types }) => (
          <div className="gb-palette-group" key={category}>
            <h3 className="gb-palette-group-title">{category}</h3>
            <ul className="gb-palette-list">
              {types.map((type) => (
                <li key={type.id}>
                  <button
                    type="button"
                    className={`gb-palette-item${highlighted?.has(type.id) ? ' is-compatible' : ''}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', type.id);
                      event.dataTransfer.effectAllowed = 'copy';
                      onDragStart(type.id);
                    }}
                    onDragEnd={onDragEnd}
                    onClick={() => onAdd(type.id)}
                    title={`${type.label} — nx g @aws/nx-plugin:${type.generator}`}
                  >
                    <NodeLogo
                      logo={type.logo}
                      badge={type.badge}
                      alt={type.label}
                    />
                    <span className="gb-palette-item-text">
                      <span className="gb-palette-item-label">
                        {type.label}
                      </span>
                      <span className="gb-palette-item-meta">
                        {LANGUAGE_LABELS[type.language]}
                        {type.kind === 'component' ? ' · component' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="gb-palette-empty">No components match “{query}”.</p>
        )}
      </div>
    </div>
  );
};
