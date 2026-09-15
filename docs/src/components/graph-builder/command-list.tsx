/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef } from 'react';
import type { ScriptLine } from '../../lib/graph-builder/commands';

/** A piece of a command that gets its own colour. */
interface CommandPart {
  readonly key: string;
  readonly text: string;
  readonly kind: 'plain' | 'namespace' | 'generator' | 'flag';
}

const PART_CLASS: Record<CommandPart['kind'], string | undefined> = {
  plain: undefined,
  namespace: 'gb-token--namespace',
  generator: 'gb-token--generator',
  flag: 'gb-token--flag',
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

export const CommandText = ({ command }: { command: string }) => (
  <>
    {commandParts(command).map((part) => (
      <span key={part.key} className={PART_CLASS[part.kind]}>
        {part.text}
      </span>
    ))}
  </>
);

/** The graph element a command belongs to. */
export interface CommandFocus {
  readonly nodeId?: string;
  readonly edgeId?: string;
}

interface Props {
  lines: readonly ScriptLine[];
  /** Print what each command does above it, as a shell comment. */
  annotate?: boolean;
  /** The graph element lit right now, so its commands stand out from the rest. */
  focus?: CommandFocus;
  /** Reports the element a command belongs to as the pointer moves over it. */
  onFocus?: (focus: CommandFocus | undefined) => void;
  /** Milliseconds between each line arriving. Omit to have them all at once. */
  stagger?: number;
  /** Keep the newest command in view as lines arrive, for a list that scrolls. */
  followTail?: boolean;
  /** What to say instead when there are no commands to run. */
  empty?: string;
}

/**
 * The commands that scaffold a graph, as a terminal transcript: one line each,
 * the generator being run picked out of it.
 *
 * With `focus` and `onFocus` the lines pair up with a diagram of the same graph —
 * pointing at either lights the other, since every command carries the node or
 * edge it came from.
 */
export const CommandList = ({
  lines,
  annotate,
  focus,
  onFocus,
  stagger,
  followTail,
  empty,
}: Props) => {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!followTail || !list || lines.length === 0) return;
    list.scrollTop = list.scrollHeight;
  }, [followTail, lines.length]);

  if (lines.length === 0 && empty) {
    return <p className="gb-commands-empty">{empty}</p>;
  }

  return (
    <ol className="gb-commands" ref={listRef}>
      {lines.map((line, index) => {
        const isLit =
          (line.nodeId !== undefined && line.nodeId === focus?.nodeId) ||
          (line.edgeId !== undefined && line.edgeId === focus?.edgeId);
        return (
          <li
            key={line.command}
            className={`gb-command${isLit ? ' is-lit' : ''}${
              focus && !isLit ? ' is-dimmed' : ''
            }`}
            style={
              stagger ? { animationDelay: `${index * stagger}ms` } : undefined
            }
            // Redundant where the comments are already printed.
            title={annotate ? undefined : line.comment}
            onPointerEnter={
              onFocus &&
              (() =>
                onFocus(
                  line.nodeId || line.edgeId
                    ? { nodeId: line.nodeId, edgeId: line.edgeId }
                    : undefined,
                ))
            }
            onPointerLeave={onFocus && (() => onFocus(undefined))}
          >
            {annotate && line.comment && (
              <span className="gb-command-comment"># {line.comment}</span>
            )}
            <span className="gb-command-line">
              <span className="gb-prompt" aria-hidden="true">
                ❯
              </span>
              <code>
                <CommandText command={line.command} />
              </code>
            </span>
          </li>
        );
      })}
    </ol>
  );
};
