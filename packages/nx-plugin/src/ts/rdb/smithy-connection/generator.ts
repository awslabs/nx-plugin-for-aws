/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import camelCase from 'lodash.camelcase';
import {
  addDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { pascalCase } from '../../../utils/names';
import { toScopeAlias } from '../../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import type { TsRdbSmithyConnectionGeneratorSchema } from './schema';

export const TS_RDB_SMITHY_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbSmithyConnectionGenerator = async (
  tree: Tree,
  options: TsRdbSmithyConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  if (sourceProject.targets?.['dev']) {
    addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  const rdbBaseName = targetProject.name.split('/').pop();
  const rdbNameCamel = camelCase(rdbBaseName);
  const rdbNamePascal = pascalCase(rdbBaseName);
  const rdbPackageAlias = toScopeAlias(targetProject.name);
  const getterAlias = `getPrisma as get${rdbNamePascal}`;

  const contextPath = joinPathFragments(sourceProject.root, 'src/context.ts');
  const handlerPath = joinPathFragments(sourceProject.root, 'src/handler.ts');
  const localServerPath = joinPathFragments(
    sourceProject.root,
    'src/local-server.ts',
  );

  if (tree.exists(contextPath)) {
    await addDestructuredImport(
      tree,
      contextPath,
      [getterAlias],
      rdbPackageAlias,
    );

    await applyGritQL(
      tree,
      contextPath,
      `\`interface ServiceContext { $members }\` where {
        $members <: not some \`${rdbNameCamel}: $_\`,
        $members += \`\n  ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>>\`
      }`,
    );
  }

  if (tree.exists(handlerPath)) {
    await addDestructuredImport(
      tree,
      handlerPath,
      [getterAlias],
      rdbPackageAlias,
    );

    const alreadyHasDecl = await matchGritQL(
      tree,
      handlerPath,
      `\`const ${rdbNameCamel} = await get${rdbNamePascal}()\``,
    );
    if (!alreadyHasDecl) {
      await applyGritQL(
        tree,
        handlerPath,
        `\`const httpResponse = await serviceHandler.handle($req, $ctx)\` => \`const ${rdbNameCamel} = await get${rdbNamePascal}();\n  const httpResponse = await serviceHandler.handle($req, $ctx)\``,
      );
    }

    await applyGritQL(
      tree,
      handlerPath,
      `\`serviceHandler.handle($req, { $props })\` where {
        $props <: not some \`${rdbNameCamel}\`,
        $props += \`\n    ${rdbNameCamel}\`
      }`,
    );
  }

  if (tree.exists(localServerPath)) {
    await addDestructuredImport(
      tree,
      localServerPath,
      [getterAlias],
      rdbPackageAlias,
    );

    const alreadyHasDeclLocal = await matchGritQL(
      tree,
      localServerPath,
      `\`const ${rdbNameCamel} = await get${rdbNamePascal}()\``,
    );
    if (!alreadyHasDeclLocal) {
      await applyGritQL(
        tree,
        localServerPath,
        `\`const httpResponse = await serviceHandler.handle($req, $ctx)\` => \`const ${rdbNameCamel} = await get${rdbNamePascal}();\n  const httpResponse = await serviceHandler.handle($req, $ctx)\``,
      );
    }

    await applyGritQL(
      tree,
      localServerPath,
      `\`serviceHandler.handle($req, { $props })\` where {
        $props <: not some \`${rdbNameCamel}\`,
        $props += \`\n    ${rdbNameCamel}\`
      }`,
    );
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_SMITHY_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbSmithyConnectionGenerator;
