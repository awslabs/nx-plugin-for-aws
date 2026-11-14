/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacMetadata } from '../shared-constructs-constants.js';
import type {
  ContainerAuth,
  ContainerInfra,
  ContainerIngress,
} from './container-constructs.js';

/**
 * What `ts#container` and `py#container` record on their component, which the
 * connection generators and the version sync read.
 */
export interface ContainerMetadata extends IacMetadata {
  readonly infra: ContainerInfra;
  /** Present when `infra` is `ecs`. */
  readonly ingress?: ContainerIngress;
  /** Present when `ingress` is `http-api`. */
  readonly auth?: ContainerAuth;
  /** Local `serve` port, assigned with `assignPort`. */
  readonly port: number;
  /** PascalCase key under `connection.services` in runtime config. */
  readonly rc: string;
}

/** The options a container generator resolved, before any file is written. */
export interface ResolvedContainerOptions {
  readonly infra: ContainerInfra;
  readonly ingress?: ContainerIngress;
  readonly auth?: ContainerAuth;
}

/**
 * Applies the option defaults and drops the options that do not apply, so
 * `ingress` is only set with `infra=ecs` and `auth` only with `http-api`.
 */
export const resolveContainerOptions = (options: {
  infra?: ContainerInfra;
  ingress?: ContainerIngress;
  auth?: ContainerAuth;
}): ResolvedContainerOptions => {
  const infra = options.infra ?? 'ecs';
  if (infra === 'none') {
    if (options.ingress || options.auth) {
      console.warn(
        'Warning: ingress and auth are ignored when infra is none (no infrastructure is generated)',
      );
    }
    return { infra };
  }
  const ingress = options.ingress ?? 'http-api';
  if (ingress === 'private') {
    if (options.auth) {
      console.warn(
        'Warning: auth is ignored when ingress is private (there is no HTTP API to authenticate)',
      );
    }
    return { infra, ingress };
  }
  return { infra, ingress, auth: options.auth ?? 'iam' };
};
