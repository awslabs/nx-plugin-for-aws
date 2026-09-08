/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildPresetGraph,
  PRESETS,
  SHOWCASE_PRESET_IDS,
} from '../../components/graph-builder/presets';
import { nodeType } from './catalog';
import { emitCommands } from './commands';
import { validate } from './model';
import {
  effectiveNodeOptions,
  propertyApplies,
  propertyValueApplies,
} from './node-options';

/**
 * A preset is a starting point users load and scaffold as-is, so every one must
 * produce a graph the builder accepts — a preset naming an unsupported
 * connection or an option a connection rejects would hand the user commands
 * that fail.
 */
describe('graph builder presets', () => {
  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'should build a valid graph for the %s preset',
    (_id, preset) => {
      const graph = buildPresetGraph(preset);

      // Every pair the preset names resolves to a supported connection.
      expect(graph.edges).toHaveLength(preset.edges.length);

      const errors = validate(graph).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    },
  );

  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'should emit scaffold commands for the %s preset',
    (_id, preset) => {
      const commands = emitCommands(buildPresetGraph(preset), {
        workspace: 'my-project',
        packageManager: 'pnpm',
        iac: 'cdk',
      });

      // The workspace, every node, every edge, and the infra project.
      expect(commands.length).toBeGreaterThanOrEqual(
        preset.nodes.length + preset.edges.length + 2,
      );
    },
  );

  // Every option a preset pins has to be one the node still takes, and one the
  // generator would accept alongside the rest.
  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'should only pin options that apply for the %s preset',
    (_id, preset) => {
      for (const node of preset.nodes) {
        const type = nodeType(node.type);
        const values = effectiveNodeOptions(type, node.options ?? {});
        for (const [option, value] of Object.entries(node.options ?? {})) {
          const property = type.properties.find((p) => p.name === option);
          if (!property) {
            throw new Error(`${node.type} has no ${option} option`);
          }
          expect(
            propertyApplies(property, values),
            `${node.type}'s ${option} does not apply`,
          ).toBe(true);
          expect(
            propertyValueApplies(property, String(value), values),
            `${node.type}'s ${option}=${value} does not apply`,
          ).toBe(true);
        }
      }
    },
  );

  // The showcase drops an id it cannot resolve rather than rendering an empty
  // stage, so a renamed preset would silently lose an example from the homepage.
  it.each(SHOWCASE_PRESET_IDS)(
    'should have a preset for the %s example the showcase names',
    (id) => {
      expect(PRESETS.map((preset) => preset.id)).toContain(id);
    },
  );
});
