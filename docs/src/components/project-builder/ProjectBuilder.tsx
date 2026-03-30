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
import {
  getGeneratorById,
  isConnectionValid,
  getCanonicalConnection,
} from './generators';
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
 * Wrapper node component that bridges ReactFlow node props to our component.
 * Created once and remains stable to avoid ReactFlow remounting nodes.
 */
const createNodeComponent = (
  updateNodeDataRef: React.MutableRefObject<
    (
      id: string,
      updater: (data: GeneratorNodeData) => GeneratorNodeData,
    ) => void
  >,
  deleteNodeRef: React.MutableRefObject<(id: string) => void>,
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
          updateNodeDataRef.current(id, (prev) => ({ ...prev, name }))
        }
        onOptionChange={(key, value) =>
          updateNodeDataRef.current(id, (prev) => ({
            ...prev,
            options: { ...prev.options, [key]: value },
          }))
        }
        onDelete={() => deleteNodeRef.current(id)}
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

  // Use refs so the node component stays stable (no remounting)
  const updateNodeDataRef = useRef(updateNodeData);
  updateNodeDataRef.current = updateNodeData;
  const deleteNodeRef = useRef(deleteNode);
  deleteNodeRef.current = deleteNode;

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      generator: createNodeComponent(updateNodeDataRef, deleteNodeRef),
    }),
    [],
  );

  // Use a ref to always have fresh nodes in connection validation
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const isValidConnectionCheck = useCallback(
    (connection: Connection | Edge) => {
      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find(
        (n) => n.id === connection.source,
      );
      const targetNode = currentNodes.find(
        (n) => n.id === connection.target,
      );
      if (!sourceNode || !targetNode) return false;
      if (sourceNode.id === targetNode.id) return false;

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
    [],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find(
        (n) => n.id === connection.source,
      );
      const targetNode = currentNodes.find(
        (n) => n.id === connection.target,
      );
      if (!sourceNode || !targetNode) return;

      const sourceGen = getGeneratorById(
        (sourceNode.data as GeneratorNodeData).generatorId,
      );
      const targetGen = getGeneratorById(
        (targetNode.data as GeneratorNodeData).generatorId,
      );
      if (!sourceGen || !targetGen) return;

      if (
        !isConnectionValid(
          sourceGen.connectionType,
          targetGen.connectionType,
        )
      )
        return;

      // Determine canonical direction and potentially swap source/target
      const canonical = getCanonicalConnection(
        sourceGen.connectionType,
        targetGen.connectionType,
      );
      if (!canonical) return;

      // If the user drew the edge backwards, swap source and target
      const finalConnection =
        canonical.source === sourceGen.connectionType
          ? connection
          : {
              ...connection,
              source: connection.target,
              target: connection.source,
              sourceHandle: connection.targetHandle,
              targetHandle: connection.sourceHandle,
            };

      setEdges((eds) =>
        addEdge(
          {
            ...finalConnection,
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
    [setEdges],
  );

  const addGeneratorNode = useCallback(
    (gen: GeneratorDefinition, position?: { x: number; y: number }) => {
      setNodes((nds) => {
        const id = getNextId();
        const name = generateUniqueName(gen, nds);
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

        return [...nds, newNode];
      });
    },
    [setNodes],
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
        height: 'calc(100vh - 64px)',
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
            isValidConnection={isValidConnectionCheck}
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
            <Controls />
          </ReactFlow>
        </div>
      </div>

      <CommandOutput nodes={nodes} edges={edges} settings={settings} />
    </div>
  );
};

export default ProjectBuilder;
