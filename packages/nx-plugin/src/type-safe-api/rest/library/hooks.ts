/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addDependenciesToPackageJson, readProjectConfiguration, Tree, updateJson, updateProjectConfiguration } from "@nx/devkit";
import { generatedTsLibGenerator } from "../../utils/generated-ts-lib";
import { InferredTypeSafeRestApiSchema } from "../schema";
import { buildGenerateTarget } from "../../utils/generate-target";
import { withVersions } from "../../../utils/versions";
import { join } from "path";


export const typeScriptRestHooksLibraryGenerator = async (tree: Tree, schema: InferredTypeSafeRestApiSchema) => {
  const { dir, fullyQualifiedName } = schema.library.typescriptHooks!;

  await generatedTsLibGenerator(tree, {
    ...schema.library.typescriptHooks!,
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
        templateDirs: ['typescript/templates/client', 'typescript-react-query-hooks'],
        excludeTemplates: ['**/README.md.ejs'],
        specPath: schema.model.outputSpecPath,
        outputPath: dir,
        metadata: {
          srcDir: 'src',
          esm: true,
          queryV5: true,
        },
      }),
      compile: {
        ...projectConfig.targets?.compile,
        dependsOn: ['generate', ...(projectConfig.targets?.compile?.dependsOn ?? [])],
      },
    },
    implicitDependencies: [...(projectConfig.implicitDependencies ?? []), schema.model.fullyQualifiedName],
  });

  updateJson(tree, join(dir, "tsconfig.lib.json"), (tsConfig) => ({
    ...tsConfig,
    jsx: "react-jsx",
  }));

  addDependenciesToPackageJson(tree, withVersions([
    "@tanstack/react-query",
    "react",
    "@types/react",
  ]), {});
};
