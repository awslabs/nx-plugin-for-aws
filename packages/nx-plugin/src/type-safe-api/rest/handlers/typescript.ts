/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, Tree, updateProjectConfiguration } from "@nx/devkit";
import { InferredTypeSafeRestApiSchema } from "../schema";
import { buildGenerateTarget } from "../../utils/generate-target";
import { _tsLibGenerator } from "../../../ts/lib/generator";
import { updateGitIgnore } from "../../../utils/gitignore";
import { toScopeAlias } from "../../../utils/npm-scope";
import { join } from "path";
import { addGeneratedExplicitTypeScriptDependency } from "../../utils/generated-ts-lib";


export const typeScriptRestHandlersGenerator = async (tree: Tree, schema: InferredTypeSafeRestApiSchema) => {
  const { dir, fullyQualifiedName, assetPath: bundleOutputDir } = schema.handlers.typescript!;

  await _tsLibGenerator(tree, {
    ...schema.handlers.typescript!,
    unitTestRunner: 'vitest',
    linter: 'eslint',
  });

  if (tree.exists(join(dir, 'src', 'index.ts'))) {
    tree.write(join(dir, 'src', 'index.ts'), '');
  }

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
        templateDirs: ['typescript-lambda-handlers'],
        specPath: schema.model.outputSpecPath,
        outputPath: dir,
        metadata: {
          srcDir: 'src',
          tstDir: 'src', // vitest config is all set up for tests co-existing with source
          runtimePackageName: toScopeAlias(schema.runtime.typescript!.fullyQualifiedName),
          esm: true,
          vitest: true,
        },
      }),
      compile: {
        ...projectConfig.targets?.compile,
        dependsOn: ['generate', ...(projectConfig.targets?.compile?.dependsOn ?? [])],
      },
      test: {
        ...projectConfig.targets?.test,
        dependsOn: ['generate', ...(projectConfig.targets?.test?.dependsOn ?? [])],
      },
      bundle: {
        executor: "nx:run-commands",
        options: {
          commands: [
            `rm -rf "${bundleOutputDir}" && mkdir -p "${bundleOutputDir}"`,
            `esbuild --bundle "${join(dir, "src", "*.ts")}" --platform=node --outdir="${bundleOutputDir}" --target=node18`,
            `for f in $(ls "${bundleOutputDir}"); do mkdir "${bundleOutputDir}/$(basename $f .js)" && mv "${bundleOutputDir}/$f" "${bundleOutputDir}/$(basename $f .js)/index.js"; done`,
          ],
          parallel: false,
        },
        dependsOn: ["compile"],
      },
      build: {
        ...projectConfig.targets?.build,
        dependsOn: ['bundle', ...(projectConfig.targets?.build?.dependsOn ?? [])],
      },
    },
  });

  addGeneratedExplicitTypeScriptDependency(tree, schema.handlers.typescript!, schema.runtime.typescript!);

  updateGitIgnore(tree, dir, (patterns) => [
    ...patterns,
    ".tsapi-manifest",
  ]);
};
