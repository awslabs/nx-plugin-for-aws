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
import { PY_DEPENDENCIES, TYPESCRIPT_DEPENDENCIES } from './dependencies.js';
import { pythonGreengrassComponentGenerator } from './python/generator.js';
import type { GreengrassComponentGeneratorSchema } from './schema.js';
import { typescriptGreengrassComponentGenerator } from './typescript/generator.js';

/**
 * The metadata this generator records on the host project, which its
 * dependency predicates read. Declared here, in the registered factory, so the
 * ownership invariant can match every predicate-read field against it; the
 * shared finalizer and both language declarations import it type-only.
 */
export interface GreengrassComponentMetadata {
  readonly language: 'typescript' | 'python';
  readonly componentName: string;
  readonly componentVersion: string;
  readonly platform: GreengrassPlatformSelection;
  readonly ipc: boolean;
  readonly gdkConfig: boolean;
  readonly iac?: string;
}

const isPython = (metadata: GreengrassComponentMetadata): boolean =>
  metadata.language === 'python';
const isTypeScript = (metadata: GreengrassComponentMetadata): boolean =>
  metadata.language === 'typescript';

/**
 * Every package either language adapter may add, gated by the recorded
 * `language` on top of each entry's own condition. The version sync migration
 * reads this off the registered `greengrass#component` factory module, so it -
 * not either adapter's own declaration - is what makes both languages'
 * packages "owned" under the unified generator id.
 */
export const DEPENDENCIES = declareDependencies<GreengrassComponentMetadata>()({
  ts: [
    ...onlyWhen(PY_DEPENDENCIES.ts, isPython),
    ...onlyWhen(TYPESCRIPT_DEPENDENCIES.ts, isTypeScript),
  ],
  py: [...onlyWhen(PY_DEPENDENCIES.py, isPython)],
});

export const greengrassComponentGenerator = async (
  tree: Tree,
  options: GreengrassComponentGeneratorSchema,
): Promise<GeneratorCallback> => {
  const component = await normalizeComponent(tree, options);
  return component.language === 'python'
    ? pythonGreengrassComponentGenerator(tree, component)
    : typescriptGreengrassComponentGenerator(tree, component);
};

export default greengrassComponentGenerator;
