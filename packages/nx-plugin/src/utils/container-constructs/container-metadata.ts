/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacMetadata } from '../shared-constructs-constants.js';
import type {
  ContainerArchitecture,
  ContainerInfra,
} from './container-constructs.js';

/**
 * What `ts#container` and `py#container` record on their component, which the
 * connection generators and the version sync read.
 */
export interface ContainerMetadata extends IacMetadata {
  readonly infra: ContainerInfra;
  /** Local `serve` port, assigned with `assignPort`. */
  readonly port: number;
  /** PascalCase service name: the construct class and Terraform module name. */
  readonly rc: string;
  /**
   * CPU architecture the image is built for and the task runs on, read on a
   * re-run so the value already in the vended code is kept. Absent on a
   * component generated before the option existed, whose vended code is ARM64.
   */
  readonly architecture?: ContainerArchitecture;
}
