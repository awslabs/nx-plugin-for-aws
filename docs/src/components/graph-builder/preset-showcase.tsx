/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { nodeType } from '../../lib/graph-builder/catalog';
import type { EmitOptions, ScriptLine } from '../../lib/graph-builder/commands';
import { toScript, toScriptLines } from '../../lib/graph-builder/commands';
import type { Graph } from '../../lib/graph-builder/model';
import type { CommandFocus } from './command-list';
import { FLOW_PHASES, FlowSteps } from './flow-steps';
import {
  edgePath,
  loopPath,
  NODE_HEIGHT,
  NODE_WIDTH,
  sourceAnchor,
  targetAnchor,
} from './geometry';
import { NodeLogo } from './node-logo';
import {
  buildPresetGraph,
  PRESETS,
  type Preset,
  SHOWCASE_PRESET_IDS,
} from './presets';

/** Where the grid starts, and the spacing between its cells on each axis. */
const ORIGIN = 24;
const X_GAP = NODE_WIDTH + 90;
const Y_GAP = NODE_HEIGHT + 60;
/** Padding kept around the diagram inside its panel. */
const PADDING = 24;

/** How fast the assistant is shown typing, and running what it writes. */
const TYPE_MS = 26;
const COMMAND_MS = 560;
/** What the asking step holds for once the prompt is typed, so the tool calls read. */
const ASK_TAIL_MS = 1400;

/** The smallest the diagram is scaled before it is scrolled sideways instead. */
const MIN_SCALE = 0.6;
/** How far the diagram is enlarged to fill a wide panel. */
const MAX_SCALE = 1.25;

interface Stage {
  readonly preset: Preset;
  readonly graph: Graph;
  /**
   * The commands the assistant is shown running. The workspace-create is left
   * off: the first step of the flow already did that.
   */
  readonly lines: readonly ScriptLine[];
  /** The whole script, workspace and all, for the copy button. */
  readonly script: string;
  /** The diagram's natural size, before it is scaled to the panel. */
  readonly width: number;
  readonly height: number;
}

/**
 * Lay a preset out from its authored grid, and emit the commands that build it
 * with the same emitter the builder and the docs pages use — so what the homepage
 * shows being run is what the plugin runs.
 */
const toStage = (preset: Preset): Stage => {
  const options: EmitOptions = {
    workspace: 'my-project',
    packageManager: 'pnpm',
    iac: 'cdk',
    overrides: preset.overrides,
  };
  const built = buildPresetGraph(preset);
  const nodes = built.nodes.map((node, index) => ({
    ...node,
    x: ORIGIN + preset.nodes[index].column * X_GAP,
    y: ORIGIN + preset.nodes[index].row * Y_GAP,
  }));
  const graph = { ...built, nodes };
  return {
    preset,
    graph,
    lines: toScriptLines(graph, options, { skipWorkspace: true }),
    script: toScript(graph, options),
    width: Math.max(...nodes.map((node) => node.x + NODE_WIDTH)) + PADDING,
    height: Math.max(...nodes.map((node) => node.y + NODE_HEIGHT)) + PADDING,
  };
};

interface Props {
  /** The graph builder page, which each example can be opened in to edit. */
  builderHref: string;
}

/**
 * The landing page's showcase: one example workspace at a time, from the command
 * that creates it to the diagram of what you end up with.
 *
 * The steps and the diagram are one story — the prompt asks for the example, the
 * commands are the ones the generators run, and the diagram fills in as each
 * appears. Pointing at a node lights the commands that build it, and vice versa.
 */
export const PresetShowcase = ({ builderHref }: Props) => {
  const stages = useMemo(
    () =>
      SHOWCASE_PRESET_IDS.map((id) =>
        PRESETS.find((preset) => preset.id === id),
      )
        .filter((preset): preset is Preset => preset !== undefined)
        .map(toStage),
    [],
  );

  const [index, setIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);
  // How many examples have played, which picks the assistant and replays step one.
  const [pass, setPass] = useState(0);
  const [typed, setTyped] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isOnScreen, setIsOnScreen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [focus, setFocus] = useState<CommandFocus | undefined>();
  const tabsId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const stage = stages[index];
  const preset = stage.preset;
  const phase = FLOW_PHASES[phaseIndex].id;
  const prompt = preset.prompt ?? preset.description;
  // How long each step of this example holds. Memoised, since the step timer
  // restarts whenever it changes and typing re-renders many times a second.
  const durations = useMemo(
    () =>
      FLOW_PHASES.map((entry) =>
        entry.id === 'ask' ? prompt.length * TYPE_MS + ASK_TAIL_MS : entry.ms,
      ),
    [prompt],
  );
  // Paused, or less motion asked for: the example reads finished rather than
  // waiting partway through a sequence that will not play.
  const isHeld = !isPlaying || reduceMotion;
  const isPlayingThrough = !isHeld && isVisible && isOnScreen;
  // Only moving on to the next example would pull the page out from under a
  // reader, so that alone waits for the pointer to leave.
  const canAdvanceExample = isPlayingThrough && !isHovered && !isFocused;

  /** The last step, which an example held rather than playing reads at. */
  const LAST_PHASE = FLOW_PHASES.length - 1;

  /** Jump to an example: play it from the first step, or show it finished. */
  const show = (next: number) => {
    setIndex(next);
    setPhaseIndex(isHeld ? LAST_PHASE : 0);
    setPass((current) => current + 1);
    setFocus(undefined);
  };

  /**
   * Pausing settles on the finished example rather than freezing mid-sequence;
   * starting again begins from the first step with nothing done.
   */
  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      setPhaseIndex(LAST_PHASE);
      return;
    }
    setIsPlaying(true);
    setPhaseIndex(0);
    setTyped(0);
    setRevealed(0);
    setPass((current) => current + 1);
    setFocus(undefined);
  };

  // Each step holds for its own length; after the last one the next example
  // starts again from the first step.
  useEffect(() => {
    if (!isPlayingThrough) return;
    const isLastPhase = phaseIndex === FLOW_PHASES.length - 1;
    if (isLastPhase && !canAdvanceExample) return;
    const timer = setTimeout(() => {
      if (!isLastPhase) {
        setPhaseIndex(phaseIndex + 1);
        return;
      }
      setIndex((current) => (current + 1) % stages.length);
      setPhaseIndex(0);
      setPass((current) => current + 1);
      setFocus(undefined);
    }, durations[phaseIndex]);
    return () => clearTimeout(timer);
  }, [
    phaseIndex,
    isPlayingThrough,
    canAdvanceExample,
    stages.length,
    durations,
  ]);

  // Content that advances on its own is what a reduced-motion preference asks for
  // less of, so the showcase holds on the first example, finished.
  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setReduceMotion(true);
    setIsPlaying(false);
    setPhaseIndex(FLOW_PHASES.length - 1);
  }, []);

  // Nothing plays until the showcase is scrolled to, so a reader arrives at the
  // first step.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsOnScreen(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // A background tab animates nothing, so the examples would go by unseen.
  useEffect(() => {
    const onVisibilityChange = () =>
      setIsVisible(document.visibilityState === 'visible');
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // The prompt types itself out while the assistant is being asked.
  useEffect(() => {
    if (phase !== 'ask') return;
    setTyped(0);
    const timer = setInterval(
      () => setTyped((count) => Math.min(count + 1, prompt.length)),
      TYPE_MS,
    );
    return () => clearInterval(timer);
  }, [phase, prompt]);

  // Then the commands arrive one at a time, and the diagram fills in with them.
  useEffect(() => {
    if (phase !== 'build') return;
    setRevealed(0);
    const timer = setInterval(
      () => setRevealed((count) => count + 1),
      COMMAND_MS,
    );
    return () => clearInterval(timer);
  }, [phase]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState<number | undefined>();

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasWidth(canvas.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // One scale for every example, set by the widest: it fills a big panel and holds
  // its size as the showcase cycles. Below the floor a phone scrolls the diagram
  // sideways rather than shrinking labels past reading, and the panel stands as
  // tall as the tallest example so its height is steady too.
  const scale = canvasWidth
    ? Math.min(
        MAX_SCALE,
        Math.max(
          MIN_SCALE,
          Math.min(...stages.map((entry) => canvasWidth / entry.width)),
        ),
      )
    : 1;
  const canvasHeight = Math.max(...stages.map((entry) => entry.height * scale));
  const fitsCanvas = !canvasWidth || stage.width * scale <= canvasWidth;

  /** Arrows move between the examples, Home and End jump to the ends. */
  const onTabsKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: stages.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + stages.length) % stages.length;
    show(next);
    tabsRef.current
      ?.querySelector<HTMLButtonElement>(
        `#${CSS.escape(`${tabsId}-tab-${next}`)}`,
      )
      ?.focus();
  };

  const { graph, lines } = stage;

  // Nothing is asked or run until those steps come round, then the commands and
  // the diagram fill in together. Derived rather than reset, so starting an
  // example over always starts from nothing.
  const typedPrompt = isHeld ? prompt.length : phase === 'create' ? 0 : typed;
  const revealedLines =
    isHeld || phase === 'result'
      ? lines.length
      : phase === 'build'
        ? revealed
        : 0;
  const built = useMemo(() => {
    if (isHeld || phase !== 'build') return undefined;
    const ids = new Set<string>();
    for (const line of lines.slice(0, revealed)) {
      if (line.nodeId) ids.add(line.nodeId);
      if (line.edgeId) ids.add(line.edgeId);
    }
    return ids;
  }, [isHeld, phase, lines, revealed]);
  const isPlanned = (id: string) =>
    !isHeld &&
    (phase === 'create' || phase === 'ask' || (built ? !built.has(id) : false));

  // What the command that just appeared scaffolded, so the diagram lights it up
  // rather than leaving the change to be spotted.
  const arriving = useMemo(() => {
    if (isHeld || phase !== 'build' || revealed === 0) return undefined;
    const line = lines[revealed - 1];
    if (!line) return undefined;
    return new Set(
      [line.nodeId, line.edgeId].filter((id): id is string => id !== undefined),
    );
  }, [isHeld, phase, lines, revealed]);

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const focusedEdge = focus?.edgeId
    ? graph.edges.find((edge) => edge.id === focus.edgeId)
    : undefined;
  // A hovered connection command lights both of its endpoints, so the command
  // and the pair it wires together read together.
  const litNodeIds = new Set(
    [focus?.nodeId, focusedEdge?.source, focusedEdge?.target].filter(
      (id): id is string => id !== undefined,
    ),
  );

  /** How long an example holds altogether, for the fill on its tab. */
  const cycleMs = durations.reduce((total, ms) => total + ms, 0);

  const summary = `${graph.nodes.length} project${
    graph.nodes.length === 1 ? '' : 's'
  } and ${graph.edges.length} connection${
    graph.edges.length === 1 ? '' : 's'
  }, ready to run and deploy.`;

  return (
    <div
      ref={rootRef}
      className="gb-root ps-root"
      data-graph-builder
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => {
        setIsHovered(false);
        setFocus(undefined);
      }}
      // Only keyboard focus pauses: a click leaves focus on the button it hit,
      // which would otherwise freeze the showcase for good.
      onFocusCapture={(event) =>
        setIsFocused((event.target as HTMLElement).matches(':focus-visible'))
      }
      onBlurCapture={() => setIsFocused(false)}
    >
      <div
        ref={tabsRef}
        className="ps-tabs"
        role="tablist"
        aria-label="Example workspaces"
        onKeyDown={onTabsKeyDown}
      >
        {stages.map((entry, entryIndex) => (
          <button
            key={entry.preset.id}
            id={`${tabsId}-tab-${entryIndex}`}
            type="button"
            role="tab"
            aria-selected={entryIndex === index}
            aria-controls={`${tabsId}-panel`}
            // Only the active tab is a tab stop, so the group is one stop and the
            // arrow keys move within it — how a tablist is expected to behave.
            tabIndex={entryIndex === index ? 0 : -1}
            className={`ps-tab${entryIndex === index ? ' is-active' : ''}`}
            onClick={() => show(entryIndex)}
          >
            {entryIndex === index && (
              <span
                // Keyed on the example and the cycling state so the fill
                // restarts with each example rather than carrying on from where
                // the last one left off.
                key={`${index}-${pass}-${isPlayingThrough}`}
                className="ps-tab-progress"
                style={{
                  animationDuration: `${cycleMs}ms`,
                  animationPlayState: isPlayingThrough ? 'running' : 'paused',
                }}
                aria-hidden="true"
              />
            )}
            {entry.preset.label}
          </button>
        ))}
      </div>
      <div
        className="ps-stage"
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${index}`}
      >
        <div className="af-flow">
          <FlowSteps
            phase={phase}
            held={isHeld}
            pass={pass}
            prompt={prompt}
            typed={typedPrompt}
            lines={lines}
            revealed={revealedLines}
            script={stage.script}
            summary={summary}
            focus={focus}
            onFocus={setFocus}
          />
        </div>

        {/* Points from the steps down at the diagram, so it reads as what they
            produced. */}
        <div
          className={`ps-link${
            phase === 'build' || phase === 'result' ? ' is-active' : ''
          }`}
          aria-hidden="true"
        />

        <div className="ps-panel ps-panel--graph">
          <div className="ps-panel-bar">
            <p className="ps-panel-title">
              <span className="ps-panel-chip">Result</span>
              {preset.label}
            </p>
            <div className="ps-panel-actions">
              <span className="ps-stat">
                {graph.nodes.length} project
                {graph.nodes.length === 1 ? '' : 's'}
              </span>
              <span className="ps-stat">
                {graph.edges.length} connection
                {graph.edges.length === 1 ? '' : 's'}
              </span>
              <a
                className="gb-action gb-action--primary gb-action--small"
                href={`${builderHref}?preset=${preset.id}`}
              >
                <span>Customize</span>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="18" y2="12" />
                  <polyline points="12 6 18 12 12 18" />
                </svg>
              </a>
            </div>
          </div>

          <p className="ps-panel-description">{preset.description}</p>

          <div
            ref={canvasRef}
            className="ps-canvas"
            style={{ height: canvasHeight }}
          >
            {/* Keyed on the example, so switching remounts the diagram and its
                plan arrives again. */}
            <div
              key={preset.id}
              className="ps-extent"
              style={{
                width: stage.width,
                height: stage.height,
                // Centred across the panel while it fits; pinned to the left once
                // it doesn't, so the overflow is somewhere the canvas can scroll.
                ...(fitsCanvas
                  ? {
                      left: '50%',
                      transform: `translateX(-50%) scale(${scale})`,
                    }
                  : {
                      left: 0,
                      transformOrigin: 'top left',
                      transform: `scale(${scale})`,
                    }),
                // Centred in the panel, which is as tall as the tallest example.
                marginTop: (canvasHeight - stage.height * scale) / 2,
              }}
            >
              <svg
                className="gb-edges"
                width={stage.width}
                height={stage.height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="ps-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    markerUnits="strokeWidth"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="context-stroke" />
                  </marker>
                </defs>

                {graph.edges.map((edge) => {
                  const source = nodeById.get(edge.source);
                  const target = nodeById.get(edge.target);
                  if (!source || !target) return null;
                  const path =
                    source.id === target.id
                      ? loopPath(source, 'horizontal')
                      : edgePath(
                          sourceAnchor(source, 'horizontal'),
                          targetAnchor(target, 'horizontal'),
                          'horizontal',
                        );
                  const isLit = focus?.edgeId === edge.id;
                  return (
                    <g
                      key={edge.id}
                      className={`gb-edge ps-edge${isLit ? ' is-active' : ''}${
                        focus && !isLit ? ' is-dimmed' : ''
                      }${isPlanned(edge.id) ? ' is-planned' : ''}${
                        arriving?.has(edge.id) ? ' is-arriving' : ''
                      }`}
                      onPointerEnter={() => setFocus({ edgeId: edge.id })}
                      onPointerLeave={() => setFocus(undefined)}
                    >
                      {/* A connection is a thin line to hit, so pointing at it is
                          picked up by a wider invisible path over the top. */}
                      <path className="gb-edge-hit" d={path} />
                      {/* Dashes travelling the path, so a connection reads as a
                          direction of flow. */}
                      <path
                        className="gb-edge-line ps-edge-line"
                        d={path}
                        markerEnd="url(#ps-arrow)"
                      />
                    </g>
                  );
                })}
              </svg>

              {graph.nodes.map((node) => {
                const type = nodeType(node.type);
                const isLit = litNodeIds.has(node.id);
                return (
                  <div
                    key={node.id}
                    className={`gb-node gb-node--static ps-node${
                      isLit ? ' is-lit' : ''
                    }${focus && !isLit ? ' is-dimmed' : ''}${
                      isPlanned(node.id) ? ' is-planned' : ''
                    }${arriving?.has(node.id) ? ' is-arriving' : ''}`}
                    style={{ left: node.x, top: node.y }}
                    onPointerEnter={() => setFocus({ nodeId: node.id })}
                    onPointerLeave={() => setFocus(undefined)}
                  >
                    <NodeLogo
                      logo={type.logo}
                      badge={type.badge}
                      alt={type.label}
                    />
                    <span className="gb-node-text">
                      <span className="gb-node-name">{node.name}</span>
                      <span className="gb-node-type">{type.label}</span>
                    </span>

                    {type.roles.includes('target') && (
                      <span
                        className="gb-port gb-port--in gb-port--in-horizontal"
                        aria-hidden="true"
                      />
                    )}
                    {type.roles.includes('source') && (
                      <span
                        className="gb-port gb-port--out gb-port--out-horizontal"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* A rule closing the section off, with the play control at the end of it. */}
      <div className="ps-bar">
        <span className="ps-bar-rule" aria-hidden="true" />
        <button
          type="button"
          className="ps-bar-button"
          onClick={togglePlay}
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

export default PresetShowcase;
