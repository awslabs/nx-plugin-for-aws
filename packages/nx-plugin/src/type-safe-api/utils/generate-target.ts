/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TargetConfiguration } from "@nx/devkit";

export interface GenerateTargetOptions {
  readonly modelFullyQualifiedName: string;
  readonly specPath: string;
  readonly outputPath: string;
  readonly templateDirs: string[];
  readonly excludeTemplates?: string[];
  readonly metadata?: { [key: string]: any };
  readonly cacheOutputs?: string[];
}

export const buildGenerateTarget = (options: GenerateTargetOptions): TargetConfiguration => {
  const templateDirs = options.templateDirs.map((t) => `"${t}"`).join(' ');
  const metadata = options.metadata ? ` --metadata '${JSON.stringify(options.metadata)}'` : '';
  const excludeTemplates = options.excludeTemplates ? ` --excludeTemplates ${options.excludeTemplates.map(t => `'${t}'`)}` : '';
  return {
    executor: 'nx:run-commands',
    cache: true,
    options: {
      parallel: false,
      commands: [
        `type-safe-api generate --specPath "${options.specPath}" --outputPath "${options.outputPath}" --templateDirs ${templateDirs}${excludeTemplates}${metadata}`
      ],
    },
    dependsOn: [{
      projects: [options.modelFullyQualifiedName], target: "build",
    }],
    outputs: [
      '.tsapi-manifest',
      ...(options.metadata?.srcDir ? [options.metadata.srcDir] : []),
      ...(options.cacheOutputs ?? []),
    ].map(o => `{projectRoot}/${o}`),
  };
};
