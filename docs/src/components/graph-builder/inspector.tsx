/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { nodeType } from '../../lib/graph-builder/catalog';
import type { GraphNode, Issue } from '../../lib/graph-builder/model';
import { NodeLogo } from './node-logo';

interface Props {
  node: GraphNode | undefined;
  issues: readonly Issue[];
  onChange: (patch: Partial<GraphNode>) => void;
  onOptionChange: (option: string, value: string | boolean) => void;
  onDelete: () => void;
  /** How many nodes the delete button will remove, when a group is selected. */
  selectedCount?: number;
}

/**
 * The properties panel for the selected node. Every field is derived from the
 * generator's own JSON schema, so a new or changed generator option appears here
 * without the panel knowing anything about it.
 */
export const Inspector = ({
  node,
  issues,
  onChange,
  onOptionChange,
  onDelete,
  selectedCount = 1,
}: Props) => {
  if (!node) {
    return (
      <div className="gb-inspector gb-inspector--empty">
        <p>Select a component to edit its properties.</p>
      </div>
    );
  }

  const type = nodeType(node.type);
  const nodeIssues = issues.filter((issue) => issue.nodeId === node.id);
  // Important options first — the generator marks the ones that change what it
  // produces — then the rest, so the panel opens on what matters.
  const properties = [
    ...type.properties.filter((p) => p.important),
    ...type.properties.filter((p) => !p.important),
  ];

  return (
    <div className="gb-inspector">
      <header className="gb-inspector-header">
        <NodeLogo logo={type.logo} badge={type.badge} alt={type.label} />
        <div>
          <h3>{type.label}</h3>
          <code>{type.generator}</code>
        </div>
        <button
          type="button"
          className="gb-icon-btn gb-icon-btn--danger"
          onClick={onDelete}
          aria-label={
            selectedCount > 1
              ? `Delete ${selectedCount} selected components`
              : `Delete ${node.name}`
          }
          title={
            selectedCount > 1 ? `Delete ${selectedCount} selected` : 'Delete'
          }
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </header>

      {nodeIssues.length > 0 && (
        <ul className="gb-inspector-issues">
          {nodeIssues.map((issue) => (
            <li
              key={`${issue.severity}-${issue.nodeId ?? ''}-${issue.edgeId ?? ''}-${issue.message}`}
              className={`gb-issue gb-issue--${issue.severity}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="gb-field">
        <label htmlFor={`gb-name-${node.id}`}>Name</label>
        <input
          id={`gb-name-${node.id}`}
          type="text"
          value={node.name}
          spellCheck={false}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <p className="gb-field-hint">
          {type.kind === 'component'
            ? 'Names this component within its project.'
            : 'Names the project and the directory it is created in.'}
        </p>
      </div>

      {type.kind === 'component' && type.host && (
        <div className="gb-field">
          <label htmlFor={`gb-host-${node.id}`}>Host project</label>
          <input
            id={`gb-host-${node.id}`}
            type="text"
            value={node.hostName ?? ''}
            spellCheck={false}
            onChange={(event) => onChange({ hostName: event.target.value })}
          />
          <p className="gb-field-hint">
            The <code>{type.host.generator}</code> project this is added to.
            Components sharing a host project name share one project.
          </p>
        </div>
      )}

      {properties.map((property) => {
        const id = `gb-${node.id}-${property.name}`;
        const value = node.options[property.name] ?? property.default ?? '';

        if (property.type === 'boolean') {
          return (
            <div className="gb-field gb-field--switch" key={property.name}>
              <label htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) =>
                    onOptionChange(property.name, event.target.checked)
                  }
                />
                <span>{property.name}</span>
              </label>
              {property.description && (
                <p className="gb-field-hint">{property.description}</p>
              )}
            </div>
          );
        }

        if (property.enum && property.enum.length > 0) {
          // A two- or three-value enum reads better as a segmented control than
          // a select, and takes the same vertical space.
          if (property.enum.length <= 3) {
            return (
              <div className="gb-field" key={property.name}>
                <span className="gb-field-label">{property.name}</span>
                <fieldset className="gb-segmented" aria-label={property.name}>
                  {property.enum.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`gb-segment${value === option ? ' is-active' : ''}`}
                      aria-pressed={value === option}
                      onClick={() => onOptionChange(property.name, option)}
                    >
                      {option}
                    </button>
                  ))}
                </fieldset>
                {property.description && (
                  <p className="gb-field-hint">{property.description}</p>
                )}
              </div>
            );
          }
          return (
            <div className="gb-field" key={property.name}>
              <label htmlFor={id}>{property.name}</label>
              <select
                id={id}
                value={String(value)}
                onChange={(event) =>
                  onOptionChange(property.name, event.target.value)
                }
              >
                {property.enum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {property.description && (
                <p className="gb-field-hint">{property.description}</p>
              )}
            </div>
          );
        }

        return (
          <div className="gb-field" key={property.name}>
            <label htmlFor={id}>{property.name}</label>
            <input
              id={id}
              type="text"
              value={String(value)}
              spellCheck={false}
              placeholder={
                property.default !== undefined ? String(property.default) : ''
              }
              onChange={(event) =>
                onOptionChange(property.name, event.target.value)
              }
            />
            {property.description && (
              <p className="gb-field-hint">{property.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
};
