/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface SmithyProjectGeneratorSchema {
  name: string;
  serviceName?: string;
  namespace?: string;
  directory?: string;
  subDirectory?: string;
}
