/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import {
  declareDependencies,
  onlyWhen,
} from '../../utils/declared-dependencies.js';
import type { GreengrassPlatformSelection } from '../../utils/greengrass/constants.js';
import { normalizeComponent } from './common.js';
import { PY_DEPENDENCIES } from './dependencies.js';
import { pythonGreengrassComponentGenerator } from './python/generator.js';
import type { GreengrassComponentGeneratorSchema } from './schema.js';

/**
 * The metadata this generator records on the host project, which its
 * dependency predicates read. Declared here, in the registered factory, so the
 * ownership invariant can match every predicate-read field against it; the
 * shared finalizer and Python declaration import it type-only.
 */
export interface GreengrassComponentMetadata {
  readonly language: 'python';
  readonly componentName: string;
  readonly componentVersion: string;
  readonly platform: GreengrassPlatformSelection;
  readonly ipc: boolean;
  readonly gdkConfig: boolean;
  readonly iac?: string;
}

const isPython = (metadata: GreengrassComponentMetadata): boolean =>
  metadata.language === 'python';

/**
 * Packages owned by the registered factory for metadata-based version sync.
 */
export const DEPENDENCIES = declareDependencies<GreengrassComponentMetadata>()({
  ts: [...onlyWhen(PY_DEPENDENCIES.ts, isPython)],
  py: [...onlyWhen(PY_DEPENDENCIES.py, isPython)],
});

export const greengrassComponentGenerator = async (
  tree: Tree,
  options: GreengrassComponentGeneratorSchema,
): Promise<GeneratorCallback> => {
  const component = await normalizeComponent(tree, options);
  return pythonGreengrassComponentGenerator(tree, component);
};

export default greengrassComponentGenerator;
