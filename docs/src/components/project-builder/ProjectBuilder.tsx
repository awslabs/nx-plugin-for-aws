/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
  type NodeTypes,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import GeneratorPanel from './GeneratorPanel';
import GeneratorNodeComponent from './GeneratorNode';
import CommandOutput from './CommandOutput';
import GlobalSettings from './GlobalSettings';
import { getGeneratorById, isConnectionValid } from './generators';
import type {
  GeneratorDefinition,
  GeneratorNodeData,
  GlobalSettings as GlobalSettingsType,
} from './types';

let nodeIdCounter = 0;
const getNextId = () => `gen-${++nodeIdCounter}`;

/** Generate a unique name based on the generator default and existing nodes */
const generateUniqueName = (
  gen: GeneratorDefinition,
  existingNodes: Node[],
): string => {
  const base = gen.defaultName;
  const existingNames = new Set(
    existingNodes.map((n) => (n.data as GeneratorNodeData).name),
  );
  if (!existingNames.has(base)) return base;

  let i = 2;
  while (existingNames.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
};

/**
 * Wrapper node component that bridges ReactFlow node props to our component
 */
const createNodeComponent = (
  updateNodeData: (
    id: string,
    updater: (data: GeneratorNodeData) => GeneratorNodeData,
  ) => void,
  deleteNode: (id: string) => void,
) => {
  const NodeComponent = ({
    id,
    data,
  }: {
    id: string;
    data: GeneratorNodeData;
  }) => {
    return (
      <GeneratorNodeComponent
        generatorId={data.generatorId}
        name={data.name}
        options={data.options}
        onNameChange={(name) =>
          updateNodeData(id, (prev) => ({ ...prev, name }))
        }
        onOptionChange={(key, value) =>
          updateNodeData(id, (prev) => ({
            ...prev,
            options: { ...prev.options, [key]: value },
          }))
        }
        onDelete={() => deleteNode(id)}
      />
    );
  };
  NodeComponent.displayName = 'GeneratorFlowNode';
  return NodeComponent;
};

const ProjectBuilder: React.FC = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [settings, setSettings] = useState<GlobalSettingsType>({
    workspaceName: 'my-project',
    packageManager: 'pnpm',
    iacProvider: 'CDK',
  });

  const updateNodeData = useCallback(
    (id: string, updater: (data: GeneratorNodeData) => GeneratorNodeData) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: updater(n.data as GeneratorNodeData) }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      generator: createNodeComponent(updateNodeData, deleteNode),
    }),
    [updateNodeData, deleteNode],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const sourceGen = getGeneratorById(
        (sourceNode.data as GeneratorNodeData).generatorId,
      );
      const targetGen = getGeneratorById(
        (targetNode.data as GeneratorNodeData).generatorId,
      );
      if (!sourceGen || !targetGen) return false;

      return isConnectionValid(
        sourceGen.connectionType,
        targetGen.connectionType,
      );
    },
    [nodes],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!isValidConnection(connection)) return;
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: 'var(--sl-color-accent)' },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: 'var(--sl-color-accent)',
            },
          },
          eds,
        ),
      );
    },
    [setEdges, isValidConnection],
  );

  const addGeneratorNode = useCallback(
    (gen: GeneratorDefinition, position?: { x: number; y: number }) => {
      const id = getNextId();
      const name = generateUniqueName(gen, nodes);
      const defaults: Record<string, string> = {};
      for (const opt of gen.options) {
        defaults[opt.name] = opt.default;
      }

      const newNode: Node = {
        id,
        type: 'generator',
        position: position ?? {
          x: 280 + Math.random() * 200,
          y: 80 + Math.random() * 300,
        },
        data: {
          generatorId: gen.id,
          name,
          options: defaults,
        } satisfies GeneratorNodeData,
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [nodes, setNodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/reactflow');
      if (!raw) return;

      const { generatorId } = JSON.parse(raw);
      const gen = getGeneratorById(generatorId);
      if (!gen) return;

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = {
        x: event.clientX - bounds.left - 100,
        y: event.clientY - bounds.top - 40,
      };

      addGeneratorNode(gen, position);
    },
    [addGeneratorNode],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '700px',
        border: '1px solid var(--sl-color-gray-5)',
        borderRadius: '8px',
        overflow: 'hidden',
        background: 'var(--sl-color-bg)',
      }}
    >
      <GlobalSettings settings={settings} onChange={setSettings} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <GeneratorPanel onAdd={addGeneratorNode} />

        <div ref={reactFlowWrapper} style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            onDrop={onDrop}
            onDragOver={onDragOver}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: 'var(--sl-color-accent)' },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: 'var(--sl-color-accent)',
              },
            }}
          >
            <Background color="var(--sl-color-gray-5)" gap={20} />
            <Controls
              style={
                {
                  button: {
                    background: 'var(--sl-color-bg-nav)',
                    color: 'var(--sl-color-white)',
                    border: '1px solid var(--sl-color-gray-5)',
                  },
                } as any
              }
            />
          </ReactFlow>
        </div>
      </div>

      <CommandOutput nodes={nodes} edges={edges} settings={settings} />
    </div>
  );
};

export default ProjectBuilder;
