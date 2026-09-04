/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kebabCase } from '../../../../packages/nx-plugin/src/utils/names';
import {
  buildPresetGraph,
  PRESETS,
} from '../../components/graph-builder/presets';
import { nodeType } from './catalog';
import { emitCommands } from './commands';

/**
 * Two guides offer the reader a choice: copy the commands from an embedded
 * read-only graph, or run each generator themselves from the prose beside it.
 * Both are presented as reaching the same workspace, and every code sample
 * further down the page assumes it — a construct class name, a source directory,
 * an Nx target — so the two routes really must scaffold the same thing.
 *
 * These tests compare the preset's emitted commands against the `RunGenerator`
 * blocks in the guide's own source, which is the only place the step-by-step
 * route is written down. A preset gaining or losing an option, or the prose
 * changing one, fails here rather than in a reader's terminal.
 */

const DOCS = join(import.meta.dirname, '../../content/docs/en/get_started');

/** A generator invocation, reduced to what determines what gets scaffolded. */
interface Invocation {
  readonly generator: string;
  readonly options: Readonly<Record<string, string>>;
}

/**
 * Values naming a project, normalised so the two routes' spellings compare.
 *
 * The prose qualifies a project with the workspace's npm scope, which the
 * emitted commands leave off (the connection generator resolves an unqualified
 * name against the scope). A name is otherwise kebab-cased by whichever
 * generator receives it, so `GameUI` and `game-ui` name one project.
 */
const PROJECT_OPTIONS = new Set([
  'name',
  'project',
  'sourceProject',
  'targetProject',
]);

const normaliseValue = (option: string, value: string): string =>
  PROJECT_OPTIONS.has(option)
    ? kebabCase(value.replace(/^@[^/]+\//, ''))
    : value;

/**
 * Options whose value matches the generator's own schema default, which either
 * route may pass or leave off with the same result.
 */
const SCHEMA_DEFAULTS: Readonly<Record<string, Record<string, string>>> = {
  'ts#api': { framework: 'trpc', auth: 'iam', integrationPattern: 'isolated' },
  'ts#website': { framework: 'react', ux: 'shadcn' },
  'py#project': { type: 'application' },
  'terraform#project': { type: 'application' },
};

const normalise = ({ generator, options }: Invocation): string => {
  const defaults = SCHEMA_DEFAULTS[generator] ?? {};
  const entries = Object.entries(options)
    .map(([k, v]) => [k, normaliseValue(k, v)] as const)
    .filter(([k, v]) => defaults[k] !== v)
    // The component flags disambiguate which of a project's components a
    // connection wires up. The prose omits them where a project hosts only one
    // candidate; a dedicated test below covers the names they carry.
    .filter(([k]) => k !== 'sourceComponent' && k !== 'targetComponent')
    .sort(([a], [b]) => a.localeCompare(b));
  return `${generator} ${entries.map(([k, v]) => `--${k}=${v}`).join(' ')}`;
};

/**
 * The generator invocations a guide's `RunGenerator` blocks document, which is
 * how every step-by-step instruction in these guides is written.
 */
const guideInvocations = (page: string): Invocation[] => {
  const source = readFileSync(join(DOCS, page), 'utf-8');
  const blocks = source.matchAll(
    /<RunGenerator\s+generator="([^"]+)"\s+requiredParameters=\{\{([^}]*)\}\}/g,
  );
  return [...blocks].map(([, generator, parameters]) => ({
    generator,
    options: Object.fromEntries(
      [...parameters.matchAll(/(\w+)\s*:\s*"([^"]*)"|(\w+)\s*:\s*'([^']*)'/g)]
        .map((m) => [m[1] ?? m[3], m[2] ?? m[4]] as const)
        .concat(
          [...parameters.matchAll(/(\w+)\s*:\s*(true|false)/g)].map(
            (m) => [m[1], m[2]] as const,
          ),
        ),
    ),
  }));
};

/** The generator invocations a preset's copied commands run. */
const presetInvocations = (presetId: string): Invocation[] => {
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const commands = emitCommands(buildPresetGraph(preset), {
    packageManager: 'pnpm',
    workspace: presetId,
    iac: 'cdk',
    overrides: preset.overrides,
  });
  // The first command creates the workspace, which the guides cover separately.
  return commands.slice(1).map(({ command }) => {
    const [, , generator, ...args] = command.split(' ');
    const options: Record<string, string> = {};
    for (const arg of args) {
      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        options[key] = value;
      } else {
        // A positional argument is the name, which the prose always passes as
        // a flag.
        options.name = arg;
      }
    }
    return { generator: generator.replace(/^@aws\/nx-plugin:/, ''), options };
  });
};

describe.each([
  ['dungeon-adventure', 'tutorials/dungeon-game/1.mdx'],
  ['quick-start', 'quick-start.mdx'],
])('the %s preset and its guide', (presetId, page) => {
  it('should run the same generators with the same options', () => {
    const fromPreset = presetInvocations(presetId).map(normalise);
    const fromGuide = guideInvocations(page)
      .map(normalise)
      // Guides documenting both IaC providers show a Terraform infra project
      // alongside the CDK one; the emitted commands follow the chosen provider.
      .filter((c) => !c.startsWith('terraform#project '));

    expect([...fromPreset].sort()).toEqual([...fromGuide].sort());
  });
});

describe('the dungeon-adventure preset', () => {
  /**
   * The tutorial leaves `--name` off the agent and MCP server, so each generator
   * derives its own — which is what fixes the source directory, construct class
   * and Nx target prefix every later module refers to. The connection commands
   * must then name the components by those derived names.
   */
  it('should reference the agent and MCP server by their derived names', () => {
    const connections = presetInvocations('dungeon-adventure').filter(
      (i) => i.generator === 'connection',
    );
    const components = connections.flatMap((i) =>
      [i.options.sourceComponent, i.options.targetComponent].filter(Boolean),
    );
    expect(new Set(components)).toEqual(new Set(['agent', 'mcp-server']));
  });

  it('should not name the agent or MCP server itself', () => {
    const preset = PRESETS.find((p) => p.id === 'dungeon-adventure')!;
    const componentNames = preset.nodes
      .filter((n) => nodeType(n.type).kind === 'component')
      .map((n) => n.name);
    for (const name of componentNames) {
      expect(preset.overrides?.[name]?.generatorName).toBeNull();
    }
  });
});
