/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo, useState } from 'react';
import type { EmitOptions } from '../../lib/graph-builder/commands';
import { toScript, toScriptLines } from '../../lib/graph-builder/commands';
import type { Graph, Issue } from '../../lib/graph-builder/model';
import { CommandList } from './command-list';
import { CopyButton } from './copy-button';

interface Props {
  graph: Graph;
  issues: readonly Issue[];
  options: EmitOptions;
  onOptionsChange: (patch: Partial<EmitOptions>) => void;
}

const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;

export const Output = ({ graph, issues, options, onOptionsChange }: Props) => {
  const [annotate, setAnnotate] = useState(true);

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  // An empty graph still emits a workspace to create, which is nothing to show
  // before anything has been drawn.
  const lines = useMemo(
    () => (graph.nodes.length === 0 ? [] : toScriptLines(graph, options)),
    [graph, options],
  );
  const script = useMemo(
    () => toScript(graph, options, { annotate }),
    [graph, options, annotate],
  );

  return (
    <div className="gb-output">
      <div className="gb-output-bar">
        <div className="gb-output-controls">
          <label className="gb-inline-field">
            <span>Workspace</span>
            <input
              type="text"
              value={options.workspace}
              spellCheck={false}
              onChange={(event) =>
                onOptionsChange({ workspace: event.target.value })
              }
            />
          </label>

          <fieldset className="gb-segmented" aria-label="Package manager">
            {PACKAGE_MANAGERS.map((pm) => (
              <button
                key={pm}
                type="button"
                className={`gb-segment${options.packageManager === pm ? ' is-active' : ''}`}
                aria-pressed={options.packageManager === pm}
                onClick={() => onOptionsChange({ packageManager: pm })}
              >
                {pm}
              </button>
            ))}
          </fieldset>

          <fieldset
            className="gb-segmented"
            aria-label="Infrastructure as code"
          >
            {(['cdk', 'terraform'] as const).map((iac) => (
              <button
                key={iac}
                type="button"
                className={`gb-segment${options.iac === iac ? ' is-active' : ''}`}
                aria-pressed={options.iac === iac}
                onClick={() => onOptionsChange({ iac })}
              >
                {iac === 'cdk' ? 'CDK' : 'Terraform'}
              </button>
            ))}
          </fieldset>
        </div>

        <div className="gb-output-actions">
          <label className="gb-inline-check">
            <input
              type="checkbox"
              checked={annotate}
              onChange={(event) => setAnnotate(event.target.checked)}
            />
            <span>Comments</span>
          </label>
          <CopyButton
            text={script}
            label="Copy"
            disabled={graph.nodes.length === 0}
          />
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="gb-output-issues">
          {[...errors, ...warnings].map((issue) => (
            <li
              key={`${issue.severity}-${issue.nodeId ?? ''}-${issue.edgeId ?? ''}-${issue.message}`}
              className={`gb-issue gb-issue--${issue.severity}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Generated commands">
        <CommandList
          lines={lines}
          annotate={annotate}
          empty="Add components to build your workspace"
        />
      </section>

      {errors.length > 0 && (
        <p className="gb-output-note">
          Fix the errors above before running — the commands are shown so you
          can see what changes.
        </p>
      )}
    </div>
  );
};
