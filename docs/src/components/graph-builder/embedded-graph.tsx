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
import type {
  EmitOptions,
  NodeOverride,
} from '../../lib/graph-builder/commands';
import { toScript } from '../../lib/graph-builder/commands';
import { declaredDiagram } from '../../lib/graph-builder/diagrams';
import {
  buildDeclaredLayout,
  buildInfrastructureLayout,
} from '../../lib/graph-builder/infrastructure';
import type { Graph } from '../../lib/graph-builder/model';
import {
  edgePath,
  loopPath,
  NODE_HEIGHT,
  NODE_WIDTH,
  type Orientation,
  sourceAnchor,
  targetAnchor,
} from './geometry';
import { IacMark } from './iac-mark';
import { InfraDiagram } from './infra-diagram';
import { NodeLogo } from './node-logo';
import { buildPresetGraph, PRESETS } from './presets';
import { usePageOptions } from './use-page-options';
import { type DiagramView, ViewMark, ViewToggle } from './view-toggle';

/** Where the grid starts, and the spacing between its cells on each axis. */
const ORIGIN = 24;
const X_GAP = NODE_WIDTH + 90;
const Y_GAP = NODE_HEIGHT + 60;

interface Props {
  /** The preset to render, by id. Omitted for a single-project diagram. */
  preset?: string;
  /**
   * A single project to render on its own, for a guide covering one generator:
   * either a node type from the palette or any generator with an infrastructure
   * blueprint. The diagram is then that project's own infrastructure, with no
   * commands to copy — the guide's own steps run the generator.
   */
  type?: string;
  /** The project name shown, for a single-project diagram. */
  name?: string;
  /**
   * Option values in effect for a single-project diagram, which decide what its
   * infrastructure holds — a REST API brings a WAF, an agent with `infra: none`
   * runs as a local process. A guide pins these to the variant it is describing.
   */
  options?: Readonly<Record<string, string | boolean>>;
  /**
   * A diagram declared outright, by name, for a page describing a mechanism
   * rather than a project's own infrastructure. There is nothing to switch to and
   * no commands to copy: it is one drawing.
   */
  diagram?: string;
  /**
   * Take the option values the reader has picked in the page's command, for
   * every option the diagram is not pinning. A guide's diagram then shows the
   * architecture of the options the rest of the guide is filtered to.
   */
  followPageOptions?: boolean;
  /** Which diagram to open on. Defaults to the projects view. */
  view?: DiagramView;
  /**
   * Whether to offer the commands that scaffold the graph. A page showing what a
   * workspace looks like, rather than having the reader build it, turns this off.
   */
  copyable?: boolean;
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
  /**
   * Option values the copied commands pin, keyed by node name, layered over any
   * the preset declares. A page walking the reader through the same generators
   * in prose uses these to pin what the prose passes, so both routes scaffold
   * one workspace.
   */
  overrides?: Readonly<Record<string, NodeOverride>>;
}

/** Padding kept around the diagram inside its box. */
const PADDING = 24;
/** Room left at the top of the canvas for the view switch, clear of the diagram. */
const TOGGLE_ROOM = 40;

/**
 * A read-only view of a preset, or of a single project: the graph laid out top to
 * bottom, with a switch between the projects and the AWS infrastructure they
 * deploy, and a button to copy the whole series of scaffold commands.
 *
 * Unlike the full builder there are no palette or inspector panels and nothing is
 * editable — it stands in a docs page to show, and hand over, exactly the
 * commands that build a given workspace. The diagram is sized to the page's
 * content width and scaled down to fit narrower viewports, standing as tall as
 * the graph needs.
 */
export const EmbeddedGraph = ({
  preset: presetId,
  type,
  name,
  diagram,
  options: nodeOptions,
  followPageOptions = false,
  view: initialView = 'projects',
  copyable = true,
  workspace = 'my-project',
  packageManager = 'pnpm',
  iac = 'cdk',
  orientation = 'vertical',
  skipWorkspace = false,
  overrides,
}: Props) => {
  const preset = PRESETS.find((entry) => entry.id === presetId);
  /** A guide's diagram: one project, and only the architecture of it. */
  const single = type !== undefined;
  const declared = diagram ? declaredDiagram(diagram) : undefined;
  const [chosenView, setView] = useState<DiagramView>(initialView);
  // Nothing to switch to for a single project, so it stays on its architecture
  // — which is also the only view a generator without a palette node type has.
  const view: DiagramView = single || declared ? 'infrastructure' : chosenView;
  const markerId = `${useId()}-arrow`;
  const pageOptions = usePageOptions(followPageOptions);

  const options: EmitOptions = useMemo(
    () => ({
      workspace,
      packageManager,
      iac,
      overrides: { ...preset?.overrides, ...overrides },
    }),
    [workspace, packageManager, iac, preset, overrides],
  );

  // Lay the preset out from its authored grid, honouring the flow axis: for a
  // horizontal graph the column is the step across and the row the slot down;
  // for a vertical one they swap. Positions come straight from the grid rather
  // than the builder's auto-packing, so a preset lands exactly as authored.
  const graph = useMemo((): Graph | undefined => {
    if (type) {
      return {
        nodes: [
          {
            id: type,
            type,
            name: name ?? `my-${type.split('#').pop()}`,
            // What the diagram pins wins over what the reader has selected: a
            // block describing one variant draws that variant.
            options: { ...pageOptions, ...nodeOptions },
            x: ORIGIN,
            y: ORIGIN,
          },
        ],
        edges: [],
      };
    }
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
  }, [preset, orientation, type, name, nodeOptions, pageOptions]);

  // The boxes flow down the page whichever way the projects view runs: a docs
  // column has height to spare and width to save.
  const infrastructure = useMemo(
    () =>
      declared
        ? buildDeclaredLayout(declared)
        : graph
          ? buildInfrastructureLayout(graph, { from: orientation })
          : undefined,
    [declared, graph, orientation],
  );

  // The diagram's natural size, so it can be scaled to fit the content column.
  const layout = useMemo(() => {
    if (view === 'infrastructure' && infrastructure) {
      return {
        width: infrastructure.width,
        height: infrastructure.height,
      };
    }
    if (!graph || graph.nodes.length === 0) {
      return { width: PADDING * 2, height: PADDING * 2 };
    }
    return {
      width:
        Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH)) + PADDING,
      height:
        Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT)) + PADDING,
    };
  }, [graph, view, infrastructure]);

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
  // Centred in the column: the infrastructure view is a stack of boxes narrower
  // than the page, which would otherwise sit against the left edge.
  const offset = containerWidth
    ? Math.max(0, (containerWidth - layout.width * scale) / 2)
    : 0;
  /** Room for the switch or the mark, where the diagram has one. */
  const headroom = declared ? 0 : TOGGLE_ROOM;

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  // Unannotated: the script is only ever copied, never shown, so it hands over
  // commands that paste straight into a shell. Only a preset has one — a single
  // project's diagram is drawn from a blueprint, which may be a generator the
  // scaffold catalogue knows nothing about.
  const script = useMemo(
    () => (graph && preset ? toScript(graph, options, { skipWorkspace }) : ''),
    [graph, preset, options, skipWorkspace],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; nothing to fall back to here.
    }
  };

  if (!graph && !infrastructure) {
    return null;
  }

  const nodeById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));

  const summary =
    view === 'infrastructure' && infrastructure
      ? `${infrastructure.resourceCount} AWS resource${
          infrastructure.resourceCount === 1 ? '' : 's'
        }, ${infrastructure.connectionCount} connection${
          infrastructure.connectionCount === 1 ? '' : 's'
        }`
      : graph && graph.nodes.length === 1
        ? '1 project'
        : `${graph?.nodes.length ?? 0} projects and components, ${
            graph?.edges.length ?? 0
          } connection${graph?.edges.length === 1 ? '' : 's'}`;

  return (
    <div className="gb-root gb-embed" data-graph-builder>
      {/* A declared diagram is one drawing of a mechanism: there is nothing to
          count up or to scaffold. */}
      {!declared && (
        <div className="gb-embed-bar">
          <span className="gb-embed-hint">{summary}</span>
          {preset && copyable && (
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
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="gb-embed-canvas"
        style={{ height: layout.height * scale + headroom }}
      >
        {/* One project has only its own architecture to show, so the guide
            diagrams say which view this is rather than offering the other, and a
            declared diagram is the only thing it could be. */}
        {declared ? null : single ? (
          <ViewMark view={view} />
        ) : (
          <ViewToggle view={view} onChange={setView} />
        )}

        <div
          className="gb-embed-extent"
          style={{
            top: headroom,
            left: offset,
            width: layout.width,
            height: layout.height,
            transform: `scale(${scale})`,
          }}
        >
          {view === 'infrastructure' && infrastructure ? (
            <InfraDiagram layout={infrastructure} markerId={markerId} />
          ) : (
            <>
              <svg
                className="gb-edges"
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={markerId}
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
                        markerEnd={`url(#${markerId})`}
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
            </>
          )}
        </div>

        {/* Only a workspace has a provider to name: which one declares the
            infrastructure says nothing about what the infrastructure is, so a
            single project's architecture and a declared diagram leave the mark
            off. */}
        {preset && <IacMark iac={iac} />}
      </div>
    </div>
  );
};

export default EmbeddedGraph;
