/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo, useState } from 'react';
import { TERMINAL_GLYPH_PATHS } from '../../lib/command-card-icons';
import type { EmitOptions } from '../../lib/graph-builder/commands';
import { toScript, toScriptLines } from '../../lib/graph-builder/commands';
import type { Graph, Issue } from '../../lib/graph-builder/model';
import {
  PACKAGE_MANAGER_LABELS,
  writePackageManager,
} from '../../lib/package-manager';
import { CommandList } from './command-list';
import { CopyButton } from './copy-button';

interface Props {
  graph: Graph;
  issues: readonly Issue[];
  options: EmitOptions;
  onOptionsChange: (patch: Partial<EmitOptions>) => void;
}

const IAC_LABELS: Record<EmitOptions['iac'], string> = {
  cdk: 'cdk',
  terraform: 'terraform',
};

/**
 * The commands a graph scaffolds, in the card the guides run their generators
 * from: the same frame, prompt, tokens and controls, so a workspace sketched here
 * hands over a command that reads like the ones in the guides.
 */
export const Output = ({ graph, issues, options, onOptionsChange }: Props) => {
  const [annotate, setAnnotate] = useState(true);

  // Picking one here is picking it for the guides too, and the other way about:
  // the choice is read back where this panel's state starts.
  const pickPackageManager = (packageManager: string) => {
    writePackageManager(packageManager);
    onOptionsChange({ packageManager });
  };

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
    <div className="command-card gb-output">
      <p className="command-card-head">
        <span className="command-card-mark" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {TERMINAL_GLYPH_PATHS.map((path) => (
              <path key={path} d={path} />
            ))}
          </svg>
        </span>
        <span className="command-card-title">Run these commands</span>
        <code className="command-card-target">@aws/nx-plugin</code>
      </p>

      <div className="gb-output-body">
        <div className="command-card-terminal">
          <section
            className="gb-output-commands"
            aria-label="Generated commands"
          >
            <CommandList
              lines={lines}
              annotate={annotate}
              empty="Add components to build your workspace"
            />
          </section>
          <CopyButton
            text={script}
            title="Copy the commands"
            disabled={graph.nodes.length === 0}
          />
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

        {errors.length > 0 && (
          <p className="gb-output-note">
            Fix the errors above before running — the commands are shown so you
            can see what changes.
          </p>
        )}
      </div>

      <details className="command-card-builder" open>
        <summary className="command-card-builder-summary">
          <svg
            className="command-card-chevron"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          <span className="command-card-builder-title">Build your commands</span>
        </summary>

        <div className="command-card-fields">
          <div className="command-card-field">
            <p className="command-card-field-head">
              <label className="command-card-field-name" htmlFor="gb-workspace">
                workspace
              </label>
            </p>
            <input
              id="gb-workspace"
              className="command-card-input"
              type="text"
              value={options.workspace}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                onOptionsChange({ workspace: event.target.value })
              }
            />
          </div>

          <div className="command-card-field">
            <p className="command-card-field-head">
              <span className="command-card-field-name">packageManager</span>
            </p>
            <fieldset className="command-card-pills" aria-label="Package manager">
              {PACKAGE_MANAGER_LABELS.map((pm) => (
                <button
                  key={pm}
                  type="button"
                  className="command-card-pill"
                  aria-pressed={options.packageManager === pm}
                  onClick={() => pickPackageManager(pm)}
                >
                  {pm}
                </button>
              ))}
            </fieldset>
          </div>

          <div className="command-card-field">
            <p className="command-card-field-head">
              <span className="command-card-field-name">iac</span>
            </p>
            <fieldset
              className="command-card-pills"
              aria-label="Infrastructure as code"
            >
              {(['cdk', 'terraform'] as const).map((iac) => (
                <button
                  key={iac}
                  type="button"
                  className="command-card-pill"
                  aria-pressed={options.iac === iac}
                  onClick={() => onOptionsChange({ iac })}
                >
                  {IAC_LABELS[iac]}
                </button>
              ))}
            </fieldset>
          </div>
        </div>

        <p className="command-card-footer">
          <label className="command-card-check">
            <input
              type="checkbox"
              checked={annotate}
              onChange={(event) => setAnnotate(event.target.checked)}
            />
            <code>comments</code>
          </label>
          <span className="command-card-footer-help">
            Print what each command does above it, as a shell comment
          </span>
        </p>
      </details>
    </div>
  );
};
