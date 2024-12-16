/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { GeneratorCallback, readProjectConfiguration, Tree, updateJson, updateProjectConfiguration } from "@nx/devkit";
import { _tsLibGenerator, TsLibGeneratorOptions } from "../../ts/lib/generator";
import { join } from "path";
import { updateGitIgnore } from "../../utils/gitignore";
import { ConfigureProjectOptions } from "../../ts/lib/types";
import { getRelativePathWithinTree } from "../../utils/paths";


/**
 * Generate a typescript library which will contain generated code
 */
export const generatedTsLibGenerator = async (tree: Tree, schema: Pick<TsLibGeneratorOptions, 'dir' | 'fullyQualifiedName'>): Promise<GeneratorCallback> => {
  const callback = await _tsLibGenerator(tree, {
    ...schema,
    unitTestRunner: 'none',
    linter: 'none',
    skipFormat: true,
  });

  updateJson(tree, join(schema.dir, "tsconfig.lib.json"), (tsconfig) => ({
    ...tsconfig,
    compilerOptions: {
      ...tsconfig.compilerOptions,
      // Generated code is not very strict!
      strict: false,
      alwaysStrict: false,
      noImplicitAny: false,
      noImplicitReturns: false,
      noImplicitThis: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
      strictNullChecks: false,
      strictPropertyInitialization: false,
      skipLibCheck: true,
      // Add Dom types
      lib: [
        ...(tsconfig.compilerOptions?.lib ?? []),
        'dom',
      ],
    },
  }));

  updateGitIgnore(tree, schema.dir, (patterns) => [
    ...patterns,
    "src",
    ".tsapi-manifest",
  ]);

  // Update build to only depend on compile - do not run lint/test
  const projectConfiguration = readProjectConfiguration(tree, schema.fullyQualifiedName);
  projectConfiguration.targets.lint = undefined;
  projectConfiguration.targets.test = undefined;
  projectConfiguration.targets.build = {
    dependsOn: ["compile"],
  };
  updateProjectConfiguration(tree, schema.fullyQualifiedName, projectConfiguration);

  return callback;
};


export const addGeneratedExplicitTypeScriptDependency = (tree: Tree, source: ConfigureProjectOptions, target: ConfigureProjectOptions) => {
  // Add an implicit dependency, since Nx won't be able to determine the relationship from code
  // when it computes the project graph, as code is generated later at build time
  const sourceProjectConfig = readProjectConfiguration(tree, source.fullyQualifiedName);
  updateProjectConfiguration(tree, source.fullyQualifiedName, {
    ...sourceProjectConfig,
    implicitDependencies: [...(sourceProjectConfig.implicitDependencies ?? []), target.fullyQualifiedName],
  });

  // Nx won't add the project references for implicit dependencies, so we must add this manually
  const sourceTsConfigPath = join(source.dir, "tsconfig.lib.json");
  const targetTsConfigPath = join(target.dir, "tsconfig.lib.json");
  if (tree.exists(sourceTsConfigPath) && tree.exists(targetTsConfigPath)) {
    updateJson(tree, sourceTsConfigPath, (tsConfig) => ({
      ...tsConfig,
      references: [
        ...(tsConfig.references ?? []),
        { path: join(getRelativePathWithinTree(tree, source.dir, target.dir), "tsconfig.lib.json") },
      ],
    }));
  }
};
