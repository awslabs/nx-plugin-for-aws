/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { getIcon } from './icons';
import { getGeneratorById } from './generators';

interface GeneratorNodeComponentProps {
  generatorId: string;
  name: string;
  options: Record<string, string>;
  onNameChange: (name: string) => void;
  onOptionChange: (key: string, value: string) => void;
  onDelete: () => void;
}

const GeneratorNodeComponent: React.FC<GeneratorNodeComponentProps> = ({
  generatorId,
  name,
  options,
  onNameChange,
  onOptionChange,
  onDelete,
}) => {
  const generator = getGeneratorById(generatorId);
  if (!generator) return null;

  const handleStyle = {
    width: 10,
    height: 10,
    background: 'var(--sl-color-gray-4)',
    border: '2px solid var(--sl-color-gray-3)',
  };

  return (
    <div
      style={{
        background: 'var(--sl-color-bg)',
        border: '1px solid var(--sl-color-gray-5)',
        borderRadius: '8px',
        padding: '12px',
        minWidth: '200px',
        fontSize: '13px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ ...handleStyle, left: -5 }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {getIcon(generator.icon, generator.iconColor)}
          <strong style={{ color: 'var(--sl-color-white)' }}>
            {generator.label}
          </strong>
        </div>
        <button
          onClick={onDelete}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--sl-color-gray-3)',
            fontSize: '16px',
            padding: '0 2px',
            lineHeight: 1,
          }}
          title="Remove"
        >
          x
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--sl-color-gray-2)',
          }}
        >
          <span style={{ minWidth: '40px' }}>Name</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="nodrag"
            style={{
              flex: 1,
              padding: '3px 6px',
              borderRadius: '4px',
              border: '1px solid var(--sl-color-gray-5)',
              background: 'var(--sl-color-bg-nav)',
              color: 'var(--sl-color-white)',
              fontSize: '12px',
            }}
          />
        </label>

        {generator.options.map((opt) => (
          <label
            key={opt.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--sl-color-gray-2)',
            }}
          >
            <span style={{ minWidth: '40px' }}>{opt.label}</span>
            {opt.type === 'select' ? (
              <select
                value={options[opt.name] ?? opt.default}
                onChange={(e) => onOptionChange(opt.name, e.target.value)}
                className="nodrag"
                style={{
                  flex: 1,
                  padding: '3px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--sl-color-gray-5)',
                  background: 'var(--sl-color-bg-nav)',
                  color: 'var(--sl-color-white)',
                  fontSize: '12px',
                }}
              >
                {opt.choices?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={options[opt.name] ?? opt.default}
                onChange={(e) => onOptionChange(opt.name, e.target.value)}
                className="nodrag"
                style={{
                  flex: 1,
                  padding: '3px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--sl-color-gray-5)',
                  background: 'var(--sl-color-bg-nav)',
                  color: 'var(--sl-color-white)',
                  fontSize: '12px',
                }}
              />
            )}
          </label>
        ))}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ ...handleStyle, right: -5 }}
      />
    </div>
  );
};

export default GeneratorNodeComponent;
