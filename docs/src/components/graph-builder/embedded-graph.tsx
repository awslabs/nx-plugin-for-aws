/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nodeType } from '../../lib/graph-builder/catalog';
import type { EmitOptions } from '../../lib/graph-builder/commands';
import { toScript } from '../../lib/graph-builder/commands';
import {
  edgePath,
  loopPath,
  NODE_HEIGHT,
  NODE_WIDTH,
  type Orientation,
  sourceAnchor,
  targetAnchor,
} from './geometry';
import { NodeLogo } from './node-logo';
import { buildPresetGraph, PRESETS } from './presets';

/** Where the grid starts, and the spacing between its cells on each axis. */
const ORIGIN = 24;
const X_GAP = NODE_WIDTH + 90;
const Y_GAP = NODE_HEIGHT + 60;

interface Props {
  /** The preset to render, by id. */
  preset: string;
  /** The workspace name the emitted commands scaffold. */
  workspace?: string;
  packageManager?: string;
  iac?: 'cdk' | 'terraform';
  /** Which way the graph flows. Defaults to `vertical`. */
  orientation?: Orientation;
  /**
   * Drop the workspace-create and `cd` from the copied commands, so they run
   * inside a workspace the page has already had the reader create.
   */
  skipWorkspace?: boolean;
}

/** Padding kept around the diagram inside its box. */
const PADDING = 24;

/**
 * A read-only view of a preset: the graph laid out top to bottom, with a button
 * to copy the whole series of scaffold commands.
 *
 * Unlike the full builder there are no palette or inspector panels and nothing is
 * editable — it stands in a docs page to show, and hand over, exactly the
 * commands that build a given workspace. The diagram is sized to the page's
 * content width and scaled down to fit narrower viewports, standing as tall as
 * the graph needs.
 */
export const EmbeddedGraph = ({
  preset: presetId,
  workspace = 'my-project',
  packageManager = 'pnpm',
  iac = 'cdk',
  orientation = 'vertical',
  skipWorkspace = false,
}: Props) => {
  const preset = PRESETS.find((entry) => entry.id === presetId);

  const options: EmitOptions = useMemo(
    () => ({ workspace, packageManager, iac }),
    [workspace, packageManager, iac],
  );

  // Lay the preset out from its authored grid, honouring the flow axis: for a
  // horizontal graph the column is the step across and the row the slot down;
  // for a vertical one they swap. Positions come straight from the grid rather
  // than the builder's auto-packing, so a preset lands exactly as authored.
  const graph = useMemo(() => {
    if (!preset) return undefined;
    const built = buildPresetGraph(preset);
    const nodes = built.nodes.map((node, index) => {
      const { column, row } = preset.nodes[index];
      return {
        ...node,
        x: ORIGIN + (orientation === 'horizontal' ? column : row) * X_GAP,
        y: ORIGIN + (orientation === 'horizontal' ? row : column) * Y_GAP,
      };
    });
    return { ...built, nodes };
  }, [preset, orientation]);

  // The diagram's natural size, so it can be scaled to fit the content column.
  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) {
      return { width: PADDING * 2, height: PADDING * 2 };
    }
    return {
      width:
        Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH)) + PADDING,
      height:
        Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT)) + PADDING,
    };
  }, [graph]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | undefined>();

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setContainerWidth(container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Shrink to fit a narrow column, never enlarge past the natural size.
  const scale =
    containerWidth && layout.width > containerWidth
      ? containerWidth / layout.width
      : 1;

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const script = useMemo(
    () =>
      graph ? toScript(graph, options, { annotate: true, skipWorkspace }) : '',
    [graph, options, skipWorkspace],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; nothing to fall back to here.
    }
  };

  if (!graph) {
    return null;
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return (
    <div className="gb-root gb-embed" data-graph-builder>
      <div className="gb-embed-bar">
        <span className="gb-embed-hint">
          {graph.nodes.length} project
          {graph.nodes.length === 1 ? '' : 's'} and components,{' '}
          {graph.edges.length} connection{graph.edges.length === 1 ? '' : 's'}
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

      <div
        ref={containerRef}
        className="gb-embed-canvas"
        style={{ height: layout.height * scale }}
      >
        <div
          className="gb-embed-extent"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `scale(${scale})`,
          }}
        >
          <svg
            className="gb-edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="gb-embed-arrow"
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
              const isLoop = source.id === target.id;
              const path = isLoop
                ? loopPath(source, orientation)
                : edgePath(
                    sourceAnchor(source, orientation),
                    targetAnchor(target, orientation),
                    orientation,
                  );
              return (
                <g key={edge.id} className="gb-edge">
                  <path
                    className="gb-edge-line"
                    d={path}
                    markerEnd="url(#gb-embed-arrow)"
                  />
                </g>
              );
            })}
          </svg>

          {graph.nodes.map((node) => {
            const type = nodeType(node.type);
            return (
              <div
                key={node.id}
                className="gb-node gb-node--static"
                style={{ left: node.x, top: node.y }}
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
                    className={`gb-port gb-port--in gb-port--in-${orientation}`}
                    aria-hidden="true"
                  />
                )}
                {type.roles.includes('source') && (
                  <span
                    className={`gb-port gb-port--out gb-port--out-${orientation}`}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EmbeddedGraph;
