/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { getGeneratorById, NX_VERSION } from './generators';
import type { GeneratorNodeData, GlobalSettings } from './types';

interface CommandOutputProps {
  nodes: Node[];
  edges: Edge[];
  settings: GlobalSettings;
}

const getNxRunCommand = (pm: string): string => {
  switch (pm) {
    case 'pnpm':
      return 'pnpm nx';
    case 'yarn':
      return 'yarn nx';
    case 'bun':
      return 'bun nx';
    default:
      return 'npx nx';
  }
};

export const buildCommand = (
  nodes: Node[],
  edges: Edge[],
  settings: GlobalSettings,
): string => {
  if (nodes.length === 0)
    return '# Drag generators onto the canvas to get started';

  const lines: string[] = [];
  const nx = getNxRunCommand(settings.packageManager);
  const ws = settings.workspaceName || 'my-project';

  // Create workspace using the same format as buildCreateNxWorkspaceCommand
  lines.push(
    `npx create-nx-workspace@${NX_VERSION} ${ws} --pm=${settings.packageManager} ` +
      `--preset=@aws/nx-plugin --iacProvider=${settings.iacProvider} ` +
      `--ci=skip --analytics=false --aiAgents`,
    ``,
    `cd ${ws}`,
  );

  // Track project names for add-to-project generators
  const hostProjects = new Map<string, string>();

  // Sort: standalone projects first, then add-to-project generators
  const standalone = nodes.filter((n) => {
    const gen = getGeneratorById((n.data as GeneratorNodeData).generatorId);
    return gen && !gen.hostProjectGenerator;
  });
  const addTo = nodes.filter((n) => {
    const gen = getGeneratorById((n.data as GeneratorNodeData).generatorId);
    return gen && gen.hostProjectGenerator;
  });

  // Generate standalone project commands
  for (const node of standalone) {
    const data = node.data as GeneratorNodeData;
    const gen = getGeneratorById(data.generatorId);
    if (!gen) continue;

    const name = data.name || gen.defaultName;
    const optParts: string[] = [];

    for (const opt of gen.options) {
      const val = data.options[opt.name] ?? opt.default;
      if (val !== opt.default) {
        optParts.push(`--${opt.name}=${val}`);
      }
    }

    lines.push('');
    const optStr = optParts.length > 0 ? ` ${optParts.join(' ')}` : '';
    lines.push(
      `${nx} g @aws/nx-plugin:${gen.generatorId} ${name}${optStr} --no-interactive`,
    );
  }

  // Generate add-to-project commands (create host project + add component)
  for (const node of addTo) {
    const data = node.data as GeneratorNodeData;
    const gen = getGeneratorById(data.generatorId);
    if (!gen || !gen.hostProjectGenerator) continue;

    const componentName = data.name || gen.defaultName;
    const projectName = `${componentName}-project`;
    hostProjects.set(node.id, projectName);

    const optParts: string[] = [];
    for (const opt of gen.options) {
      const val = data.options[opt.name] ?? opt.default;
      if (val !== opt.default) {
        optParts.push(`--${opt.name}=${val}`);
      }
    }

    lines.push('');
    lines.push(
      `${nx} g @aws/nx-plugin:${gen.hostProjectGenerator} ${projectName} --no-interactive`,
    );
    const optStr = optParts.length > 0 ? ` ${optParts.join(' ')}` : '';
    lines.push(
      `${nx} g @aws/nx-plugin:${gen.generatorId} ${projectName} --name=${componentName}${optStr} --no-interactive`,
    );
  }

  // Generate connection commands
  // Edges are already in the correct direction (source handle -> target handle)
  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceData = sourceNode.data as GeneratorNodeData;
    const targetData = targetNode.data as GeneratorNodeData;
    const sourceGen = getGeneratorById(sourceData.generatorId);
    const targetGen = getGeneratorById(targetData.generatorId);
    if (!sourceGen || !targetGen) continue;

    // Determine project names
    const sourceName = sourceGen.hostProjectGenerator
      ? (hostProjects.get(sourceNode.id) ?? `${sourceData.name}-project`)
      : sourceData.name || sourceGen.defaultName;
    const targetName = targetGen.hostProjectGenerator
      ? (hostProjects.get(targetNode.id) ?? `${targetData.name}-project`)
      : targetData.name || targetGen.defaultName;

    let connectionCmd = `${nx} g @aws/nx-plugin:connection --sourceProject=${sourceName} --targetProject=${targetName}`;

    // For agent -> MCP connections, specify components
    if (sourceGen.hostProjectGenerator) {
      connectionCmd += ` --sourceComponent=${sourceData.name || sourceGen.defaultName}`;
    }
    if (targetGen.hostProjectGenerator) {
      connectionCmd += ` --targetComponent=${targetData.name || targetGen.defaultName}`;
    }

    connectionCmd += ' --no-interactive';
    lines.push('');
    lines.push(connectionCmd);
  }

  return lines.join('\n');
};

const CommandOutput: React.FC<CommandOutputProps> = ({
  nodes,
  edges,
  settings,
}) => {
  const [copied, setCopied] = useState(false);

  const command = useMemo(
    () => buildCommand(nodes, edges, settings),
    [nodes, edges, settings],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const area = document.createElement('textarea');
      area.value = command;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        background: 'var(--sl-color-bg-nav)',
        borderTop: '1px solid var(--sl-color-gray-5)',
        padding: '12px',
        maxHeight: '250px',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            color: 'var(--sl-color-white)',
            fontSize: '14px',
          }}
        >
          CLI Commands
        </span>
        <button
          onClick={handleCopy}
          disabled={nodes.length === 0}
          style={{
            padding: '6px 16px',
            borderRadius: '6px',
            border: 'none',
            background:
              nodes.length === 0
                ? 'var(--sl-color-gray-5)'
                : copied
                  ? '#16a34a'
                  : 'var(--sl-color-accent)',
            color: nodes.length === 0 ? 'var(--sl-color-gray-3)' : '#fff',
            cursor: nodes.length === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '13px',
            transition: 'background 0.15s',
          }}
        >
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
      </div>
      <pre
        style={{
          background: 'var(--sl-color-bg)',
          border: '1px solid var(--sl-color-gray-5)',
          borderRadius: '6px',
          padding: '12px',
          margin: 0,
          fontSize: '12px',
          lineHeight: 1.6,
          color: 'var(--sl-color-gray-2)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {command}
      </pre>
    </div>
  );
};

export default CommandOutput;
