/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsRdbMcpServerConnectionGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { formatFilesInSubtree } from '../../../utils/format';
import { pascalCase } from '../../../utils/names';
import camelCase from 'lodash.camelcase';
import { toScopeAlias } from '../../../utils/npm-scope';
import { addDestructuredImport, applyGritQL } from '../../../utils/ast';

export const TS_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbMcpServerConnectionGenerator = async (
  tree: Tree,
  options: TsRdbMcpServerConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const mcpServerName = options.sourceComponent?.name ?? 'mcp-server';
  const serveLocalTarget = `${mcpServerName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTarget, {
      projects: [targetProject.name],
      target: 'serve-local',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  const rdbBaseName = targetProject.name.split('/').pop();
  const rdbNameCamel = camelCase(rdbBaseName);
  const rdbNamePascal = pascalCase(rdbBaseName);
  const rdbPackageAlias = toScopeAlias(targetProject.name);
  const getterAlias = `getPrisma as get${rdbNamePascal}`;

  const serverPath = joinPathFragments(
    sourceProject.root,
    'src',
    mcpServerName,
    'server.ts',
  );

  // server.ts: inject db inside createServer body
  if (tree.exists(serverPath)) {
    await addDestructuredImport(
      tree,
      serverPath,
      [getterAlias],
      rdbPackageAlias,
    );

    await applyGritQL(
      tree,
      serverPath,
      `\`export const createServer = async () => { $body }\` => raw\`export const createServer = async () => {
  const ${rdbNameCamel} = await get${rdbNamePascal}();
  $body
}\` where { $body <: not some \`const ${rdbNameCamel} = await get${rdbNamePascal}()\` }`,
    );

    // Add $on error handler after the db declaration.
    // Done via string replacement because GritQL treats $on as a metavariable.
    const dbDecl = `const ${rdbNameCamel} = await get${rdbNamePascal}();`;
    const onCall = `${rdbNameCamel}.$on('error' as never, (e) => {\n    console.log(e);\n  });`;
    const content = tree.read(serverPath, 'utf-8')!;
    if (content.includes(dbDecl) && !content.includes(`${rdbNameCamel}.$on`)) {
      tree.write(serverPath, content.replace(dbDecl, `${dbDecl}\n  ${onCall}`));
    }
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbMcpServerConnectionGenerator;
