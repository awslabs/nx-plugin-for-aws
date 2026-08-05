/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildPresetGraph,
  PRESETS,
} from '../../components/graph-builder/presets';
import { emitCommands } from './commands';
import { validate } from './model';

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
});
