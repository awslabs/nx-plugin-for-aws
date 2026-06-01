/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { execSync } from 'child_process';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from './config/utils';

export const CONTAINER_ENGINES = ['docker', 'finch'] as const;

export type ContainerEngine = (typeof CONTAINER_ENGINES)[number];

export type ContainerEngineOption = ContainerEngine | 'inherit';

/**
 * Configuration for container tooling
 */
export interface ContainersConfig {
  /**
   * Container engine used for build/push/login operations
   */
  engine: ContainerEngine;
}

const isOnPath = (binary: string): boolean => {
  try {
    const which = process.platform === 'win32' ? 'where' : 'command -v';
    execSync(`${which} ${binary}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Detect which container engine is available on the host. Prefers docker;
 * falls back to finch when only finch is installed; defaults to docker
 * when neither is found.
 */
export const inferContainerEngine = (): ContainerEngine => {
  if (isOnPath('docker')) return 'docker';
  if (isOnPath('finch')) return 'finch';
  return 'docker';
};

/**
 * Given a container engine option, resolve the actual engine to use.
 * `Inherit` reads the value from the workspace plugin config, defaulting
 * to docker when nothing has been configured.
 */
export const resolveContainerEngine = async (
  tree: Tree,
  option: ContainerEngineOption,
): Promise<ContainerEngine> => {
  if (option === 'inherit') {
    const pluginConfig = await readAwsNxPluginConfig(tree);
    const engine = pluginConfig?.containers?.engine ?? 'docker';
    if (!CONTAINER_ENGINES.includes(engine)) {
      throw new Error(
        `containers.engine in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} must be one of ${CONTAINER_ENGINES.join(
          ', ',
        )}`,
      );
    }
    return engine;
  }
  return option;
};
