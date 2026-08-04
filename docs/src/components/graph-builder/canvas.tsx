/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findEdgeType, nodeType } from '../../lib/graph-builder/catalog';
import {
  canConnect,
  type Graph,
  type GraphNode,
  type Issue,
} from '../../lib/graph-builder/model';
import {
  edgeMidpoint,
  edgePath,
  loopPath,
  NODE_HEIGHT,
  NODE_WIDTH,
  type Point,
  snap,
  sourceAnchor,
  targetAnchor,
} from './geometry';
import { NodeLogo } from './node-logo';

interface Props {
  graph: Graph;
  issues: readonly Issue[];
  /** Every selected node; a group moves and deletes together. */
  selectedIds: ReadonlySet<string>;
  /** The palette type being dragged in, so drop targets can be previewed. */
  pendingType: string | undefined;
  onSelect: (id: string | undefined, options?: { additive?: boolean }) => void;
  onMoveNodes: (moves: readonly { id: string; x: number; y: number }[]) => void;
  onAddNodeAt: (typeId: string, x: number, y: number) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onDeleteEdge: (id: string) => void;
  onDeleteNodes: (ids: readonly string[]) => void;
  /** Reports the canvas's visible width, so presets can be laid out to fit it. */
  onResize?: (width: number, height: number) => void;
}

/**
 * An in-progress node drag. Every node in the drag moves by the same delta from
 * where it started, so a multi-node selection keeps its relative layout.
 */
interface NodeDrag {
  /** Canvas position of the pointer when the drag began. */
  readonly startX: number;
  readonly startY: number;
  /** Where each dragged node was when the drag began. */
  readonly origins: readonly { id: string; x: number; y: number }[];
  /** Whether the pointer has moved far enough to count as a drag, not a click. */
  moved: boolean;
}

/** An in-progress edge draw, from a node's output port to the cursor. */
interface EdgeDraft {
  readonly sourceId: string;
  readonly to: Point;
  /** The node currently under the cursor, if it is a valid target. */
  readonly hoverTargetId?: string;
}

/**
 * An in-progress canvas pan, started by pressing the background. Positions are
 * client coordinates and the scroll offsets at press time, so the pan tracks the
 * pointer exactly regardless of how far the canvas has already scrolled.
 */
interface Pan {
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startScrollLeft: number;
  readonly startScrollTop: number;
}

const DRAG_THRESHOLD = 3;

/**
 * How far past the visible area (and past the outermost node) the canvas extends
 * on each axis, giving room to pan and to drag a node into open space.
 */
const PAN_MARGIN = 240;

export const Canvas = ({
  graph,
  issues,
  selectedIds,
  pendingType,
  onSelect,
  onMoveNodes,
  onAddNodeAt,
  onConnect,
  onDeleteEdge,
  onDeleteNodes,
  onResize,
}: Props) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [nodeDrag, setNodeDrag] = useState<NodeDrag | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  // Held in a ref, not state: a pan mutates scroll position directly and would
  // otherwise re-render the whole graph on every pointer move.
  const panRef = useRef<Pan | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // The visible size of the canvas, tracked so the scrollable extent can always
  // exceed it. Unknown until the first measure, which the effect below does.
  const [surfaceSize, setSurfaceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Keep the measured size current as the layout responds to the viewport.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const measure = () => {
      setSurfaceSize({
        width: surface.clientWidth,
        height: surface.clientHeight,
      });
      onResize?.(surface.clientWidth, surface.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [onResize]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );

  /** Pointer position in canvas coordinates, accounting for scroll. */
  const toCanvasPoint = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const surface = surfaceRef.current;
      if (!surface) return { x: 0, y: 0 };
      const rect = surface.getBoundingClientRect();
      return {
        x: event.clientX - rect.left + surface.scrollLeft,
        y: event.clientY - rect.top + surface.scrollTop,
      };
    },
    [],
  );

  // A pan scrolls the surface directly while the pointer moves, and listens on
  // the window so dragging past the canvas edge keeps working.
  useEffect(() => {
    if (!isPanning) return;

    const onPointerMove = (event: PointerEvent) => {
      const pan = panRef.current;
      const surface = surfaceRef.current;
      if (!pan || !surface) return;
      surface.scrollLeft =
        pan.startScrollLeft - (event.clientX - pan.startClientX);
      surface.scrollTop =
        pan.startScrollTop - (event.clientY - pan.startClientY);
    };

    const stop = () => {
      panRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [isPanning]);

  // Node drags and edge draws both track the pointer past the element they
  // started on, so they listen on the window and clean up when they end.
  useEffect(() => {
    if (!nodeDrag && !edgeDraft) return;

    const onPointerMove = (event: PointerEvent) => {
      const point = toCanvasPoint(event);
      if (nodeDrag) {
        let dx = point.x - nodeDrag.startX;
        let dy = point.y - nodeDrag.startY;
        if (!nodeDrag.moved) {
          if (
            Math.abs(dx) <= DRAG_THRESHOLD &&
            Math.abs(dy) <= DRAG_THRESHOLD
          ) {
            return;
          }
          nodeDrag.moved = true;
        }
        // Clamp the delta so the leftmost/topmost node in the group stops at the
        // canvas origin, keeping the whole group's relative layout intact.
        const minX = Math.min(...nodeDrag.origins.map((o) => o.x));
        const minY = Math.min(...nodeDrag.origins.map((o) => o.y));
        dx = Math.max(dx, -minX);
        dy = Math.max(dy, -minY);
        onMoveNodes(
          nodeDrag.origins.map((origin) => ({
            id: origin.id,
            x: origin.x + dx,
            y: origin.y + dy,
          })),
        );
        return;
      }

      if (edgeDraft) {
        const source = nodeById.get(edgeDraft.sourceId);
        const hovered = graph.nodes.find(
          (node) =>
            point.x >= node.x &&
            point.x <= node.x + NODE_WIDTH &&
            point.y >= node.y &&
            point.y <= node.y + NODE_HEIGHT,
        );
        const valid =
          source && hovered && canConnect(source, hovered)
            ? hovered.id
            : undefined;
        setEdgeDraft({
          sourceId: edgeDraft.sourceId,
          to: point,
          ...(valid ? { hoverTargetId: valid } : {}),
        });
      }
    };

    const onPointerUp = () => {
      if (nodeDrag) {
        // Snap to the grid on release so a hand-placed layout stays tidy while
        // the drag itself remains free-moving. A group snaps by one shared
        // offset, so it doesn't distort.
        if (nodeDrag.moved) {
          const lead = nodeById.get(nodeDrag.origins[0].id);
          if (lead) {
            const offsetX = snap(lead.x) - lead.x;
            const offsetY = snap(lead.y) - lead.y;
            onMoveNodes(
              nodeDrag.origins
                .map((origin) => nodeById.get(origin.id))
                .filter((node): node is GraphNode => node !== undefined)
                .map((node) => ({
                  id: node.id,
                  x: Math.max(0, node.x + offsetX),
                  y: Math.max(0, node.y + offsetY),
                })),
            );
          }
        }
        setNodeDrag(null);
      }
      if (edgeDraft) {
        if (edgeDraft.hoverTargetId) {
          onConnect(edgeDraft.sourceId, edgeDraft.hoverTargetId);
        }
        setEdgeDraft(null);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [
    nodeDrag,
    edgeDraft,
    graph.nodes,
    nodeById,
    onMoveNodes,
    onConnect,
    toCanvasPoint,
  ]);

  const nodeIssueSeverity = useCallback(
    (id: string): Issue['severity'] | undefined => {
      const forNode = issues.filter((issue) => issue.nodeId === id);
      if (forNode.some((issue) => issue.severity === 'error')) return 'error';
      if (forNode.length > 0) return 'warning';
      return undefined;
    },
    [issues],
  );

  const edgeIssueSeverity = useCallback(
    (id: string): Issue['severity'] | undefined => {
      const forEdge = issues.filter((issue) => issue.edgeId === id);
      if (forEdge.some((issue) => issue.severity === 'error')) return 'error';
      if (forEdge.length > 0) return 'warning';
      return undefined;
    },
    [issues],
  );

  /** Nodes that could receive the edge being drawn, for dimming the rest. */
  const validTargets = useMemo(() => {
    if (!edgeDraft) return undefined;
    const source = nodeById.get(edgeDraft.sourceId);
    if (!source) return undefined;
    return new Set(
      graph.nodes.filter((node) => canConnect(source, node)).map((n) => n.id),
    );
  }, [edgeDraft, graph.nodes, nodeById]);

  /** Nodes a palette drag could connect to, previewed while dragging in. */
  const pendingCompatible = useMemo(() => {
    if (!pendingType) return undefined;
    return new Set(
      graph.nodes
        .filter(
          (node) =>
            findEdgeType(pendingType, node.type) ||
            findEdgeType(node.type, pendingType),
        )
        .map((node) => node.id),
    );
  }, [pendingType, graph.nodes]);

  // The canvas grows to hold the graph, plus room to keep dragging outward. The
  // extent always exceeds the visible area by PAN_MARGIN on each axis, so there
  // is somewhere to pan to even when the graph is small or empty — measured from
  // the surface rather than a fixed floor, which would leave a tall canvas with
  // no vertical scroll range at all.
  const extent = useMemo(() => {
    const visible = surfaceSize ?? { width: 0, height: 0 };
    const width = Math.max(
      visible.width + PAN_MARGIN,
      ...graph.nodes.map((node) => node.x + NODE_WIDTH + PAN_MARGIN),
    );
    const height = Math.max(
      visible.height + PAN_MARGIN,
      ...graph.nodes.map((node) => node.y + NODE_HEIGHT + PAN_MARGIN),
    );
    return { width, height };
  }, [graph.nodes, surfaceSize]);

  return (
    <div
      ref={surfaceRef}
      className={`gb-canvas${isDropTarget ? ' is-drop-target' : ''}${edgeDraft ? ' is-connecting' : ''}${isPanning ? ' is-panning' : ''}`}
      // The canvas handles its own pointer and keyboard interaction (panning,
      // dropping, and the per-node controls within it).
      role="application"
      aria-label="Workspace graph"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Only the background pans. Nodes and edge controls are interactive in
        // their own right, so a press that lands on one is left to them.
        const target = event.target as HTMLElement;
        if (target.closest('.gb-node, .gb-edge-remove')) return;

        onSelect(undefined);
        const surface = surfaceRef.current;
        if (!surface) return;
        panRef.current = {
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: surface.scrollLeft,
          startScrollTop: surface.scrollTop,
        };
        setIsPanning(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setIsDropTarget(true);
      }}
      onDragLeave={(event) => {
        if (event.target === event.currentTarget) setIsDropTarget(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropTarget(false);
        const typeId = event.dataTransfer.getData('text/plain');
        if (!typeId) return;
        const point = toCanvasPoint(event);
        onAddNodeAt(
          typeId,
          snap(Math.max(0, point.x - NODE_WIDTH / 2)),
          snap(Math.max(0, point.y - NODE_HEIGHT / 2)),
        );
      }}
    >
      <div
        className="gb-canvas-extent"
        style={{ width: extent.width, height: extent.height }}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Components on the canvas"
      >
        <svg
          className="gb-edges"
          width={extent.width}
          height={extent.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="gb-arrow"
              viewBox="0 0 10 10"
              // The tip sits at x=9 in the viewBox, so refX must match for the
              // arrow to end exactly on the path's endpoint rather than past it.
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              // Scale with the stroke so the head stays proportionate.
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

            const isLoop = source.id === target.id;
            const from = sourceAnchor(source);
            const to = targetAnchor(target);
            const path = isLoop ? loopPath(source) : edgePath(from, to);
            const severity = edgeIssueSeverity(edge.id);
            const active =
              selectedIds.has(edge.source) || selectedIds.has(edge.target);
            return (
              <g
                key={edge.id}
                className={`gb-edge${severity ? ` gb-edge--${severity}` : ''}${active ? ' is-active' : ''}`}
              >
                <path className="gb-edge-hit" d={path} />
                <path
                  className="gb-edge-line"
                  d={path}
                  markerEnd="url(#gb-arrow)"
                />
              </g>
            );
          })}

          {edgeDraft &&
            (() => {
              const source = nodeById.get(edgeDraft.sourceId);
              if (!source) return null;
              const target = edgeDraft.hoverTargetId
                ? nodeById.get(edgeDraft.hoverTargetId)
                : undefined;
              const to = target ? targetAnchor(target) : edgeDraft.to;
              return (
                <path
                  className={`gb-edge-draft${edgeDraft.hoverTargetId ? ' is-valid' : ''}`}
                  d={edgePath(sourceAnchor(source), to)}
                  markerEnd="url(#gb-arrow)"
                />
              );
            })()}
        </svg>

        {/* Edge delete buttons live outside the (aria-hidden) drawing so each is a
            real, focusable button rather than a role on an SVG group. */}
        {graph.edges.map((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;
          const midpoint =
            source.id === target.id
              ? { x: source.x + NODE_WIDTH / 2, y: source.y - 34 }
              : edgeMidpoint(sourceAnchor(source), targetAnchor(target));
          return (
            <button
              key={`remove-${edge.id}`}
              type="button"
              className="gb-edge-remove"
              style={{ left: midpoint.x, top: midpoint.y }}
              aria-label={`Remove connection from ${source.name} to ${target.name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onDeleteEdge(edge.id)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M 6.5 6.5 L 13.5 13.5 M 13.5 6.5 L 6.5 13.5" />
              </svg>
            </button>
          );
        })}

        {graph.nodes.map((node) => {
          const type = nodeType(node.type);
          const severity = nodeIssueSeverity(node.id);
          const dimmed =
            (validTargets && !validTargets.has(node.id)) ||
            (pendingCompatible &&
              pendingCompatible.size > 0 &&
              !pendingCompatible.has(node.id));

          return (
            <div
              key={node.id}
              className={[
                'gb-node',
                selectedIds.has(node.id) ? 'is-selected' : '',
                severity ? `gb-node--${severity}` : '',
                nodeDrag?.nodeId === node.id ? 'is-dragging' : '',
                edgeDraft?.hoverTargetId === node.id ? 'is-drop-valid' : '',
                dimmed ? 'is-dimmed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                const additive = event.shiftKey;
                onSelect(node.id, { additive });
                // Shift-clicking is for building the selection, not dragging —
                // starting a drag here would move a node the user is toggling.
                if (additive) return;

                // Drag the whole selection when the pressed node belongs to it,
                // otherwise just this node (which the click above selected).
                const group = selectedIds.has(node.id)
                  ? graph.nodes.filter((other) => selectedIds.has(other.id))
                  : [node];
                const point = toCanvasPoint(event);
                setNodeDrag({
                  startX: point.x,
                  startY: point.y,
                  origins: group.map((other) => ({
                    id: other.id,
                    x: other.x,
                    y: other.y,
                  })),
                  moved: false,
                });
              }}
              onKeyDown={(event) => {
                // Arrow keys nudge by one grid step, so a graph can be laid out
                // without a pointer.
                const step = event.shiftKey ? 1 : 24;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                // Keyboard actions apply to the whole selection when this node
                // is part of it, matching what a drag would do.
                const affected = selectedIds.has(node.id)
                  ? graph.nodes.filter((other) => selectedIds.has(other.id))
                  : [node];
                if (event.key in moves) {
                  event.preventDefault();
                  const [dx, dy] = moves[event.key];
                  const minX = Math.min(...affected.map((other) => other.x));
                  const minY = Math.min(...affected.map((other) => other.y));
                  const clampedX = Math.max(dx, -minX);
                  const clampedY = Math.max(dy, -minY);
                  onMoveNodes(
                    affected.map((other) => ({
                      id: other.id,
                      x: other.x + clampedX,
                      y: other.y + clampedY,
                    })),
                  );
                } else if (
                  event.key === 'Delete' ||
                  event.key === 'Backspace'
                ) {
                  event.preventDefault();
                  onDeleteNodes(affected.map((other) => other.id));
                }
              }}
              // A node holds its own port buttons, so it cannot be a <button>
              // itself. `option` is the role for a selectable item among peers,
              // and unlike a bare div it carries aria-selected.
              tabIndex={0}
              role="option"
              aria-label={`${node.name || type.label}, ${type.label}`}
              aria-selected={selectedIds.has(node.id)}
            >
              <NodeLogo logo={type.logo} badge={type.badge} alt={type.label} />
              <span className="gb-node-text">
                <span className="gb-node-name">{node.name || type.label}</span>
                <span className="gb-node-type">{type.label}</span>
              </span>

              {type.roles.includes('target') && (
                <span className="gb-port gb-port--in" aria-hidden="true" />
              )}
              {type.roles.includes('source') && (
                <button
                  type="button"
                  className="gb-port gb-port--out"
                  aria-label={`Draw a connection from ${node.name || type.label}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    setEdgeDraft({
                      sourceId: node.id,
                      to: sourceAnchor(node),
                    });
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {graph.nodes.length === 0 && (
        <div className="gb-canvas-empty">
          <p className="gb-canvas-empty-title">Drag a component here</p>
          <p className="gb-canvas-empty-body">
            Pick from the palette, then drag from a component's right edge to
            another to connect them.
          </p>
        </div>
      )}
    </div>
  );
};
