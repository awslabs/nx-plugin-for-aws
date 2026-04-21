/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  ProjectConfiguration,
  Tree,
  addDependenciesToPackageJson,
  addProjectConfiguration,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
} from '@nx/devkit';
import { TsAstroDocsGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import { toKebabCase } from '../../utils/names';
import { ITsDepVersion, withVersions } from '../../utils/versions';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager';

export const TS_ASTRO_DOCS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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

  addProjectConfiguration(tree, fullyQualifiedName, {
    name: fullyQualifiedName,
    root: dir,
    sourceRoot: joinPathFragments(dir, 'src'),
    projectType: 'application',
    targets,
  });

  const templateOptions = {
    fullyQualifiedName,
    title: schema.name,
    includeTranslation,
    includeBlog,
    pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    today: new Date().toISOString().slice(0, 10),
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'base'),
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
      joinPathFragments(__dirname, 'files', 'translation'),
      dir,
      templateOptions,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  addGeneratorMetadata(tree, fullyQualifiedName, TS_ASTRO_DOCS_GENERATOR_INFO, {
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

  addDependenciesToPackageJson(
    tree,
    withVersions(dependencies),
    withVersions(devDependencies),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_ASTRO_DOCS_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
};

export default tsAstroDocsGenerator;
