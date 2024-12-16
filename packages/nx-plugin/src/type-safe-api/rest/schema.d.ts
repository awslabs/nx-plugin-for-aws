/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Linter } from '@nx/eslint';
import { Bundler, LibraryGeneratorSchema } from '@nx/js/src/utils/schema';

export type ModelLanguage = 'openapi' | 'smithy' | 'typespec';
export type Language = 'typescript' | 'java' | 'python';
export type Library = 'typescript-react-hooks';

export interface TypeSafeRestApiGeneratorSchema {
  name: string;
  modelLanguage: ModelLanguage;
  infrastructureLanguage: Language;
  handlerLanguages: Language[];
  libraries: Library[];
  runtimeLanguages: Language[];
  scope?: string;
  directory?: string;
  subDirectory?: string;
}

export interface InferredTypeSafeRestApiSchema
  extends TypeSafeRestApiGeneratorSchema {
  readonly fullyQualifiedApiName: string;
  readonly nameKebabCase: string;
  readonly namePascalCase: string;
  readonly dir: string;
  readonly model: {
    readonly dir: string;
    readonly fullyQualifiedName: string;
    readonly outputSpecPath: string;
  };
  readonly runtime: {
    readonly dir: string;
    readonly typescript?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
    readonly java?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
    readonly python?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
  };
  readonly infrastructure: {
    readonly dir: string;
    readonly typescript?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
    readonly java?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
    readonly python?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
  };
  readonly handlers: {
    readonly dir: string;
    readonly typescript?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
      readonly assetPath: string;
    };
    readonly python?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
      readonly assetPath: string;
      readonly moduleName: string;
    };
    readonly java?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
      readonly assetPath: string;
      readonly packageName: string;
    };
  };
  readonly library: {
    readonly dir: string;
    readonly typescriptHooks?: {
      readonly dir: string;
      readonly fullyQualifiedName: string;
    };
  };
}
