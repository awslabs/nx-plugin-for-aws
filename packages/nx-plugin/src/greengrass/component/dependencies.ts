/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { BUNDLE_DEPENDENCIES } from '../../utils/bundle/bundle.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { FS_DEPENDENCIES } from '../../utils/fs.js';
import { GREENGRASS_CONSTRUCTS_DEPENDENCIES } from '../../utils/greengrass-constructs/greengrass-constructs.js';
import { SHARED_CONSTRUCTS_DEPENDENCIES } from '../../utils/shared-constructs.js';
import { SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES } from '../../utils/shared-greengrass-scripts.js';
// Type-only, so the factory's runtime import of this module stays acyclic.
import type { GreengrassComponentMetadata } from './generator.js';

export const PY_DEPENDENCIES =
  declareDependencies<GreengrassComponentMetadata>()({
    ts: [
      ...ownedElsewhere(FS_DEPENDENCIES),
      ...ownedElsewhere(SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES),
      ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
      ...ownedElsewhere(GREENGRASS_CONSTRUCTS_DEPENDENCIES),
    ],
    py: [{ name: 'awsiotsdk', when: (metadata) => metadata.ipc }],
  });

export const TYPESCRIPT_DEPENDENCIES =
  declareDependencies<GreengrassComponentMetadata>()({
    ts: [
      { name: 'aws-iot-device-sdk-v2', when: (metadata) => metadata.ipc },
      ...ownedElsewhere(BUNDLE_DEPENDENCIES),
      ...ownedElsewhere(SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES),
      ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
      ...ownedElsewhere(GREENGRASS_CONSTRUCTS_DEPENDENCIES),
    ],
  });
