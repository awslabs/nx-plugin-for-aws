/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ScriptLine } from '../../lib/graph-builder/commands';
import { type CommandFocus, CommandList } from './command-list';
import { CopyButton } from './copy-button';

/** The command the first step runs, which its window offers to copy. */
const CREATE_COMMAND = 'pnpm create @aws/nx-workspace';

/** The MCP tools the assistant is shown reaching for. */
const TOOL_CALLS = ['list-generators', 'generator-guide'];

/**
 * The assistants the workspace is shown being opened in — a new workspace
 * configures the MCP server for both. `mark` and `tint` draw the glyph beside the
 * name: a shape and a colour each is known by, not its own artwork.
 */
const ASSISTANTS = [
  { name: 'Claude Code', mark: 'burst', tint: '#d97757' },
  { name: 'Kiro', mark: 'ghost', tint: '#8b5cf6' },
] as const;

type Mark = (typeof ASSISTANTS)[number]['mark'];

/**
 * Where the flow has got to: the workspace being created, the assistant being
 * asked, the generators running, and the workspace they leave behind.
 */
export type FlowPhase = 'create' | 'ask' | 'build' | 'result';

/**
 * The phases in order, with how long each holds. The asking step is timed from the
 * prompt being typed, so its value here only stands in.
 */
export const FLOW_PHASES: readonly { id: FlowPhase; ms: number }[] = [
  { id: 'create', ms: 3200 },
  { id: 'ask', ms: 4800 },
  { id: 'build', ms: 6600 },
  { id: 'result', ms: 5600 },
];

/** The assistant's glyph, so which window this is reads without the name. */
const AssistantMark = ({ mark, tint }: { mark: Mark; tint: string }) => (
  <svg className="af-mark" viewBox="0 0 24 24" aria-hidden="true" fill={tint}>
    {mark === 'burst' ? (
      <path d="M12 2.6l1.7 6.1 4.6-4.3-2.6 5.7 6.2-1.1-5.6 2.9 5.6 2.9-6.2-1.1 2.6 5.7-4.6-4.3L12 21.4l-1.7-6.1-4.6 4.3 2.6-5.7-6.2 1.1 5.6-2.9-5.6-2.9 6.2 1.1-2.6-5.7 4.6 4.3z" />
    ) : (
      <>
        <path d="M12 2.5c-3.9 0-6.8 3-6.8 6.9v10.2c0 .8.9 1.1 1.4.6l1.5-1.5c.3-.3.8-.3 1.1 0l1.3 1.3c.3.3.8.3 1.1 0l1.3-1.3c.3-.3.8-.3 1.1 0l1.5 1.5c.5.5 1.4.1 1.4-.6V9.4c0-3.9-2.9-6.9-6.9-6.9z" />
        <circle cx="9.6" cy="9.8" r="1.35" fill="var(--gb-surface)" />
        <circle cx="14.4" cy="9.8" r="1.35" fill="var(--gb-surface)" />
      </>
    )}
  </svg>
);

const WindowDots = () => (
  <>
    <span className="gb-window-dot gb-window-dot--red" aria-hidden="true" />
    <span className="gb-window-dot gb-window-dot--yellow" aria-hidden="true" />
    <span className="gb-window-dot gb-window-dot--green" aria-hidden="true" />
  </>
);

interface Props {
  /** Which step is playing. */
  phase: FlowPhase;
  /** Shown finished rather than playing, so nothing arrives a line at a time. */
  held?: boolean;
  /** How many examples have played, which picks the assistant shown. */
  pass: number;
  /** What is being asked for, and how much of it has been typed so far. */
  prompt: string;
  typed: number;
  /** The commands the assistant runs, and how many have appeared so far. */
  lines: readonly ScriptLine[];
  revealed: number;
  /** The whole script, for the third window's copy button. */
  script: string;
  /** What the commands leave behind, said once they have all run. */
  summary: string;
  /** Lights the commands belonging to the graph element under the pointer. */
  focus?: CommandFocus;
  onFocus?: (focus: CommandFocus | undefined) => void;
}

/**
 * The three steps between one command and a working application: create the
 * workspace, open it in an AI assistant and ask, and watch it run the generators
 * that build the diagram below.
 *
 * Purely a view: what is typed, what has appeared and which step is playing all
 * come from the timeline that drives it.
 */
export const FlowSteps = ({
  phase,
  held,
  pass,
  prompt,
  typed,
  lines,
  revealed,
  script,
  summary,
  focus,
  onFocus,
}: Props) => {
  const assistant = ASSISTANTS[pass % ASSISTANTS.length];
  const isTyped = typed >= prompt.length;
  const shown = lines.slice(0, revealed);
  const isBuilt = shown.length >= lines.length;

  /** Whether a step is the one playing, one already passed, or still to come. */
  const state = (id: FlowPhase) => {
    const position = FLOW_PHASES.findIndex((entry) => entry.id === id);
    const current = FLOW_PHASES.findIndex((entry) => entry.id === phase);
    if (position === current) return ' is-active';
    return position < current ? ' is-done' : '';
  };

  return (
    <ol className="af-steps">
      <li className={`af-step${state('create')}`}>
        <p className="af-step-head">
          <span className="af-step-number">1</span>
          Create a workspace
        </p>

        <div className="af-frame">
          <div className="af-window">
            <div className="gb-window-chrome">
              <WindowDots />
              <span className="gb-window-name">zsh</span>
              <CopyButton text={CREATE_COMMAND} title="Copy the command" />
            </div>

            {/* Keyed on the pass, so the output arrives again each time over. */}
            <div
              className={`af-body af-body--terminal${held ? ' is-complete' : ''}`}
              key={pass}
            >
              <p className="af-line">
                <span className="gb-prompt">❯</span>
                <code>
                  pnpm create{' '}
                  <span className="gb-token--generator">@aws/nx-workspace</span>
                </code>
              </p>
              <p className="af-line af-line--output af-line--second">
                <span className="af-tick">✓</span> Workspace ready
              </p>
              <p className="af-line af-line--output af-line--third">
                <span className="af-tick">✓</span> MCP server configured for
                your coding agents
              </p>
            </div>
          </div>
        </div>

        <p className="af-step-note">
          One command, and the plugin's MCP server is already wired up.
        </p>
      </li>

      <li className={`af-step${state('ask')}`}>
        <p className="af-step-head">
          <span className="af-step-number">2</span>
          Open your workspace and ask
        </p>

        <div className="af-frame">
          <div className="af-window">
            <div className="gb-window-chrome">
              <WindowDots />
              {/* Keyed on the assistant, so its name and mark arrive together. */}
              <span className="gb-window-name" key={assistant.name}>
                <AssistantMark mark={assistant.mark} tint={assistant.tint} />
                {assistant.name}
              </span>
              <CopyButton text={prompt} title="Copy the prompt" />
            </div>

            <div className="af-body af-body--chat">
              <p className="af-prompt">
                <span className="gb-prompt">›</span>
                <span>
                  {prompt.slice(0, typed)}
                  {!isTyped && <span className="af-caret" />}
                </span>
              </p>

              {isTyped && (
                <ul className="af-tools">
                  {TOOL_CALLS.map((tool, index) => (
                    <li
                      key={tool}
                      className="af-tool"
                      style={{ animationDelay: `${index * 300}ms` }}
                    >
                      <span className="af-tool-icon" aria-hidden="true" />
                      <span className="af-tool-server">nx-plugin-for-aws</span>
                      <span className="af-tool-name">{tool}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <p className="af-step-note">
          Claude Code, Kiro, Cursor, Copilot, Codex — any agent that speaks MCP.
        </p>
      </li>

      <li className={`af-step${state('build')}`}>
        <p className="af-step-head">
          <span className="af-step-number">3</span>
          Your agent runs the generators
        </p>

        <div className="af-frame">
          <div className="af-window">
            <div className="gb-window-chrome">
              <WindowDots />
              <span className="gb-window-name">my-project — zsh</span>
              <CopyButton text={script} title="Copy the commands" />
            </div>

            <div className="af-body af-body--commands">
              {shown.length === 0 ? (
                <p className="af-line af-line--output">
                  <span className="af-caret" />
                </p>
              ) : (
                <CommandList
                  lines={shown}
                  focus={focus}
                  onFocus={onFocus}
                  followTail
                />
              )}
            </div>
          </div>
        </div>

        <p className="af-step-note">
          {isBuilt ? (
            <span className="af-done">
              <span className="af-tick">✓</span> {summary}
            </span>
          ) : (
            'Each command scaffolds a project or component in your workspace, or connects them together.'
          )}
        </p>
      </li>
    </ol>
  );
};
