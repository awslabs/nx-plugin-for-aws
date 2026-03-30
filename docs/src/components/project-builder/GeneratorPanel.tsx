/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GENERATORS, CATEGORY_LABELS } from './generators';
import { getIcon } from './icons';
import type { GeneratorDefinition } from './types';

interface GeneratorPanelProps {
  onAdd: (generator: GeneratorDefinition) => void;
}

const GeneratorPanel: React.FC<GeneratorPanelProps> = ({ onAdd }) => {
  const categories = Object.keys(CATEGORY_LABELS);

  const onDragStart = (
    event: React.DragEvent,
    generator: GeneratorDefinition,
  ) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({ generatorId: generator.id }),
    );
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      style={{
        width: '220px',
        background: 'var(--sl-color-bg-nav)',
        borderRight: '1px solid var(--sl-color-gray-5)',
        padding: '12px',
        overflowY: 'auto',
        fontSize: '13px',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: '12px',
          color: 'var(--sl-color-white)',
          fontSize: '14px',
        }}
      >
        Generators
      </div>
      <div
        style={{
          color: 'var(--sl-color-gray-3)',
          fontSize: '11px',
          marginBottom: '12px',
        }}
      >
        Drag onto canvas or click to add
      </div>

      {categories.map((cat) => {
        const items = GENERATORS.filter((g) => g.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: '16px' }}>
            <div
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--sl-color-gray-3)',
                marginBottom: '6px',
              }}
            >
              {CATEGORY_LABELS[cat]}
            </div>
            {items.map((gen) => (
              <div
                key={gen.id}
                draggable
                onDragStart={(e) => onDragStart(e, gen)}
                onClick={() => onAdd(gen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  marginBottom: '4px',
                  borderRadius: '6px',
                  cursor: 'grab',
                  border: '1px solid var(--sl-color-gray-5)',
                  background: 'var(--sl-color-bg)',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = 'var(--sl-color-gray-3)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = 'var(--sl-color-gray-5)')
                }
              >
                {getIcon(gen.icon, gen.iconColor)}
                <div>
                  <div
                    style={{ color: 'var(--sl-color-white)', fontWeight: 500 }}
                  >
                    {gen.label}
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--sl-color-gray-3)',
                    }}
                  >
                    {gen.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default GeneratorPanel;
