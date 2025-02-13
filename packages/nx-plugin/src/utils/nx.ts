/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TargetConfiguration } from '@nx/devkit';

export const sortProjectTargets = (targets: {
  [targetName: string]: TargetConfiguration;
}) =>
  Object.keys(targets)
    .sort()
    .reduce((obj, key) => {
      obj[key] = targets[key];
      return obj;
    }, {});
