/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { isEsmWorkspace } from '../../utils/module-format.js';
import { toKebabCase } from '../../utils/names.js';
import { getNpmScopePrefix } from '../../utils/npm-scope.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx.js';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager.js';
import { ensureProjectPackageJson } from '../../utils/project-package-json.js';
import type { TsAstroDocsGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TsAstroDocsMetadata {
  readonly framework: string;
  readonly includeTranslation: boolean;
  readonly includeBlog: boolean;
}

// Each entry names the branch it belongs to, so the same declaration drives both
// adding and the version sync.
export const DEPENDENCIES = declareDependencies<TsAstroDocsMetadata>()({
  ts: [
    { name: 'astro' },
    // Astro leaves `cookie` external in the prerender bundle, so the emitted
    // `dist` entry imports it directly. Node resolves that from `dist`, which
    // cannot reach astro's own nested copy, so the docs project declares it to
    // keep a compatible one in reach.
    { name: 'cookie' },
    { name: '@astrojs/starlight' },
    { name: 'starlight-blog', when: (m) => m.includeBlog },
    { name: '@strands-agents/sdk', when: (m) => m.includeTranslation },
    { name: 'commander', when: (m) => m.includeTranslation },
    { name: 'fast-glob', when: (m) => m.includeTranslation },
    { name: 'fs-extra', when: (m) => m.includeTranslation },
    { name: 'simple-git', when: (m) => m.includeTranslation },
    { name: '@types/fs-extra', when: (m) => m.includeTranslation, dev: true },
    // The translate target runs its script from the workspace root via tsx.
    { name: 'tsx', when: (m) => m.includeTranslation, dev: true, root: true },
  ],
});

export const TS_ASTRO_DOCS_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const tsAstroDocsGenerator = async (
  tree: Tree,
  schema: TsAstroDocsGeneratorSchema,
): Promise<GeneratorCallback> => {
  const includeTranslation = !(schema.noTranslation ?? false);
  const includeBlog = !(schema.noBlog ?? false);
  const npmScopePrefix = getNpmScopePrefix(tree);
  const docsNameKebabCase = toKebabCase(schema.name);
  const fullyQualifiedName = `${npmScopePrefix}${docsNameKebabCase}`;
  // NB: interactive nx generator cli can pass empty string
  const dir = joinPathFragments(
    schema.directory || '.',
    schema.subDirectory || docsNameKebabCase,
  );

  const alreadyExists = projectExists(tree, fullyQualifiedName);

  const targets: ProjectConfiguration['targets'] = {
    // Inputs are left to Nx's implicit `["default", "^default"]`. Astro resolves
    // imports from a dependency's source rather than its build output, and this
    // target declares no `dependsOn` for `default`'s transitive
    // `dependentTasksOutputFiles` to resolve against — so `^default` is the only
    // thing keeping a dependency's content in the hash.
    build: {
      executor: 'nx:run-commands',
      options: {
        command: 'astro build',
        cwd: dir,
      },
      outputs: [`{workspaceRoot}/${dir}/dist`],
      cache: true,
    },
    start: {
      executor: 'nx:run-commands',
      options: {
        command: 'astro dev',
        cwd: dir,
      },
      continuous: true,
    },
    serve: {
      dependsOn: ['start'],
    },
    preview: {
      executor: 'nx:run-commands',
      options: {
        command: 'astro preview',
        cwd: dir,
      },
      dependsOn: ['build'],
      continuous: true,
    },
  };

  if (includeTranslation) {
    targets['translate'] = {
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ./scripts/translate.ts',
        cwd: dir,
        forwardAllArgs: true,
      },
    };
  }

  if (!alreadyExists) {
    addProjectConfiguration(tree, fullyQualifiedName, {
      name: fullyQualifiedName,
      root: dir,
      sourceRoot: joinPathFragments(dir, 'src'),
      projectType: 'application',
      targets,
    });
  }

  ensureProjectPackageJson(tree, { dir, fullyQualifiedName });

  const templateOptions = {
    fullyQualifiedName,
    title: schema.name,
    includeTranslation,
    includeBlog,
    esm: isEsmWorkspace(tree),
    pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    today: new Date().toISOString().slice(0, 10),
  };

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'base'),
    dir,
    templateOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // The sample blog post is always emitted above — drop it if the user opted out.
  if (!includeBlog) {
    tree.delete(
      joinPathFragments(
        dir,
        'src',
        'content',
        'docs',
        'en',
        'blog',
        'welcome.mdx',
      ),
    );
  }

  if (includeTranslation) {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'translation'),
      dir,
      templateOptions,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  // Recorded here and read by the declaration's predicates, so the packages
  // added below are exactly the ones the version sync will own.
  const metadata: TsAstroDocsMetadata = {
    framework: 'astro',
    includeTranslation,
    includeBlog,
  };
  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    TS_ASTRO_DOCS_GENERATOR_INFO,
    metadata,
  );

  addTsDependencies(tree, DEPENDENCIES, { metadata, projectRoot: dir });

  await addGeneratorMetricsIfApplicable(tree, [TS_ASTRO_DOCS_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsAstroDocsGenerator;
