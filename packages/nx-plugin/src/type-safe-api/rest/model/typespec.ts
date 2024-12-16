/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addDependenciesToPackageJson, addProjectConfiguration, generateFiles, Tree } from "@nx/devkit";
import { InferredTypeSafeRestApiSchema } from "../schema";
import { join } from "path";
import { withVersions } from "../../../utils/versions";


export const typeSpecRestModelGenerator = async (tree: Tree, options: InferredTypeSafeRestApiSchema) => {
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
            `tsp compile ${join(options.model.dir, "src")} --config ${join(options.model.dir, "tspconfig.yaml")}`,
            `type-safe-api parse-openapi-spec --specPath ${join("dist", options.model.dir, "openapi", "@typespec", "openapi3", "openapi.json")} --outputPath ${options.model.outputSpecPath}`,
          ],
          parallel: false,
        },
      },
    },
  });

  addDependenciesToPackageJson(tree, {}, withVersions([
    "@typespec/compiler",
    "@typespec/http",
    "@typespec/openapi",
    "@typespec/openapi3"
  ]));

  generateFiles(tree, join(__dirname, "..", "files", "model", "typespec"), join(options.model.dir), {
    ...options,
  });
};
