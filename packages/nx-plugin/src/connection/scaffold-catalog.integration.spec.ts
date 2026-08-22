/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import GeneratorsJson from '../../generators.json' with { type: 'json' };
import { agentcoreGatewayGenerator } from '../sdk/agentcore-gateway';
import { agentcoreHarnessGenerator } from '../sdk/agentcore-harness';
import { connectionGenerator } from '../sdk/connection';
import {
  pyAgentGenerator,
  pyApiGenerator,
  pyDynamoDBGenerator,
  pyMcpServerGenerator,
  pyProjectGenerator,
  pyRdbGenerator,
} from '../sdk/py';
import {
  tsAgentGenerator,
  tsApiGenerator,
  tsDynamoDBGenerator,
  tsMcpServerGenerator,
  tsProjectGenerator,
  tsRdbGenerator,
  tsWebsiteGenerator,
} from '../sdk/ts';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';
import { toSnakeCase } from '../utils/names';
import { getNpmScope } from '../utils/npm-scope';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  CONNECTION_CONSTRAINTS,
  type ConnectionConstraint,
} from './scaffold-catalog';
import { nodeSchemaResolver, SCAFFOLD_RECIPES } from './schema-resolver';
import { SUPPORTED_CONNECTIONS } from './supported-connections';

/**
 * The docs graph builder promises that a graph it accepts is a graph that
 * scaffolds. These tests keep that promise honest by actually running the
 * generators each recipe names, then the connection between them — so a recipe
 * whose options no longer produce a connectable project fails here rather than
 * in a user's terminal.
 *
 * Every generator is invoked with exactly the options the builder would emit:
 * the variant options from the recipe, plus each connection's own constraints.
 */
describe('scaffold catalog integration', () => {
  // Maps each endpoint type to the generator call the builder's emitted command
  // would make. Keyed by type so the exhaustiveness test below can assert every
  // recipe is exercised.
  type Scaffold = (
    tree: Tree,
    name: string,
    options: Record<string, string>,
  ) => Promise<unknown>;

  const defaults = {
    preferInstallDependencies: false,
    iac: 'inherit',
  } as const;
  const projectDefaults = { ...defaults, directory: 'packages' };

  /**
   * The defaults Nx applies from a generator's JSON schema when the CLI invokes
   * it. Calling a generator in-process bypasses that, so they are applied here —
   * the builder emits a CLI command, so the options it omits are the ones the
   * schema fills in.
   */
  const schemaDefaults = (generatorId: string): Record<string, string> => {
    const entry = (
      GeneratorsJson.generators as Record<string, { schema: string }>
    )[generatorId];
    const schema = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', entry.schema),
        'utf-8',
      ),
    );
    return Object.fromEntries(
      Object.entries(schema.properties as Record<string, { default?: unknown }>)
        .filter(([, property]) => property.default !== undefined)
        .map(([name, property]) => [name, property.default as string]),
    );
  };

  /** The TypeScript project hosting ts# components, created on first use. */
  const ensureTsHost = async (tree: Tree, name: string) => {
    if (!tree.exists(`packages/${name}/project.json`)) {
      await tsProjectGenerator(tree, {
        ...schemaDefaults('ts#project'),
        name,
        ...projectDefaults,
      });
    }
    return name;
  };

  /** The Python project hosting py# components, created on first use. */
  const ensurePyHost = async (tree: Tree, name: string) => {
    if (!tree.exists(`packages/${name}/project.json`)) {
      await pyProjectGenerator(tree, {
        ...schemaDefaults('py#project'),
        name,
        type: 'application',
        ...projectDefaults,
      });
    }
    return toSnakeCase(name);
  };

  const SCAFFOLDS: Record<string, Scaffold> = {
    'ts#trpc-api': (tree, name, options) =>
      tsApiGenerator(tree, {
        ...schemaDefaults('ts#api'),
        name,
        framework: 'trpc',
        ...projectDefaults,
        ...options,
      } as any),
    'ts#smithy-api': (tree, name, options) =>
      tsApiGenerator(tree, {
        ...schemaDefaults('ts#api'),
        name,
        framework: 'smithy',
        ...projectDefaults,
        ...options,
      } as any),
    'py#fast-api': (tree, name, options) =>
      pyApiGenerator(tree, {
        ...schemaDefaults('py#api'),
        name,
        framework: 'fastapi',
        ...projectDefaults,
        ...options,
      } as any),
    'ts#react-website': (tree, name, options) =>
      tsWebsiteGenerator(tree, {
        ...schemaDefaults('ts#website'),
        name,
        framework: 'react',
        ...projectDefaults,
        ...options,
      } as any),
    'ts#rdb': (tree, name, options) =>
      tsRdbGenerator(tree, {
        ...schemaDefaults('ts#rdb'),
        name,
        ...projectDefaults,
        ...options,
      } as any),
    'py#rdb': (tree, name, options) =>
      pyRdbGenerator(tree, {
        ...schemaDefaults('py#rdb'),
        name,
        ...projectDefaults,
        ...options,
      } as any),
    'ts#dynamodb': (tree, name, options) =>
      tsDynamoDBGenerator(tree, {
        ...schemaDefaults('ts#dynamodb'),
        name,
        ...projectDefaults,
        ...options,
      } as any),
    'py#dynamodb': (tree, name, options) =>
      pyDynamoDBGenerator(tree, {
        ...schemaDefaults('py#dynamodb'),
        name,
        ...projectDefaults,
        ...options,
      } as any),
    'agentcore-gateway': (tree, name, options) =>
      agentcoreGatewayGenerator(tree, {
        ...schemaDefaults('agentcore-gateway'),
        name,
        ...projectDefaults,
        ...options,
      } as any),
    'agentcore-harness': (tree, name, options) =>
      agentcoreHarnessGenerator(tree, {
        ...schemaDefaults('agentcore-harness'),
        name,
        ...projectDefaults,
        ...options,
      } as any),
    'ts#agent': async (tree, name, options) =>
      tsAgentGenerator(tree, {
        ...schemaDefaults('ts#agent'),
        project: await ensureTsHost(tree, 'ts-host'),
        name,
        ...defaults,
        ...options,
      } as any),
    'py#agent': async (tree, name, options) =>
      pyAgentGenerator(tree, {
        ...schemaDefaults('py#agent'),
        project: await ensurePyHost(tree, 'py-host'),
        name,
        ...defaults,
        ...options,
      } as any),
    'ts#mcp-server': async (tree, name, options) =>
      tsMcpServerGenerator(tree, {
        ...schemaDefaults('ts#mcp-server'),
        project: await ensureTsHost(tree, 'ts-host'),
        name,
        ...defaults,
        ...options,
      } as any),
    'py#mcp-server': async (tree, name, options) =>
      pyMcpServerGenerator(tree, {
        ...schemaDefaults('py#mcp-server'),
        project: await ensurePyHost(tree, 'py-host'),
        name,
        ...defaults,
        ...options,
      } as any),
  };

  it('should cover every recipe', () => {
    // A recipe with no scaffold here would go unverified, so adding one to the
    // catalogue requires adding it below too.
    expect(Object.keys(SCAFFOLDS).sort()).toEqual(
      Object.keys(SCAFFOLD_RECIPES).sort(),
    );
  });

  /**
   * The options a connection's constraints require on one of its endpoints.
   * `equals` pins a value; `notEquals` needs an alternative, taken from the
   * generator's enum.
   */
  const constrainedOptions = (
    key: string,
    side: 'source' | 'target',
    endpointType: string,
  ): Record<string, string> => {
    const constraints: readonly ConnectionConstraint[] =
      (
        CONNECTION_CONSTRAINTS as Record<
          string,
          readonly ConnectionConstraint[]
        >
      )[key] ?? [];
    const options: Record<string, string> = {};
    for (const constraint of constraints.filter((c) => c.side === side)) {
      if (constraint.equals !== undefined) {
        options[constraint.option] = constraint.equals;
      } else if (constraint.notEquals !== undefined) {
        // The rejected value may be the schema default, so pick the first
        // enum value the constraint allows — as a user drawing the graph
        // would have to.
        const recipe = (SCAFFOLD_RECIPES as Record<string, any>)[endpointType];
        const schema = JSON.parse(
          readFileSync(
            join(
              import.meta.dirname,
              '..',
              '..',
              (GeneratorsJson.generators as Record<string, { schema: string }>)[
                recipe.generator
              ].schema,
            ),
            'utf-8',
          ),
        );
        const allowed = (
          schema.properties[constraint.option].enum as string[]
        ).find((value) => value !== constraint.notEquals);
        options[constraint.option] = allowed!;
      }
    }
    return options;
  };

  /** How a scaffolded endpoint is referenced by the connection generator. */
  const reference = (
    tree: Tree,
    type: string,
    name: string,
  ): { project: string; component?: string } => {
    const recipe = (SCAFFOLD_RECIPES as Record<string, any>)[type];
    if (recipe.kind === 'component') {
      return recipe.host.snakeCaseName
        ? { project: toSnakeCase('py-host'), component: name }
        : { project: 'ts-host', component: name };
    }
    return {
      project: recipe.generator.startsWith('py#')
        ? `${toSnakeCase(getNpmScope(tree))}.${toSnakeCase(name)}`
        : name,
    };
  };

  // One case per supported connection: scaffold both ends with the options the
  // builder would emit, then run the connection generator between them.
  it.each(
    SUPPORTED_CONNECTIONS.map(({ source, target }) => [
      `${source} -> ${target}`,
      source,
      target,
    ]),
  )(
    'should scaffold and connect %s',
    async (key, source, target) => {
      const tree = createTreeUsingTsSolutionSetup();
      // The builder leaves `iac` at `inherit`, as a real workspace does, so the
      // provider comes from the workspace config the preset writes.
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, { iac: { provider: 'cdk' } });

      // Distinct names, so a self-typed connection (agent -> agent) still has
      // two endpoints to wire together.
      const sourceName = 'src-node';
      const targetName = 'tgt-node';

      await SCAFFOLDS[source](
        tree,
        sourceName,
        constrainedOptions(key, 'source', source),
      );
      await SCAFFOLDS[target](
        tree,
        targetName,
        constrainedOptions(key, 'target', target),
      );

      const sourceRef = reference(tree, source, sourceName);
      const targetRef = reference(tree, target, targetName);

      // Completing without throwing is the assertion: the generator rejects a
      // connection it does not support, or whose endpoints' options conflict.
      // The returned callback is deliberately not invoked — it would shell out
      // to a package install.
      await connectionGenerator(tree, {
        sourceProject: sourceRef.project,
        targetProject: targetRef.project,
        ...(sourceRef.component
          ? { sourceComponent: sourceRef.component }
          : {}),
        ...(targetRef.component
          ? { targetComponent: targetRef.component }
          : {}),
        preferInstallDependencies: false,
      });
    },
    300000,
  );
});
