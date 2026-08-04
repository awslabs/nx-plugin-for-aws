/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useState } from 'react';
import type { EmitOptions } from '../../lib/graph-builder/commands';
import { toScript } from '../../lib/graph-builder/commands';
import type { Graph, Issue } from '../../lib/graph-builder/model';

interface Props {
  graph: Graph;
  issues: readonly Issue[];
  options: EmitOptions;
  onOptionsChange: (patch: Partial<EmitOptions>) => void;
}

const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;

export const Output = ({ graph, issues, options, onOptionsChange }: Props) => {
  const [annotate, setAnnotate] = useState(true);
  const [copied, setCopied] = useState(false);

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  const script = useMemo(
    () => toScript(graph, options, { annotate }),
    [graph, options, annotate],
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the script stays selectable.
    }
  };

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
          <button
            type="button"
            className={`gb-copy-btn${copied ? ' is-copied' : ''}`}
            onClick={copy}
            disabled={graph.nodes.length === 0}
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
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
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
        <pre className="gb-script">
          <code>
            {graph.nodes.length === 0
              ? '# Add components to build your workspace'
              : script}
          </code>
        </pre>
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
