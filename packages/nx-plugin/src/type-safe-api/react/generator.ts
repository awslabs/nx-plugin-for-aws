/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  GeneratorCallback,
  readProjectConfiguration,
  installPackagesTask,
  joinPathFragments,
  generateFiles,
  addDependenciesToPackageJson,
} from '@nx/devkit';
import { TypeSafeApiReactGeneratorSchema } from './schema';
import runtimeConfigGenerator from '../../cloudscape-website/runtime-config/generator';
import kebabCase from 'lodash.kebabcase';
import camelCase from 'lodash.camelcase';
import upperFirst from 'lodash.upperfirst';
import { addDefaultImportDeclarations, addJsxComponentWrapper } from '../../utils/typescript-ast';
import { toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { formatFilesInSubtree } from '../../utils/format';

export async function typeSafeApiReactGenerator(
  tree: Tree,
  options: TypeSafeApiReactGeneratorSchema
): Promise<GeneratorCallback> {
  const frontendProject = readProjectConfiguration(tree, options.frontendProject);
  const hooksLibraryProject = readProjectConfiguration(tree, options.hooksLibraryProject);

  // Add runtime config provider to the app if not already present
  await runtimeConfigGenerator(tree, {
    project: options.frontendProject,
  });

  const apiName = (hooksLibraryProject.metadata as any)?.apiName;
  if (!apiName) {
    throw new Error(`${options.hooksLibraryProject} does not appear to be a Type Safe API generated hooks project`);
  }

  const apiNameKebabCase = kebabCase(apiName);
  const apiNamePascalCase = upperFirst(camelCase(apiName));

  generateFiles(tree, joinPathFragments(__dirname, 'files'), frontendProject.root, {
    apiName,
    apiNameKebabCase,
    apiNamePascalCase,
    generatedHooksLibraryPackage: toScopeAlias(options.hooksLibraryProject),
    auth: options.auth,
  });

  const mainTsxPath = joinPathFragments(
    frontendProject.sourceRoot,
    'main.tsx'
  );

  if (!tree.exists(mainTsxPath)) {
    throw new Error(
      `Could not find main.tsx in ${frontendProject.sourceRoot}`
    );
  }

  const mainTsxContents = tree.read(mainTsxPath).toString();

  const hooksProviderComponentName = `${apiNamePascalCase}HooksProvider`;

  const updatedImports = addDefaultImportDeclarations(mainTsxContents, [
    { import: hooksProviderComponentName, from: `./components/${hooksProviderComponentName}` },
  ]);

  const mainTsxUpdatedContents = addJsxComponentWrapper(updatedImports, 'App', hooksProviderComponentName);

  if (!mainTsxUpdatedContents) {
    throw new Error('Could not locate App component in main.tsx');
  }

  if (mainTsxContents !== mainTsxUpdatedContents) {
    tree.write(mainTsxPath, mainTsxUpdatedContents);
  }

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@tanstack/react-query',
      '@aws-northstar/ui',
    ]),
    {}
  );

  await formatFilesInSubtree(tree, frontendProject.root);

  return () => {
    installPackagesTask(tree);
  };
}

export default typeSafeApiReactGenerator;
