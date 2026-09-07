/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { InfraLayout } from '../../lib/graph-builder/infrastructure';
import { AwsIcon } from './aws-icon';
import { boxPath, rectPath } from './geometry';

interface Props {
  layout: InfraLayout;
  /** Unique per diagram, so pages holding several keep their own arrowhead. */
  markerId: string;
  /** Graph node and edge ids not yet scaffolded, drawn as still to come. */
  planned?: ReadonlySet<string>;
  /** Ids the command that just ran scaffolded, drawn arriving. */
  arriving?: ReadonlySet<string>;
  /** Ids to highlight; anything else reads dimmed while some id is lit. */
  lit?: ReadonlySet<string>;
  onFocus?: (focus: { nodeId?: string; edgeId?: string } | undefined) => void;
  /**
   * The classes the host draws its own connections with, so the arrows between
   * projects read the same as the ones in the projects view — the showcase's
   * travel their dashes, a docs page's sit still.
   */
  edgeClassName?: string;
  lineClassName?: string;
}

/**
 * The AWS infrastructure view: one box per project, holding the resources its
 * generator provisions and the connections between them, with the projects'
 * connections running box to box.
 *
 * Rendered into whatever extent its host positions and scales — the read-only
 * embedded graph and the homepage showcase both hand their own canvas over — so
 * this is only the diagram itself.
 */
export const InfraDiagram = ({
  layout,
  markerId,
  planned,
  arriving,
  lit,
  onFocus,
  edgeClassName = '',
  lineClassName = '',
}: Props) => {
  const state = (id: string | undefined) =>
    id === undefined
      ? ''
      : `${planned?.has(id) ? ' is-planned' : ''}${
          arriving?.has(id) ? ' is-arriving' : ''
        }${lit?.has(id) ? ' is-lit' : ''}${
          lit && lit.size > 0 && !lit.has(id) ? ' is-dimmed' : ''
        }`;

  return (
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

        {layout.connections.map((connection) => {
          const path = boxPath(connection.from, connection.to);
          return (
            <g
              key={connection.id}
              className={`gb-edge ${edgeClassName}${state(connection.edgeId)}`}
              onPointerEnter={
                connection.edgeId
                  ? () => onFocus?.({ edgeId: connection.edgeId })
                  : undefined
              }
              onPointerLeave={
                connection.edgeId ? () => onFocus?.(undefined) : undefined
              }
            >
              {/* A connection is a thin line to hit, so pointing at it is picked
                  up by a wider invisible path over the top. */}
              {onFocus && <path className="gb-edge-hit" d={path} />}
              <path
                className={`gb-edge-line ${lineClassName}`}
                d={path}
                markerEnd={`url(#${markerId})`}
              />
            </g>
          );
        })}
      </svg>

      {layout.boxes.map((box) => (
        <div
          key={box.id}
          className={`gb-infra-box${box.bare ? ' gb-infra-box--bare' : ''}${state(
            box.nodeId,
          )}`}
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }}
          onPointerEnter={
            box.nodeId ? () => onFocus?.({ nodeId: box.nodeId }) : undefined
          }
          onPointerLeave={box.nodeId ? () => onFocus?.(undefined) : undefined}
        >
          {!box.bare && (
            <span className="gb-infra-box-head">
              <span className="gb-infra-box-name">{box.name}</span>
              <span className="gb-infra-box-type">{box.typeLabel}</span>
            </span>
          )}

          {box.links.length > 0 && (
            <svg
              className="gb-edges"
              width={box.width}
              height={box.height}
              aria-hidden="true"
            >
              {/* A project's own plumbing: the same arrow, drawn a little
                  smaller, and solid whatever the host's connections do. */}
              {box.links.map((link) => (
                <g key={link.id} className="gb-edge gb-edge--internal">
                  <path
                    className="gb-edge-line"
                    d={rectPath(link.from, link.to)}
                    markerEnd={`url(#${markerId})`}
                  />
                </g>
              ))}
            </svg>
          )}

          {box.resources.map((resource) => (
            <div
              key={resource.id}
              className={`gb-infra-res${
                resource.icon ? '' : ' gb-infra-res--plain'
              }`}
              style={{
                left: resource.x,
                top: resource.y,
                width: resource.width,
                height: resource.height,
              }}
            >
              {resource.icon && (
                <AwsIcon icon={resource.icon} alt={resource.label} />
              )}
              <span className="gb-infra-res-label">{resource.label}</span>
              {resource.detail && (
                <span className="gb-infra-res-detail">{resource.detail}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
};

export default InfraDiagram;
