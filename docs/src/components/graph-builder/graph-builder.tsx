/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findEdgeType,
  NODE_TYPES,
  nodeType,
  sourcesFor,
  targetsFor,
} from '../../lib/graph-builder/catalog';
import type { EmitOptions } from '../../lib/graph-builder/commands';
import {
  autoFixesForConnection,
  type Graph,
  type GraphNode,
  validate,
} from '../../lib/graph-builder/model';
import { Canvas } from './canvas';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type Orientation,
  snap,
  transposePositions,
} from './geometry';
import { Inspector } from './inspector';
import { Output } from './output';
import { Palette } from './palette';
import { buildPresetGraph, PRESETS } from './presets';

const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

const DEFAULT_EMIT_OPTIONS: EmitOptions = {
  packageManager: 'pnpm',
  workspace: 'my-project',
  iac: 'cdk',
};

/** How many undo steps to keep. Enough to unwind a mislaid layout, not unbounded. */
const HISTORY_LIMIT = 50;

/**
 * A default name for a new node of the given type, suffixed when the base name
 * is already taken so two dropped components never start out clashing.
 */
const defaultName = (typeId: string, nodes: readonly GraphNode[]): string => {
  // The generator id's last segment reads well as a name: `ts#mcp-server` gives
  // `mcp-server`, `agentcore-gateway` gives `agentcore-gateway`.
  const base = typeId.split('#').pop() ?? typeId;
  const taken = new Set(nodes.map((node) => node.name));
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/**
 * The host project name a new component node adopts: an existing host of the
 * same project generator if the graph has one, so components naturally land in
 * the same project, else a name derived from the generator's language.
 */
const defaultHostName = (
  typeId: string,
  nodes: readonly GraphNode[],
): string | undefined => {
  const type = nodeType(typeId);
  if (type.kind !== 'component' || !type.host) return undefined;
  const existing = nodes.find((node) => {
    const other = nodeType(node.type);
    return (
      other.kind === 'component' &&
      other.host?.generator === type.host!.generator &&
      node.hostName
    );
  });
  if (existing?.hostName) return existing.hostName;
  return type.host.generator.startsWith('py#') ? 'py-app' : 'app';
};

export const GraphBuilder = () => {
  const [graph, setGraph] = useState<Graph>(EMPTY_GRAPH);
  // Ordered so the last-clicked node is the one the inspector shows.
  const [selection, setSelection] = useState<readonly string[]>([]);
  // An edge is selected on its own, not alongside nodes: the two have different
  // delete semantics, and selecting one clears the other.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [pendingType, setPendingType] = useState<string | undefined>();
  // Which way the graph flows. Swapping it re-lays the nodes rather than just
  // moving the ports, so the graph still reads along its new axis.
  const [orientation, setOrientation] = useState<Orientation>('horizontal');
  const [emitOptions, setEmitOptions] =
    useState<EmitOptions>(DEFAULT_EMIT_OPTIONS);

  // Undo/redo stacks. Held in refs since they are never rendered directly and
  // shouldn't cause a re-render when pushed to.
  const undoStack = useRef<Graph[]>([]);
  const redoStack = useRef<Graph[]>([]);
  const nextId = useRef(0);
  // The canvas reports its visible width here so presets can be laid out to fit
  // it. A ref, not state: only the preset handler reads it, on click.
  const canvasWidthRef = useRef<number | undefined>(undefined);

  /**
   * Apply a change, recording the previous graph for undo. Node moves pass
   * `transient` so a drag doesn't fill the history with intermediate positions.
   */
  const commit = useCallback(
    (next: (current: Graph) => Graph, { transient = false } = {}) => {
      setGraph((current) => {
        if (!transient) {
          undoStack.current = [...undoStack.current, current].slice(
            -HISTORY_LIMIT,
          );
          redoStack.current = [];
        }
        return next(current);
      });
    },
    [],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.at(-1);
    if (!previous) return;
    undoStack.current = undoStack.current.slice(0, -1);
    setGraph((current) => {
      redoStack.current = [...redoStack.current, current];
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.at(-1);
    if (!next) return;
    redoStack.current = redoStack.current.slice(0, -1);
    setGraph((current) => {
      undoStack.current = [...undoStack.current, current];
      return next;
    });
  }, []);

  const addNodeAt = useCallback(
    (typeId: string, x: number, y: number) => {
      // A palette entry for a type the catalogue no longer has can only come
      // from a stale drag; ignore it rather than throwing.
      if (!NODE_TYPES.some((type) => type.id === typeId)) return;
      const id = `node-${nextId.current++}`;
      commit((current) => ({
        ...current,
        nodes: [
          ...current.nodes,
          {
            id,
            type: typeId,
            name: defaultName(typeId, current.nodes),
            options: {},
            ...(defaultHostName(typeId, current.nodes)
              ? { hostName: defaultHostName(typeId, current.nodes) }
              : {}),
            x,
            y,
          },
        ],
      }));
      setSelection([id]);
      setSelectedEdgeId(undefined);
    },
    [commit],
  );

  /**
   * Add a node by click rather than drag, placed in the first free slot on the
   * grid so entries never land on top of each other.
   */
  const addNode = useCallback(
    (typeId: string) => {
      const columns = 4;
      const index = graph.nodes.length;
      addNodeAt(
        typeId,
        snap(48 + (index % columns) * (NODE_WIDTH + 96)),
        snap(48 + Math.floor(index / columns) * (NODE_HEIGHT + 56)),
      );
    },
    [addNodeAt, graph.nodes.length],
  );

  const moveNodes = useCallback(
    (moves: readonly { id: string; x: number; y: number }[]) => {
      if (moves.length === 0) return;
      const byId = new Map(moves.map((move) => [move.id, move]));
      commit(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const move = byId.get(node.id);
            return move ? { ...node, x: move.x, y: move.y } : node;
          }),
        }),
        { transient: true },
      );
    },
    [commit],
  );

  /** Delete the given nodes, and every edge touching one of them. */
  const deleteNodes = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const removing = new Set(ids);
      commit((current) => ({
        nodes: current.nodes.filter((node) => !removing.has(node.id)),
        // A node's edges go with it — an edge to a node that no longer exists
        // has nothing to scaffold.
        edges: current.edges.filter(
          (edge) => !removing.has(edge.source) && !removing.has(edge.target),
        ),
      }));
      setSelection((current) => current.filter((id) => !removing.has(id)));
    },
    [commit],
  );

  const connect = useCallback(
    (sourceId: string, targetId: string) => {
      commit((current) => {
        const source = current.nodes.find((node) => node.id === sourceId);
        const target = current.nodes.find((node) => node.id === targetId);
        if (!source || !target) return current;
        if (!findEdgeType(source.type, target.type)) return current;
        const exists = current.edges.some(
          (edge) => edge.source === sourceId && edge.target === targetId,
        );
        if (exists) return current;

        // Some connections only work against one setting — a website reaches an
        // agent over AG-UI, an agent reaches another over A2A. Switch to it as the
        // edge is drawn, rather than drawing it and reporting an error, but leave
        // any option the user chose themselves alone.
        const fixes = autoFixesForConnection(source, target);
        const nodes = fixes.length
          ? current.nodes.map((node) => {
              const forNode = fixes.filter((fix) => fix.nodeId === node.id);
              if (forNode.length === 0) return node;
              return {
                ...node,
                options: {
                  ...node.options,
                  ...Object.fromEntries(
                    forNode.map((fix) => [fix.option, fix.value]),
                  ),
                },
              };
            })
          : current.nodes;

        return {
          ...current,
          nodes,
          edges: [
            ...current.edges,
            {
              id: `edge-${nextId.current++}`,
              source: sourceId,
              target: targetId,
            },
          ],
        };
      });
    },
    [commit],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== id),
      }));
      setSelectedEdgeId((current) => (current === id ? undefined : current));
    },
    [commit],
  );

  /** Select an edge, clearing any node selection so Delete is unambiguous. */
  const selectEdge = useCallback((id: string | undefined) => {
    setSelectedEdgeId(id);
    if (id !== undefined) setSelection([]);
  }, []);

  const updateNode = useCallback(
    (id: string, patch: Partial<GraphNode>) => {
      commit((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, ...patch } : node,
        ),
      }));
    },
    [commit],
  );

  const setNodeOption = useCallback(
    (id: string, option: string, value: string | boolean) => {
      commit((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id
            ? { ...node, options: { ...node.options, [option]: value } }
            : node,
        ),
      }));
    },
    [commit],
  );

  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((entry) => entry.id === presetId);
      if (!preset) return;
      // Lay the preset out for the canvas as it is now, so its widest row lands
      // fully in view rather than running off the right edge.
      commit(() => {
        const built = buildPresetGraph(preset, canvasWidthRef.current);
        if (orientation === 'horizontal') return built;
        // Presets are authored on a left-to-right grid, so transpose one loaded
        // while the canvas is running top-to-bottom.
        const moves = new Map(
          transposePositions(
            built.nodes,
            orientation,
            canvasWidthRef.current,
          ).map((m) => [m.id, m]),
        );
        return {
          ...built,
          nodes: built.nodes.map((node) => {
            const move = moves.get(node.id);
            return move ? { ...node, x: move.x, y: move.y } : node;
          }),
        };
      });
      setSelection([]);
      setSelectedEdgeId(undefined);
    },
    [commit, orientation],
  );

  // Stable identity, so the canvas's resize observer isn't torn down and
  // re-established on every render.
  const handleCanvasResize = useCallback((width: number) => {
    canvasWidthRef.current = width;
  }, []);

  /**
   * Flip the flow axis, transposing the layout so the graph reads along it. The
   * transpose normalises to lanes rather than swapping raw coordinates, so
   * swapping back and forth stays tidy instead of drifting.
   */
  const toggleOrientation = useCallback(() => {
    setOrientation((current) => {
      const next: Orientation =
        current === 'horizontal' ? 'vertical' : 'horizontal';
      commit((graph) => {
        if (graph.nodes.length === 0) return graph;
        const moves = new Map(
          transposePositions(graph.nodes, next, canvasWidthRef.current).map(
            (move) => [move.id, move],
          ),
        );
        return {
          ...graph,
          nodes: graph.nodes.map((node) => {
            const move = moves.get(node.id);
            return move ? { ...node, x: move.x, y: move.y } : node;
          }),
        };
      });
      return next;
    });
  }, [commit]);

  const clear = useCallback(() => {
    commit(() => EMPTY_GRAPH);
    setSelection([]);
    setSelectedEdgeId(undefined);
  }, [commit]);

  // Undo/redo and delete shortcuts, ignored while a text field has focus so they
  // don't fight the browser's own undo in the name and option inputs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (editing) return;

      // A selected edge deletes from anywhere on the page, matching how a
      // focused node responds to the same key.
      if (
        selectedEdgeId &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
        return;
      }

      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'z'
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, selectedEdgeId, deleteEdge]);

  const issues = useMemo(() => validate(graph), [graph]);
  // The inspector edits one node: the last one clicked, of those still present.
  const selected = graph.nodes.find((node) => node.id === selection.at(-1));
  const selectedIds = useMemo(() => new Set(selection), [selection]);

  /**
   * Select a node, or toggle it in and out of the selection when the user holds
   * shift — so a group can be built up and dragged together.
   */
  const selectNode = useCallback(
    (id: string | undefined, { additive = false } = {}) => {
      setSelectedEdgeId(undefined);
      if (id === undefined) {
        setSelection([]);
        return;
      }
      setSelection((current) => {
        if (!additive) {
          // Re-clicking a member of a group keeps the group, so a plain drag
          // moves all of it rather than collapsing to the one node.
          return current.includes(id) ? current : [id];
        }
        return current.includes(id)
          ? current.filter((existing) => existing !== id)
          : [...current, id];
      });
    },
    [],
  );

  /**
   * Node types that can connect to or from the selection, so the palette can
   * point at what to reach for next.
   */
  const compatibleTypes = useMemo(() => {
    if (!selected) return undefined;
    return new Set([
      ...targetsFor(selected.type),
      ...sourcesFor(selected.type),
    ]);
  }, [selected]);

  const errorCount = issues.filter(
    (issue) => issue.severity === 'error',
  ).length;

  return (
    <div className="gb-root" data-graph-builder>
      <div className="gb-toolbar">
        <div className="gb-toolbar-presets">
          <label className="gb-toolbar-label" htmlFor="gb-preset">
            Start from
          </label>
          <select
            id="gb-preset"
            className="gb-select"
            // Held at the placeholder rather than the last choice, so picking the
            // same preset again reloads it instead of being a no-op.
            value=""
            onChange={(event) => {
              if (event.target.value) loadPreset(event.target.value);
            }}
          >
            <option value="">Choose an example…</option>
            {PRESETS.map((preset) => (
              <option
                key={preset.id}
                value={preset.id}
                title={preset.description}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <div className="gb-toolbar-actions">
          <span className="gb-stat">
            {graph.nodes.length} component{graph.nodes.length === 1 ? '' : 's'}
          </span>
          <span className="gb-stat">
            {graph.edges.length} connection{graph.edges.length === 1 ? '' : 's'}
          </span>
          {selection.length > 1 && (
            <span className="gb-stat gb-stat--accent">
              {selection.length} selected
            </span>
          )}
          {errorCount > 0 && (
            <span className="gb-stat gb-stat--error">
              {errorCount} issue{errorCount === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            className="gb-chip gb-chip--icon"
            onClick={toggleOrientation}
            aria-label={
              orientation === 'horizontal'
                ? 'Lay the graph out top to bottom'
                : 'Lay the graph out left to right'
            }
            title={
              orientation === 'horizontal'
                ? 'Lay out top to bottom'
                : 'Lay out left to right'
            }
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {orientation === 'horizontal' ? (
                // Two stacked boxes joined vertically: what pressing this gives.
                <>
                  <rect x="7" y="2.5" width="10" height="6" rx="1.5" />
                  <rect x="7" y="15.5" width="10" height="6" rx="1.5" />
                  <line x1="12" y1="8.5" x2="12" y2="15.5" />
                </>
              ) : (
                <>
                  <rect x="2.5" y="9" width="6" height="6" rx="1.5" />
                  <rect x="15.5" y="9" width="6" height="6" rx="1.5" />
                  <line x1="8.5" y1="12" x2="15.5" y2="12" />
                </>
              )}
            </svg>
            {orientation === 'horizontal' ? 'Vertical' : 'Horizontal'}
          </button>
          <button
            type="button"
            className="gb-chip"
            onClick={undo}
            aria-label="Undo"
            title="Undo (⌘Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="gb-chip"
            onClick={redo}
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
          >
            Redo
          </button>
          <button
            type="button"
            className="gb-chip gb-chip--danger"
            onClick={clear}
            disabled={graph.nodes.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="gb-workspace">
        <aside
          className="gb-pane gb-pane--palette"
          aria-label="Component palette"
        >
          <Palette
            onDragStart={setPendingType}
            onDragEnd={() => setPendingType(undefined)}
            onAdd={addNode}
            highlighted={compatibleTypes}
          />
        </aside>

        <Canvas
          graph={graph}
          issues={issues}
          selectedIds={selectedIds}
          selectedEdgeId={selectedEdgeId}
          pendingType={pendingType}
          orientation={orientation}
          onSelect={selectNode}
          onSelectEdge={selectEdge}
          onMoveNodes={moveNodes}
          onAddNodeAt={addNodeAt}
          onConnect={connect}
          onDeleteEdge={deleteEdge}
          onDeleteNodes={deleteNodes}
          onResize={handleCanvasResize}
        />

        <aside className="gb-pane gb-pane--inspector" aria-label="Properties">
          <Inspector
            node={selected}
            issues={issues}
            onChange={(patch) => selected && updateNode(selected.id, patch)}
            onOptionChange={(option, value) =>
              selected && setNodeOption(selected.id, option, value)
            }
            onDelete={() => deleteNodes(selection)}
            selectedCount={selection.length}
          />
        </aside>
      </div>

      <Output
        graph={graph}
        issues={issues}
        options={emitOptions}
        onOptionsChange={(patch) =>
          setEmitOptions((current) => ({ ...current, ...patch }))
        }
      />
    </div>
  );
};

export default GraphBuilder;
