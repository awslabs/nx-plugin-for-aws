/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import {
  REACT_WEBSITE_APP_GENERATOR_INFO,
  type TsReactWebsiteMetadata,
} from '../../../ts/react-website/app/generator.js';
import { runtimeConfigGenerator } from '../../../ts/react-website/runtime-config/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Add the runtime config provider and useRuntimeConfig hook to react website projects that lack them
 *
 * `ts#website` now vends `src/components/RuntimeConfig` and
 * `src/hooks/useRuntimeConfig.tsx` with every website, rather than only when an
 * auth or connection generator pulled them in. This migration adds them to a
 * website that doesn't have them yet, wiring the provider into `main.tsx` the
 * same way the generator does.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [name, project] of getProjects(tree)) {
    const metadata = project.metadata as
      | (TsReactWebsiteMetadata & { generator?: string })
      | undefined;
    if (metadata?.generator !== REACT_WEBSITE_APP_GENERATOR_INFO.id) {
      continue;
    }

    const srcRoot =
      project.sourceRoot ?? joinPathFragments(project.root, 'src');
    if (
      tree.exists(
        joinPathFragments(srcRoot, 'components', 'RuntimeConfig', 'index.tsx'),
      )
    ) {
      // Already present - skip so re-running is a no-op.
      continue;
    }

    // The generator requires a main.tsx to wire the provider into. A website
    // whose entry point has been moved or renamed is left for the user.
    if (!tree.exists(joinPathFragments(srcRoot, 'main.tsx'))) {
      nextSteps.push(
        `${name}: no ${joinPathFragments(srcRoot, 'main.tsx')} to wire the runtime config provider into - run 'nx g @aws/nx-plugin:ts#react-website#runtime-config --project=${name}' once your entry point is back at that path, or add the provider by hand.`,
      );
      continue;
    }

    try {
      await runtimeConfigGenerator(tree, {
        project: name,
        preferInstallDependencies: false,
      });
    } catch (e) {
      nextSteps.push(
        `${name}: could not add the runtime config provider (${e instanceof Error ? e.message : String(e)}) - add it by hand, or run 'nx g @aws/nx-plugin:ts#react-website#runtime-config --project=${name}' once ${joinPathFragments(srcRoot, 'main.tsx')} matches the generated shape.`,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
