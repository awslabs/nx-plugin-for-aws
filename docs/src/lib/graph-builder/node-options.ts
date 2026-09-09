/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isApplicable, isValueApplicable } from '../generator-options';
import type { NodeProperty, NodeType } from './catalog';
import type { GraphNode } from './model';

/**
 * Which of a node's options apply, given the values it is set to.
 *
 * A generator's schema can say that an option only applies for certain values of
 * another (`x-when`), or that one of an option's values does (`x-value-when`) —
 * a gateway's `auth` needs infrastructure to authenticate, and only a LangChain
 * agent has a DynamoDB session to save to. The builder reads those the way the
 * guides do, so a graph can only hand over commands the generators accept.
 *
 * The options a node type fixes are already gone from `type.properties`, dropped
 * where the type's own variant options rule them out. What's left is what the
 * reader chooses, and can therefore rule out as they go.
 */

/** The values a run of this node's generator would use, as strings. */
export const effectiveNodeOptions = (
  type: NodeType,
  options: Readonly<Record<string, string | boolean>>,
): Record<string, string> => {
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(type.variantOptions),
  );
  for (const property of type.properties) {
    const value = options[property.name] ?? property.default;
    if (value !== undefined && value !== '')
      values[property.name] = String(value);
  }
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') values[key] = String(value);
  }
  return values;
};

const asOption = (property: NodeProperty) => ({
  when: property.when as Record<string, string[]> | undefined,
  valueWhen: property.valueWhen as
    | Record<string, Record<string, string[]>>
    | undefined,
});

/** Whether an option applies given what the node is set to. */
export const propertyApplies = (
  property: NodeProperty,
  values: Record<string, string>,
): boolean => isApplicable(asOption(property), values);

/** Whether one of an option's values applies given what the node is set to. */
export const propertyValueApplies = (
  property: NodeProperty,
  value: string,
  values: Record<string, string>,
): boolean => isValueApplicable(asOption(property), value, values);

/**
 * A node's options with anything the rest of them rules out put right: an option
 * that no longer applies is dropped, and a value that no longer applies gives way
 * to one that does — where the value a run would fall back to is ruled out too,
 * the option has to name one that isn't, or the generator refuses the command.
 *
 * Called whenever an option changes, so the graph is always one the commands can
 * be emitted from.
 */
export const reconcileNodeOptions = (
  type: NodeType,
  options: Readonly<Record<string, string | boolean>>,
): Record<string, string | boolean> => {
  const next: Record<string, string | boolean> = { ...options };
  const values = effectiveNodeOptions(type, options);

  for (const property of type.properties) {
    if (!propertyApplies(property, values)) {
      delete next[property.name];
      continue;
    }
    if (!property.enum || property.enum.length === 0) continue;

    const applicable = property.enum.filter((value) =>
      propertyValueApplies(property, value, values),
    );
    if (applicable.length === 0) continue;

    const chosen = next[property.name];
    if (chosen !== undefined && !applicable.includes(String(chosen))) {
      delete next[property.name];
    }
    const fallback = String(next[property.name] ?? property.default ?? '');
    if (fallback && !applicable.includes(fallback)) {
      next[property.name] = applicable[0];
    }
  }

  return next;
};

/** The same, for a node. */
export const reconcileNode = (node: GraphNode, type: NodeType): GraphNode => {
  const options = reconcileNodeOptions(type, node.options);
  return Object.keys(options).length === Object.keys(node.options).length &&
    Object.entries(options).every(([key, value]) => node.options[key] === value)
    ? node
    : { ...node, options };
};
