/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describeWhen } from '../../lib/generator-options';
import { nodeType } from '../../lib/graph-builder/catalog';
import type { GraphNode, Issue } from '../../lib/graph-builder/model';
import {
  effectiveNodeOptions,
  propertyApplies,
  propertyValueApplies,
} from '../../lib/graph-builder/node-options';
import { NodeLogo } from './node-logo';

/** What a condition badge says when the pointer rests on it. */
const APPLIES_WHEN = 'Only applies with these option values';

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
  // What a run of this node's generator would use, which is what its options'
  // conditions are read against.
  const values = effectiveNodeOptions(type, node.options);
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
        <label
          className="command-card-field-name"
          htmlFor={`gb-name-${node.id}`}
        >
          name
        </label>
        <input
          id={`gb-name-${node.id}`}
          className="command-card-input"
          type="text"
          value={node.name}
          spellCheck={false}
          autoComplete="off"
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
          <label
            className="command-card-field-name"
            htmlFor={`gb-host-${node.id}`}
          >
            hostProject
          </label>
          <input
            id={`gb-host-${node.id}`}
            className="command-card-input"
            type="text"
            value={node.hostName ?? ''}
            spellCheck={false}
            autoComplete="off"
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
        const applies = propertyApplies(property, values);
        const fieldClass = `gb-field${applies ? '' : ' is-inapplicable'}`;
        const condition = property.when && (
          <span
            className="command-card-field-when doc-tooltip"
            role="note"
            data-tooltip={APPLIES_WHEN}
            aria-label={`${APPLIES_WHEN}: ${describeWhen(
              property.when as Record<string, string[]>,
            )}`}
          >
            {describeWhen(property.when as Record<string, string[]>)}
          </span>
        );

        if (property.type === 'boolean') {
          return (
            <div
              className={`${fieldClass} gb-field--switch`}
              key={property.name}
            >
              <label className="command-card-check" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  disabled={!applies}
                  onChange={(event) =>
                    onOptionChange(property.name, event.target.checked)
                  }
                />
                <span className="command-card-field-name">{property.name}</span>
                {condition}
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
              <div className={fieldClass} key={property.name}>
                <p className="gb-field-head">
                  <span className="command-card-field-name">
                    {property.name}
                  </span>
                  {condition}
                </p>
                <fieldset
                  className="command-card-pills"
                  aria-label={property.name}
                >
                  {property.enum.map((option) => {
                    const valueApplies = propertyValueApplies(
                      property,
                      option,
                      values,
                    );
                    return (
                      <button
                        key={option}
                        type="button"
                        className={[
                          'command-card-pill',
                          option === property.default ? 'is-default' : '',
                          valueApplies ? '' : 'is-inapplicable',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-pressed={value === option}
                        disabled={!applies || !valueApplies}
                        title={
                          valueApplies
                            ? undefined
                            : `${APPLIES_WHEN}: ${describeWhen(
                                (property.valueWhen?.[option] ?? {}) as Record<
                                  string,
                                  string[]
                                >,
                              )}`
                        }
                        onClick={() => onOptionChange(property.name, option)}
                      >
                        {option}
                      </button>
                    );
                  })}
                </fieldset>
                {property.description && (
                  <p className="gb-field-hint">{property.description}</p>
                )}
              </div>
            );
          }
          return (
            <div className={fieldClass} key={property.name}>
              <p className="gb-field-head">
                <label className="command-card-field-name" htmlFor={id}>
                  {property.name}
                </label>
                {condition}
              </p>
              <select
                id={id}
                className="gb-select"
                value={String(value)}
                disabled={!applies}
                onChange={(event) =>
                  onOptionChange(property.name, event.target.value)
                }
              >
                {property.enum
                  .filter((option) =>
                    propertyValueApplies(property, option, values),
                  )
                  .map((option) => (
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
          <div className={fieldClass} key={property.name}>
            <p className="gb-field-head">
              <label className="command-card-field-name" htmlFor={id}>
                {property.name}
              </label>
              {condition}
            </p>
            <input
              id={id}
              className="command-card-input"
              type="text"
              value={String(value)}
              spellCheck={false}
              autoComplete="off"
              readOnly={!applies}
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
