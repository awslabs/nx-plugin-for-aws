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
import { addDependenciesToPackageJson } from '../../utils/dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { isEsmWorkspace } from '../../utils/module-format';
import { toKebabCase } from '../../utils/names';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager';
import { ensureProjectPackageJson } from '../../utils/project-package-json';
import { type ITsDepVersion, withVersions } from '../../utils/versions';
import type { TsAstroDocsGeneratorSchema } from './schema';

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

  addGeneratorMetadata(tree, fullyQualifiedName, TS_ASTRO_DOCS_GENERATOR_INFO, {
    framework: 'astro',
    includeTranslation,
    includeBlog,
  });

  const dependencies: ITsDepVersion[] = ['astro', '@astrojs/starlight'];
  const devDependencies: ITsDepVersion[] = [];

  if (includeBlog) {
    dependencies.push('starlight-blog');
  }

  if (includeTranslation) {
    dependencies.push(
      '@strands-agents/sdk',
      'commander',
      'fast-glob',
      'fs-extra',
      'simple-git',
    );
    devDependencies.push('tsx', '@types/fs-extra');
  }

  // Runtime dependencies imported by the docs project's own source (astro
  // config, translation scripts) belong in its manifest; shared tooling (tsx)
  // is routed to the root automatically.
  addDependenciesToPackageJson(
    tree,
    withVersions(dependencies),
    withVersions(devDependencies),
    joinPathFragments(dir, 'package.json'),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_ASTRO_DOCS_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsAstroDocsGenerator;
