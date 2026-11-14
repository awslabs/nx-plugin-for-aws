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

/** Option defaults, the same values the generator schemas declare. */
const DEFAULT_INGRESS: ContainerIngress = 'http-api';
const DEFAULT_AUTH: ContainerAuth = 'iam';

/**
 * Applies the option defaults and drops the options that do not apply, so
 * `ingress` is only set with `infra=ecs` and `auth` only with `http-api`.
 *
 * Nx passes the schema defaults on every run, so a default value cannot be
 * told apart from a user choice. The warnings fire only for a dropped value
 * other than the default, which the user must have chosen.
 */
export const resolveContainerOptions = (options: {
  infra?: ContainerInfra;
  ingress?: ContainerIngress;
  auth?: ContainerAuth;
}): ResolvedContainerOptions => {
  const infra = options.infra ?? 'ecs';
  const authChosen =
    options.auth !== undefined && options.auth !== DEFAULT_AUTH;
  if (infra === 'none') {
    const ingressChosen =
      options.ingress !== undefined && options.ingress !== DEFAULT_INGRESS;
    if (ingressChosen || authChosen) {
      console.warn(
        'Warning: ingress and auth are ignored when infra is none (no infrastructure is generated)',
      );
    }
    return { infra };
  }
  const ingress = options.ingress ?? DEFAULT_INGRESS;
  if (ingress === 'private') {
    if (authChosen) {
      console.warn(
        'Warning: auth is ignored when ingress is private (there is no HTTP API to authenticate)',
      );
    }
    return { infra, ingress };
  }
  return { infra, ingress, auth: options.auth ?? DEFAULT_AUTH };
};
