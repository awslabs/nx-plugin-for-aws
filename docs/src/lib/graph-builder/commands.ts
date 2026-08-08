/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildCreateNxWorkspaceCommand,
  buildPackageManagerExecCommand,
} from '../../../../packages/nx-plugin/src/utils/commands';
import {
  kebabCase,
  snakeCase,
} from '../../../../packages/nx-plugin/src/utils/names';
import { INFRA_PROJECT_NAME, type NodeType, nodeType } from './catalog';
import type { Graph, GraphNode } from './model';

/**
 * Turn a graph into the commands that scaffold it: one to create the workspace,
 * one per project and component, and one per connection.
 */

export interface EmitOptions {
  readonly packageManager: string;
  readonly workspace: string;
  readonly iac: 'cdk' | 'terraform';
}

/** A single emitted command, with the graph element it came from. */
export interface EmittedCommand {
  readonly command: string;
  /** What the command does, for the annotated view. */
  readonly comment: string;
  /** The graph node or edge this command scaffolds, for hover highlighting. */
  readonly nodeId?: string;
  readonly edgeId?: string;
}

const NAMESPACE = '@aws/nx-plugin';

/** The generator producing the infrastructure project for each IaC provider. */
const INFRA_GENERATORS = {
  cdk: { generator: 'ts#infra', options: {}, label: 'CDK infrastructure' },
  terraform: {
    generator: 'terraform#project',
    options: { type: 'application' },
    label: 'Terraform infrastructure',
  },
} as const satisfies Record<
  EmitOptions['iac'],
  {
    generator: string;
    options: Readonly<Record<string, string>>;
    label: string;
  }
>;

/**
 * Options whose value the generator would have chosen anyway. Emitting them
 * would only lengthen the command, so a value equal to the schema default is
 * dropped — except for the variant options selecting the node type, which are
 * always explicit so the command reads unambiguously.
 */
const shouldEmit = (
  node: GraphNode,
  type: NodeType,
  option: string,
): boolean => {
  if (option in type.variantOptions) return true;
  if (!(option in node.options)) return false;
  const property = type.properties.find((p) => p.name === option);
  return node.options[option] !== property?.default;
};

const flag = (option: string, value: string | boolean) =>
  typeof value === 'boolean' ? `--${option}=${value}` : `--${option}=${value}`;

/**
 * The name a generator will give the project it creates, and by which later
 * commands must refer to it.
 *
 * TypeScript projects keep their kebab-cased name; the connection generator
 * resolves an unqualified name against the workspace scope, so the scope prefix
 * is left off. Python project names are snake_cased.
 */
const projectReference = (name: string, snakeCaseName: boolean): string =>
  snakeCaseName ? snakeCase(name) : kebabCase(name);

/** The host project a component node attaches to. */
interface HostProject {
  /** The name the user typed. */
  readonly name: string;
  readonly generator: string;
  readonly options: Readonly<Record<string, string>>;
  readonly snakeCaseName: boolean;
  /** The first component node needing this host, for command attribution. */
  readonly firstNodeId: string;
}

/**
 * The host projects the graph's component nodes need, in the order they were
 * first referenced. Components sharing a host name share one project, so each
 * host is scaffolded once.
 */
const hostProjects = (graph: Graph): HostProject[] => {
  const hosts = new Map<string, HostProject>();
  for (const node of graph.nodes) {
    const type = nodeType(node.type);
    if (type.kind !== 'component' || !type.host || !node.hostName) continue;
    if (hosts.has(node.hostName)) continue;
    hosts.set(node.hostName, {
      name: node.hostName,
      generator: type.host.generator,
      options: type.host.options,
      snakeCaseName: type.host.snakeCaseName,
      firstNodeId: node.id,
    });
  }
  return [...hosts.values()];
};

/** How each node is referred to by the connection commands. */
interface NodeReference {
  /** The project name to pass as sourceProject / targetProject. */
  readonly project: string;
  /** The component name, for nodes that are components of a project. */
  readonly component?: string;
}

const nodeReferences = (graph: Graph): Map<string, NodeReference> => {
  const references = new Map<string, NodeReference>();
  for (const node of graph.nodes) {
    const type = nodeType(node.type);
    if (type.kind === 'component' && type.host) {
      references.set(node.id, {
        project: projectReference(node.hostName ?? '', type.host.snakeCaseName),
        component: node.name,
      });
    } else {
      // Python project-level endpoint types are snake_cased too; today every
      // project-kind endpoint whose generator is a py# one behaves this way.
      references.set(node.id, {
        project: projectReference(node.name, type.generator.startsWith('py#')),
      });
    }
  }
  return references;
};

const generatorCommand = (generator: string, args: readonly string[]): string =>
  `nx g ${NAMESPACE}:${generator} ${args.join(' ')}`;

/**
 * Emit the commands scaffolding the graph, in dependency order: the workspace,
 * then host projects, then projects and the components they host, then the
 * connections that wire them together.
 */
export const emitCommands = (
  graph: Graph,
  options: EmitOptions,
): EmittedCommand[] => {
  const commands: EmittedCommand[] = [];

  commands.push({
    command: buildCreateNxWorkspaceCommand(
      options.packageManager,
      kebabCase(options.workspace) || 'my-project',
      options.iac,
    ),
    comment: `Create the workspace, managing infrastructure with ${options.iac === 'cdk' ? 'CDK' : 'Terraform'}`,
  });

  const hosts = hostProjects(graph);
  for (const host of hosts) {
    const args = [
      kebabCase(host.name),
      ...Object.entries(host.options).map(([k, v]) => flag(k, v)),
    ];
    commands.push({
      command: generatorCommand(host.generator, args),
      comment: `Create the ${host.generator === 'py#project' ? 'Python' : 'TypeScript'} project hosting ${graph.nodes
        .filter((n) => n.hostName === host.name)
        .map((n) => n.name)
        .join(', ')}`,
      nodeId: host.firstNodeId,
    });
  }

  // Project nodes, then component nodes: a component's `--project` must already
  // exist, and the host projects above are emitted first.
  const projectNodes = graph.nodes.filter(
    (n) => nodeType(n.type).kind === 'project',
  );
  const componentNodes = graph.nodes.filter(
    (n) => nodeType(n.type).kind === 'component',
  );

  for (const node of projectNodes) {
    const type = nodeType(node.type);
    const args = [
      kebabCase(node.name),
      ...Object.entries(type.variantOptions).map(([k, v]) => flag(k, v)),
      ...type.properties
        .filter((p) => shouldEmit(node, type, p.name))
        .map((p) => flag(p.name, node.options[p.name])),
    ];
    commands.push({
      command: generatorCommand(type.generator, args),
      comment: `Create ${node.name} (${type.label})`,
      nodeId: node.id,
    });
  }

  for (const node of componentNodes) {
    const type = nodeType(node.type);
    const reference = nodeReferences(graph).get(node.id)!;
    const args = [
      `--project=${reference.project}`,
      `--name=${node.name}`,
      ...Object.entries(type.variantOptions).map(([k, v]) => flag(k, v)),
      ...type.properties
        .filter((p) => shouldEmit(node, type, p.name))
        .map((p) => flag(p.name, node.options[p.name])),
    ];
    commands.push({
      command: generatorCommand(type.generator, args),
      comment: `Add ${node.name} (${type.label}) to ${reference.project}`,
      nodeId: node.id,
    });
  }

  const references = nodeReferences(graph);
  const emittedPairs = new Set<string>();
  for (const edge of graph.edges) {
    const source = graph.nodes.find((n) => n.id === edge.source);
    const target = graph.nodes.find((n) => n.id === edge.target);
    if (!source || !target) continue;

    const pair = `${edge.source} ${edge.target}`;
    if (emittedPairs.has(pair)) continue;
    emittedPairs.add(pair);

    const sourceRef = references.get(source.id)!;
    const targetRef = references.get(target.id)!;
    const args = [
      `--sourceProject=${sourceRef.project}`,
      `--targetProject=${targetRef.project}`,
      // A component reference disambiguates which of a project's components is
      // wired up, which the generator requires whenever a project hosts more
      // than one candidate.
      ...(sourceRef.component
        ? [`--sourceComponent=${sourceRef.component}`]
        : []),
      ...(targetRef.component
        ? [`--targetComponent=${targetRef.component}`]
        : []),
    ];
    commands.push({
      command: generatorCommand('connection', args),
      comment: `Connect ${source.name} to ${target.name}`,
      edgeId: edge.id,
    });
  }

  // The deployable infrastructure project every other project's constructs land
  // in, matching the workspace's IaC choice. Emitted last so the graph's own
  // projects and connections read first, and because the generator scaffolds an
  // empty stack that does not depend on what already exists.
  if (graph.nodes.length > 0) {
    const infra = INFRA_GENERATORS[options.iac];
    commands.push({
      command: generatorCommand(infra.generator, [
        INFRA_PROJECT_NAME,
        ...Object.entries(infra.options).map(([k, v]) => flag(k, v)),
      ]),
      comment: `Create the ${infra.label} project that deploys it all`,
    });
  }

  return commands;
};

/**
 * The emitted commands as a copyable shell script: the workspace command, then a
 * `cd` into it, then each generator command prefixed for the chosen package
 * manager and run non-interactively.
 */
export const toScript = (
  graph: Graph,
  options: EmitOptions,
  { annotate }: { annotate: boolean } = { annotate: false },
): string => {
  const commands = emitCommands(graph, options);
  const [create, ...rest] = commands;
  const workspace = kebabCase(options.workspace) || 'my-project';

  const lines: string[] = [];
  if (annotate) lines.push(`# ${create.comment}`);
  lines.push(create.command);
  lines.push(`cd ${workspace}`);

  for (const command of rest) {
    if (annotate) lines.push('', `# ${command.comment}`);
    lines.push(
      buildPackageManagerExecCommand(
        options.packageManager,
        `${command.command} --no-interactive`,
      ),
    );
  }

  return lines.join('\n');
};
