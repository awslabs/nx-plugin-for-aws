/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  Tree,
} from '@nx/devkit';
import {
  InferredTypeSafeRestApiSchema,
  TypeSafeRestApiGeneratorSchema,
} from './schema';
import kebabCase from 'lodash.kebabcase';
import camelCase from 'lodash.camelcase';
import upperFirst from 'lodash.upperfirst';
import { join } from 'path';
import { typeSpecRestModelGenerator } from './model/typespec';
import { openApiRestModelGenerator } from './model/openapi';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { typeScriptRestRuntimeGenerator } from './runtime/typescript';
import { uniq } from '../../utils/string';
import { typeScriptRestInfrastructureGenerator } from './infrastructure/typescript';
import { typeScriptRestHandlersGenerator } from './handlers/typescript';
import { typeScriptRestHooksLibraryGenerator } from './library/hooks';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { withVersions } from '../../utils/versions';
import { writeExportDeclarations } from '../../utils/typescript-ast';

/**
 * Generates a Type Safe REST API
 */
export const typeSafeRestApiGenerator = async (
  tree: Tree,
  schema: TypeSafeRestApiGeneratorSchema
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(schema.name);
  const scope = schema.scope ? `${schema.scope}/` : getNpmScopePrefix(tree);
  const fullyQualifiedApiName = `${scope}${nameKebabCase}`;
  const namePascalCase = upperFirst(camelCase(schema.name));
  const dir = join(
    schema.directory ?? '.',
    schema.subDirectory ?? nameKebabCase
  );

  const runtimeLanguages = uniq([
    schema.infrastructureLanguage,
    ...schema.handlerLanguages,
    ...schema.runtimeLanguages,
  ]);

  const options: InferredTypeSafeRestApiSchema = {
    ...schema,
    fullyQualifiedApiName,
    namePascalCase,
    nameKebabCase,
    dir,
    runtimeLanguages,
    model: {
      fullyQualifiedName: `${fullyQualifiedApiName}-model`,
      dir: join(dir, 'model'),
      outputSpecPath: join('dist', dir, 'model', 'prepared', 'api.json'),
    },
    runtime: {
      dir: join(dir, 'generated', 'runtime'),
      typescript: runtimeLanguages.includes('typescript')
        ? {
            dir: join(dir, 'generated', 'runtime', 'typescript'),
            fullyQualifiedName: `${fullyQualifiedApiName}-runtime-typescript`,
          }
        : undefined,
    },
    infrastructure: {
      dir: join(dir, 'generated', 'infrastructure'),
      typescript:
        schema.infrastructureLanguage === 'typescript'
          ? {
              dir: join(dir, 'generated', 'infrastructure', 'typescript'),
              fullyQualifiedName: `${fullyQualifiedApiName}-infrastructure-typescript`,
            }
          : undefined,
    },
    handlers: {
      dir: join(dir, 'handlers'),
      typescript: schema.handlerLanguages.includes('typescript')
        ? {
            dir: join(dir, 'handlers', 'typescript'),
            fullyQualifiedName: `${fullyQualifiedApiName}-handlers-typescript`,
            assetPath: join('dist', dir, 'handlers', 'typescript-lambda'),
          }
        : undefined,
    },
    library: {
      dir: join(dir, 'generated', 'libraries'),
      typescriptHooks: schema.libraries.includes('typescript-react-hooks')
        ? {
            dir: join(dir, 'generated', 'libraries', 'typescript-react-hooks'),
            fullyQualifiedName: `${fullyQualifiedApiName}-typescript-react-hooks`,
          }
        : undefined,
    },
  };

  // Generate the model if needed
  if (!tree.exists(options.model.dir)) {
    switch (schema.modelLanguage) {
      case 'typespec': {
        await typeSpecRestModelGenerator(tree, options);
        break;
      }
      case 'openapi': {
        await openApiRestModelGenerator(tree, options);
        break;
      }
      default: {
        throw new Error(
          `Model language ${schema.modelLanguage} is not supported!`
        );
      }
    }
  }

  if (!tree.exists(options.infrastructure.dir)) {
    switch (options.infrastructureLanguage) {
      case 'typescript': {
        await typeScriptRestInfrastructureGenerator(tree, options);
        break;
      }
      default: {
        throw new Error(
          `Infrastructure language ${options.infrastructureLanguage} is not supported!`
        );
      }
    }
  }

  for (const handlerLanguage of options.handlerLanguages) {
    switch (handlerLanguage) {
      case 'typescript': {
        if (!tree.exists(options.handlers.typescript!.dir)) {
          await typeScriptRestHandlersGenerator(tree, options);
        }
        break;
      }
      default: {
        throw new Error(
          `Handler language ${handlerLanguage} is not supported!`
        );
      }
    }
  }

  for (const runtimeLanguage of options.runtimeLanguages) {
    switch (runtimeLanguage) {
      case 'typescript': {
        if (!tree.exists(options.runtime.typescript!.dir)) {
          await typeScriptRestRuntimeGenerator(tree, options);
        }
        break;
      }
      default: {
        throw new Error(
          `Runtime language ${runtimeLanguage} is not supported!`
        );
      }
    }
  }

  for (const library of options.libraries) {
    switch (library) {
      case 'typescript-react-hooks': {
        if (!tree.exists(options.library.typescriptHooks!.dir)) {
          await typeScriptRestHooksLibraryGenerator(tree, options);
        }
        break;
      }
      default: {
        throw new Error(`Library ${library} is not supported!`);
      }
    }
  }

  // Add the shared construct for the api
  if (options.infrastructureLanguage === 'typescript') {
    await addTypeScriptSharedConstructs(tree, options);
  }

  return () => {
    installPackagesTask(tree);
  };
};

const addTypeScriptSharedConstructs = async (
  tree: Tree,
  options: InferredTypeSafeRestApiSchema
) => {
  // Call shared constructs generator for API wrapper construct
  await sharedConstructsGenerator(tree);

  const constructsPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    options.nameKebabCase,
    'index.ts'
  );

  if (!tree.exists(constructsPath)) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
      {
        ...options,
        generatedInfrastructurePackage: toScopeAlias(
          options.infrastructure.typescript!.fullyQualifiedName
        ),
      }
    );

    addDependenciesToPackageJson(
      tree,
      withVersions(['constructs', 'aws-cdk-lib']),
      {}
    );

    const sharedConstructsIndexTsPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'index.ts'
    );

    writeExportDeclarations(tree, sharedConstructsIndexTsPath, [
      `./${options.nameKebabCase}/index.js`,
    ]);
  }
};

export default typeSafeRestApiGenerator;
