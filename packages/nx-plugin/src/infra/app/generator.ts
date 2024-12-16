/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  readProjectConfiguration,
  addDependenciesToPackageJson,
  generateFiles,
  Tree,
  updateJson,
  ProjectConfiguration,
  GeneratorCallback,
} from '@nx/devkit';
import { InfraGeneratorSchema } from './schema';
import tsLibGenerator, { getTsLibDetails } from '../../ts/lib/generator';
import { withVersions } from '../../utils/versions';
import { formatFilesInSubtree } from '../../utils/format';

export async function infraGenerator(
  tree: Tree,
  schema: InfraGeneratorSchema
): Promise<GeneratorCallback> {
  const lib = getTsLibDetails(tree, schema);
  const tsLibGeneratorCallback = await tsLibGenerator(tree, schema);

  const synthDirFromRoot = `/dist/${lib.dir}/cdk.out`;
  const synthDirFromProject =
    lib.dir
      .split('/')
      .map(() => '..')
      .join('/') + synthDirFromRoot;
  const projectConfig = readProjectConfiguration(tree, lib.fullyQualifiedName);
  const libraryRoot = projectConfig.root;
  tree.delete(joinPathFragments(libraryRoot, 'src'));
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, './files'), // path to the file templates
    libraryRoot, // destination path of the files
    {
      synthDir: synthDirFromProject,
      ...schema,
    }
  );

  updateJson(
    tree,
    `${libraryRoot}/project.json`,
    (config: ProjectConfiguration) => {
      config.projectType = 'application';

      config.targets.build = {
        cache: true,
        executor: 'nx:run-commands',
        outputs: [`{workspaceRoot}${synthDirFromRoot}`],
        dependsOn: ['^build'],
        options: {
          cwd: libraryRoot,
          command: 'cdk synth',
        },
      };

      config.targets.deploy = {
        executor: 'nx:run-commands',
        options: {
          cwd: libraryRoot,
          command: `cdk deploy --require-approval=never --app ${synthDirFromProject}`,
        },
      };

      return config;
    }
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws/pdk',
      'aws-cdk-lib',
      'aws-cdk',
      'esbuild',
      'constructs',
      'source-map-support',
    ]),
    withVersions(['tsx'])
  );

  await formatFilesInSubtree(tree, libraryRoot);

  return tsLibGeneratorCallback;
}

export default infraGenerator;
