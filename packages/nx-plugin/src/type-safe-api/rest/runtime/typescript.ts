/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addDependenciesToPackageJson, readProjectConfiguration, Tree, updateProjectConfiguration } from "@nx/devkit";
import { InferredTypeSafeRestApiSchema } from "../schema";
import { buildGenerateTarget } from "../../utils/generate-target";
import { withVersions } from "../../../utils/versions";
import { generatedTsLibGenerator } from "../../utils/generated-ts-lib";


export const typeScriptRestRuntimeGenerator = async (tree: Tree, schema: InferredTypeSafeRestApiSchema) => {
  const { dir, fullyQualifiedName } = schema.runtime.typescript!;

  await generatedTsLibGenerator(tree, {
    ...schema.runtime.typescript!,
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
        templateDirs: ['typescript'],
        specPath: schema.model.outputSpecPath,
        outputPath: dir,
        metadata: {
          srcDir: 'src',
          esm: true,
        },
      }),
      compile: {
        ...projectConfig.targets?.compile,
        dependsOn: ['generate', ...(projectConfig.targets?.compile?.dependsOn ?? [])],
      },
    },
    implicitDependencies: [...(projectConfig.implicitDependencies ?? []), schema.model.fullyQualifiedName],
  });

  addDependenciesToPackageJson(tree, withVersions([
    "@aws-lambda-powertools/tracer",
    "@aws-lambda-powertools/logger",
    "@aws-lambda-powertools/metrics",
  ]), withVersions([
    "@types/aws-lambda",
  ]));
};
