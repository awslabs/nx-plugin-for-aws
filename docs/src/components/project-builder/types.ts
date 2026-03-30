/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
export type IacProvider = 'CDK' | 'Terraform';

export interface GlobalSettings {
  workspaceName: string;
  packageManager: PackageManager;
  iacProvider: IacProvider;
}

export interface GeneratorOption {
  name: string;
  label: string;
  type: 'text' | 'select';
  default: string;
  choices?: string[];
}

export interface GeneratorDefinition {
  id: string;
  label: string;
  description: string;
  category: 'frontend' | 'backend' | 'ai' | 'infra';
  icon: string;
  iconColor: string;
  defaultName: string;
  /** The nx generator ID, e.g. "ts#react-website" */
  generatorId: string;
  /** For add-to-project generators, the host project generator */
  hostProjectGenerator?: string;
  /** Options configurable in the node UI */
  options: GeneratorOption[];
  /** Connection type used by the connection generator */
  connectionType: string;
}

export interface ValidConnection {
  source: string;
  target: string;
}

export interface GeneratorNodeData {
  generatorId: string;
  name: string;
  options: Record<string, string>;
}
