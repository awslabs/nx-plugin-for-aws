/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ComponentMetadata } from '../../../utils/nx';

/**
 * TypeScript types for options defined in schema.json
 */
export interface TsStrandsAgentReactConnectionGeneratorSchema {
  sourceProject: string;
  targetProject: string;
  sourceComponent?: ComponentMetadata;
  targetComponent?: ComponentMetadata;
}
