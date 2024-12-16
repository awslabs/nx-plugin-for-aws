/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, generateFiles, Tree } from "@nx/devkit";
import { InferredTypeSafeRestApiSchema } from "../schema";
import { join } from "path";

export const openApiRestModelGenerator = async (tree: Tree, options: InferredTypeSafeRestApiSchema) => {
  addProjectConfiguration(tree, options.model.fullyQualifiedName, {
    root: options.model.dir,
    name: options.model.fullyQualifiedName,
    metadata: {
      apiName: options.name,
    } as unknown,
    targets: {
      build: {
        executor: "nx:run-commands",
        cache: true,
        options: {
          commands: [
            `type-safe-api parse-openapi-spec --specPath ${join(options.model.dir, "src", "main.yaml")} --outputPath ${options.model.outputSpecPath}`,
          ],
          parallel: false,
        },
      },
    },
  });

  generateFiles(tree, join(__dirname, "..", "files", "model", "openapi"), join(options.model.dir), {
    ...options,
  });
};
