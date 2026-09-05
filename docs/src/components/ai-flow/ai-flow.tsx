/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toScriptLines } from '../../lib/graph-builder/commands';
import { CommandList } from '../graph-builder/command-list';
import { buildPresetGraph, PRESETS } from '../graph-builder/presets';

/**
 * The example the flow has the assistant build: the same agentic app the showcase
 * opens on, so the commands the assistant writes here are the commands that
 * example is scaffolded with.
 */
const PRESET_ID = 'agentic-app';

/** What the reader is shown asking for, matching what that preset scaffolds. */
const PROMPT =
  'Add a React website with an AG-UI agent, an MCP server for its tools and a DynamoDB table, and wire them together.';

/** The MCP tools the assistant is shown reaching for. */
const TOOL_CALLS = ['list-generators', 'generator-guide'];

/**
 * The assistants the workspace is shown being opened in. A new workspace
 * configures the MCP server for both, so either is one step away.
 *
 * `tint` is only used for the mark in the window chrome, so the two passes are
 * told apart at a glance.
 */
const ASSISTANTS = [
  { name: 'Claude Code', tint: '#d97757' },
  { name: 'Kiro', tint: '#8b5cf6' },
] as const;

type Phase = 'create' | 'ask' | 'build';

/** The steps in order, with how long each holds before the flow moves on. */
const PHASES: readonly { id: Phase; ms: number }[] = [
  { id: 'create', ms: 3600 },
  { id: 'ask', ms: 6800 },
  { id: 'build', ms: 7000 },
];

const TYPE_MS = 26;
const COMMAND_MS = 420;

/** A mark for the assistant, tinted to tell one from the other. */
const AssistantMark = ({ tint }: { tint: string }) => (
  <svg className="af-mark" viewBox="0 0 24 24" aria-hidden="true" fill={tint}>
    <path d="M12 2.6l1.7 6.1 4.6-4.3-2.6 5.7 6.2-1.1-5.6 2.9 5.6 2.9-6.2-1.1 2.6 5.7-4.6-4.3L12 21.4l-1.7-6.1-4.6 4.3 2.6-5.7-6.2 1.1 5.6-2.9-5.6-2.9 6.2 1.1-2.6-5.7 4.6 4.3z" />
  </svg>
);

const WindowDots = () => (
  <>
    <span className="gb-window-dot gb-window-dot--red" aria-hidden="true" />
    <span className="gb-window-dot gb-window-dot--yellow" aria-hidden="true" />
    <span className="gb-window-dot gb-window-dot--green" aria-hidden="true" />
  </>
);

/**
 * How a workspace gets from one command to a working application: create it,
 * open it in an AI assistant, and ask — the assistant finds the plugin's
 * generators over MCP and runs them for you.
 *
 * The three steps play as a loop, each picking up where the last left off, so the
 * sequence reads in order rather than as three separate pictures. It runs only
 * while on screen, pauses while the pointer is over it so the prompt can be read,
 * and holds still at the finished state for a reduced-motion preference.
 */
export const AiFlow = () => {
  const lines = useMemo(() => {
    const preset = PRESETS.find((entry) => entry.id === PRESET_ID);
    if (!preset) return [];
    return toScriptLines(
      buildPresetGraph(preset),
      {
        workspace: 'my-project',
        packageManager: 'pnpm',
        iac: 'cdk',
        overrides: preset.overrides,
      },
      // The workspace already exists by this step: the reader created it in the
      // first one.
      { skipWorkspace: true },
    );
  }, []);

  const [phaseIndex, setPhaseIndex] = useState(0);
  // Bumped on each pass, so the animations that play once per pass replay.
  const [pass, setPass] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isOnScreen, setIsOnScreen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [typedCount, setTypedCount] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);

  const phase = PHASES[phaseIndex].id;
  const assistant = ASSISTANTS[pass % ASSISTANTS.length];
  const isRunning = isPlaying && !isHovered && isOnScreen && !reduceMotion;

  const rootRef = useRef<HTMLDivElement>(null);

  // Nothing plays until the flow is scrolled to, so the reader arrives at the
  // start of the sequence rather than partway through it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsOnScreen(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      setReduceMotion(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    [],
  );

  useEffect(() => {
    if (!isRunning) return;
    const timer = setTimeout(() => {
      const next = phaseIndex + 1;
      if (next >= PHASES.length) {
        setPhaseIndex(0);
        setPass((current) => current + 1);
      } else {
        setPhaseIndex(next);
      }
    }, PHASES[phaseIndex].ms);
    return () => clearTimeout(timer);
  }, [phaseIndex, isRunning]);

  // Each pass starts from an empty prompt and no commands.
  useEffect(() => {
    if (phase !== 'create') return;
    setTypedCount(0);
    setRevealedCount(0);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'ask') return;
    setTypedCount(0);
    const timer = setInterval(
      () => setTypedCount((count) => Math.min(count + 1, PROMPT.length)),
      TYPE_MS,
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'build') return;
    setRevealedCount(0);
    const timer = setInterval(
      () => setRevealedCount((count) => count + 1),
      COMMAND_MS,
    );
    return () => clearInterval(timer);
  }, [phase]);

  // Held at the end of every step when motion is unwelcome: all three steps
  // read at once, as three finished pictures.
  const typed = reduceMotion ? PROMPT.length : typedCount;
  const shown = lines.slice(0, reduceMotion ? lines.length : revealedCount);
  const isTyped = typed >= PROMPT.length;
  const isBuilt = shown.length >= lines.length;

  /** Whether a step is the one running, one already passed, or still to come. */
  const state = (id: Phase) => {
    if (reduceMotion) return ' is-active';
    const position = PHASES.findIndex((entry) => entry.id === id);
    if (position === phaseIndex) return ' is-active';
    return position < phaseIndex ? ' is-done' : '';
  };

  return (
    <div
      ref={rootRef}
      className="gb-root af-root"
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <ol className="af-steps">
        <li className={`af-step${state('create')}`}>
          <p className="af-step-head">
            <span className="af-step-number">1</span>
            Create the workspace
          </p>

          <div className="af-window">
            <div className="gb-window-chrome">
              <WindowDots />
              <span className="gb-window-name">zsh</span>
            </div>

            <div className="af-body af-body--terminal" key={`create-${pass}`}>
              <p className="af-line">
                <span className="gb-prompt">❯</span>
                <code>
                  pnpm create{' '}
                  <span className="gb-token--generator">@aws/nx-workspace</span>{' '}
                  my-project
                </code>
              </p>
              <p className="af-line af-line--output af-line--second">
                <span className="af-tick">✓</span> Workspace ready
              </p>
              <p className="af-line af-line--output af-line--third">
                <span className="af-tick">✓</span> MCP server configured for
                your coding agents
              </p>
              <p className="af-line af-line--fourth">
                <span className="gb-prompt">❯</span>
                <code>cd my-project</code>
              </p>
            </div>
          </div>

          <p className="af-step-note">
            One command, and the plugin's MCP server is already wired up.
          </p>
        </li>

        <li className={`af-step${state('ask')}`}>
          <p className="af-step-head">
            <span className="af-step-number">2</span>
            Open it and ask
          </p>

          <div className="af-window">
            <div className="gb-window-chrome">
              <WindowDots />
              {/* Keyed on the assistant, so its name and mark arrive together on
                  each pass rather than changing in place. */}
              <span className="gb-window-name" key={assistant.name}>
                <AssistantMark tint={assistant.tint} />
                {assistant.name}
              </span>
            </div>

            <div className="af-body af-body--chat">
              <p className="af-prompt">
                <span className="gb-prompt">›</span>
                <span>
                  {PROMPT.slice(0, typed)}
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

          <p className="af-step-note">
            Claude Code, Kiro, Cursor, Copilot, Codex — any agent that speaks
            MCP.
          </p>
        </li>

        <li className={`af-step${state('build')}`}>
          <p className="af-step-head">
            <span className="af-step-number">3</span>
            It runs the generators
          </p>

          <div className="af-window">
            <div className="gb-window-chrome">
              <WindowDots />
              <span className="gb-window-name">my-project — zsh</span>
            </div>

            <div className="af-body af-body--commands">
              {shown.length === 0 ? (
                <p className="af-line af-line--output">
                  <span className="af-caret" />
                </p>
              ) : (
                <CommandList lines={shown} />
              )}
            </div>
          </div>

          <p className="af-step-note">
            {isBuilt ? (
              <span className="af-done">
                <span className="af-tick">✓</span> Website, agent, MCP server,
                table and infrastructure — connected.
              </span>
            ) : (
              'The same generators you would run by hand, in the right order.'
            )}
          </p>
        </li>
      </ol>

      <div className="af-controls">
        <button
          type="button"
          className="gb-action"
          onClick={() => setIsPlaying((playing) => !playing)}
          aria-pressed={!isPlaying}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <rect x="7" y="5" width="3.5" height="14" rx="1" />
              <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
};

export default AiFlow;
