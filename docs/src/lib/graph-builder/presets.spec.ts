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
import { emitCommands, toScriptLines } from './commands';
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

  // The polyglot example is the widest spread of the plugin in one graph, and the
  // commands it hands over are the ones a reader runs, so they are pinned here in
  // full: a change to the emitter or the catalogue that rewrites them shows up as
  // a diff rather than as a workspace that doesn't build.
  it('should emit the commands the polyglot full-stack example is written around', () => {
    const preset = PRESETS.find((p) => p.id === 'polyglot-full-stack');
    if (!preset) throw new Error('the polyglot preset is missing');
    const lines = toScriptLines(buildPresetGraph(preset), {
      workspace: 'my-project',
      packageManager: 'pnpm',
      iac: 'cdk',
    });

    expect(lines.map((line) => line.command)).toEqual([
      'pnpm create @aws/nx-workspace my-project --iac=cdk --interactive=false',
      'cd my-project',
      'pnpm nx g @aws/nx-plugin:py#project py-app --type=application --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#project app --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#website frontend --framework=react --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#website#auth --project=frontend --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#api backend --framework=trpc --no-interactive',
      'pnpm nx g @aws/nx-plugin:agentcore-gateway mcp-gateway --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#dynamodb dynamodb --no-interactive',
      'pnpm nx g @aws/nx-plugin:py#agent --project=py_app --name=agent --protocol=ag-ui --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#mcp-server --project=app --name=typescript-mcp --no-interactive',
      'pnpm nx g @aws/nx-plugin:py#mcp-server --project=py_app --name=python-mcp --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=frontend --targetProject=backend --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=frontend --targetProject=py_app --targetComponent=agent --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=py_app --targetProject=mcp-gateway --sourceComponent=agent --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=mcp-gateway --targetProject=app --targetComponent=typescript-mcp --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=mcp-gateway --targetProject=py_app --targetComponent=python-mcp --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=app --targetProject=dynamodb --sourceComponent=typescript-mcp --no-interactive',
      'pnpm nx g @aws/nx-plugin:connection --sourceProject=backend --targetProject=dynamodb --no-interactive',
      'pnpm nx g @aws/nx-plugin:ts#infra infra --no-interactive',
    ]);
  });

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
