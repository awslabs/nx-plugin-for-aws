/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addDependenciesToPackageJson, readProjectConfiguration, Tree, updateProjectConfiguration } from "@nx/devkit";
import { InferredTypeSafeRestApiSchema } from "../schema";
import { buildGenerateTarget } from "../../utils/generate-target";
import { withVersions } from "../../../utils/versions";
import { toScopeAlias } from "../../../utils/npm-scope";
import { addGeneratedExplicitTypeScriptDependency, generatedTsLibGenerator } from "../../utils/generated-ts-lib";
import { getRelativePathWithinTree } from "../../../utils/paths";
import { join } from "path";
import { updateGitIgnore } from "../../../utils/gitignore";

export const typeScriptRestInfrastructureGenerator = async (tree: Tree, schema: InferredTypeSafeRestApiSchema) => {
  const { dir, fullyQualifiedName } = schema.infrastructure.typescript!;

  await generatedTsLibGenerator(tree, {
    ...schema.infrastructure.typescript!,
  });

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  updateProjectConfiguration(tree, fullyQualifiedName, {
    ...projectConfig,
    metadata: {
      ...projectConfig.metadata,
      apiName: schema.name,
    } as unknown,
    targets: {
      ...projectConfig.targets,
      generate: buildGenerateTarget({
        modelFullyQualifiedName: schema.model.fullyQualifiedName,
        templateDirs: ['typescript-cdk-infrastructure'],
        specPath: schema.model.outputSpecPath,
        outputPath: dir,
        cacheOutputs: ["mocks"],
        metadata: {
          srcDir: 'src',
          runtimePackageName: toScopeAlias(schema.runtime.typescript!.fullyQualifiedName),
          relativeSpecPath: join("..", getRelativePathWithinTree(tree, dir, schema.model.outputSpecPath)),
          enableMockIntegrations: true,
          ...(schema.handlers.typescript ? {
            "x-handlers-typescript-asset-path": getRelativePathWithinTree(tree, dir, schema.handlers.typescript.assetPath),
          } : {}),
          ...(schema.handlers?.python ? {
            "x-handlers-python-asset-path": getRelativePathWithinTree(tree, dir, schema.handlers.python.assetPath),
            "x-handlers-python-module": schema.handlers.python.moduleName,
          } : {}),
          ...(schema.handlers?.java ? {
            "x-handlers-java-asset-path": getRelativePathWithinTree(tree, dir, schema.handlers.java.assetPath),
            "x-handlers-java-package": schema.handlers.java.packageName,
          } : {}),
          "x-handlers-node-lambda-runtime-version": "NODEJS_20_X",
          "x-handlers-python-lambda-runtime-version": "PYTHON_3_12",
          "x-handlers-java-lambda-runtime-version": "JAVA_21",
          esm: true,
        },
      }),
      mocks: {
        executor: 'nx:run-commands',
        options: {
          parallel: false,
          commands: [
            `type-safe-api generate-mock-data --specPath "${schema.model.outputSpecPath}" --outputPath "${dir}"`,
          ],
        },
        dependsOn: [{
          projects: [schema.model.fullyQualifiedName], target: "build",
        }],
      },
      compile: {
        ...projectConfig.targets?.compile,
        dependsOn: ['generate', ...(projectConfig.targets?.compile?.dependsOn ?? [])],
      },
      build: {
        ...projectConfig.targets?.build,
        dependsOn: ['mocks', ...(projectConfig.targets?.build?.dependsOn ?? [])],
      },
    },
    implicitDependencies: [...(projectConfig.implicitDependencies ?? []), schema.model.fullyQualifiedName],
  });

  addGeneratedExplicitTypeScriptDependency(tree, schema.infrastructure.typescript!, schema.runtime.typescript!);

  updateGitIgnore(tree, dir, (patterns) => [
    ...patterns,
    "mocks",
  ]);

  addDependenciesToPackageJson(tree, withVersions([
    "@aws/pdk",
    "aws-cdk-lib",
    "constructs",
  ]), {});
};
