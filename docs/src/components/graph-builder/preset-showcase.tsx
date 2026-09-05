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

/** How long an example holds before the showcase moves to the next. */
const CYCLE_MS = 11000;

/** Where the grid starts, and the spacing between its cells on each axis. */
const ORIGIN = 24;
const X_GAP = NODE_WIDTH + 90;
const Y_GAP = NODE_HEIGHT + 60;
/** Padding kept around the diagram inside its panel. */
const PADDING = 24;

/** The stagger between each node, edge and command as an example builds itself. */
const STEP_MS = 90;

/** The smallest the diagram is scaled before it is scrolled sideways instead. */
const MIN_SCALE = 0.6;

interface Stage {
  readonly preset: Preset;
  readonly graph: Graph;
  readonly lines: readonly ScriptLine[];
  readonly script: string;
  /** The diagram's natural size, before it is scaled to the panel. */
  readonly width: number;
  readonly height: number;
}

/**
 * Lay a preset out from its authored grid and emit the commands that build it.
 *
 * Positions come straight from the grid rather than the builder's auto-packing,
 * so an example lands exactly as authored, and the commands come from the same
 * emitter the graph builder and the docs pages use — so what the homepage hands
 * over is what the plugin actually runs.
 */
const toStage = (preset: Preset): Stage => {
  const options: EmitOptions = {
    workspace: preset.id,
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
    lines: toScriptLines(graph, options),
    script: toScript(graph, options),
    width: Math.max(...nodes.map((node) => node.x + NODE_WIDTH)) + PADDING,
    height: Math.max(...nodes.map((node) => node.y + NODE_HEIGHT)) + PADDING,
  };
};

/** The graph element a hovered command belongs to, or a hovered node. */
interface Focus {
  readonly nodeId?: string;
  readonly edgeId?: string;
}

/** A piece of a command that gets its own colour. */
interface CommandPart {
  readonly key: string;
  readonly text: string;
  readonly kind: 'plain' | 'namespace' | 'generator' | 'flag';
}

const PART_CLASS: Record<CommandPart['kind'], string | undefined> = {
  plain: undefined,
  namespace: 'ps-token--pkg',
  generator: 'ps-token--generator',
  flag: 'ps-token--flag',
};

/**
 * Split a command so the generator being run reads at a glance: the plugin's
 * namespace held back, the generator id picked out, its flags dimmed.
 */
const commandParts = (command: string): CommandPart[] =>
  command.split(' ').flatMap((token, position) => {
    const key = `${position}-${token}`;
    const space: CommandPart[] =
      position > 0 ? [{ key: `${key}-space`, text: ' ', kind: 'plain' }] : [];
    const [before, generator] = token.split('@aws/nx-plugin:');
    if (generator) {
      return [
        ...space,
        ...(before
          ? [{ key: `${key}-before`, text: before, kind: 'plain' as const }]
          : []),
        { key: `${key}-namespace`, text: '@aws/nx-plugin:', kind: 'namespace' },
        { key: `${key}-generator`, text: generator, kind: 'generator' },
      ];
    }
    return [
      ...space,
      { key, text: token, kind: token.startsWith('--') ? 'flag' : 'plain' },
    ];
  });

const CommandText = ({ command }: { command: string }) => (
  <>
    {commandParts(command).map((part) => (
      <span key={part.key} className={PART_CLASS[part.kind]}>
        {part.text}
      </span>
    ))}
  </>
);

interface Props {
  /** The graph builder page, which each example can be opened in to edit. */
  builderHref: string;
}

/**
 * The homepage showcase: a read-only graph of an example workspace beside the
 * commands that scaffold it, cycling through the examples on its own.
 *
 * Each example builds itself in — nodes, then the connections between them, then
 * the commands — and hovering either a node or a command lights up the other, so
 * the diagram and the commands read as one thing. Cycling pauses while the
 * pointer or keyboard focus is inside, and while the tab is in the background,
 * so nothing moves underneath someone reading it.
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
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [focus, setFocus] = useState<Focus | undefined>();
  const [copied, setCopied] = useState(false);
  const tabsId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);

  const stage = stages[index];
  const isCycling = isPlaying && !isHovered && !isFocused && isVisible;

  /** Move to an example, dropping whatever the last one had lit. */
  const show = (next: number) => {
    setIndex(next);
    setFocus(undefined);
  };

  // A timeout rather than an interval, so picking an example by hand — or coming
  // back from a pause — restarts the full dwell rather than landing mid-cycle.
  useEffect(() => {
    if (!isCycling) return;
    const timer = setTimeout(() => {
      setIndex((index + 1) % stages.length);
      setFocus(undefined);
    }, CYCLE_MS);
    return () => clearTimeout(timer);
  }, [index, isCycling, stages.length]);

  // Content that advances on its own is exactly what a reduced-motion preference
  // asks for less of, so the showcase starts held on the first example and waits
  // to be driven by the tabs or the play button.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsPlaying(false);
    }
  }, []);

  // A background tab animates nothing, so the examples would otherwise all have
  // gone by before the reader came back.
  useEffect(() => {
    const onVisibilityChange = () =>
      setIsVisible(document.visibilityState === 'visible');
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

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

  // Shrink to fit the panel, never enlarge past the natural size, and never past
  // the point where the labels stop being readable — a phone scrolls the diagram
  // sideways instead. The panel stands as tall as the tallest example needs, so
  // it doesn't resize as the showcase cycles.
  const scaleOf = (entry: Stage) =>
    canvasWidth && entry.width > canvasWidth
      ? Math.max(MIN_SCALE, canvasWidth / entry.width)
      : 1;
  const scale = scaleOf(stage);
  const canvasHeight = Math.max(
    ...stages.map((entry) => entry.height * scaleOf(entry)),
  );
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stage.script);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; nothing to fall back to here.
    }
  };

  const { graph, lines, preset } = stage;
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

  return (
    <div
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
                // restarts with each dwell rather than carrying on from where
                // the last one left off.
                key={`${index}-${isCycling}`}
                className="ps-tab-progress"
                style={{
                  animationDuration: `${CYCLE_MS}ms`,
                  animationPlayState: isCycling ? 'running' : 'paused',
                }}
                aria-hidden="true"
              />
            )}
            <span className="ps-tab-label">{entry.preset.label}</span>
          </button>
        ))}
      </div>

      <div
        className="ps-stage"
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${index}`}
      >
        <div className="ps-panel ps-panel--graph">
          <div className="ps-panel-bar">
            <p className="ps-panel-title">{preset.label}</p>
            <div className="ps-stats">
              <span className="ps-stat">
                {graph.nodes.length} project
                {graph.nodes.length === 1 ? '' : 's'}
              </span>
              <span className="ps-stat">
                {graph.edges.length} connection
                {graph.edges.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <p className="ps-panel-description">{preset.description}</p>

          <div
            ref={canvasRef}
            className="ps-canvas"
            style={{ height: canvasHeight }}
          >
            {/* Keyed on the example, so switching remounts the diagram and its
                build-in animation replays. */}
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

                {graph.edges.map((edge, edgeIndex) => {
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
                      }`}
                      style={{
                        // Edges draw in behind the nodes they join.
                        animationDelay: `${(graph.nodes.length + edgeIndex) * STEP_MS}ms`,
                      }}
                    >
                      <path
                        className="gb-edge-line ps-edge-line"
                        d={path}
                        pathLength={1}
                        markerEnd="url(#ps-arrow)"
                      />
                      {/* Dashes travelling the path, so a connection reads as a
                          direction of flow rather than a static line. */}
                      <path className="ps-edge-flow" d={path} />
                    </g>
                  );
                })}
              </svg>

              {graph.nodes.map((node, nodeIndex) => {
                const type = nodeType(node.type);
                const isLit = litNodeIds.has(node.id);
                return (
                  <div
                    key={node.id}
                    className={`gb-node gb-node--static ps-node${
                      isLit ? ' is-lit' : ''
                    }${focus && !isLit ? ' is-dimmed' : ''}`}
                    style={{
                      left: node.x,
                      top: node.y,
                      animationDelay: `${nodeIndex * STEP_MS}ms`,
                    }}
                    onPointerEnter={() => setFocus({ nodeId: node.id })}
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

        <div className="ps-panel ps-panel--commands">
          <div className="ps-terminal-chrome" aria-hidden="true">
            <span className="ps-dot ps-dot--red" />
            <span className="ps-dot ps-dot--yellow" />
            <span className="ps-dot ps-dot--green" />
            <span className="ps-terminal-name">{preset.id} — zsh</span>
          </div>

          <ol key={preset.id} className="ps-commands">
            {lines.map((line, lineIndex) => {
              const isLit =
                (line.nodeId !== undefined && line.nodeId === focus?.nodeId) ||
                (line.edgeId !== undefined && line.edgeId === focus?.edgeId);
              return (
                <li
                  key={line.command}
                  className={`ps-command${isLit ? ' is-lit' : ''}${
                    focus && !isLit ? ' is-dimmed' : ''
                  }`}
                  style={{ animationDelay: `${lineIndex * STEP_MS}ms` }}
                  title={line.comment}
                  onPointerEnter={() =>
                    setFocus(
                      line.nodeId || line.edgeId
                        ? { nodeId: line.nodeId, edgeId: line.edgeId }
                        : undefined,
                    )
                  }
                >
                  <span className="ps-prompt" aria-hidden="true">
                    ❯
                  </span>
                  <code>
                    <CommandText command={line.command} />
                  </code>
                </li>
              );
            })}
          </ol>

          <div className="ps-terminal-bar">
            <span className="ps-terminal-hint">
              {lines.length} commands, run in order
            </span>
            <button
              type="button"
              className={`gb-copy-btn${copied ? ' is-copied' : ''}`}
              onClick={copy}
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
              <span>{copied ? 'Copied' : 'Copy commands'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="ps-actions">
        <button
          type="button"
          className="ps-action"
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

        <a
          className="ps-action ps-action--primary"
          href={`${builderHref}?preset=${preset.id}`}
        >
          <span>Open this in the graph builder</span>
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
  );
};

export default PresetShowcase;
